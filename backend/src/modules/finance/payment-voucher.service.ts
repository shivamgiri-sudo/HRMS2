import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { recordFinanceApprovalEvent, listFinanceApprovalEvents } from "../../shared/financeApprovalEvent.js";
import { vendorPaymentLedgerService } from "./vendor-payment-ledger.service.js";
import { imprestLedgerService } from "./imprest-ledger.service.js";
import { imprestService } from "./imprest.service.js";
import { inboxService } from "../inbox/inbox.service.js";
import { resolveRoleHolderUserIds } from "../../shared/recipient-resolver.js";

/**
 * Payment Voucher — the authorization + release chain (PRD §3.4, §6.5, §6.6).
 *
 * Role model (revised 2026-09-10 — Finance Head now both raises AND releases):
 *   raise()        Finance Head  — bank + payable account + remarks. Money has not moved yet.
 *   ceoApprove()   CEO           — a yes/no on amount/purpose. Does not execute the transfer.
 *   release()      Finance Head  — actually executes the transfer, keys in the real
 *                                  payment_mode/date/transaction_ref, and is the ONLY step that
 *                                  writes vendor_payment_tracking / bank_account_ledger_entry /
 *                                  the imprest ledger.
 *   reviewRelease() Accounts Head — a non-blocking sign-off AFTER release: Accounts Head
 *                                  reviews the already-executed payment and records that it was
 *                                  checked, but cannot hold up or reverse it. This is the actual
 *                                  control now (a second pair of eyes on money already sent,
 *                                  not a gate before it goes) — CEO approval remains the one
 *                                  blocking check between raise and release.
 *
 * Maker-checker between raise and CEO approval is still enforced by identity, not only role —
 * the same pairwise inequality check vendor-approval.service.ts and vendor-bank.service.ts use
 * ("a route guard proves a role, it cannot prove two different people"): raised_by !=
 * ceo_approved_by. release() no longer requires released_by to differ from raised_by — the same
 * Finance Head who raised a CEO-approved voucher is expected to release it themselves; the CEO
 * approval gate plus the post-release Accounts Head review are what stand in for that older
 * three-way separation now.
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
  sourceType: "vendor_grn" | "imprest_allocation" | "general";
  bankAccountId: string;
  payableAccountId: string;
  /** Required when sourceType === 'general' — the free-text description a GRN/imprest name
   *  would otherwise supply (e.g. "March statutory PF challan", "Bank charges Q2"). */
  particulars?: string | null;
  /** Legacy single-GRN shape — still accepted; internally normalised into a one-row grnAllocations. */
  linkedVendorPaymentId?: string | null;
  /**
   * Multi-GRN shape: pay several outstanding GRNs of the SAME vendor with one voucher. When
   * present this wins over linkedVendorPaymentId. Every allocation must belong to the same
   * vendor_id, and allocated amounts must sum to `amount` (within a paisa of rounding).
   */
  grnAllocations?: Array<{ vendorPaymentTrackingId: string; amount: number }>;
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
              vpt.head, vpt.sub_head, vpt.due_date, vpt.financial_year,
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

    // Full multi-GRN allocation set (Requirement: "multiple selection of GRN of same vendor" +
    // "complete GRN Data" visible) — not just the single primary GRN the row-level join above
    // resolves. Empty for imprest-lane vouchers and for legacy single-GRN vouchers raised before
    // this table existed (those still show correctly via the vpt.* columns above).
    const [grnAllocationRows] = await db.execute<RowDataPacket[]>(
      `SELECT pvga.vendor_payment_tracking_id, pvga.allocated_amount,
              vpt.grn_number, vpt.vendor_name, vpt.head, vpt.sub_head, vpt.due_date,
              vpt.due_amount, vpt.tds_deducted_amount, vpt.paid_amount, vpt.balance_amount
         FROM payment_voucher_grn_allocation pvga
         JOIN vendor_payment_tracking vpt ON vpt.id = pvga.vendor_payment_tracking_id
        WHERE pvga.payment_voucher_id = ?
        ORDER BY pvga.created_at ASC`,
      [id],
    );

    return {
      ...maskVoucherRow(row),
      grn_allocations: grnAllocationRows,
      // The raise -> CEO-approve -> release timeline (drill-down mandate's "Approval / workflow
      // timeline" section) — same generic reader every other finance entity type uses.
      approval_events: await listFinanceApprovalEvents("payment_voucher", id),
      audit_log: auditRows,
      consumption_since_replenishment: consumptionSinceReplenishment,
    };
  },

  async raise(input: RaiseVoucherInput, actorUserId: string, actorRole?: string) {
    if ((input.sourceType as string) === "sales_receipt") {
      throw new PaymentVoucherError("Sales-receipt vouchers are not available yet — vendor_grn, imprest_allocation and general only.");
    }
    if (!["vendor_grn", "imprest_allocation", "general"].includes(input.sourceType)) {
      throw new PaymentVoucherError("Invalid source type");
    }
    if (input.sourceType === "general" && !input.particulars?.trim()) {
      throw new PaymentVoucherError("Particulars are required for a general payment (what this payment is for)");
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

      // Normalise both input shapes into one allocation list: the legacy single-GRN field
      // becomes a one-row allocation of the full amount, so the rest of raise() and every
      // downstream reader (release()) only ever has to handle "N allocations", never a
      // singular/plural special case.
      let grnAllocations: Array<{ vendorPaymentTrackingId: string; amount: number }> = [];
      if (input.sourceType === "vendor_grn") {
        if (input.grnAllocations && input.grnAllocations.length > 0) {
          grnAllocations = input.grnAllocations.map((a) => ({
            vendorPaymentTrackingId: a.vendorPaymentTrackingId,
            amount: roundMoney(Number(a.amount)),
          }));
        } else if (input.linkedVendorPaymentId) {
          grnAllocations = [{ vendorPaymentTrackingId: input.linkedVendorPaymentId, amount }];
        } else {
          throw new PaymentVoucherError("At least one vendor GRN payment record must be selected");
        }
        if (grnAllocations.some((a) => !a.vendorPaymentTrackingId || !(a.amount > 0))) {
          throw new PaymentVoucherError("Every selected GRN needs a positive allocated amount");
        }
        const allocatedTotal = roundMoney(grnAllocations.reduce((sum, a) => sum + a.amount, 0));
        if (Math.abs(allocatedTotal - amount) > 0.01) {
          throw new PaymentVoucherError(
            `Allocated amounts (${allocatedTotal}) must add up to the voucher amount (${amount})`,
          );
        }

        let vendorIdSeen: string | null = null;
        for (const alloc of grnAllocations) {
          const [[vpt]] = await connection.execute<RowDataPacket[]>(
            `SELECT vendor_id, due_amount, tds_deducted_amount, paid_amount
               FROM vendor_payment_tracking WHERE id = ? FOR UPDATE`,
            [alloc.vendorPaymentTrackingId],
          );
          if (!vpt) throw new PaymentVoucherError("Vendor payment record not found", 404);
          const row = vpt as any;
          if (vendorIdSeen === null) vendorIdSeen = row.vendor_id;
          else if (row.vendor_id !== vendorIdSeen) {
            throw new PaymentVoucherError("All selected GRNs must belong to the same vendor");
          }
          const remaining = roundMoney(
            Number(row.due_amount) - Number(row.tds_deducted_amount ?? 0) - Number(row.paid_amount ?? 0),
          );
          if (alloc.amount > remaining + 0.01) {
            throw new PaymentVoucherError(
              `Allocated amount (${alloc.amount}) exceeds the remaining net-payable balance on GRN ${alloc.vendorPaymentTrackingId} (${remaining})`,
            );
          }
        }
      } else if (input.sourceType === "imprest_allocation") {
        if (!input.linkedImprestManagerId) throw new PaymentVoucherError("An imprest manager must be selected");
        const [[manager]] = await connection.execute<RowDataPacket[]>(
          `SELECT id, active_status FROM imprest_manager WHERE id = ? FOR UPDATE`,
          [input.linkedImprestManagerId],
        );
        if (!manager) throw new PaymentVoucherError("Imprest manager not found", 404);
        if (!(manager as any).active_status) throw new PaymentVoucherError("This imprest manager is not active");
      }
      // 'general' has no linkage to validate — Payable Account (already validated above) is the
      // category, and input.particulars (already required-checked above) is the description.

      id = randomUUID();
      voucherNumber = await nextVoucherNumber(connection, input.bankAccountId);

      await connection.execute(
        `INSERT INTO payment_voucher
           (id, voucher_number, voucher_type, source_type, bank_account_id, payable_account_id,
            linked_vendor_payment_id, linked_imprest_manager_id, amount, remarks, reason,
            particulars, status, raised_by, raised_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'raised', ?, NOW())`,
        [
          id,
          voucherNumber,
          input.voucherType ?? "payment",
          input.sourceType,
          input.bankAccountId,
          input.payableAccountId,
          grnAllocations[0]?.vendorPaymentTrackingId ?? null,
          input.linkedImprestManagerId ?? null,
          amount,
          input.remarks?.trim() || null,
          input.reason?.trim() || null,
          input.particulars?.trim() || null,
          actorUserId,
        ],
      );

      for (const alloc of grnAllocations) {
        await connection.execute(
          `INSERT INTO payment_voucher_grn_allocation
             (id, payment_voucher_id, vendor_payment_tracking_id, allocated_amount)
           VALUES (?, ?, ?, ?)`,
          [randomUUID(), id, alloc.vendorPaymentTrackingId, alloc.amount],
        );
      }

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

    const ceoRecipients = await resolveRoleHolderUserIds("ceo", null);
    for (const userId of ceoRecipients) {
      await inboxService.createItem({
        user_id: userId,
        type: "payment_voucher_pending_approval",
        title: `[ACTION REQUIRED] Payment Voucher ${voucherNumber} — ₹${amount}`,
        description: input.remarks?.trim() || "Awaiting your approval.",
        entity_type: "payment_voucher",
        entity_id: id,
        action_url: "/finance/payment-vouchers",
        priority: "high",
      }).catch(() => undefined);
    }

    return this.get(id);
  },

  async ceoApprove(
    id: string,
    actorUserId: string,
    actorRole: string | undefined,
    decision: "approve" | "reject" | "request_changes",
    note?: string | null,
  ) {
    if (decision === "request_changes" && !note?.trim()) {
      throw new PaymentVoucherError("A note explaining what needs to change is required.");
    }
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

      const newStatus = decision === "approve" ? "ceo_approved" : decision === "reject" ? "rejected" : "changes_requested";
      const [result] = decision === "request_changes"
        ? await connection.execute<ResultSetHeader>(
            `UPDATE payment_voucher
                SET status = ?, changes_requested_by = ?, changes_requested_at = NOW(), changes_requested_note = ?
              WHERE id = ? AND status = 'raised'`,
            [newStatus, actorUserId, note!.trim(), id],
          )
        : await connection.execute<ResultSetHeader>(
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
      const actionLabel = decision === "approve" ? "PAYMENT_VOUCHER_APPROVED"
        : decision === "reject" ? "PAYMENT_VOUCHER_REJECTED"
        : "PAYMENT_VOUCHER_CHANGES_REQUESTED";
      await writeVoucherAudit(connection, actionLabel, id, actorUserId, actorRole, {
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

    const actionLabel = decision === "approve" ? "PAYMENT_VOUCHER_APPROVED"
      : decision === "reject" ? "PAYMENT_VOUCHER_REJECTED"
      : "PAYMENT_VOUCHER_CHANGES_REQUESTED";
    await logSensitiveAction({
      actor_user_id: actorUserId,
      actor_role: actorRole,
      action_type: actionLabel,
      module_key: "FINANCE",
      entity_type: "payment_voucher",
      entity_id: id,
    }).catch(() => undefined);

    if (decision === "approve") {
      // Finance Head releases now (2026-09-10 role model), and per the original spec ("Finance
      // head should get the notification that payment has to be done") this goes to the specific
      // person who raised it, not a role-wide broadcast — they raised it, they know the vendor
      // and amount, they're the one expected to actually make the payment.
      const raisedBy = String((await this.get(id))?.raised_by ?? "");
      if (raisedBy) {
        await inboxService.createItem({
          user_id: raisedBy,
          type: "payment_voucher_ready_for_release",
          title: `[ACTION REQUIRED] Payment Voucher ready to release`,
          description: `CEO-approved and awaiting release.`,
          entity_type: "payment_voucher",
          entity_id: id,
          action_url: "/finance/payment-vouchers",
          priority: "high",
        }).catch(() => undefined);
      }
    } else if (decision === "request_changes") {
      const raisedBy = String((await this.get(id))?.raised_by ?? "");
      if (raisedBy) {
        await inboxService.createItem({
          user_id: raisedBy,
          type: "payment_voucher_changes_requested",
          title: `[ACTION REQUIRED] CEO requested changes to a voucher`,
          description: note!.trim(),
          entity_type: "payment_voucher",
          entity_id: id,
          action_url: "/finance/payment-vouchers",
          priority: "high",
        }).catch(() => undefined);
      }
    }

    return this.get(id);
  },

  async resubmit(
    id: string,
    actorUserId: string,
    actorRole: string | undefined,
    updates: { bankAccountId?: string; payableAccountId?: string; amount?: number; remarks?: string | null },
  ) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [[voucher]] = await connection.execute<RowDataPacket[]>(
        `SELECT * FROM payment_voucher WHERE id = ? FOR UPDATE`,
        [id],
      );
      if (!voucher) throw new PaymentVoucherError("Payment voucher not found", 404);
      const v = voucher as any;
      if (v.status !== "changes_requested") {
        throw new PaymentVoucherError(`Voucher is not awaiting resubmission (status: ${v.status})`, 409);
      }
      if (String(v.raised_by) !== String(actorUserId)) {
        throw new PaymentVoucherError("Only the person who raised this voucher may resubmit it.", 403);
      }

      const bankAccountId = updates.bankAccountId ?? v.bank_account_id;
      if (updates.bankAccountId) {
        const [[bankAccount]] = await connection.execute<RowDataPacket[]>(
          `SELECT id, active_status FROM company_bank_account WHERE id = ?`,
          [bankAccountId],
        );
        if (!bankAccount) throw new PaymentVoucherError("Bank account not found", 404);
        if (!(bankAccount as any).active_status) throw new PaymentVoucherError("This bank account is closed");
      }
      const amount = updates.amount != null ? roundMoney(Number(updates.amount)) : Number(v.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new PaymentVoucherError("Amount must be a positive number");

      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE payment_voucher
            SET status = 'raised', bank_account_id = ?, payable_account_id = ?, amount = ?, remarks = ?,
                ceo_approved_by = NULL, ceo_approved_at = NULL, rejection_reason = NULL,
                changes_requested_by = NULL, changes_requested_at = NULL, changes_requested_note = NULL,
                raised_at = NOW()
          WHERE id = ? AND status = 'changes_requested'`,
        [
          bankAccountId,
          updates.payableAccountId ?? v.payable_account_id,
          amount,
          updates.remarks !== undefined ? (updates.remarks?.trim() || null) : v.remarks,
          id,
        ],
      );
      if (result.affectedRows !== 1) throw new PaymentVoucherError("Voucher state changed before resubmission", 409);

      await recordFinanceApprovalEvent(
        { entityType: "payment_voucher", entityId: id, action: "resubmit", toStatus: "raised", actorUserId, actorRole: actorRole ?? "finance_head", remarks: updates.remarks ?? null },
        connection,
      );
      await writeVoucherAudit(connection, "PAYMENT_VOUCHER_RESUBMITTED", id, actorUserId, actorRole, { bank_account_id: bankAccountId, amount });

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    await logSensitiveAction({
      actor_user_id: actorUserId, actor_role: actorRole, action_type: "PAYMENT_VOUCHER_RESUBMITTED",
      module_key: "FINANCE", entity_type: "payment_voucher", entity_id: id,
    }).catch(() => undefined);

    const ceoRecipients = await resolveRoleHolderUserIds("ceo", null);
    for (const userId of ceoRecipients) {
      await inboxService.createItem({
        user_id: userId, type: "payment_voucher_pending_approval",
        title: `[ACTION REQUIRED] Payment Voucher resubmitted for approval`,
        description: "Resubmitted after requested changes.",
        entity_type: "payment_voucher", entity_id: id, action_url: "/finance/payment-vouchers", priority: "high",
      }).catch(() => undefined);
    }

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
      // Finance Head both raises and releases under the current role model (2026-09-10) — CEO
      // approval is the one blocking gate between the two, so release no longer requires a
      // different person than raised_by. The CEO themselves still cannot release their own
      // approval, since ceo is not in VOUCHER_RELEASE_ROLES at all — this check is defence in
      // depth for a super_admin acting as both.
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
        // Multi-GRN (Task: "multiple selection of GRN of same vendor"): walk every GRN this
        // voucher was raised against, not just the single linked_vendor_payment_id column —
        // that column only ever holds the FIRST/primary allocation for backward compatibility
        // with older read paths. A voucher raised before this table existed has no allocation
        // rows at all, so it falls back to the single linked GRN for its full amount.
        const [allocRows] = await connection.execute<RowDataPacket[]>(
          `SELECT vendor_payment_tracking_id, allocated_amount
             FROM payment_voucher_grn_allocation WHERE payment_voucher_id = ? ORDER BY created_at ASC`,
          [id],
        );
        const allocations = (allocRows as any[]).length > 0
          ? (allocRows as any[]).map((r) => ({ vendorPaymentTrackingId: r.vendor_payment_tracking_id, amount: roundMoney(Number(r.allocated_amount)) }))
          : [{ vendorPaymentTrackingId: v.linked_vendor_payment_id, amount }];

        for (const alloc of allocations) {
          // Reuses the exact same write path the Vendor Payment page's own "Pay" button uses
          // (vendor_payment_transaction ledger row + TDS calc + vendor_payment_tracking/grn_request
          // update) — this is what makes "all payment details reflect back into Vendor Payment"
          // actually true, rather than a second, thinner implementation of the same update that
          // used to skip the per-installment ledger row and TDS calculation entirely. Runs inside
          // THIS transaction via the externalConnection parameter, once per allocated GRN, so
          // every selected GRN's vendor_payment_tracking row updates automatically.
          const dispatchResult = await vendorPaymentLedgerService.dispatch(
            alloc.vendorPaymentTrackingId,
            {
              paymentMode: paymentMode as any,
              paymentDate,
              bankId: (bankAccount as any).bank_id,
              transactionId: transactionRef,
              paymentAmount: alloc.amount,
              remarks: `Released via Payment Voucher ${v.voucher_number}`,
              // One bank transfer, one reference, split across every GRN this voucher covers —
              // not several independent payments that happen to collide on a UTR.
              allowSharedReference: allocations.length > 1,
            },
            actorUserId,
            actorRole,
            connection,
            // This voucher is still 'ceo_approved' right now — exempt it from dispatch()'s
            // active-voucher guard so a release does not block itself.
            v.id,
          );
          const lastTransaction = dispatchResult.transactions[dispatchResult.transactions.length - 1];
          const grnNumberForNarration = (dispatchResult.payment as any)?.grn_number ?? "";

          runningBalance = roundMoney(runningBalance - alloc.amount);
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
              alloc.amount,
              v.payable_account_id,
              `Vendor payment released — GRN ${grnNumberForNarration} — voucher ${v.voucher_number}`.trim(),
              transactionRef,
              runningBalance,
              actorUserId,
            ],
          );

          // TDS withheld is not cash leaving the bank — it never touches running_balance. There is
          // no general-ledger/journal table in this schema yet, so this row is booked as a
          // zero-cash memo against "TDS Payable" purely so the liability is visible next to the
          // payment that created it — debit=credit=0 is deliberate, not a bug. Sized to what
          // dispatch() actually computed for THIS installment — dispatch() calculates TDS per
          // installment from the vendor's own TDS settings, so this is correct per-GRN across a
          // multi-GRN release, unlike the "first release only" approximation this replaced.
          const tds = roundMoney(Number(lastTransaction?.tds_amount ?? 0));
          if (tds > 0) {
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
                  `TDS withheld on GRN ${grnNumberForNarration} — voucher ${v.voucher_number} (liability memo, no cash movement)`.trim(),
                  runningBalance,
                  actorUserId,
                ],
              );
            }
          }
        }
      } else if (v.source_type === "imprest_allocation") {
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
      } else {
        // 'general' lane — no vendor GRN or imprest manager to update, just the bank debit
        // against whatever Payable Account (Salary Payable / Statutory Dues / Bank Charges /
        // TDS Payable / Other) the voucher was raised under. particulars carries the "what this
        // is for" a GRN number or imprest manager name would otherwise supply.
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
            `${v.particulars ?? "General payment"} — voucher ${v.voucher_number}`,
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
          actorRole: actorRole ?? "finance_head",
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

    await inboxService.resolveItems({
      entity_type: "payment_voucher",
      entity_id: id,
      types: ["payment_voucher_ready_for_release"],
    }).catch(() => undefined);

    // Accounts Head reviews the payment AFTER it lands, not before — tell them it's ready to
    // look at now that money has actually moved.
    const accountsRecipients = await resolveRoleHolderUserIds("accounts_head", null);
    for (const userId of accountsRecipients) {
      await inboxService.createItem({
        user_id: userId,
        type: "payment_voucher_awaiting_review",
        title: `Payment Voucher released — review when convenient`,
        description: `Released and awaiting your sign-off review.`,
        entity_type: "payment_voucher",
        entity_id: id,
        action_url: "/finance/payment-vouchers",
        priority: "normal",
      }).catch(() => undefined);
    }

    return this.get(id);
  },

  /**
   * Accounts Head's post-release review — non-blocking. The voucher is already released; this
   * only records who checked it, when, and any note. Never touches status or reverses anything.
   */
  async reviewRelease(id: string, actorUserId: string, actorRole: string | undefined, note?: string | null) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [[voucher]] = await connection.execute<RowDataPacket[]>(
        `SELECT status FROM payment_voucher WHERE id = ? FOR UPDATE`,
        [id],
      );
      if (!voucher) throw new PaymentVoucherError("Payment voucher not found", 404);
      if ((voucher as any).status !== "released") {
        throw new PaymentVoucherError("Only a released voucher can be reviewed.", 409);
      }
      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE payment_voucher
            SET accounts_reviewed_by = ?, accounts_reviewed_at = NOW(), review_note = ?
          WHERE id = ? AND status = 'released'`,
        [actorUserId, note?.trim() || null, id],
      );
      if (result.affectedRows !== 1) {
        throw new PaymentVoucherError("Voucher state changed — please retry.", 409);
      }
      await recordFinanceApprovalEvent(
        {
          entityType: "payment_voucher",
          entityId: id,
          action: "accounts_review",
          fromStatus: "released",
          toStatus: "released",
          actorUserId,
          actorRole: actorRole ?? "accounts_head",
          remarks: note ?? null,
        },
        connection,
      );
      await writeVoucherAudit(connection, "PAYMENT_VOUCHER_REVIEWED", id, actorUserId, actorRole, { note: note ?? null });
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    await inboxService.resolveItems({
      entity_type: "payment_voucher",
      entity_id: id,
      types: ["payment_voucher_awaiting_review"],
    }).catch(() => undefined);

    await logSensitiveAction({
      actor_user_id: actorUserId,
      actor_role: actorRole,
      action_type: "PAYMENT_VOUCHER_REVIEWED",
      module_key: "FINANCE",
      entity_type: "payment_voucher",
      entity_id: id,
      change_summary: { note: note ?? null },
    }).catch(() => undefined);

    return this.get(id);
  },
};
