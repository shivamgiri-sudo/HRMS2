import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { recordFinanceApprovalEvent, listFinanceApprovalEvents } from "../../shared/financeApprovalEvent.js";
import { vendorPaymentService } from "./vendor-payment.service.js";
import { imprestLedgerService } from "./imprest-ledger.service.js";
import { imprestService } from "./imprest.service.js";

/**
 * Payment Voucher — the authorization + release chain (PRD §3.4, §6.5, §6.6).
 *
 * Three different people, three different actions:
 *   raise()      Finance Head  — bank + payable account + remarks. Money has not moved yet.
 *   ceoApprove() CEO           — a yes/no on amount/purpose. Does not execute the transfer.
 *   release()    Accounts Head — actually executes the transfer, keys in the real
 *                                payment_mode/date/transaction_ref, and is the ONLY step that
 *                                writes vendor_payment_tracking / bank_account_ledger_entry /
 *                                the imprest ledger.
 *
 * Maker-checker is enforced here, not only by role — the same pairwise inequality checks
 * vendor-approval.service.ts and vendor-bank.service.ts already use for two-party
 * maker-checker ("a route guard proves a role, it cannot prove two different people"),
 * extended to three: raised_by != ceo_approved_by != released_by.
 *
 * source_type='sales_receipt' is declared on the table for a later phase; raise() refuses it
 * here rather than silently accepting a lane nothing downstream can release.
 *
 * Every mutating method follows the same shape as vendor-payment.service.ts's updatePayment:
 * open one connection, do everything in one transaction, commit, release the connection, and
 * only THEN do the non-transactional post-commit logging (logSensitiveAction) and the
 * plain-`db` re-read for the response — never inside the try/finally that owns the connection.
 */

export class PaymentVoucherError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** Must match vendor_payment_tracking.payment_mode and payment_voucher.payment_mode exactly —
 *  both ENUMs were declared identically on purpose (1703_payment_voucher.sql) so a released
 *  voucher's mode is always a value the existing vendor-payment report already understands. */
const PAYMENT_MODES = [
  "Cheque", "NEFT", "RTGS", "IMPS", "UPI", "Cash", "Bank Transfer", "Adjustment", "Other",
] as const;
const BANK_MODES = new Set(["Cheque", "NEFT", "RTGS", "IMPS", "UPI", "Bank Transfer"]);

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

async function writeVoucherAudit(
  connection: PoolConnection,
  actionType: string,
  voucherId: string,
  actorUserId: string,
  actorRole: string | undefined,
  changeSummary: Record<string, unknown>,
) {
  await connection.execute(
    `INSERT INTO finance_action_audit_log
       (id, action_type, entity_type, entity_id, actor_user_id, actor_role, change_summary)
     VALUES (?, ?, 'PAYMENT_VOUCHER', ?, ?, ?, ?)`,
    [randomUUID(), actionType, voucherId, actorUserId, actorRole ?? null, JSON.stringify(changeSummary)],
  );
}

/** PV/<branch_code>/<YYYYMM>/<seq> — carried into Tally VOUCHERNUMBER in a later phase.
 *  Sequence is a simple per-branch-per-month count; low-frequency path (vouchers, not
 *  attendance punches), so a UNIQUE-key collision is an acceptable, rare failure the caller
 *  simply retries rather than something this needs its own lock/loop for. */
async function nextVoucherNumber(connection: PoolConnection, bankAccountId: string): Promise<string> {
  const [[account]] = await connection.execute<RowDataPacket[]>(
    `SELECT b.branch_code
       FROM company_bank_account cba
       LEFT JOIN branch_master b ON b.id = cba.branch_id
      WHERE cba.id = ?`,
    [bankAccountId],
  );
  const branchCode = String((account as any)?.branch_code ?? "HQ").replace(/[^A-Za-z0-9]/g, "").toUpperCase() || "HQ";
  const yyyymm = new Date().toISOString().slice(0, 7).replace("-", "");
  const prefix = `PV/${branchCode}/${yyyymm}/`;
  const [[count]] = await connection.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM payment_voucher WHERE voucher_number LIKE ?`,
    [`${prefix}%`],
  );
  const seq = Number((count as any)?.n ?? 0) + 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

export interface RaiseVoucherInput {
  sourceType: "vendor_grn" | "imprest_allocation";
  bankAccountId: string;
  payableAccountId: string;
  linkedVendorPaymentId?: string | null;
  linkedImprestManagerId?: string | null;
  amount: number;
  remarks?: string | null;
  reason?: string | null;
  voucherType?: "payment" | "receipt";
}

function maskVoucherRow(row: any) {
  return { ...row, amount: Number(row.amount ?? 0) };
}

export const paymentVoucherService = {
  async list(filters: { status?: string; sourceType?: string; bankAccountId?: string; limit?: number }) {
    const conditions: string[] = ["1=1"];
    const params: unknown[] = [];
    if (filters.status) { conditions.push("pv.status = ?"); params.push(filters.status); }
    if (filters.sourceType) { conditions.push("pv.source_type = ?"); params.push(filters.sourceType); }
    if (filters.bankAccountId) { conditions.push("pv.bank_account_id = ?"); params.push(filters.bankAccountId); }
    const limit = Math.min(500, Math.max(1, filters.limit ?? 200));
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT pv.*,
              cba.account_name AS bank_account_name,
              pam.account_name AS payable_account_name,
              vpt.grn_number, vpt.vendor_name, vpt.due_amount AS vendor_due_amount,
              im.tally_name AS imprest_manager_name
         FROM payment_voucher pv
         LEFT JOIN company_bank_account cba ON cba.id = pv.bank_account_id
         LEFT JOIN payable_account_master pam ON pam.id = pv.payable_account_id
         LEFT JOIN vendor_payment_tracking vpt ON vpt.id = pv.linked_vendor_payment_id
         LEFT JOIN imprest_manager im ON im.id = pv.linked_imprest_manager_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY pv.created_at DESC
        LIMIT ${limit}`,
      params,
    );
    return (rows as RowDataPacket[]).map(maskVoucherRow);
  },

  async get(id: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT pv.*,
              cba.account_name AS bank_account_name,
              pam.account_name AS payable_account_name,
              vpt.grn_number, vpt.vendor_name, vpt.due_amount AS vendor_due_amount,
              vpt.tds_deducted_amount, vpt.paid_amount AS vendor_paid_amount,
              im.tally_name AS imprest_manager_name
         FROM payment_voucher pv
         LEFT JOIN company_bank_account cba ON cba.id = pv.bank_account_id
         LEFT JOIN payable_account_master pam ON pam.id = pv.payable_account_id
         LEFT JOIN vendor_payment_tracking vpt ON vpt.id = pv.linked_vendor_payment_id
         LEFT JOIN imprest_manager im ON im.id = pv.linked_imprest_manager_id
        WHERE pv.id = ?
        LIMIT 1`,
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    const [auditRows] = await db.execute<RowDataPacket[]>(
      `SELECT action_type, actor_user_id, actor_role, change_summary, created_at
         FROM finance_action_audit_log
        WHERE entity_type = 'PAYMENT_VOUCHER' AND entity_id = ?
        ORDER BY created_at DESC
        LIMIT 20`,
      [id],
    );
    // PRD §6.6's CA-grade detail: the CEO approving a float replenishment should see what the
    // float was actually spent on since it was last topped up, not just a number the manager
    // asked for. Only fetched for the lane it applies to.
    const consumptionSinceReplenishment = (row as any).source_type === "imprest_allocation" && (row as any).linked_imprest_manager_id
      ? await imprestService.getConsumptionSinceLastReplenishment(String((row as any).linked_imprest_manager_id))
      : null;

    return {
      ...maskVoucherRow(row),
      // The raise -> CEO-approve -> release timeline (drill-down mandate's "Approval / workflow
      // timeline" section) — same generic reader every other finance entity type uses.
      approval_events: await listFinanceApprovalEvents("payment_voucher", id),
      audit_log: auditRows,
      consumption_since_replenishment: consumptionSinceReplenishment,
    };
  },

  async raise(input: RaiseVoucherInput, actorUserId: string, actorRole?: string) {
    if ((input.sourceType as string) === "sales_receipt") {
      throw new PaymentVoucherError("Sales-receipt vouchers are not available yet — vendor_grn and imprest_allocation only.");
    }
    if (!["vendor_grn", "imprest_allocation"].includes(input.sourceType)) {
      throw new PaymentVoucherError("Invalid source type");
    }
    const amount = roundMoney(Number(input.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new PaymentVoucherError("Amount must be a positive number");
    }
    if (!input.bankAccountId) throw new PaymentVoucherError("Bank account is required");
    if (!input.payableAccountId) throw new PaymentVoucherError("Payable account is required");

    let id = "";
    let voucherNumber = "";
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [[bankAccount]] = await connection.execute<RowDataPacket[]>(
        `SELECT id, active_status FROM company_bank_account WHERE id = ? FOR UPDATE`,
        [input.bankAccountId],
      );
      if (!bankAccount) throw new PaymentVoucherError("Bank account not found", 404);
      if (!(bankAccount as any).active_status) throw new PaymentVoucherError("This bank account is closed");

      const [[payableAccount]] = await connection.execute<RowDataPacket[]>(
        `SELECT id, active_status FROM payable_account_master WHERE id = ?`,
        [input.payableAccountId],
      );
      if (!payableAccount) throw new PaymentVoucherError("Payable account not found", 404);
      if (!(payableAccount as any).active_status) throw new PaymentVoucherError("This payable account is inactive");

      if (input.sourceType === "vendor_grn") {
        if (!input.linkedVendorPaymentId) throw new PaymentVoucherError("A vendor GRN payment record must be selected");
        const [[vpt]] = await connection.execute<RowDataPacket[]>(
          `SELECT due_amount, tds_deducted_amount, paid_amount FROM vendor_payment_tracking WHERE id = ? FOR UPDATE`,
          [input.linkedVendorPaymentId],
        );
        if (!vpt) throw new PaymentVoucherError("Vendor payment record not found", 404);
        const remaining = roundMoney(
          Number((vpt as any).due_amount) - Number((vpt as any).tds_deducted_amount ?? 0) - Number((vpt as any).paid_amount ?? 0),
        );
        if (amount > remaining + 0.01) {
          throw new PaymentVoucherError(
            `Amount (${amount}) exceeds the remaining net-payable balance on this GRN (${remaining})`,
          );
        }
      } else {
        if (!input.linkedImprestManagerId) throw new PaymentVoucherError("An imprest manager must be selected");
        const [[manager]] = await connection.execute<RowDataPacket[]>(
          `SELECT id, active_status FROM imprest_manager WHERE id = ? FOR UPDATE`,
          [input.linkedImprestManagerId],
        );
        if (!manager) throw new PaymentVoucherError("Imprest manager not found", 404);
        if (!(manager as any).active_status) throw new PaymentVoucherError("This imprest manager is not active");
      }

      id = randomUUID();
      voucherNumber = await nextVoucherNumber(connection, input.bankAccountId);

      await connection.execute(
        `INSERT INTO payment_voucher
           (id, voucher_number, voucher_type, source_type, bank_account_id, payable_account_id,
            linked_vendor_payment_id, linked_imprest_manager_id, amount, remarks, reason,
            status, raised_by, raised_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'raised', ?, NOW())`,
        [
          id,
          voucherNumber,
          input.voucherType ?? "payment",
          input.sourceType,
          input.bankAccountId,
          input.payableAccountId,
          input.linkedVendorPaymentId ?? null,
          input.linkedImprestManagerId ?? null,
          amount,
          input.remarks?.trim() || null,
          input.reason?.trim() || null,
          actorUserId,
        ],
      );

      await recordFinanceApprovalEvent(
        {
          entityType: "payment_voucher",
          entityId: id,
          action: "submit",
          toStatus: "raised",
          actorUserId,
          actorRole: actorRole ?? "finance_head",
          remarks: input.remarks ?? null,
        },
        connection,
      );
      await writeVoucherAudit(connection, "PAYMENT_VOUCHER_RAISED", id, actorUserId, actorRole, {
        source_type: input.sourceType,
        amount,
        bank_account_id: input.bankAccountId,
      });

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
      action_type: "PAYMENT_VOUCHER_RAISED",
      module_key: "FINANCE",
      entity_type: "payment_voucher",
      entity_id: id,
      change_summary: { voucher_number: voucherNumber, amount, source_type: input.sourceType },
    }).catch(() => undefined);

    return this.get(id);
  },

  async ceoApprove(
    id: string,
    actorUserId: string,
    actorRole: string | undefined,
    decision: "approve" | "reject",
    note?: string | null,
  ) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [[voucher]] = await connection.execute<RowDataPacket[]>(
        `SELECT * FROM payment_voucher WHERE id = ? FOR UPDATE`,
        [id],
      );
      if (!voucher) throw new PaymentVoucherError("Payment voucher not found", 404);
      if ((voucher as any).status !== "raised") {
        throw new PaymentVoucherError(`Voucher is already ${(voucher as any).status}`, 409);
      }
      // Maker-checker: the CEO must not be the person who raised this voucher.
      if (String((voucher as any).raised_by) === String(actorUserId)) {
        throw new PaymentVoucherError(
          "A payment voucher must be approved by someone other than the person who raised it.",
          403,
        );
      }

      const newStatus = decision === "approve" ? "ceo_approved" : "rejected";
      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE payment_voucher
            SET status = ?, ceo_approved_by = ?, ceo_approved_at = NOW(),
                rejection_reason = ?
          WHERE id = ? AND status = 'raised'`,
        [newStatus, actorUserId, decision === "reject" ? (note?.trim() || "Rejected by CEO") : null, id],
      );
      if (result.affectedRows !== 1) {
        throw new PaymentVoucherError("Voucher was already decided by someone else", 409);
      }

      await recordFinanceApprovalEvent(
        {
          entityType: "payment_voucher",
          entityId: id,
          action: decision,
          fromStatus: "raised",
          toStatus: newStatus,
          decision,
          actorUserId,
          actorRole: actorRole ?? "ceo",
          remarks: note ?? null,
        },
        connection,
      );
      await writeVoucherAudit(connection, `PAYMENT_VOUCHER_${decision.toUpperCase()}D`, id, actorUserId, actorRole, {
        decision,
        note: note ?? null,
      });

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
      action_type: `PAYMENT_VOUCHER_${decision.toUpperCase()}D`,
      module_key: "FINANCE",
      entity_type: "payment_voucher",
      entity_id: id,
    }).catch(() => undefined);

    return this.get(id);
  },

  async release(
    id: string,
    actorUserId: string,
    actorRole: string | undefined,
    input: { paymentMode: string; paymentDate: string; transactionRef?: string | null },
  ) {
    const paymentMode = input.paymentMode;
    if (!PAYMENT_MODES.includes(paymentMode as any)) throw new PaymentVoucherError("Invalid payment mode");
    const paymentDate = String(input.paymentDate ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) throw new PaymentVoucherError("Payment date is required");
    if (paymentDate > new Date().toISOString().slice(0, 10)) throw new PaymentVoucherError("Payment date cannot be in the future");
    const transactionRef = input.transactionRef?.trim() || null;
    if (paymentMode !== "Cash" && !transactionRef) {
      throw new PaymentVoucherError("Transaction ID / UTR / Cheque No. is required");
    }

    let sourceType = "";
    let linkedVendorPaymentId: string | null = null;
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [[voucher]] = await connection.execute<RowDataPacket[]>(
        `SELECT * FROM payment_voucher WHERE id = ? FOR UPDATE`,
        [id],
      );
      if (!voucher) throw new PaymentVoucherError("Payment voucher not found", 404);
      const v = voucher as any;
      sourceType = v.source_type;
      linkedVendorPaymentId = v.linked_vendor_payment_id;
      if (v.status !== "ceo_approved") throw new PaymentVoucherError(`Voucher is not ready for release (status: ${v.status})`, 409);
      if (String(v.raised_by) === String(actorUserId)) {
        throw new PaymentVoucherError("A payment voucher must be released by someone other than the person who raised it.", 403);
      }
      if (String(v.ceo_approved_by) === String(actorUserId)) {
        throw new PaymentVoucherError("A payment voucher must be released by someone other than the CEO who approved it.", 403);
      }
      if (BANK_MODES.has(paymentMode) && !v.bank_account_id) {
        throw new PaymentVoucherError("This voucher has no bank account to release from");
      }

      // Lock the paying account. Every release against the same account serialises here, which
      // is what makes running_balance safe to compute-then-store instead of deriving it live
      // (mirrors imprest-ledger.service.ts's `imprest_manager ... FOR UPDATE` for the same reason).
      const [[bankAccount]] = await connection.execute<RowDataPacket[]>(
        `SELECT id, bank_id, branch_id, opening_balance, active_status
           FROM company_bank_account WHERE id = ? FOR UPDATE`,
        [v.bank_account_id],
      );
      if (!bankAccount) throw new PaymentVoucherError("Bank account not found", 404);
      if (!(bankAccount as any).active_status) throw new PaymentVoucherError("This bank account is closed");

      const [[lastEntry]] = await connection.execute<RowDataPacket[]>(
        `SELECT running_balance FROM bank_account_ledger_entry
          WHERE bank_account_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
        [v.bank_account_id],
      );
      let runningBalance = lastEntry ? Number((lastEntry as any).running_balance) : Number((bankAccount as any).opening_balance);

      const amount = roundMoney(Number(v.amount));

      if (v.source_type === "vendor_grn") {
        const [[vpt]] = await connection.execute<RowDataPacket[]>(
          `SELECT id, grn_number, due_amount, tds_deducted_amount, paid_amount
             FROM vendor_payment_tracking WHERE id = ? FOR UPDATE`,
          [v.linked_vendor_payment_id],
        );
        if (!vpt) throw new PaymentVoucherError("Linked vendor payment record no longer exists", 404);
        const vp = vpt as any;
        const isFirstRelease = Number(vp.paid_amount ?? 0) === 0;
        const newPaidAmount = roundMoney(Number(vp.paid_amount ?? 0) + amount);
        const dueAmount = roundMoney(Number(vp.due_amount));
        if (newPaidAmount > dueAmount + 0.01) {
          throw new PaymentVoucherError(
            "This GRN's balance has changed since this voucher was raised — releasing it would overpay the GRN. Reject this voucher and raise a new one for the correct remaining amount.",
          );
        }

        // Reuses the exact same write path today's dispatch screen uses (vendor_payment_tracking
        // update + grn_request cascade) — this is what makes "all payment details reflect back
        // into Vendor Payment" true, rather than a second, drifting implementation of the same
        // update. Runs inside THIS transaction via the externalConnection parameter.
        await vendorPaymentService.updatePayment(
          v.linked_vendor_payment_id,
          {
            paidAmount: newPaidAmount,
            paymentMode: paymentMode as any,
            paymentDate,
            bankId: (bankAccount as any).bank_id,
            transactionId: transactionRef ?? undefined,
            remarks: `Released via Payment Voucher ${v.voucher_number}`,
          },
          actorUserId,
          actorRole,
          connection,
        );

        runningBalance = roundMoney(runningBalance - amount);
        await connection.execute(
          `INSERT INTO bank_account_ledger_entry
             (id, bank_account_id, entry_date, voucher_id, debit_amount, credit_amount,
              payable_account_id, narration, instrument_ref, running_balance, source_type, created_by)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'voucher', ?)`,
          [
            randomUUID(),
            v.bank_account_id,
            paymentDate,
            id,
            amount,
            v.payable_account_id,
            `Vendor payment released — GRN ${vp.grn_number ?? ""} — voucher ${v.voucher_number}`.trim(),
            transactionRef,
            runningBalance,
            actorUserId,
          ],
        );

        // TDS withheld is not cash leaving the bank — it never touches running_balance. There is
        // no general-ledger/journal table in this schema yet (the PRD's data model is
        // bank-ledger centric, not full double-entry), so this row is booked here as a
        // zero-cash memo against "TDS Payable" purely so the liability is visible next to the
        // payment that created it — debit=credit=0 is deliberate, not a bug. Booked once, on
        // the first release against this GRN: tds_deducted_amount is fixed once per GRN today
        // (no per-installment TDS field exists anywhere vendor_payment_tracking is written), so
        // splitting it proportionally across partial releases would invent a rule this system
        // has no basis for. Flagged in the implementation plan for review.
        const tds = roundMoney(Number(vp.tds_deducted_amount ?? 0));
        if (isFirstRelease && tds > 0) {
          const [[tdsAccount]] = await connection.execute<RowDataPacket[]>(
            `SELECT id FROM payable_account_master WHERE account_name = 'TDS Payable' LIMIT 1`,
          );
          if (tdsAccount) {
            await connection.execute(
              `INSERT INTO bank_account_ledger_entry
                 (id, bank_account_id, entry_date, voucher_id, debit_amount, credit_amount,
                  payable_account_id, narration, instrument_ref, running_balance, source_type, created_by)
               VALUES (?, ?, ?, ?, 0, 0, ?, ?, NULL, ?, 'voucher', ?)`,
              [
                randomUUID(),
                v.bank_account_id,
                paymentDate,
                id,
                (tdsAccount as any).id,
                `TDS withheld on GRN ${vp.grn_number ?? ""} — voucher ${v.voucher_number} (liability memo, no cash movement)`.trim(),
                runningBalance,
                actorUserId,
              ],
            );
          }
        }
      } else {
        // imprest_allocation lane
        const [[manager]] = await connection.execute<RowDataPacket[]>(
          `SELECT id, branch_id FROM imprest_manager WHERE id = ? FOR UPDATE`,
          [v.linked_imprest_manager_id],
        );
        if (!manager) throw new PaymentVoucherError("Linked imprest manager no longer exists", 404);

        await imprestLedgerService.post(
          {
            imprestManagerId: (manager as any).id,
            branchId: (manager as any).branch_id,
            entryType: "allocation",
            direction: "credit",
            amount,
            transactionDate: paymentDate,
            referenceType: "manual",
            referenceId: id,
            narration: `Float replenishment — Payment Voucher ${v.voucher_number}`,
            actorUserId,
          },
          connection,
        );

        runningBalance = roundMoney(runningBalance - amount);
        await connection.execute(
          `INSERT INTO bank_account_ledger_entry
             (id, bank_account_id, entry_date, voucher_id, debit_amount, credit_amount,
              payable_account_id, narration, instrument_ref, running_balance, source_type, created_by)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'voucher', ?)`,
          [
            randomUUID(),
            v.bank_account_id,
            paymentDate,
            id,
            amount,
            v.payable_account_id,
            `Imprest float replenishment — voucher ${v.voucher_number}`,
            transactionRef,
            runningBalance,
            actorUserId,
          ],
        );
      }

      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE payment_voucher
            SET status = 'released', released_by = ?, released_at = NOW(),
                payment_mode = ?, payment_date = ?, transaction_ref = ?
          WHERE id = ? AND status = 'ceo_approved'`,
        [actorUserId, paymentMode, paymentDate, transactionRef, id],
      );
      if (result.affectedRows !== 1) {
        throw new PaymentVoucherError("Voucher was already released or its state changed", 409);
      }

      await recordFinanceApprovalEvent(
        {
          entityType: "payment_voucher",
          entityId: id,
          action: "release",
          fromStatus: "ceo_approved",
          toStatus: "released",
          actorUserId,
          actorRole: actorRole ?? "accounts_head",
          remarks: null,
          details: { paymentMode, paymentDate, transactionRef },
        },
        connection,
      );
      await writeVoucherAudit(connection, "PAYMENT_VOUCHER_RELEASED", id, actorUserId, actorRole, {
        payment_mode: paymentMode,
        payment_date: paymentDate,
        transaction_ref: transactionRef,
        amount,
      });

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
      action_type: "PAYMENT_VOUCHER_RELEASED",
      module_key: "FINANCE",
      entity_type: "payment_voucher",
      entity_id: id,
      change_summary: { payment_mode: paymentMode, payment_date: paymentDate, transaction_ref: transactionRef },
    }).catch(() => undefined);
    if (sourceType === "vendor_grn" && linkedVendorPaymentId) {
      await logSensitiveAction({
        actor_user_id: actorUserId,
        actor_role: actorRole,
        action_type: "VENDOR_PAYMENT_UPDATED",
        module_key: "FINANCE",
        entity_type: "vendor_payment_tracking",
        entity_id: linkedVendorPaymentId,
        change_summary: { released_via_voucher: id },
      }).catch(() => undefined);
    }

    return this.get(id);
  },
};
