import { createHash, randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

const PAYMENT_MODES = [
  "Cheque",
  "NEFT",
  "RTGS",
  "IMPS",
  "UPI",
  "Cash",
  "Bank Transfer",
  "Adjustment",
  "Other",
] as const;

const BANK_MODES = new Set([
  "Cheque",
  "NEFT",
  "RTGS",
  "IMPS",
  "UPI",
  "Bank Transfer",
]);

export interface DispatchPaymentPayload {
  paymentMode: (typeof PAYMENT_MODES)[number];
  paymentDate: string;
  bankId?: string | null;
  transactionId?: string | null;
  paymentAmount: number;
  remarks?: string | null;
}

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

async function writeAudit(
  connection: PoolConnection,
  actionType: string,
  entityId: string,
  actorUserId: string,
  actorRole: string | undefined,
  changeSummary: Record<string, unknown>
) {
  await connection.execute(
    `INSERT INTO finance_action_audit_log
       (id, action_type, entity_type, entity_id, actor_user_id, actor_role, change_summary)
     VALUES (?, ?, 'VENDOR_PAYMENT', ?, ?, ?, ?)`,
    [
      randomUUID(),
      actionType,
      entityId,
      actorUserId,
      actorRole ?? null,
      JSON.stringify(changeSummary),
    ]
  );
}

async function lockedPayment(connection: PoolConnection, paymentId: string) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT *
       FROM vendor_payment_tracking
      WHERE id = ?
      FOR UPDATE`,
    [paymentId]
  );
  const payment = rows[0] as any;
  if (!payment) throw new Error("Vendor payment record not found");
  return payment;
}

function validatePaymentDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Payment date must be a valid date");
  }
  if (value > new Date().toISOString().slice(0, 10)) {
    throw new Error("Payment date cannot be in the future");
  }
}

function paymentReferenceLockName(
  paymentMode: string,
  bankId: string | null,
  transactionId: string
) {
  return createHash("sha256")
    .update(`${paymentMode}|${bankId ?? ""}|${transactionId.trim().toUpperCase()}`)
    .digest("hex");
}

export const vendorPaymentLedgerService = {
  async listTransactions(paymentId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT t.*, bm.ifsc_prefix
         FROM vendor_payment_transaction t
         LEFT JOIN bank_master bm ON bm.id = t.bank_id
        WHERE t.vendor_payment_id = ?
        ORDER BY t.sequence_no ASC, t.created_at ASC`,
      [paymentId]
    );
    return rows;
  },

  async dispatch(
    paymentId: string,
    payload: DispatchPaymentPayload,
    actorUserId: string,
    actorRole?: string
  ) {
    if (!PAYMENT_MODES.includes(payload.paymentMode)) {
      throw new Error("Invalid payment mode");
    }
    validatePaymentDate(payload.paymentDate);

    const amount = roundMoney(Number(payload.paymentAmount));
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Payment amount must be greater than zero");
    }

    const connection = await db.getConnection();
    let transactionRowId = "";
    let auditSummary: Record<string, unknown> = {};
    let referenceLock: string | null = null;
    try {
      await connection.beginTransaction();
      const payment = await lockedPayment(connection, paymentId);
      if (["Paid", "Closed", "Rejected"].includes(String(payment.payment_status))) {
        throw new Error(`Payment is locked in status ${payment.payment_status}`);
      }
      if (String(payment.payment_status) === "On Hold") {
        throw new Error("Release the payment hold before dispatching an installment");
      }

      const currentPaid = roundMoney(Number(payment.paid_amount ?? 0));
      const dueAmount = roundMoney(Number(payment.due_amount ?? 0));
      const balanceBefore = roundMoney(
        Number(payment.balance_amount ?? dueAmount - currentPaid)
      );
      if (amount - balanceBefore > 0.01) {
        throw new Error(
          `Payment amount ${amount.toFixed(2)} exceeds outstanding balance ${balanceBefore.toFixed(2)}`
        );
      }

      const externalTransactionId = payload.transactionId?.trim() || null;
      if (payload.paymentMode !== "Cash" && !externalTransactionId) {
        throw new Error("UTR / Cheque No. / transaction reference is required");
      }

      let bankName: string | null = null;
      const bankId = payload.bankId?.trim() || null;
      if (BANK_MODES.has(payload.paymentMode)) {
        if (!bankId) throw new Error("Bank is required for this payment mode");
        const [bankRows] = await connection.execute<RowDataPacket[]>(
          `SELECT bank_name
             FROM bank_master
            WHERE id = ? AND active_status = 1
            LIMIT 1`,
          [bankId]
        );
        if (!bankRows[0]) throw new Error("Selected bank is inactive or unavailable");
        bankName = String(bankRows[0].bank_name);
      }

      if (externalTransactionId) {
        referenceLock = paymentReferenceLockName(
          payload.paymentMode,
          bankId,
          externalTransactionId
        );
        const [lockRows] = await connection.query<RowDataPacket[]>(
          `SELECT GET_LOCK(?, 10) AS acquired`,
          [referenceLock]
        );
        if (Number(lockRows[0]?.acquired ?? 0) !== 1) {
          throw new Error("Payment reference is currently being processed; retry once");
        }

        const [duplicateRows] = await connection.execute<RowDataPacket[]>(
          `SELECT transaction_id
             FROM vendor_payment_transaction
            WHERE payment_mode = ?
              AND COALESCE(bank_id, '') = COALESCE(?, '')
              AND UPPER(transaction_id) = UPPER(?)
            LIMIT 1`,
          [payload.paymentMode, bankId, externalTransactionId]
        );
        if (duplicateRows[0]) {
          throw new Error("This transaction reference is already recorded");
        }
      }

      const [sequenceRows] = await connection.execute<RowDataPacket[]>(
        `SELECT COALESCE(MAX(sequence_no), 0) AS last_sequence
           FROM vendor_payment_transaction
          WHERE vendor_payment_id = ?`,
        [paymentId]
      );
      const sequenceNo = Number(sequenceRows[0]?.last_sequence ?? 0) + 1;
      transactionRowId = randomUUID();

      await connection.execute(
        `INSERT INTO vendor_payment_transaction
          (id, vendor_payment_id, grn_request_id, sequence_no, payment_mode,
           payment_date, bank_id, bank_name, transaction_id, amount, remarks,
           created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          transactionRowId,
          paymentId,
          payment.grn_request_id,
          sequenceNo,
          payload.paymentMode,
          payload.paymentDate,
          bankId,
          bankName,
          externalTransactionId,
          amount,
          payload.remarks?.trim() || null,
          actorUserId,
        ]
      );

      const paidAfter = roundMoney(currentPaid + amount);
      const balanceAfter = roundMoney(Math.max(0, dueAmount - paidAfter));
      const paymentStatus = balanceAfter <= 0.01 ? "Paid" : "Partially Paid";
      const grnStatus = paymentStatus === "Paid" ? "paid" : "partially_paid";
      const accountsStatus = paymentStatus === "Paid" ? "paid" : "partially_paid";

      const [updateResult] = await connection.execute<ResultSetHeader>(
        `UPDATE vendor_payment_tracking
            SET payment_mode = ?,
                payment_date = ?,
                bank_id = ?,
                bank_name = ?,
                transaction_id = ?,
                paid_amount = ?,
                balance_amount = ?,
                payment_status = ?,
                remarks = COALESCE(?, remarks),
                updated_by = ?,
                updated_at = NOW()
          WHERE id = ?`,
        [
          payload.paymentMode,
          payload.paymentDate,
          bankId,
          bankName,
          externalTransactionId,
          paidAfter,
          balanceAfter,
          paymentStatus,
          payload.remarks?.trim() || null,
          actorUserId,
          paymentId,
        ]
      );
      if (updateResult.affectedRows !== 1) {
        throw new Error("Vendor payment aggregate could not be updated");
      }

      await connection.execute(
        `UPDATE grn_request
            SET status = ?, accounts_payment_status = ?
          WHERE id = ?`,
        [grnStatus, accountsStatus, payment.grn_request_id]
      );

      auditSummary = {
        grn_number: payment.grn_number,
        installment_sequence: sequenceNo,
        payment_transaction_id: transactionRowId,
        external_transaction_id: externalTransactionId,
        payment_mode: payload.paymentMode,
        payment_date: payload.paymentDate,
        amount,
        paid_before: currentPaid,
        paid_after: paidAfter,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        payment_status: paymentStatus,
      };
      await writeAudit(
        connection,
        "VENDOR_PAYMENT_INSTALLMENT_DISPATCHED",
        paymentId,
        actorUserId,
        actorRole,
        auditSummary
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      if (referenceLock) {
        await connection.query(`SELECT RELEASE_LOCK(?)`, [referenceLock]).catch(() => undefined);
      }
      connection.release();
    }

    await logSensitiveAction({
      actor_user_id: actorUserId,
      actor_role: actorRole,
      action_type: "VENDOR_PAYMENT_INSTALLMENT_DISPATCHED",
      module_key: "FINANCE",
      entity_type: "vendor_payment_transaction",
      entity_id: transactionRowId,
      change_summary: auditSummary,
    }).catch(() => undefined);

    return {
      payment: await this.getPayment(paymentId),
      transactions: await this.listTransactions(paymentId),
    };
  },

  async setHold(
    paymentId: string,
    hold: boolean,
    reason: string | undefined,
    actorUserId: string,
    actorRole?: string
  ) {
    if (hold && !reason?.trim()) throw new Error("Hold reason is required");
    const connection = await db.getConnection();
    let nextStatus = "Payment Pending";
    let auditSummary: Record<string, unknown> = {};
    try {
      await connection.beginTransaction();
      const payment = await lockedPayment(connection, paymentId);
      if (["Paid", "Closed", "Rejected"].includes(String(payment.payment_status))) {
        throw new Error(`Payment is locked in status ${payment.payment_status}`);
      }

      const paidAmount = roundMoney(Number(payment.paid_amount ?? 0));
      nextStatus = hold
        ? "On Hold"
        : paidAmount > 0
          ? "Partially Paid"
          : "Payment Pending";
      const grnStatus = paidAmount > 0
        ? "partially_paid"
        : "pending_accounts_payment";
      const accountsStatus = hold
        ? "on_hold"
        : paidAmount > 0
          ? "partially_paid"
          : "pending";

      await connection.execute(
        `UPDATE vendor_payment_tracking
            SET payment_status = ?,
                remarks = COALESCE(?, remarks),
                updated_by = ?,
                updated_at = NOW()
          WHERE id = ?`,
        [nextStatus, reason?.trim() || null, actorUserId, paymentId]
      );
      await connection.execute(
        `UPDATE grn_request
            SET status = ?, accounts_payment_status = ?
          WHERE id = ?`,
        [grnStatus, accountsStatus, payment.grn_request_id]
      );

      auditSummary = {
        grn_number: payment.grn_number,
        hold,
        reason: reason?.trim() || null,
        from_status: payment.payment_status,
        to_status: nextStatus,
      };
      await writeAudit(
        connection,
        hold ? "VENDOR_PAYMENT_HELD" : "VENDOR_PAYMENT_HOLD_RELEASED",
        paymentId,
        actorUserId,
        actorRole,
        auditSummary
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    await logSensitiveAction({
      actor_user_id: actorUserId,
      actor_role: actorRole,
      action_type: hold ? "VENDOR_PAYMENT_HELD" : "VENDOR_PAYMENT_HOLD_RELEASED",
      module_key: "FINANCE",
      entity_type: "vendor_payment_tracking",
      entity_id: paymentId,
      change_summary: auditSummary,
    }).catch(() => undefined);

    return this.getPayment(paymentId);
  },

  async saveTransactionProof(
    paymentId: string,
    transactionRowId: string,
    fileName: string,
    filePath: string,
    fileMime: string,
    actorUserId: string,
    actorRole?: string
  ) {
    const connection = await db.getConnection();
    let auditSummary: Record<string, unknown> = {};
    try {
      await connection.beginTransaction();
      await lockedPayment(connection, paymentId);
      const [transactionRows] = await connection.execute<RowDataPacket[]>(
        `SELECT id, transaction_id, amount
           FROM vendor_payment_transaction
          WHERE id = ? AND vendor_payment_id = ?
          FOR UPDATE`,
        [transactionRowId, paymentId]
      );
      if (!transactionRows[0]) throw new Error("Payment installment was not found");

      await connection.execute(
        `UPDATE vendor_payment_transaction
            SET proof_file_name = ?, proof_file_path = ?, proof_file_mime = ?
          WHERE id = ?`,
        [fileName, filePath, fileMime, transactionRowId]
      );
      await connection.execute(
        `UPDATE vendor_payment_tracking
            SET payment_proof_file_name = ?,
                payment_proof_file_path = ?,
                payment_proof_file_mime = ?,
                updated_by = ?,
                updated_at = NOW()
          WHERE id = ?`,
        [fileName, filePath, fileMime, actorUserId, paymentId]
      );
      auditSummary = {
        payment_transaction_id: transactionRowId,
        external_transaction_id: transactionRows[0].transaction_id,
        amount: Number(transactionRows[0].amount),
        file_name: fileName,
        file_mime: fileMime,
      };
      await writeAudit(
        connection,
        "VENDOR_PAYMENT_INSTALLMENT_PROOF_UPLOADED",
        paymentId,
        actorUserId,
        actorRole,
        auditSummary
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    await logSensitiveAction({
      actor_user_id: actorUserId,
      actor_role: actorRole,
      action_type: "VENDOR_PAYMENT_INSTALLMENT_PROOF_UPLOADED",
      module_key: "FINANCE",
      entity_type: "vendor_payment_transaction",
      entity_id: transactionRowId,
      change_summary: auditSummary,
    }).catch(() => undefined);
  },

  async getPayment(paymentId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM vendor_payment_tracking WHERE id = ? LIMIT 1`,
      [paymentId]
    );
    return rows[0] ?? null;
  },
};
