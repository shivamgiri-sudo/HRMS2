import type { RequestKind, RosterRequest, SlaState } from "./types";

const HOUR = 3_600_000;

const IST_NAIVE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a DB/API timestamp to epoch ms (NaN when unparseable). Naive strings
 * ("YYYY-MM-DD HH:MM:SS", date-only) are IST (+05:30), matching the DB pool;
 * strings carrying Z/an offset parse as-is. Kept in sync with the frontend copy.
 */
export function parseDbTimestamp(value: string): number {
  const v = String(value ?? "").trim();
  if (DATE_ONLY.test(v)) return new Date(`${v}T00:00:00+05:30`).getTime();
  if (IST_NAIVE.test(v)) return new Date(`${v.replace(" ", "T")}+05:30`).getTime();
  return new Date(v).getTime();
}

export function computeSla(raisedAt: string, shiftDate: string, now: Date): { state: SlaState; ageHours: number } {
  const raised = parseDbTimestamp(raisedAt);
  if (Number.isNaN(raised)) return { state: "ok", ageHours: 0 };
  const ageHours = Math.max(0, Math.floor((now.getTime() - raised) / HOUR));
  const shift = new Date(`${shiftDate.slice(0, 10)}T00:00:00+05:30`).getTime();
  const toShift = Number.isNaN(shift) ? Infinity : (shift - now.getTime()) / HOUR;
  if (toShift <= 24) return { state: "urgent", ageHours };
  if (ageHours > 48) return { state: "overdue", ageHours };
  if (ageHours >= 24) return { state: "due_soon", ageHours };
  return { state: "ok", ageHours };
}

function build(kind: RequestKind, id: string, p: Omit<RosterRequest, "key" | "kind" | "id" | "slaState" | "ageHours" | "counterpartStatus"> & { counterpartStatus?: string | null }, now: Date): RosterRequest {
  const sla = computeSla(p.raisedAt, p.date, now);
  return { key: `${kind}:${id}`, kind, id, ...p, counterpartStatus: p.counterpartStatus ?? null, slaState: sla.state, ageHours: sla.ageHours };
}
const d10 = (v: unknown) => String(v ?? "").slice(0, 10);

export const normalizeSwap = (s: any, now = new Date()) =>
  build("swap", String(s.id), { employeeId: s.requester_employee_id ?? null, employeeName: s.requester_name ?? "Employee", secondaryName: s.target_name ?? null, date: d10(s.swap_date), reason: s.reason ?? null, counterpartStatus: s.counterpart_status ?? null, raisedAt: String(s.created_at ?? ""), raw: s }, now);

// Week-off rejection / dispute age from when the employee raised it (employee_ack_at is stamped on
// reject, disputed_at on dispute — migration 2074); updated_at, which moves on any later write, is
// only the fallback for rows raised before those were recorded.
export const normalizeWeekoff = (w: any, now = new Date()) =>
  build("weekoff_rejection", String(w.id), { employeeId: w.employee_id ?? null, employeeName: w.employee_name ?? "Employee", secondaryName: null, date: d10(w.roster_date), reason: w.employee_rejection_reason ?? null, raisedAt: String(w.employee_ack_at ?? w.updated_at ?? w.created_at ?? ""), raw: w }, now);

export const normalizeDispute = (r: any, now = new Date()) =>
  build("dispute", String(r.id), { employeeId: r.employee_id ?? null, employeeName: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "Employee", secondaryName: null, date: d10(r.roster_date), reason: r.dispute_reason ?? null, raisedAt: String(r.disputed_at ?? r.updated_at ?? r.roster_date ?? ""), raw: r }, now);

export const normalizeConflict = (c: any, now = new Date()) =>
  build("conflict", String(c.id), { employeeId: c.employees_involved?.[0] ?? null, employeeName: c.employee_names?.[0] ?? "Employee", secondaryName: null, date: d10(c.conflict_date), reason: c.description ?? c.conflict_type ?? null, raisedAt: String(c.created_at ?? ""), raw: c }, now);

const RANK: Record<SlaState, number> = { urgent: 0, overdue: 1, due_soon: 2, ok: 3 };
export const sortRequests = (list: RosterRequest[]) =>
  [...list].sort((a, b) => RANK[a.slaState] - RANK[b.slaState] || b.ageHours - a.ageHours);
