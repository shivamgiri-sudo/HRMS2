import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { recordFinanceApprovalEvent, listFinanceApprovalEvents } from "../../shared/financeApprovalEvent.js";
import { vendorPaymentLedgerService } from "./vendor-payment-ledger.service.js";
import { assertNotInClosedPeriod } from "./bank-reconciliation-period.service.js";
import { imprestLedgerService } from "./imprest-ledger.service.js";
import { imprestService } from "./imprest.service.js";
import { inboxService } from "../inbox/inbox.service.js";
import { resolveRoleHolderUserIds } from "../../shared/recipient-resolver.js";
import { journalService, type JournalLineInput } from "./journal.service.js";
import {
  vendorGrnLines,
  imprestAllocationLines,
  vendorAdvanceLines,
  vendorAdvanceApplicationLines,
  generalLines,
} from "./payment-voucher-journal-lines.js";

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

/**
 * Normalises + validates a GRN allocation set against `amount`, shared by 'vendor_grn' (paying
 * fresh dues from the bank) and 'vendor_advance_application' (settling dues from an existing
 * advance balance) — both mean "which GRN dues does this voucher affect, by how much" and must
 * enforce the exact same rules: every allocation belongs to the same vendor, amounts sum to
 * `amount` within a paisa, and none exceeds its GRN's own remaining net-payable balance. Kept as
 * one function rather than duplicated per lane — two copies of this arithmetic disagreeing after
 * a future edit is a correctness bug, not a style nit (same reasoning as this session's
 * assertNotInClosedPeriod extraction).
 */
async function validateGrnAllocations(
  connection: PoolConnection,
  input: { grnAllocations?: Array<{ vendorPaymentTrackingId: string; amount: number }>; linkedVendorPaymentId?: string | null },
  amount: number,
  notSelectedMessage: string,
): Promise<{ allocations: Array<{ vendorPaymentTrackingId: string; amount: number }>; vendorId: string }> {
  let allocations: Array<{ vendorPaymentTrackingId: string; amount: number }> = [];
  if (input.grnAllocations && input.grnAllocations.length > 0) {
    allocations = input.grnAllocations.map((a) => ({
      vendorPaymentTrackingId: a.vendorPaymentTrackingId,
      amount: roundMoney(Number(a.amount)),
    }));
  } else if (input.linkedVendorPaymentId) {
    allocations = [{ vendorPaymentTrackingId: input.linkedVendorPaymentId, amount }];
  } else {
    throw new PaymentVoucherError(notSelectedMessage);
  }
  if (allocations.some((a) => !a.vendorPaymentTrackingId || !(a.amount > 0))) {
    throw new PaymentVoucherError("Every selected GRN needs a positive allocated amount");
  }
  const allocatedTotal = roundMoney(allocations.reduce((sum, a) => sum + a.amount, 0));
  if (Math.abs(allocatedTotal - amount) > 0.01) {
    throw new PaymentVoucherError(
      `Allocated amounts (${allocatedTotal}) must add up to the voucher amount (${amount})`,
    );
  }

  let vendorIdSeen: string | null = null;
  for (const alloc of allocations) {
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
  return { allocations, vendorId: vendorIdSeen as string };
}

/** Vendor's currently available advance balance — the latest vendor_advance_ledger running
 *  balance, or 0 if the vendor has never had an advance voucher released. Same "latest
 *  balance_after wins" pattern bank_account_ledger_entry's running_balance already uses.
 *  Accepts either `db` (a plain read, e.g. from get()) or a `PoolConnection` mid-transaction —
 *  both share this call shape. */
async function getVendorAdvanceBalance(
  executor: { execute(sql: string, params?: any[]): Promise<[any, any]> },
  vendorId: string,
): Promise<number> {
  const [[last]] = (await executor.execute(
    `SELECT balance_after FROM vendor_advance_ledger
      WHERE vendor_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
    [vendorId],
  )) as [RowDataPacket[], unknown];
  return last ? Number((last as any).balance_after) : 0;
}

export interface RaiseVoucherInput {
  sourceType: "vendor_grn" | "imprest_allocation" | "general" | "vendor_advance" | "vendor_advance_application";
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
   *
   * Also used by 'vendor_advance_application' — same shape, same meaning ("which GRN dues does
   * this voucher affect, by how much"), just settling them from an existing advance balance
   * instead of a fresh bank payment.
   */
  grnAllocations?: Array<{ vendorPaymentTrackingId: string; amount: number }>;
  linkedImprestManagerId?: string | null;
  /** Required for 'vendor_advance' (which vendor is being paid an advance) and
   *  'vendor_advance_application' (whose advance balance this draws down). Neither source type
   *  is GRN-anchored, so there is no other column carrying vendor identity for them. */
  linkedVendorId?: string | null;
  amount: number;
  remarks?: string | null;
  reason?: string | null;
  voucherType?: "payment" | "receipt";
}

function maskVoucherRow(row: any) {
  return { ...row, amount: Number(row.amount ?? 0) };
}

/**
 * Resolves a batch of auth_user ids to display names (found 2026-09-17 CEO/CA compliance
 * review — the approval timeline and audit trail both carried raised_by/ceo_approved_by/
 * released_by/actor_user_id as raw UUIDs and nothing ever resolved them to a name; a reviewer
 * asking "who approved this payment" had to go to the database directly). Same
 * COALESCE(employee full_name, email) fallback access.routes.ts's own /users listing uses, so a
 * name here always matches what the User Management screen would show for the same person.
 */
async function resolveActorNames(userIds: (string | null | undefined)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT au.id, COALESCE(NULLIF(TRIM(e.full_name), ''), au.email) AS name
       FROM auth_user au
       LEFT JOIN employees e ON e.user_id = au.id AND e.active_status = 1
      WHERE au.id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
  const names = new Map<string, string>();
  for (const r of rows as RowDataPacket[]) names.set(String(r.id), r.name);
  return names;
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
              -- 3 of 41 active imprest_manager rows carry no tally_name (never backfilled
              -- when the manager master was created) — a bare im.tally_name left "Purpose"
              -- rendering blank in the drawer for any voucher against one of them. Falls
              -- back to the linked employee's name, same COALESCE(NULLIF(...),...) idiom
              -- recipient-resolver.ts already uses for the identical gap elsewhere.
              COALESCE(NULLIF(TRIM(im.tally_name), ''), NULLIF(TRIM(im_emp.full_name), '')) AS imprest_manager_name,
              -- vendor_advance/vendor_advance_application carry no GRN, so vpt.vendor_name above
              -- is NULL for them — linked_vendor_id + this join is their only vendor identity.
              lv.vendor_name AS linked_vendor_name
         FROM payment_voucher pv
         LEFT JOIN company_bank_account cba ON cba.id = pv.bank_account_id
         LEFT JOIN payable_account_master pam ON pam.id = pv.payable_account_id
         LEFT JOIN vendor_payment_tracking vpt ON vpt.id = pv.linked_vendor_payment_id
         LEFT JOIN imprest_manager im ON im.id = pv.linked_imprest_manager_id
         LEFT JOIN employees im_emp ON im_emp.id = im.employee_id
         LEFT JOIN vendor_master lv ON lv.id = pv.linked_vendor_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY pv.created_at DESC
        LIMIT ${limit}`,
      params,
    );
    return (rows as RowDataPacket[]).map(maskVoucherRow);
  },

  /** Same escape convention as bank-ledger.service.ts's toCsv() / gst-export.routes.ts — quote
   *  on comma/quote/newline, and guard a leading =/+/-/@ against formula injection. Reuses
   *  list()'s own filters (status/sourceType/bankAccountId) so the export always matches
   *  whatever tab/filter the user is looking at, and a higher row cap than the grid view since
   *  a CSV download is explicitly asking for the full set, not a paginated page. */
  async toCsv(filters: { status?: string; sourceType?: string; bankAccountId?: string }) {
    const rows = await this.list({ ...filters, limit: 5000 });
    const columns = [
      "Voucher No.", "Type", "Bank Account", "Payable Account", "Purpose",
      "Amount", "Status", "Raised At", "CEO Approved At", "Released At", "Remarks",
    ];
    const purposeOf = (r: any) =>
      r.source_type === "vendor_grn" ? (r.vendor_name ?? r.grn_number ?? "")
      : r.source_type === "imprest_allocation" ? (r.imprest_manager_name ?? "")
      : r.source_type === "vendor_advance" || r.source_type === "vendor_advance_application" ? (r.linked_vendor_name ?? "")
      : (r.particulars ?? "");
    const typeLabel: Record<string, string> = {
      vendor_grn: "Vendor GRN Payment",
      imprest_allocation: "Imprest Float Replenishment",
      vendor_advance: "Vendor Advance",
      vendor_advance_application: "Apply Vendor Advance",
      general: "Other / General Payment",
    };
    const escape = (value: unknown) => {
      const text = String(value ?? "");
      const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
      return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
    };
    const body = rows.map((r: any) => [
      r.voucher_number ?? "",
      typeLabel[r.source_type] ?? r.source_type ?? "",
      r.bank_account_name ?? "",
      r.payable_account_name ?? "",
      purposeOf(r),
      Number(r.amount ?? 0).toFixed(2),
      r.status ?? "",
      r.raised_at ?? "",
      r.ceo_approved_at ?? "",
      r.released_at ?? "",
      r.remarks ?? "",
    ]);
    return [columns, ...body].map((row) => row.map(escape).join(",")).join("\n");
  },

  async get(id: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT pv.*,
              cba.account_name AS bank_account_name,
              pam.account_name AS payable_account_name,
              vpt.grn_number, vpt.vendor_name, vpt.due_amount AS vendor_due_amount,
              vpt.tds_deducted_amount, vpt.paid_amount AS vendor_paid_amount,
              vpt.head, vpt.sub_head, vpt.due_date, vpt.financial_year,
              -- Same tally_name fallback as list() above.
              COALESCE(NULLIF(TRIM(im.tally_name), ''), NULLIF(TRIM(im_emp.full_name), '')) AS imprest_manager_name,
              lv.vendor_name AS linked_vendor_name
         FROM payment_voucher pv
         LEFT JOIN company_bank_account cba ON cba.id = pv.bank_account_id
         LEFT JOIN payable_account_master pam ON pam.id = pv.payable_account_id
         LEFT JOIN vendor_payment_tracking vpt ON vpt.id = pv.linked_vendor_payment_id
         LEFT JOIN imprest_manager im ON im.id = pv.linked_imprest_manager_id
         LEFT JOIN employees im_emp ON im_emp.id = im.employee_id
         LEFT JOIN vendor_master lv ON lv.id = pv.linked_vendor_id
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

    // The vendor's advance balance AFTER this voucher, for both new lanes — lets the drawer show
    // "₹X still available" on a vendor_advance voucher and "₹X remains after this application"
    // on a vendor_advance_application one, without a second round trip from the frontend.
    const advanceBalance = (row as any).linked_vendor_id
      ? await getVendorAdvanceBalance(db, String((row as any).linked_vendor_id))
      : null;

    const approvalEvents = (await listFinanceApprovalEvents("payment_voucher", id)) as any[];

    // Live balance of the account this voucher would debit (found 2026-09-17 CEO/CA compliance
    // review — neither the CEO approving nor the Finance Head releasing could see, anywhere in
    // this UI, whether the account has enough money). Deliberately NOT company_bank_account.
    // opening_balance — that column is a seed/rolling figure only accurate immediately after a
    // reconciliation close (see bank-reconciliation-period.service.ts's own close()), exactly the
    // staleness the raise form's own comment on this page already warns about. The real current
    // figure is the latest bank_account_ledger_entry.running_balance, same source release()
    // itself reads before moving money.
    const [[lastLedgerEntry]] = (row as any).bank_account_id
      ? await db.execute<RowDataPacket[]>(
          `SELECT running_balance FROM bank_account_ledger_entry
            WHERE bank_account_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
          [(row as any).bank_account_id],
        )
      : [[undefined]];
    const [[bankAccountRow]] = (row as any).bank_account_id
      ? await db.execute<RowDataPacket[]>(`SELECT opening_balance FROM company_bank_account WHERE id = ?`, [(row as any).bank_account_id])
      : [[undefined]];
    const currentBankBalance = lastLedgerEntry
      ? Number((lastLedgerEntry as any).running_balance)
      : bankAccountRow
        ? Number((bankAccountRow as any).opening_balance)
        : null;

    // Actor names — one batched lookup covering every id this response touches (the voucher's
    // own raised_by/ceo_approved_by/released_by/accounts_reviewed_by/changes_requested_by, plus
    // every approval_events and audit_log actor_user_id).
    const actorNames = await resolveActorNames([
      (row as any).raised_by, (row as any).ceo_approved_by, (row as any).released_by,
      (row as any).accounts_reviewed_by, (row as any).changes_requested_by, (row as any).withdrawn_by,
      ...approvalEvents.map((e) => e.actor_user_id),
      ...(auditRows as any[]).map((e) => e.actor_user_id),
    ]);
    const nameOf = (userId: string | null | undefined) => (userId ? actorNames.get(String(userId)) ?? null : null);

    return {
      ...maskVoucherRow(row),
      raised_by_name: nameOf((row as any).raised_by),
      ceo_approved_by_name: nameOf((row as any).ceo_approved_by),
      released_by_name: nameOf((row as any).released_by),
      accounts_reviewed_by_name: nameOf((row as any).accounts_reviewed_by),
      changes_requested_by_name: nameOf((row as any).changes_requested_by),
      withdrawn_by_name: nameOf((row as any).withdrawn_by),
      current_bank_balance: currentBankBalance,
      grn_allocations: grnAllocationRows,
      // The raise -> CEO-approve -> release timeline (drill-down mandate's "Approval / workflow
      // timeline" section) — same generic reader every other finance entity type uses.
      approval_events: approvalEvents.map((e) => ({ ...e, actor_name: nameOf(e.actor_user_id) })),
      audit_log: (auditRows as any[]).map((e) => ({ ...e, actor_name: nameOf(e.actor_user_id) })),
      consumption_since_replenishment: consumptionSinceReplenishment,
      vendor_advance_balance: advanceBalance,
    };
  },

  async raise(input: RaiseVoucherInput, actorUserId: string, actorRole?: string) {
    if ((input.sourceType as string) === "sales_receipt") {
      throw new PaymentVoucherError("Sales-receipt vouchers are not available yet — vendor_grn, imprest_allocation and general only.");
    }
    if (!["vendor_grn", "imprest_allocation", "general", "vendor_advance", "vendor_advance_application"].includes(input.sourceType)) {
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
      let linkedVendorId: string | null = null;
      if (input.sourceType === "vendor_grn") {
        const result = await validateGrnAllocations(
          connection, input, amount, "At least one vendor GRN payment record must be selected",
        );
        grnAllocations = result.allocations;
      } else if (input.sourceType === "imprest_allocation") {
        if (!input.linkedImprestManagerId) throw new PaymentVoucherError("An imprest manager must be selected");
        const [[manager]] = await connection.execute<RowDataPacket[]>(
          `SELECT id, active_status FROM imprest_manager WHERE id = ? FOR UPDATE`,
          [input.linkedImprestManagerId],
        );
        if (!manager) throw new PaymentVoucherError("Imprest manager not found", 404);
        if (!(manager as any).active_status) throw new PaymentVoucherError("This imprest manager is not active");
      } else if (input.sourceType === "vendor_advance") {
        if (!input.linkedVendorId) throw new PaymentVoucherError("A vendor must be selected");
        linkedVendorId = input.linkedVendorId;
      } else if (input.sourceType === "vendor_advance_application") {
        if (!input.linkedVendorId) throw new PaymentVoucherError("A vendor must be selected");
        const result = await validateGrnAllocations(
          connection, input, amount, "At least one of this vendor's GRN dues must be selected to apply the advance against",
        );
        grnAllocations = result.allocations;
        if (result.vendorId !== input.linkedVendorId) {
          throw new PaymentVoucherError("The selected GRN dues do not belong to the chosen vendor");
        }
        linkedVendorId = input.linkedVendorId;
        // Friendly check now; release() re-checks under a row lock, since the balance can move
        // between raise and a later release (e.g. a second application raised against the same
        // balance in the meantime).
        const available = await getVendorAdvanceBalance(connection, linkedVendorId);
        if (amount > available + 0.01) {
          throw new PaymentVoucherError(
            `This vendor's available advance balance (${available}) is less than the amount being applied (${amount})`,
          );
        }
      }
      // 'general' has no linkage to validate — Payable Account (already validated above) is the
      // category, and input.particulars (already required-checked above) is the description.

      id = randomUUID();
      voucherNumber = await nextVoucherNumber(connection, input.bankAccountId);

      await connection.execute(
        `INSERT INTO payment_voucher
           (id, voucher_number, voucher_type, source_type, bank_account_id, payable_account_id,
            linked_vendor_payment_id, linked_imprest_manager_id, linked_vendor_id, amount, remarks, reason,
            particulars, status, raised_by, raised_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'raised', ?, NOW())`,
        [
          id,
          voucherNumber,
          input.voucherType ?? "payment",
          input.sourceType,
          input.bankAccountId,
          input.payableAccountId,
          grnAllocations[0]?.vendorPaymentTrackingId ?? null,
          input.linkedImprestManagerId ?? null,
          linkedVendorId,
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
    } else if (decision === "reject") {
      // Was silently un-notified (found 2026-09-17 CEO/CA compliance review) — approve and
      // request_changes both tell the raiser, reject is the one outcome most likely to need
      // their attention (the voucher is now dead, not just paused) and was the one saying
      // nothing at all. Same pattern as request_changes above.
      const raisedBy = String((await this.get(id))?.raised_by ?? "");
      if (raisedBy) {
        await inboxService.createItem({
          user_id: raisedBy,
          type: "payment_voucher_rejected",
          title: `Payment Voucher rejected by CEO`,
          description: note?.trim() || "No reason given.",
          entity_type: "payment_voucher",
          entity_id: id,
          action_url: "/finance/payment-vouchers",
          priority: "high",
        }).catch(() => undefined);
      }
    }

    return this.get(id);
  },

  /**
   * Self-service cancellation (found 2026-09-17 CEO/CA compliance review — a voucher had no
   * cancel path at all before this: not for the raiser catching their own mistake, not for
   * anyone stopping an already-approved voucher before it releases). Two distinct callers,
   * both leading to the same terminal 'withdrawn' status (1799_payment_voucher_withdraw_status.sql)
   * — kept as one status rather than two because both mean the same thing operationally ("this
   * payment will not happen, decided before money moved"), just triggered from a different stage:
   *   - status='raised': only the person who raised it, before the CEO has acted.
   *   - status='ceo_approved': anyone who could release it (finance_head/super_admin) OR the CEO
   *     who approved it — recalling is strictly less than releasing, so the same authority that
   *     can push money out can also decide not to.
   * Never used on 'released' — once money has moved, the only correction is journalService.
   * reverse(), a different and much heavier operation than "we changed our mind before paying".
   */
  async withdraw(id: string, actorUserId: string, actorRole: string | undefined, reason: string) {
    if (!reason?.trim()) throw new PaymentVoucherError("A reason is required to withdraw a voucher.");
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [[voucher]] = await connection.execute<RowDataPacket[]>(
        `SELECT * FROM payment_voucher WHERE id = ? FOR UPDATE`,
        [id],
      );
      if (!voucher) throw new PaymentVoucherError("Payment voucher not found", 404);
      const v = voucher as any;

      if (v.status === "raised") {
        if (String(v.raised_by) !== String(actorUserId)) {
          throw new PaymentVoucherError("Only the person who raised this voucher can withdraw it.", 403);
        }
      } else if (v.status === "ceo_approved") {
        const canRecall = ["finance_head", "super_admin"].includes(String(actorRole)) || String(v.ceo_approved_by) === String(actorUserId);
        if (!canRecall) {
          throw new PaymentVoucherError("Only Finance Head, or the CEO who approved it, can recall an approved voucher before release.", 403);
        }
      } else {
        throw new PaymentVoucherError(`A voucher can only be withdrawn while raised or awaiting release (current status: ${v.status})`, 409);
      }

      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE payment_voucher
            SET status = 'withdrawn', withdrawn_by = ?, withdrawn_at = NOW(), withdrawal_reason = ?
          WHERE id = ? AND status = ?`,
        [actorUserId, reason.trim(), id, v.status],
      );
      if (result.affectedRows !== 1) {
        throw new PaymentVoucherError("Voucher status changed under you — reload and try again", 409);
      }

      await recordFinanceApprovalEvent(
        {
          entityType: "payment_voucher",
          entityId: id,
          action: "withdraw",
          fromStatus: v.status,
          toStatus: "withdrawn",
          decision: "withdraw",
          actorUserId,
          actorRole: actorRole ?? "unknown",
          remarks: reason.trim(),
        },
        connection,
      );
      await writeVoucherAudit(connection, "PAYMENT_VOUCHER_WITHDRAWN", id, actorUserId, actorRole, { reason: reason.trim(), fromStatus: v.status });

      await connection.commit();

      // Whoever didn't do the withdrawing should hear about it — the raiser if someone else
      // recalled it, or nobody (silent) if the raiser withdrew their own still-unapproved request,
      // since there's no one downstream waiting on it yet.
      if (v.status === "ceo_approved" && String(v.raised_by) !== String(actorUserId)) {
        await inboxService.createItem({
          user_id: v.raised_by,
          type: "payment_voucher_withdrawn",
          title: `Payment Voucher recalled before release`,
          description: reason.trim(),
          entity_type: "payment_voucher",
          entity_id: id,
          action_url: "/finance/payment-vouchers",
          priority: "high",
        }).catch(() => undefined);
      }
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    await logSensitiveAction({
      actor_user_id: actorUserId,
      actor_role: actorRole,
      action_type: "PAYMENT_VOUCHER_WITHDRAWN",
      module_key: "FINANCE",
      entity_type: "payment_voucher",
      entity_id: id,
    }).catch(() => undefined);

    return this.get(id);
  },

  async saveAttachment(id: string, filePath: string, originalName: string, actorUserId: string, mimeType?: string) {
    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE payment_voucher
          SET attachment_path = ?, attachment_original_name = ?, attachment_mime = ?,
              attachment_uploaded_by = ?, attachment_uploaded_at = NOW()
        WHERE id = ? AND status <> 'released'`,
      [filePath, originalName, mimeType ?? null, actorUserId, id],
    );
    if (result.affectedRows !== 1) {
      throw new PaymentVoucherError("Attachment can only be added or changed before a voucher is released — once released it is part of the historical record.", 409);
    }
    await logSensitiveAction({
      actor_user_id: actorUserId,
      action_type: "PAYMENT_VOUCHER_ATTACHMENT_SAVED",
      module_key: "FINANCE",
      entity_type: "payment_voucher",
      entity_id: id,
      change_summary: { filePath, originalName, mimeType },
    }).catch(() => undefined);
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
    // Optional for every mode, not just Cash: reconciliation's own matching logic (see
    // bank-reconciliation-match.service.ts's autoMatch) works purely off amount + date, never
    // off this reference, so requiring it bought nothing but friction — Finance often doesn't
    // have a UTR in hand yet at release time.
    const transactionRef = input.transactionRef?.trim() || null;

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
      // Every bank_account_ledger_entry insert below (vendor_grn/TDS-memo/imprest/general lanes,
      // all sharing this one paymentDate) needs the same guard — one call here covers all of them.
      await assertNotInClosedPeriod(connection, v.bank_account_id, paymentDate);

      const [[lastEntry]] = await connection.execute<RowDataPacket[]>(
        `SELECT running_balance FROM bank_account_ledger_entry
          WHERE bank_account_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
        [v.bank_account_id],
      );
      let runningBalance = lastEntry ? Number((lastEntry as any).running_balance) : Number((bankAccount as any).opening_balance);

      const amount = roundMoney(Number(v.amount));

      // Journal Task 3 — every lane below pushes into this ONE array; it posts through exactly
      // one journalService.post() call at the end (see payment-voucher-journal-lines.ts's
      // header for why one call, not one per allocation/lane). A TDS-account resolution failure
      // partway through (thrown by vendorGrnLines/vendorAdvanceApplicationLines) still rolls
      // back the whole release, same as every other refusal in this transaction.
      const journalLines: JournalLineInput[] = [];
      let tdsPayableAccountId: string | null = null;

      // Branch/cost-centre/process depth (owner directive 2026-09-17, same dimension GRN
      // postings already carry — 1798_journal_entry_branch_cost_centre_process.sql). A
      // multi-GRN voucher can span allocations with different cost centres; narrowing to
      // "only keep a value every source agrees on" is the same non-guessing discipline that
      // migration's own header describes, not a new policy invented here. undefined = no
      // source seen yet, null = sources disagreed (or none had a value), string = everything
      // seen so far agrees.
      let branchCandidate: string | null | undefined;
      let costCentreCandidate: string | null | undefined;
      let processCandidate: string | null | undefined;
      const narrow = (current: string | null | undefined, next: string | null | undefined): string | null | undefined => {
        if (next == null) return current;
        if (current === undefined) return next;
        return current === next ? current : null;
      };
      const resolveTdsPayableAccountId = async () => {
        if (tdsPayableAccountId !== null) return tdsPayableAccountId;
        const [[row]] = await connection.execute<RowDataPacket[]>(
          `SELECT id FROM payable_account_master WHERE account_name = 'TDS Payable' LIMIT 1`,
        );
        tdsPayableAccountId = row ? String((row as any).id) : "";
        return tdsPayableAccountId || null;
      };

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

          // Journal Task 3 — Dr Vendor (net + tds) / Cr Bank (net) / Cr TDS Payable (tds).
          // vendor_id isn't on dispatchResult.payment when release() calls dispatch() with its
          // own connection (see dispatch()'s own comment on that shape) — read it directly.
          const [[vptRow]] = await connection.execute<RowDataPacket[]>(
            `SELECT vendor_id, branch_id, cost_centre_id, process_id FROM vendor_payment_tracking WHERE id = ?`,
            [alloc.vendorPaymentTrackingId],
          );
          branchCandidate = narrow(branchCandidate, (vptRow as any)?.branch_id ?? null);
          costCentreCandidate = narrow(costCentreCandidate, (vptRow as any)?.cost_centre_id ?? null);
          processCandidate = narrow(processCandidate, (vptRow as any)?.process_id ?? null);
          if ((vptRow as any)?.vendor_id) {
            journalLines.push(
              ...vendorGrnLines({
                vendorId: String((vptRow as any).vendor_id),
                bankAccountId: v.bank_account_id,
                netAmount: alloc.amount,
                tdsAmount: tds,
                tdsPayableAccountId: tds > 0 ? await resolveTdsPayableAccountId() : null,
              }),
            );
          }
        }
      } else if (v.source_type === "imprest_allocation") {
        const [[manager]] = await connection.execute<RowDataPacket[]>(
          `SELECT id, branch_id FROM imprest_manager WHERE id = ? FOR UPDATE`,
          [v.linked_imprest_manager_id],
        );
        if (!manager) throw new PaymentVoucherError("Linked imprest manager no longer exists", 404);
        branchCandidate = narrow(branchCandidate, (manager as any).branch_id ?? null);

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

        // Journal Task 3 — Dr Imprest Float (the ledger head this voucher was raised under) /
        // Cr Bank.
        journalLines.push(
          ...imprestAllocationLines({
            imprestFloatAccountId: v.payable_account_id,
            bankAccountId: v.bank_account_id,
            amount,
          }),
        );
      } else if (v.source_type === "vendor_advance") {
        // Real money out to the vendor, no GRN behind it — same bank-debit shape as the
        // 'general' lane, plus crediting this vendor's advance balance so it's available to
        // draw down later via a 'vendor_advance_application' voucher.
        branchCandidate = narrow(branchCandidate, (bankAccount as any).branch_id ?? null);
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
            `Vendor advance — voucher ${v.voucher_number}`,
            transactionRef,
            runningBalance,
            actorUserId,
          ],
        );

        // Lock the vendor as the serialization point for vendor_advance_ledger writes — same
        // "lock the owning entity row, read the last balance, compute, insert" discipline
        // imprest-ledger.service.ts's post() uses for imprest_manager, so two vouchers for the
        // same vendor releasing concurrently can't read the same stale balance.
        const [[vendorLock]] = await connection.execute<RowDataPacket[]>(
          `SELECT id FROM vendor_master WHERE id = ? FOR UPDATE`,
          [v.linked_vendor_id],
        );
        if (!vendorLock) throw new PaymentVoucherError("Vendor not found", 404);
        const priorAdvanceBalance = await getVendorAdvanceBalance(connection, v.linked_vendor_id);
        const newAdvanceBalance = roundMoney(priorAdvanceBalance + amount);
        await connection.execute(
          `INSERT INTO vendor_advance_ledger
             (id, vendor_id, branch_id, direction, amount, balance_after, payment_voucher_id, narration, created_by)
           VALUES (?, ?, ?, 'credit', ?, ?, ?, ?, ?)`,
          [
            randomUUID(), v.linked_vendor_id, (bankAccount as any).branch_id, amount, newAdvanceBalance,
            id, `Advance paid — voucher ${v.voucher_number}`, actorUserId,
          ],
        );

        // Journal Task 3 — Dr Vendor / Cr Bank. Nets naturally against whatever that vendor's
        // own sub-ledger owes from GRNs already posted (or will post later).
        journalLines.push(
          ...vendorAdvanceLines({
            vendorId: v.linked_vendor_id,
            bankAccountId: v.bank_account_id,
            amount,
          }),
        );
      } else if (v.source_type === "vendor_advance_application") {
        // No new money moves here — the cash left the bank when the original vendor_advance
        // voucher released. This settles GRN dues on paper: walk the allocation set (same table
        // vendor_grn uses) and dispatch each with payment_mode='Adjustment', which
        // vendor-payment-ledger.service.ts's dispatch() already handles as a first-class,
        // no-bank-required path (not in BANK_MODES) that still correctly updates the GRN due's
        // paid/balance/status — and, since no companyBankAccountId is supplied, correctly writes
        // NO bank_account_ledger_entry row, because no real cash is moving right now.
        const [[vendorLock]] = await connection.execute<RowDataPacket[]>(
          `SELECT id FROM vendor_master WHERE id = ? FOR UPDATE`,
          [v.linked_vendor_id],
        );
        if (!vendorLock) throw new PaymentVoucherError("Vendor not found", 404);

        const available = await getVendorAdvanceBalance(connection, v.linked_vendor_id);
        if (amount > available + 0.01) {
          throw new PaymentVoucherError(
            `This vendor's available advance balance (${available}) is now less than the amount being applied (${amount}) — another application likely drew it down since this voucher was raised.`,
            409,
          );
        }

        const [applicationAllocRows] = await connection.execute<RowDataPacket[]>(
          `SELECT vendor_payment_tracking_id, allocated_amount
             FROM payment_voucher_grn_allocation WHERE payment_voucher_id = ? ORDER BY created_at ASC`,
          [id],
        );
        const applicationAllocations = (applicationAllocRows as any[]).map((r) => ({
          vendorPaymentTrackingId: r.vendor_payment_tracking_id,
          amount: roundMoney(Number(r.allocated_amount)),
        }));

        for (const alloc of applicationAllocations) {
          const [[applicationVptRow]] = await connection.execute<RowDataPacket[]>(
            `SELECT branch_id, cost_centre_id, process_id FROM vendor_payment_tracking WHERE id = ?`,
            [alloc.vendorPaymentTrackingId],
          );
          branchCandidate = narrow(branchCandidate, (applicationVptRow as any)?.branch_id ?? null);
          costCentreCandidate = narrow(costCentreCandidate, (applicationVptRow as any)?.cost_centre_id ?? null);
          processCandidate = narrow(processCandidate, (applicationVptRow as any)?.process_id ?? null);

          const applicationDispatch = await vendorPaymentLedgerService.dispatch(
            alloc.vendorPaymentTrackingId,
            {
              paymentMode: "Adjustment",
              paymentDate,
              paymentAmount: alloc.amount,
              remarks: `Settled from vendor advance — voucher ${v.voucher_number}`,
              allowSharedReference: applicationAllocations.length > 1,
            },
            actorUserId,
            actorRole,
            connection,
            v.id,
          );

          // Journal Task 3 — no principal entry (the GRN's Cr Vendor and the advance's Dr
          // Vendor already net on the vendor's own ledger); only TDS, if this installment
          // withholds any, needs a line — see vendorAdvanceApplicationLines' own header.
          const applicationTds = roundMoney(
            Number(applicationDispatch.transactions[applicationDispatch.transactions.length - 1]?.tds_amount ?? 0),
          );
          if (applicationTds > 0) {
            journalLines.push(
              ...vendorAdvanceApplicationLines({
                vendorId: v.linked_vendor_id,
                tdsAmount: applicationTds,
                tdsPayableAccountId: await resolveTdsPayableAccountId(),
              }),
            );
          }
        }

        const newAdvanceBalance = roundMoney(available - amount);
        await connection.execute(
          `INSERT INTO vendor_advance_ledger
             (id, vendor_id, branch_id, direction, amount, balance_after, payment_voucher_id, narration, created_by)
           VALUES (?, ?, ?, 'debit', ?, ?, ?, ?, ?)`,
          [
            randomUUID(), v.linked_vendor_id, (bankAccount as any).branch_id, amount, newAdvanceBalance,
            id, `Applied against ${applicationAllocations.length} GRN due(s) — voucher ${v.voucher_number}`, actorUserId,
          ],
        );
      } else {
        // 'general' lane — no vendor GRN or imprest manager to update, just the bank debit
        // against whatever Payable Account (Salary Payable / Statutory Dues / Bank Charges /
        // TDS Payable / Other) the voucher was raised under. particulars carries the "what this
        // is for" a GRN number or imprest manager name would otherwise supply.
        branchCandidate = narrow(branchCandidate, (bankAccount as any).branch_id ?? null);
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

        // Journal Task 3 — Dr whichever payable_account this voucher was raised under
        // (Salary Payable / Statutory Dues / Bank Charges / TDS Payable / Other) / Cr Bank.
        journalLines.push(
          ...generalLines({
            payableAccountId: v.payable_account_id,
            bankAccountId: v.bank_account_id,
            amount,
          }),
        );
      }

      // Sufficient-funds guard (found 2026-09-17 CEO/CA compliance review) — release() tracked
      // runningBalance through every cash-moving lane above but never refused if it went
      // negative, so a voucher could overdraw the recorded bank balance with nobody warned.
      // Skipped for vendor_advance_application — that lane never touches runningBalance (no cash
      // moves, it settles a GRN on paper against an existing advance), so checking it here would
      // block a paper adjustment over a balance condition it had no part in creating.
      // -0.01 tolerance for paisa rounding noise only, matching roundMoney()'s own 2-decimal
      // convention; a real shortfall is never that small. Checked here, before ANY row commits
      // (still inside this transaction — connection.rollback() in the catch below undoes
      // everything above on throw).
      if (v.source_type !== "vendor_advance_application" && runningBalance < -0.01) {
        throw new PaymentVoucherError(
          `This release would take the account's recorded balance to ₹${roundMoney(runningBalance)} — below zero. Refusing to release rather than silently overdraw the account.`,
          409,
        );
      }

      // Journal Task 3 — the single post() for this entire release, covering every lane and
      // every allocation above. One payment_voucher = one journal_entry = one Tally voucher.
      // Nothing to post is legitimate (e.g. a vendor_advance_application with zero TDS) — post()
      // itself is only called when there's at least one line, since it refuses a <2-line entry.
      if (journalLines.length > 0) {
        await journalService.post(connection, {
          entryDate: paymentDate,
          narration: `Payment Voucher ${v.voucher_number} released (${v.source_type})`,
          sourceType: "payment_voucher",
          sourceId: id,
          postedBy: actorUserId,
          branchId: branchCandidate ?? null,
          costCentreId: costCentreCandidate ?? null,
          processId: processCandidate ?? null,
          lines: journalLines,
        });
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

  vendorAdvanceBalance(vendorId: string): Promise<number> {
    return getVendorAdvanceBalance(db, vendorId);
  },
};
