// src/lib/finance/journalVoucherStatus.ts
//
// Journal Voucher vocabulary and formatters, shared by every surface that shows one — the list
// page, the drill-down drawer, and the create/edit form.

export type JvStatus = "draft" | "pending_approval" | "posted" | "rejected" | "withdrawn" | "reversed";

export type JvType =
  | "reclassification"
  | "provision"
  | "accrual_reversal"
  | "prepaid_amortisation"
  | "depreciation"
  | "correction"
  | "opening_balance"
  | "other";

export type JvAccountType = "expense_sub_head" | "payable_account";

export const STATUS_LABEL: Record<JvStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  posted: "Posted",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  reversed: "Reversed",
};

export const STATUS_TONE: Record<JvStatus, string> = {
  draft: "border-slate-200 bg-slate-50 text-slate-600",
  pending_approval: "border-amber-200 bg-amber-50 text-amber-700",
  posted: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rejected: "border-rose-200 bg-rose-50 text-rose-700",
  withdrawn: "border-slate-200 bg-slate-100 text-slate-500",
  reversed: "border-violet-200 bg-violet-50 text-violet-700",
};

export const TYPE_LABEL: Record<JvType, string> = {
  reclassification: "Reclassification",
  provision: "Provision",
  accrual_reversal: "Accrual Reversal",
  prepaid_amortisation: "Prepaid Amortisation",
  depreciation: "Depreciation",
  correction: "Correction",
  opening_balance: "Opening Balance",
  other: "Other",
};

export const JV_TYPES: JvType[] = [
  "reclassification", "provision", "accrual_reversal", "prepaid_amortisation",
  "depreciation", "correction", "opening_balance", "other",
];

export const JV_STATUSES: JvStatus[] = ["draft", "pending_approval", "posted", "rejected", "withdrawn", "reversed"];

export type JvLine = {
  id: string;
  lineOrder: number;
  accountType: JvAccountType;
  accountId: string;
  accountLabel: string;
  accountHint: string;
  debitAmount: number;
  creditAmount: number;
  narration: string | null;
};

export type JvListRow = {
  id: string;
  voucherNumber: string | null;
  voucherDate: string;
  jvType: JvType;
  narration: string;
  referenceNo: string | null;
  branchId: string | null;
  branchName: string | null;
  costCentreId: string | null;
  costCentreName: string | null;
  processId: string | null;
  processName: string | null;
  totalAmount: number;
  lineCount: number;
  status: JvStatus;
  createdBy: string;
  createdByName: string | null;
  createdAt: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  pendingHours: number | null;
  journalEntryId: string | null;
  permissions: JvPermissions;
};

export type JvPermissions = {
  canEdit: boolean;
  canDelete: boolean;
  canSubmit: boolean;
  canWithdraw: boolean;
  canApprove: boolean;
  canReject: boolean;
  canReverse: boolean;
};

export type JvLedgerEntry = {
  kind: "posting" | "reversal";
  journalEntryId: string;
  entryDate: string;
  postedAt: string | null;
  postedByName: string | null;
  narration: string;
  lines: { accountLabel: string; debitAmount: number; creditAmount: number }[];
};

export type JvTimelineEvent = {
  id: string;
  action: string;
  fromStatus: string | null;
  toStatus: string;
  actorName: string | null;
  actorRole: string;
  remarks: string | null;
  at: string;
};

export type JvDetail = JvListRow & {
  approvalNote: string | null;
  rejectedByName: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  withdrawnByName: string | null;
  withdrawnAt: string | null;
  withdrawalReason: string | null;
  reversedByName: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  reversalEntryId: string | null;
  submittedByName: string | null;
  lines: JvLine[];
  ledgerEntries: JvLedgerEntry[];
  timeline: JvTimelineEvent[];
  audit: { action: string; actorName: string | null; actorRole: string | null; at: string }[];
};

export function money(value: unknown): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
}

export function compactMoney(value: unknown): string {
  const n = Number(value ?? 0);
  if (Math.abs(n) >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (Math.abs(n) >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  return money(n);
}

export function dateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function dateOnly(value: string | null): string {
  if (!value) return "—";
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
