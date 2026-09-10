import { createHash, randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

/**
 * A rejection the caller caused and can fix, tagged with the status it deserves.
 *
 * errorHandler only forwards an error's own message when the status is 4xx; anything else becomes
 * "An unexpected server error occurred" in production. Every rule below was a bare Error, so a
 * finance user who mistyped an amount saw that generic line instead of "exceeds outstanding
 * balance" — the one sentence that tells them what to change. These are data-entry corrections on
 * a record-keeping screen, not server faults, and they were also filling error monitoring with
 * false 500s.
 *
 * 400 for a value typed wrong, 404 for a record that is not there, 409 for a request that is
 * well-formed but conflicts with the record's current state.
 */
function requestError(statusCode: number, message: string): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

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
  /**
   * One payment voucher release can cover several GRNs of the same vendor with a single bank
   * transfer — that transfer carries exactly one UTR/reference, legitimately reused across every
   * GRN it settles. The duplicate-reference check below exists to catch a DIFFERENT payment
   * accidentally reusing an old reference, not this same-payment/same-voucher case, so the
   * caller (payment-voucher.service.ts's release(), looping dispatch() once per allocation) sets
   * this on every call after the first for one voucher.
   */
  allowSharedReference?: boolean;
  /**
   * Which of the company's own bank accounts (company_bank_account.id) this direct dispatch
   * paid out of — distinct from `bankId` above, which is only bank_master's generic bank-name
   * directory. Supplying this is what lets a direct "Pay" click (as opposed to a Payment Voucher
   * release) write its own bank_account_ledger_entry row, so Bank Reconciliation sees it too.
   * Left undefined when dispatch() is called from payment-voucher.service.ts's release() —
   * release() already writes its own ledger entry for that debit; see the callingVoucherId gate
   * below for why this must not also write one.
   */
  companyBankAccountId?: string | null;
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
  if (!payment) throw requestError(404, "Vendor payment record not found");
  return payment;
}

function validatePaymentDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw requestError(400, "Payment date must be a valid date");
  }
  if (value > new Date().toISOString().slice(0, 10)) {
    throw requestError(400, "Payment date cannot be in the future");
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
    actorRole?: string,
    externalConnection?: PoolConnection,
    /**
     * The payment_voucher this dispatch is the execution of, when called from
     * payment-voucher.service.ts's release(). At that moment the voucher is still
     * 'ceo_approved' — it only flips to 'released' after this call returns — so without
     * excluding it, the active-voucher guard below would find the very voucher being released
     * and block its own release. Left undefined for a direct dispatch from the Vendor Payment
     * Dispatch page, where any active voucher legitimately blocks.
     */
    callingVoucherId?: string
  ) {
    if (!PAYMENT_MODES.includes(payload.paymentMode)) {
      throw requestError(400, "Invalid payment mode");
    }
    validatePaymentDate(payload.paymentDate);

    const amount = roundMoney(Number(payload.paymentAmount));
    if (!Number.isFinite(amount) || amount <= 0) {
      throw requestError(400, "Payment amount must be greater than zero");
    }

    // Lets payment-voucher.service.ts's release() run this inside its own already-open
    // transaction (same shape vendor-payment.service.ts's updatePayment already uses) instead
    // of committing separately — a voucher release and the vendor-payment ledger row it
    // produces are one atomic unit, not two.
    const owns = !externalConnection;
    const connection = externalConnection ?? await db.getConnection();
    let transactionRowId = "";
    let auditSummary: Record<string, unknown> = {};
    let referenceLock: string | null = null;
    try {
      if (owns) await connection.beginTransaction();
      const payment = await lockedPayment(connection, paymentId);
      if (["Paid", "Closed", "Rejected"].includes(String(payment.payment_status))) {
        throw requestError(409, `Payment is locked in status ${payment.payment_status}`);
      }
      if (String(payment.payment_status) === "On Hold") {
        throw requestError(409, "Release the payment hold before dispatching an installment");
      }

      // A due can be paid two ways: directly from the Vendor Payment Dispatch page, or through
      // a Payment Voucher (Finance Head raises, CEO approves, Finance Head releases). Once a
      // voucher is in flight the voucher is the only legitimate route — a direct dispatch here
      // would pay money the CEO is still deciding on, and leave the voucher stranded.
      //
      // Runs inside the same transaction and row lock as the rest of dispatch(), so a voucher
      // raised concurrently with an in-flight dispatch is still caught.
      //
      // Status set mirrors ACTIVE_VOUCHER_STATUSES in vendor-payment.service.ts, which drives
      // the matching UI gate. Change one, change the other.
      const [activeVoucherRows] = await connection.execute<RowDataPacket[]>(
        `SELECT pv.id, pv.voucher_number, pv.status
           FROM payment_voucher_grn_allocation pvga
           JOIN payment_voucher pv ON pv.id = pvga.payment_voucher_id
          WHERE pvga.vendor_payment_tracking_id = ?
            AND pv.status IN ('raised','ceo_approved','changes_requested')
            AND pv.id <> ?
          ORDER BY pv.raised_at DESC
          LIMIT 1`,
        [paymentId, callingVoucherId ?? ""]
      );
      const activeVoucher = activeVoucherRows[0];
      if (activeVoucher) {
        throw requestError(
          409,
          `Payment Voucher ${activeVoucher.voucher_number} is already ${activeVoucher.status} for this due. Complete it through the voucher's Release action instead of a direct dispatch.`
        );
      }

      const currentPaid = roundMoney(Number(payment.paid_amount ?? 0));
      const dueAmount = roundMoney(Number(payment.due_amount ?? 0));
      const balanceBefore = roundMoney(
        Number(payment.balance_amount ?? dueAmount - currentPaid)
      );
      if (amount - balanceBefore > 0.01) {
        throw requestError(
          400,
          `Payment amount ${amount.toFixed(2)} exceeds outstanding balance ${balanceBefore.toFixed(2)}`
        );
      }

      // Optional for every mode, not just Cash — mirrors the same relaxation in
      // payment-voucher.service.ts's release(). Reconciliation matches purely on amount + date
      // (bank-reconciliation-match.service.ts's autoMatch), never on this reference, so requiring
      // it never actually protected reconciliation; it only ever gated the duplicate-reference
      // check below, which already correctly no-ops when this is blank.
      const externalTransactionId = payload.transactionId?.trim() || null;

      let bankName: string | null = null;
      const bankId = payload.bankId?.trim() || null;
      if (BANK_MODES.has(payload.paymentMode)) {
        if (!bankId) throw requestError(400, "Bank is required for this payment mode");
        const [bankRows] = await connection.execute<RowDataPacket[]>(
          `SELECT bank_name
             FROM bank_master
            WHERE id = ? AND active_status = 1
            LIMIT 1`,
          [bankId]
        );
        if (!bankRows[0]) throw requestError(400, "Selected bank is inactive or unavailable");
        bankName = String(bankRows[0].bank_name);
      }

      const companyBankAccountId = payload.companyBankAccountId?.trim() || null;
      // Required once the org actually has a bank account configured — otherwise this fix is
      // trivially skippable by leaving the field blank, and the bank ledger stays incomplete for
      // exactly the payments this was meant to catch. Exempt when called from
      // payment-voucher.service.ts's release() (callingVoucherId set): that caller writes its own
      // ledger entry using the voucher's own bank_account_id, so it never supplies this field.
      // A fresh/test tenant with zero bank accounts configured is unaffected either way.
      if (BANK_MODES.has(payload.paymentMode) && !callingVoucherId && !companyBankAccountId) {
        const [[anyAccount]] = await connection.execute<RowDataPacket[]>(
          `SELECT id FROM company_bank_account WHERE active_status = 1 LIMIT 1`
        );
        if (anyAccount) throw requestError(400, "Bank account is required for this payment mode");
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
          throw requestError(409, "Payment reference is currently being processed; retry once");
        }

        if (!payload.allowSharedReference) {
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
            throw requestError(409, "This transaction reference is already recorded");
          }
        }
      }

      // TDS: read vendor settings via the GRN's vendor_id link.
      const [vendorTdsRows] = await connection.execute<RowDataPacket[]>(
        `SELECT vm.tds_enabled, vm.tds_rate, vm.tds_section
           FROM grn_request gr
           JOIN vendor_master vm ON vm.id = gr.vendor_id
          WHERE gr.id = ?
          LIMIT 1`,
        [payment.grn_request_id]
      );
      const tdsEnabled = Number(vendorTdsRows[0]?.tds_enabled ?? 0) === 1;
      const tdsRatePct = tdsEnabled ? roundMoney(Number(vendorTdsRows[0]?.tds_rate ?? 0)) : 0;
      const tdsSection: string | null = tdsEnabled
        ? (String(vendorTdsRows[0]?.tds_section ?? "").trim() || null)
        : null;
      const tdsAmount = tdsEnabled && tdsRatePct > 0
        ? roundMoney(amount * tdsRatePct / 100)
        : 0;
      const netAmount = roundMoney(amount - tdsAmount);

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
           payment_date, bank_id, company_bank_account_id, bank_name, transaction_id, amount,
           tds_amount, tds_section, net_amount, remarks, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          transactionRowId,
          paymentId,
          payment.grn_request_id,
          sequenceNo,
          payload.paymentMode,
          payload.paymentDate,
          bankId,
          companyBankAccountId,
          bankName,
          externalTransactionId,
          amount,
          tdsAmount,
          tdsSection,
          netAmount,
          payload.remarks?.trim() || null,
          actorUserId,
        ]
      );

      const paidAfter = roundMoney(currentPaid + amount);
      const balanceAfter = roundMoney(Math.max(0, dueAmount - paidAfter));
      const paymentStatus = balanceAfter <= 0.01 ? "Paid" : "Partially Paid";
      const grnStatus = paymentStatus === "Paid" ? "paid" : "partially_paid";
      const accountsStatus = paymentStatus === "Paid" ? "paid" : "partially_paid";
      const tdsDeductedBefore = roundMoney(Number(payment.tds_deducted_amount ?? 0));

      const [updateResult] = await connection.execute<ResultSetHeader>(
        `UPDATE vendor_payment_tracking
            SET payment_mode = ?,
                payment_date = ?,
                bank_id = ?,
                bank_name = ?,
                transaction_id = ?,
                paid_amount = ?,
                tds_deducted_amount = ?,
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
          roundMoney(tdsDeductedBefore + tdsAmount),
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

      // Bank ledger write — the gap this fix closes. Gated on !callingVoucherId: when dispatch()
      // is called from payment-voucher.service.ts's release(), release() already writes its own
      // bank_account_ledger_entry row for this exact debit right after this call returns (it
      // knows the voucher's own bank_account_id independently) — writing one here too would
      // double-debit the account. A direct "Pay" click never carries a callingVoucherId, so this
      // only ever fires for the path that was genuinely missing a ledger entry.
      if (companyBankAccountId && !callingVoucherId) {
        const [[ledgerBankAccount]] = await connection.execute<RowDataPacket[]>(
          `SELECT id, opening_balance, active_status
             FROM company_bank_account WHERE id = ? FOR UPDATE`,
          [companyBankAccountId]
        );
        if (!ledgerBankAccount) throw requestError(404, "Bank account not found");
        if (!(ledgerBankAccount as any).active_status) throw requestError(400, "This bank account is closed");

        const [[lastEntry]] = await connection.execute<RowDataPacket[]>(
          `SELECT running_balance FROM bank_account_ledger_entry
             WHERE bank_account_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
          [companyBankAccountId]
        );
        let runningBalance = lastEntry
          ? Number((lastEntry as any).running_balance)
          : Number((ledgerBankAccount as any).opening_balance);

        const [[vendorPayableAccount]] = await connection.execute<RowDataPacket[]>(
          `SELECT id FROM payable_account_master WHERE account_name = 'Vendor Payables' LIMIT 1`
        );
        if (!vendorPayableAccount) throw requestError(500, "Vendor Payables ledger account is not configured");

        runningBalance = roundMoney(runningBalance - amount);
        await connection.execute(
          `INSERT INTO bank_account_ledger_entry
             (id, bank_account_id, entry_date, voucher_id, debit_amount, credit_amount,
              payable_account_id, narration, instrument_ref, running_balance, source_type, created_by)
           VALUES (?, ?, ?, NULL, ?, 0, ?, ?, ?, ?, 'direct_vendor_dispatch', ?)`,
          [
            randomUUID(),
            companyBankAccountId,
            payload.paymentDate,
            amount,
            (vendorPayableAccount as any).id,
            `Vendor payment dispatched — GRN ${payment.grn_number ?? payment.grn_request_id} — installment #${sequenceNo}`,
            externalTransactionId,
            runningBalance,
            actorUserId,
          ]
        );

        // Same zero-cash TDS liability memo the voucher-release lane writes, so a direct
        // dispatch's TDS withholding is just as visible in the ledger as a voucher-released one.
        if (tdsAmount > 0) {
          const [[tdsAccount]] = await connection.execute<RowDataPacket[]>(
            `SELECT id FROM payable_account_master WHERE account_name = 'TDS Payable' LIMIT 1`
          );
          if (tdsAccount) {
            await connection.execute(
              `INSERT INTO bank_account_ledger_entry
                 (id, bank_account_id, entry_date, voucher_id, debit_amount, credit_amount,
                  payable_account_id, narration, instrument_ref, running_balance, source_type, created_by)
               VALUES (?, ?, ?, NULL, 0, 0, ?, ?, NULL, ?, 'direct_vendor_dispatch', ?)`,
              [
                randomUUID(),
                companyBankAccountId,
                payload.paymentDate,
                (tdsAccount as any).id,
                `TDS withheld on GRN ${payment.grn_number ?? payment.grn_request_id} — direct dispatch installment #${sequenceNo} (liability memo, no cash movement)`,
                runningBalance,
                actorUserId,
              ]
            );
          }
        }
      }

      auditSummary = {
        grn_number: payment.grn_number,
        installment_sequence: sequenceNo,
        payment_transaction_id: transactionRowId,
        external_transaction_id: externalTransactionId,
        payment_mode: payload.paymentMode,
        payment_date: payload.paymentDate,
        amount,
        tds_amount: tdsAmount,
        tds_section: tdsSection,
        net_amount: netAmount,
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
      if (owns) await connection.commit();
    } catch (error) {
      if (owns) await connection.rollback();
      throw error;
    } finally {
      if (referenceLock) {
        await connection.query(`SELECT RELEASE_LOCK(?)`, [referenceLock]).catch(() => undefined);
      }
      if (owns) connection.release();
    }

    if (owns) {
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
    }

    // The caller owns this transaction and hasn't committed yet — a plain `db` read here
    // would go through a different, uncommitted-blind connection (or the row simply
    // wouldn't exist there yet). Return what was already computed in-memory instead; the
    // caller commits and does its own post-commit logging once the whole transaction lands.
    return {
      payment: { grn_number: (auditSummary as any).grn_number ?? null },
      transactions: [{ id: transactionRowId, tds_amount: (auditSummary as any).tds_amount ?? 0, net_amount: (auditSummary as any).net_amount ?? 0, sequence_no: (auditSummary as any).installment_sequence ?? null }],
    };
  },

  async setHold(
    paymentId: string,
    hold: boolean,
    reason: string | undefined,
    actorUserId: string,
    actorRole?: string
  ) {
    if (hold && !reason?.trim()) throw requestError(400, "Hold reason is required");
    const connection = await db.getConnection();
    let nextStatus = "Payment Pending";
    let auditSummary: Record<string, unknown> = {};
    try {
      await connection.beginTransaction();
      const payment = await lockedPayment(connection, paymentId);
      if (["Paid", "Closed", "Rejected"].includes(String(payment.payment_status))) {
        throw requestError(409, `Payment is locked in status ${payment.payment_status}`);
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
      if (!transactionRows[0]) throw requestError(404, "Payment installment was not found");

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
