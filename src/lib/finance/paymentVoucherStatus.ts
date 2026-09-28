// src/lib/finance/paymentVoucherStatus.ts
//
// Payment Voucher status vocabulary and formatters, shared by every surface that shows a
// voucher.
//
// A vendor due can be settled two ways — a voucher raised on /finance/payment-vouchers, or a
// voucher raised straight from a row on /finance/vendor-payment-tracking — and both read the
// same payment_voucher row. Keeping the tone map, the label map and the stage derivation here
// (rather than inside PaymentVouchersPage.tsx, where they started) is what stops the two pages
// drifting into showing the same voucher two different ways.
//
// Extracted verbatim from PaymentVouchersPage.tsx; no behaviour change.

export type VoucherStatus =
  | "draft"
  | "raised"
  | "ceo_approved"
  | "rejected"
  | "released"
  | "changes_requested"
  | "withdrawn";

export type Voucher = {
  id: string;
  voucher_number: string;
  voucher_type: string;
  source_type: "vendor_grn" | "imprest_allocation" | "general" | "vendor_advance" | "vendor_advance_application";
  particulars: string | null;
  expense_head_name?: string | null;
  expense_sub_head_name?: string | null;
  bank_account_id: string;
  bank_account_name: string | null;
  payable_account_id: string;
  payable_account_name: string | null;
  linked_vendor_payment_id: string | null;
  grn_number: string | null;
  vendor_name: string | null;
  /** TDS on the single/legacy-linked GRN due — only meaningful pre-allocation-table vouchers;
   *  a multi-GRN voucher's TDS lives on each grn_allocations[] row instead. */
  tds_deducted_amount?: number | null;
  linked_imprest_manager_id: string | null;
  imprest_manager_name: string | null;
  /** vendor_advance/vendor_advance_application carry no GRN, so vendor_name above is null for
   *  them — this is their vendor identity. */
  linked_vendor_id: string | null;
  linked_vendor_name: string | null;
  /** The vendor's advance balance AFTER this voucher — returned by get(), null for every other
   *  source type. */
  vendor_advance_balance: number | null;
  amount: number;
  remarks: string | null;
  reason: string | null;
  status: VoucherStatus;
  raised_by: string | null;
  raised_by_name?: string | null;
  raised_at: string | null;
  ceo_approved_by: string | null;
  ceo_approved_by_name?: string | null;
  ceo_approved_at: string | null;
  released_by: string | null;
  released_by_name?: string | null;
  released_at: string | null;
  accounts_reviewed_by: string | null;
  accounts_reviewed_by_name?: string | null;
  accounts_reviewed_at: string | null;
  review_note: string | null;
  payment_mode: string | null;
  payment_date: string | null;
  transaction_ref: string | null;
  rejection_reason: string | null;
  changes_requested_note: string | null;
  withdrawn_by?: string | null;
  withdrawn_by_name?: string | null;
  withdrawn_at?: string | null;
  withdrawal_reason?: string | null;
  /** Supporting document (invoice, bank advice, approval memo) — one per voucher, re-uploadable
   *  until release, then locked. Null when nothing has been attached yet. */
  attachment_path?: string | null;
  attachment_original_name?: string | null;
  attachment_mime?: string | null;
  attachment_uploaded_by?: string | null;
  attachment_uploaded_by_name?: string | null;
  attachment_uploaded_at?: string | null;
  head: string | null;
  sub_head: string | null;
  created_at: string;
  /** Live balance of the account this voucher would debit — see payment-voucher.service.ts's
   *  get() for why this is NOT company_bank_account.opening_balance. Null only when the voucher
   *  has no bank account at all. */
  current_bank_balance?: number | null;
  approval_events?: Array<{ action: string; actor_user_id: string; actor_name?: string | null; actor_role: string; created_at: string; remarks: string | null }>;
  audit_log?: Array<{ action_type: string; actor_user_id?: string; actor_name?: string | null; created_at: string }>;
  consumption_since_replenishment?: { sinceDate: string; rows: Array<{ transaction_date: string; amount: number; grn_number: string | null; expense_head: string | null; narration: string | null }> } | null;
  grn_allocations?: Array<{
    vendor_payment_tracking_id: string; allocated_amount: number; grn_number: string | null; vendor_name: string | null;
    head: string | null; sub_head: string | null; due_date: string | null; due_amount: number; tds_deducted_amount: number;
    paid_amount: number; balance_amount: number;
  }>;
};

export const PAYMENT_MODES = ["Cheque", "NEFT", "RTGS", "IMPS", "UPI", "Cash", "Bank Transfer", "Adjustment", "Other"];

export function money(value: unknown) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value ?? 0));
}

export function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(d);
}

// Solid-fill pills (not the lighter bordered/tinted style this used to be) — picked from the
// reference dashboard's Paid/Unpaid/Completed status pills: full saturation, white text, no
// border, tight padding. Same semantic hue per status as before, just a crisper fill.
export const STATUS_TONE: Record<VoucherStatus, string> = {
  draft: "border-transparent bg-slate-400 text-white",
  raised: "border-transparent bg-amber-500 text-white",
  ceo_approved: "border-transparent bg-blue-600 text-white",
  released: "border-transparent bg-emerald-600 text-white",
  rejected: "border-transparent bg-rose-600 text-white",
  changes_requested: "border-transparent bg-orange-500 text-white",
  withdrawn: "border-transparent bg-slate-500 text-white",
};

export const STATUS_LABEL: Record<VoucherStatus, string> = {
  draft: "Draft", raised: "Awaiting CEO", ceo_approved: "Awaiting Release", released: "Released", rejected: "Rejected",
  changes_requested: "Changes Requested", withdrawn: "Withdrawn",
};

/**
 * Statuses that mean a voucher is mid-flight and owns the due.
 *
 * Mirrors ACTIVE_VOUCHER_STATUSES in backend/src/modules/finance/vendor-payment.service.ts,
 * which is also what dispatch()'s server-side guard enforces. The UI gate and the server guard
 * must agree; if you change one, change the other.
 */
export const ACTIVE_VOUCHER_STATUSES: VoucherStatus[] = ["raised", "ceo_approved", "changes_requested"];

export type StageState = "done" | "current" | "rejected" | "upcoming";
export type Stage = { key: string; label: string; state: StageState; who: string | null; at: string | null; note: string | null };

/** Stage state derived purely from the voucher's own columns — same principle as
 *  BudgetTopupPanel's buildApprovalStages, extended from two stages to three. */
export function buildStages(v: Voucher): Stage[] {
  const rejected = v.status === "rejected";
  // A withdrawal stops the process at whichever stage was underway: no CEO decision yet means
  // it was withdrawn by the raiser before reaching CEO Approval; a CEO decision already recorded
  // means it was recalled (by Finance Head or the approving CEO) at the Release stage instead.
  const withdrawnAtCeoStage = v.status === "withdrawn" && !v.ceo_approved_at;
  const withdrawnAtReleaseStage = v.status === "withdrawn" && !!v.ceo_approved_at;
  return [
    { key: "raised", label: "Raised", state: "done", who: v.raised_by_name ?? v.raised_by, at: v.raised_at, note: null },
    {
      key: "ceo",
      label: "CEO Approval",
      state: rejected || withdrawnAtCeoStage ? "rejected" : v.ceo_approved_at ? "done" : v.status === "raised" ? "current" : "upcoming",
      who: v.ceo_approved_by_name ?? v.ceo_approved_by, at: v.ceo_approved_at,
      note: rejected ? v.rejection_reason : withdrawnAtCeoStage ? `Withdrawn by raiser: ${v.withdrawal_reason ?? ""}` : null,
    },
    {
      key: "release",
      label: "Release",
      state: v.released_at ? "done" : withdrawnAtReleaseStage ? "rejected" : rejected || withdrawnAtCeoStage ? "upcoming" : v.status === "ceo_approved" ? "current" : "upcoming",
      who: v.released_by_name ?? v.released_by, at: v.released_at,
      note: withdrawnAtReleaseStage ? `Recalled: ${v.withdrawal_reason ?? ""}` : null,
    },
  ];
}

export const STAGE_BAR: Record<StageState, string> = { done: "bg-emerald-500", current: "bg-amber-400", rejected: "bg-rose-500", upcoming: "bg-slate-200" };
export const STAGE_TEXT: Record<StageState, string> = { done: "text-emerald-700", current: "text-amber-700", rejected: "text-rose-700", upcoming: "text-slate-400" };

export type JournalPreviewLine = { label: string; side: "Dr" | "Cr"; amount: number };

/**
 * What release() will actually post to the general ledger (found 2026-09-17 CEO/CA compliance
 * review — the CEO approving and the Finance Head releasing both acted on amount + vendor/purpose
 * + bank account only, never on what would actually be debited/credited). Computed client-side
 * from fields the detail response already carries — no separate preview endpoint, so this can
 * never drift from what release() itself does structurally.
 *
 * `approximate: true` on the vendor_grn/vendor_advance_application lanes — release() computes
 * TDS live at release time from the vendor's CURRENT TDS settings (payment-voucher.service.ts's
 * dispatch() call), so a value shown here from the due-amount snapshot at raise/approve time
 * could differ by the time of actual release if the vendor's TDS configuration changed in
 * between. Every other lane (imprest_allocation/vendor_advance/general) is fully deterministic
 * from fields already fixed at raise time — exact, not estimated.
 */
export function buildJournalPreview(v: Voucher): { lines: JournalPreviewLine[]; approximate: boolean } | null {
  const bank = v.bank_account_name ?? "Bank Account";
  const payable = v.payable_account_name ?? "Ledger Head";
  const amount = Number(v.amount ?? 0);

  switch (v.source_type) {
    case "imprest_allocation":
      return { lines: [{ label: payable, side: "Dr", amount }, { label: bank, side: "Cr", amount }], approximate: false };

    case "vendor_advance":
      return {
        lines: [{ label: v.linked_vendor_name ?? "Vendor", side: "Dr", amount }, { label: bank, side: "Cr", amount }],
        approximate: false,
      };

    case "general":
      return { lines: [{ label: payable, side: "Dr", amount }, { label: bank, side: "Cr", amount }], approximate: false };

    case "vendor_grn": {
      const allocations = v.grn_allocations ?? [];
      const tds = allocations.length > 0
        ? allocations.reduce((sum, a) => sum + Number(a.tds_deducted_amount || 0), 0)
        : Number(v.tds_deducted_amount || 0);
      const net = amount;
      const gross = net + tds;
      const lines: JournalPreviewLine[] = [
        { label: v.vendor_name ?? "Vendor", side: "Dr", amount: gross },
        { label: bank, side: "Cr", amount: net },
      ];
      if (tds > 0) lines.push({ label: "TDS Payable", side: "Cr", amount: tds });
      return { lines, approximate: true };
    }

    case "vendor_advance_application": {
      // No cash moves, no bank line — the advance and the GRN due already net against each
      // other on the vendor's own ledger (see payment-voucher-journal-lines.ts's
      // vendorAdvanceApplicationLines header). Only TDS, if any, posts.
      const tds = (v.grn_allocations ?? []).reduce((sum, a) => sum + Number(a.tds_deducted_amount || 0), 0);
      if (tds <= 0) return { lines: [], approximate: true };
      return {
        lines: [
          { label: v.linked_vendor_name ?? "Vendor", side: "Dr", amount: tds },
          { label: "TDS Payable", side: "Cr", amount: tds },
        ],
        approximate: true,
      };
    }

    default:
      return null;
  }
}
