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
  | "changes_requested";

export type Voucher = {
  id: string;
  voucher_number: string;
  voucher_type: string;
  source_type: "vendor_grn" | "imprest_allocation" | "general";
  particulars: string | null;
  bank_account_id: string;
  bank_account_name: string | null;
  payable_account_id: string;
  payable_account_name: string | null;
  linked_vendor_payment_id: string | null;
  grn_number: string | null;
  vendor_name: string | null;
  linked_imprest_manager_id: string | null;
  imprest_manager_name: string | null;
  amount: number;
  remarks: string | null;
  reason: string | null;
  status: VoucherStatus;
  raised_by: string | null;
  raised_at: string | null;
  ceo_approved_by: string | null;
  ceo_approved_at: string | null;
  released_by: string | null;
  released_at: string | null;
  accounts_reviewed_by: string | null;
  accounts_reviewed_at: string | null;
  review_note: string | null;
  payment_mode: string | null;
  payment_date: string | null;
  transaction_ref: string | null;
  rejection_reason: string | null;
  changes_requested_note: string | null;
  head: string | null;
  sub_head: string | null;
  created_at: string;
  approval_events?: Array<{ action: string; actor_user_id: string; actor_role: string; created_at: string; remarks: string | null }>;
  audit_log?: Array<{ action_type: string; created_at: string }>;
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

export const STATUS_TONE: Record<VoucherStatus, string> = {
  draft: "border-slate-200 bg-slate-50 text-slate-600",
  raised: "border-amber-200 bg-amber-50 text-amber-800",
  ceo_approved: "border-blue-200 bg-blue-50 text-blue-800",
  released: "border-emerald-200 bg-emerald-50 text-emerald-800",
  rejected: "border-rose-200 bg-rose-50 text-rose-800",
  changes_requested: "border-orange-200 bg-orange-50 text-orange-800",
};

export const STATUS_LABEL: Record<VoucherStatus, string> = {
  draft: "Draft", raised: "Awaiting CEO", ceo_approved: "Awaiting Release", released: "Released", rejected: "Rejected",
  changes_requested: "Changes Requested",
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
  return [
    { key: "raised", label: "Raised", state: "done", who: v.raised_by, at: v.raised_at, note: null },
    {
      key: "ceo",
      label: "CEO Approval",
      state: rejected ? "rejected" : v.ceo_approved_at ? "done" : v.status === "raised" ? "current" : "upcoming",
      who: v.ceo_approved_by, at: v.ceo_approved_at, note: rejected ? v.rejection_reason : null,
    },
    {
      key: "release",
      label: "Release",
      state: v.released_at ? "done" : rejected ? "upcoming" : v.status === "ceo_approved" ? "current" : "upcoming",
      who: v.released_by, at: v.released_at, note: null,
    },
  ];
}

export const STAGE_BAR: Record<StageState, string> = { done: "bg-emerald-500", current: "bg-amber-400", rejected: "bg-rose-500", upcoming: "bg-slate-200" };
export const STAGE_TEXT: Record<StageState, string> = { done: "text-emerald-700", current: "text-amber-700", rejected: "text-rose-700", upcoming: "text-slate-400" };
