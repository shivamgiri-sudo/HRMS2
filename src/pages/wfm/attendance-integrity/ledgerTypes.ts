// Types + pure helpers for the Branch Ledger tab. Mirrors the payloads of
// backend/src/modules/wfm/attendance-ledger.routes.ts (mounted at /api/wfm/attendance-ledger).

export type LedgerKind =
  | "regularization"
  | "mismatch_resolution"
  | "exception_resolution"
  | "dispute"
  | "manual_override";

export const LEDGER_KINDS: LedgerKind[] = [
  "regularization",
  "dispute",
  "mismatch_resolution",
  "exception_resolution",
  "manual_override",
];

export const KIND_LABELS: Record<LedgerKind, string> = {
  regularization: "Regularization",
  dispute: "Dispute",
  mismatch_resolution: "Mismatch resolution",
  exception_resolution: "Exception resolution",
  manual_override: "Manual override",
};

export const KIND_TONE: Record<LedgerKind, string> = {
  regularization: "bg-blue-50 text-blue-700",
  dispute: "bg-violet-50 text-violet-700",
  mismatch_resolution: "bg-amber-50 text-amber-800",
  exception_resolution: "bg-slate-100 text-slate-700",
  manual_override: "bg-rose-50 text-rose-700",
};

export interface ActorInfo {
  user_id: string;
  name: string | null;
  code: string | null;
  employee_id: string | null;
  email: string | null;
  role: string | null;
}

export interface BranchTally {
  branch_id: string;
  branch_name: string | null;
  regularizations: { total: number; approved: number; rejected: number; pending: number; other: number };
  mismatch_resolutions: number;
  exception_resolutions: number;
  disputes: number;
  manual_overrides: number;
  total_actions: number;
  employees_affected: number;
  actors: number;
}

export interface SummaryData {
  window: { from: string; to: string };
  scope_is_global: boolean;
  branches: BranchTally[];
  totals: { total_actions: number; employees_affected: number; actors: number };
  warnings: string[];
}

export interface LedgerEntry {
  kind: LedgerKind;
  source_id: string;
  record_date: string | null;
  employee_id: string;
  employee_name: string | null;
  employee_code: string | null;
  branch_id: string | null;
  branch_name: string | null;
  actor_id: string | null;
  given_by: ActorInfo | null;
  given_by_label: string | null;
  decision: string | null;
  reason: string | null;
  note: string | null;
  acted_at: string | null;
  meta: Record<string, unknown>;
}

export interface EntriesResponse {
  data: LedgerEntry[];
  total: number;
  counts_by_kind: Partial<Record<LedgerKind, number>>;
  page: number;
  limit: number;
  warnings: string[];
}

export interface PeopleRow {
  employee: { employee_id: string; name: string | null; code: string | null };
  given_by: ActorInfo | null;
  counts: Partial<Record<LedgerKind, number>>;
  total: number;
}

export interface PeopleData {
  truncated: boolean;
  rows: PeopleRow[];
  actors: Array<ActorInfo & { counts: Partial<Record<LedgerKind, number>>; total: number }>;
  warnings: string[];
}

export interface TimelineEvent { label: string; at: string | null; by: ActorInfo | null; note: string | null }

export interface AuditRow {
  id: string;
  actor_user_id: string | null;
  actor_role: string | null;
  action_type: string;
  reason: string | null;
  old_value_json: unknown;
  new_value_json: unknown;
  acted_at: string | null;
  actor: ActorInfo | null;
}

export interface DetailData {
  kind: LedgerKind;
  label: string;
  record: Record<string, unknown>;
  employee: { id: string; name: string | null; code: string | null; branch_id: string | null; branch_name: string | null };
  people: Record<string, ActorInfo | null>;
  timeline: TimelineEvent[];
  audit: AuditRow[];
  related: Record<string, Array<Record<string, unknown>>>;
  warnings: string[];
}

// ── Formatting ────────────────────────────────────────────────────────────────

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/;

/** DD/MM/YYYY. The API sends IST date strings; parsed textually so no timezone shift can occur. */
export function fmtDate(value: unknown): string {
  if (!value) return "None";
  const s = String(value);
  const m = DATE_ONLY.exec(s) ?? DATE_TIME.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

/** DD/MM/YYYY HH:mm. */
export function fmtDateTime(value: unknown): string {
  if (!value) return "None";
  const s = String(value);
  const m = DATE_TIME.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : fmtDate(s);
}

export function humanize(value: string | null | undefined): string {
  if (!value) return "None";
  const s = value.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Person as "Name (CODE)"; falls back to email, then the raw user id. */
export function personLabel(p: { name: string | null; code: string | null; email?: string | null; user_id?: string } | null): string {
  if (!p) return "None";
  if (p.name) return p.code ? `${p.name} (${p.code})` : p.name;
  return p.email ?? p.user_id ?? "None";
}

export function givenByLabel(e: Pick<LedgerEntry, "given_by" | "given_by_label" | "actor_id">): string {
  if (e.given_by) return personLabel(e.given_by);
  return e.given_by_label ?? "None";
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 'YYYY-MM' -> first and last day, without touching Date for the string result. */
export function monthWindow(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}

// ── CSV ───────────────────────────────────────────────────────────────────────

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // Neutralise spreadsheet formula injection from free-text fields.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function entriesToCsv(rows: LedgerEntry[]): string {
  const header = [
    "Type", "Attendance date", "Employee", "Employee code", "Branch", "Given by", "Given by code",
    "Given by role", "Decision", "Reason", "Note", "Acted at", "Record id",
  ];
  const lines = rows.map((r) => [
    KIND_LABELS[r.kind], r.record_date ? fmtDate(r.record_date) : "", r.employee_name, r.employee_code, r.branch_name,
    r.given_by?.name ?? givenByLabel(r), r.given_by?.code, r.given_by?.role,
    r.decision, r.reason, r.note, r.acted_at ? fmtDateTime(r.acted_at) : "", r.source_id,
  ].map(csvCell).join(","));
  return [header.join(","), ...lines].join("\r\n");
}
