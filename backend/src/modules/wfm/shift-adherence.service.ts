/**
 * Process-wise shift adherence for the Roster Command Center's Live Monitoring tab.
 *
 * One employee-level query for the day, classified by shift-adherence.calc.ts and rolled up
 * process -> shift slot -> reporting manager, with a late-minutes distribution at every level.
 * Scope (RBAC) and the UI branch/process/LOB filters are applied exactly as for the other Live
 * Monitoring endpoints: the filters only ever narrow the scope.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { isShiftDueYet, todayLocalDateStr } from "./shift-due.util.js";
import {
  buildEmployeeScope,
  type RosterIntelligenceFilters,
  type RosterIntelligenceScope,
} from "./roster-intelligence.service.js";
import {
  addToTally, classifyRow, deriveMetrics, emptyTally, LATE_BUCKETS,
  type ClassifiedRow, type Tally,
} from "./shift-adherence.calc.js";

export interface AdherenceNode extends Tally, ReturnType<typeof deriveMetrics> {}
export interface AdherenceSlot extends AdherenceNode { shift: string }
export interface AdherenceManager extends AdherenceNode { managerId: string | null; manager: string }
export interface AdherenceProcess extends AdherenceNode {
  processId: string | null;
  process: string;
  slots: AdherenceSlot[];
  managers: AdherenceManager[];
}
export interface ShiftAdherenceReport {
  date: string;
  graceMinutes: number;
  generatedAt: string;
  totals: AdherenceNode;
  processes: AdherenceProcess[];
  lateBuckets: { key: string; label: string }[];
}

export interface AdherenceEmployee {
  employeeId: string; employeeCode: string; employeeName: string;
  process: string; manager: string; shift: string;
  clockIn: string | null; clockOut: string | null;
  status: ClassifiedRow["status"];
  lateMin: number; leftEarly: boolean; earlyOutMin: number; missedLogout: boolean;
}

const hhmm = (t: unknown): string => String(t ?? "").slice(0, 5);
const slotLabel = (s: unknown, e: unknown) => (s || e ? `${hhmm(s)}–${hhmm(e)}` : "No shift time on roster");
const node = (t: Tally): AdherenceNode => ({ ...t, ...deriveMetrics(t) });

/** Local wall-clock "now" as a DB-comparable string — the same clock isShiftDueYet uses. */
function localNowSql(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${todayLocalDateStr(now)} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
}

interface DayRow {
  employee_id: string; employee_code: string; full_name: string;
  process_id: string | null; process_name: string; manager_id: string | null; manager_name: string;
  assignment_type: string | null; is_week_off: number; attendance_status: string | null;
  shift_start: string | null; shift_end: string | null;
  clock_in: string | null; clock_out: string | null;
  login_delta_min: number | null; early_out_min: number | null; minutes_since_end: number | null;
}

async function loadDay(date: string, scope: RosterIntelligenceScope | undefined, filters: RosterIntelligenceFilters | undefined, now: Date): Promise<DayRow[]> {
  if (scope?.branchIds?.length === 0 || scope?.processIds?.length === 0) return [];
  const { conds, params } = buildEmployeeScope(scope, filters);
  const SS = "COALESCE(ra.shift_start_time, st.start_time)";
  const SE = "COALESCE(ra.shift_end_time, st.end_time)";
  // End of shift as a timestamp; an end time at or before the start means it finishes the next day.
  const END_TS = `(TIMESTAMP(ra.roster_date, ${SE}) + INTERVAL IF(${SE} <= ${SS}, 1, 0) DAY)`;
  // Minute deltas are computed by the database so no JS timezone conversion is involved.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id AS employee_id, e.employee_code, e.full_name, e.process_id,
            COALESCE(pm.process_name, 'Unassigned') AS process_name,
            e.reporting_manager_id AS manager_id,
            COALESCE(NULLIF(TRIM(m.full_name), ''), 'Not mapped') AS manager_name,
            ra.assignment_type, ra.is_week_off, adr.attendance_status,
            ${SS} AS shift_start, ${SE} AS shift_end,
            DATE_FORMAT(adr.clock_in_time, '%H:%i') AS clock_in,
            DATE_FORMAT(adr.clock_out_time, '%H:%i') AS clock_out,
            CASE WHEN adr.clock_in_time IS NOT NULL AND ${SS} IS NOT NULL
                 THEN TIMESTAMPDIFF(MINUTE, TIMESTAMP(ra.roster_date, ${SS}), adr.clock_in_time) END AS login_delta_min,
            CASE WHEN adr.clock_out_time IS NOT NULL AND ${SE} IS NOT NULL
                 THEN TIMESTAMPDIFF(MINUTE, adr.clock_out_time, ${END_TS}) END AS early_out_min,
            CASE WHEN ${SE} IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, ${END_TS}, ?) END AS minutes_since_end
       FROM wfm_roster_assignment ra
       JOIN employees e ON e.id = ra.employee_id AND e.active_status = 1
       LEFT JOIN process_master pm ON pm.id = e.process_id
       LEFT JOIN employees m ON m.id = e.reporting_manager_id
       LEFT JOIN wfm_shift_template st ON st.id = ra.shift_template_id
       LEFT JOIN attendance_daily_record adr ON adr.employee_id = ra.employee_id AND adr.record_date = ra.roster_date
      WHERE ra.roster_date = ?
        ${conds.map((c) => `AND ${c}`).join("\n        ")}`,
    [localNowSql(now), date, ...params],
  );
  return rows as unknown as DayRow[];
}

function classify(r: DayRow, date: string, grace: number, now: Date): ClassifiedRow {
  const punched = r.clock_in != null;
  return classifyRow(
    {
      assignmentType: r.assignment_type,
      isWeekOff: Number(r.is_week_off) === 1,
      attendanceStatus: r.attendance_status,
      shiftStart: r.shift_start ? String(r.shift_start) : null,
      punched,
      loginDeltaMin: r.login_delta_min === null ? null : Number(r.login_delta_min),
      minutesSinceEnd: r.minutes_since_end === null ? null : Number(r.minutes_since_end),
      earlyOutMin: r.early_out_min === null ? null : Number(r.early_out_min),
      hasPunchOut: r.clock_out != null,
      dueYet: punched || isShiftDueYet(r.shift_start ? String(r.shift_start) : null, date, grace, now),
    },
    grace,
  );
}

export async function getShiftAdherence(
  date: string,
  graceMinutes: number,
  scope?: RosterIntelligenceScope,
  filters?: RosterIntelligenceFilters,
): Promise<ShiftAdherenceReport> {
  const now = new Date();
  const rows = await loadDay(date, scope, filters, now);

  const total = emptyTally();
  const procs = new Map<string, { processId: string | null; name: string; t: Tally; slots: Map<string, Tally>; mgrs: Map<string, { id: string | null; t: Tally }> }>();

  for (const r of rows) {
    const c = classify(r, date, graceMinutes, now);
    addToTally(total, c);
    const key = String(r.process_id ?? "none");
    const p = procs.get(key) ?? { processId: r.process_id ? String(r.process_id) : null, name: String(r.process_name), t: emptyTally(), slots: new Map(), mgrs: new Map() };
    addToTally(p.t, c);
    const slot = slotLabel(r.shift_start, r.shift_end);
    addToTally(p.slots.get(slot) ?? p.slots.set(slot, emptyTally()).get(slot)!, c);
    const mk = String(r.manager_name);
    addToTally((p.mgrs.get(mk) ?? p.mgrs.set(mk, { id: r.manager_id ? String(r.manager_id) : null, t: emptyTally() }).get(mk)!).t, c);
    procs.set(key, p);
  }

  // Worst adherence first, so the processes that need a conversation lead the table. Processes with
  // nothing measurable yet (no planned shifts due) sink to the bottom.
  const processes: AdherenceProcess[] = [...procs.values()]
    .map((p) => ({
      processId: p.processId,
      process: p.name,
      ...node(p.t),
      slots: [...p.slots.entries()].map(([shift, t]) => ({ shift, ...node(t) })).sort((a, b) => a.shift.localeCompare(b.shift)),
      managers: [...p.mgrs.entries()].map(([manager, v]) => ({ managerId: v.id, manager, ...node(v.t) }))
        .sort((a, b) => (a.adherencePct ?? 101) - (b.adherencePct ?? 101) || b.late - a.late),
    }))
    .sort((a, b) => (a.adherencePct ?? 101) - (b.adherencePct ?? 101) || b.planned - a.planned);

  return {
    date,
    graceMinutes,
    generatedAt: now.toISOString(),
    totals: node(total),
    processes,
    lateBuckets: LATE_BUCKETS.map((b) => ({ key: b.key, label: b.label })),
  };
}

export type AdherenceEmployeeFilter = "late" | "absent" | "on_time" | "left_early" | "missed_logout" | "all";

export async function getShiftAdherenceEmployees(
  date: string,
  graceMinutes: number,
  scope: RosterIntelligenceScope | undefined,
  filters: RosterIntelligenceFilters | undefined,
  opts: { shift?: string; manager?: string; status?: AdherenceEmployeeFilter; limit?: number },
): Promise<{ total: number; employees: AdherenceEmployee[] }> {
  const now = new Date();
  const rows = await loadDay(date, scope, filters, now);
  const want = opts.status ?? "all";
  const out: AdherenceEmployee[] = [];
  for (const r of rows) {
    const shift = slotLabel(r.shift_start, r.shift_end);
    if (opts.shift && shift !== opts.shift) continue;
    if (opts.manager && String(r.manager_name) !== opts.manager) continue;
    const c = classify(r, date, graceMinutes, now);
    if (c.status === "non_working" || c.status === "leave" || c.status === "week_off_worked") continue;
    const match =
      want === "all" ? true
      : want === "late" ? c.status === "late"
      : want === "absent" ? c.status === "absent"
      : want === "on_time" ? c.status === "on_time"
      : want === "left_early" ? c.leftEarly
      : c.missedLogout;
    if (!match) continue;
    out.push({
      employeeId: String(r.employee_id), employeeCode: String(r.employee_code), employeeName: String(r.full_name),
      process: String(r.process_name), manager: String(r.manager_name), shift,
      clockIn: r.clock_in, clockOut: r.clock_out, status: c.status,
      lateMin: c.lateMin, leftEarly: c.leftEarly, earlyOutMin: c.earlyOutMin, missedLogout: c.missedLogout,
    });
  }
  // Worst first: absent, then by minutes late.
  out.sort((a, b) => Number(b.status === "absent") - Number(a.status === "absent") || b.lateMin - a.lateMin || a.employeeName.localeCompare(b.employeeName));
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 1000);
  return { total: out.length, employees: out.slice(0, limit) };
}
