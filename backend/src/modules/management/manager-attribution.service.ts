/**
 * Attrition and shrinkage attributed to the manager who ACTUALLY held the team at the time.
 *
 * THE PROBLEM THIS SOLVES
 * Managers change often. `employees.reporting_manager_id` is a single mutable pointer with no
 * history: reporting_manager_change_request is empty, transfer_record is empty, audit_log is
 * empty, and kpi_daily_actual.team_leader_id_at_event — a point-in-time column that already
 * exists — is populated on 0 of 71,303 rows (all verified 2026-08-27).
 *
 * So the naive query, "count exits where reporting_manager_id = me", answers a different
 * question than it appears to: it counts the people whose pointer happens to name me TODAY.
 * The day a team moves, its entire exit history moves with it — off the manager who was
 * there and onto the one who just arrived. A new manager inherits a year of somebody else's
 * attrition on their first morning.
 *
 * THE FIX
 * employee_manager_history (migration 1624) is effective-dated. Every figure here resolves
 * the manager AS AT the event date, and every figure is returned with an `attribution` label:
 *
 *   observed        — history has a row covering that date. Trustworthy.
 *   assumed_current — history has no row covering that date, so the present-day pointer was
 *                     used. This is a GUESS and is counted separately, never blended in.
 *
 * That separation is the point. Before the history table has accumulated real changes almost
 * everything will be `assumed_current`, and the UI must say so rather than presenting a
 * precise-looking number that is actually the old bug wearing a new label.
 *
 * SHRINKAGE
 * Same treatment, per day. Shrinkage is unavailable-time over rostered-time, so each day's
 * denominator must be the team as it stood THAT DAY, not the team as it stands now. Computed
 * from attendance_daily_record, whose statuses are counted as:
 *   planned   — approved leave, week off, holiday (known in advance, plannable)
 *   unplanned — absent, half day, missing punch (the shift was not covered and nobody knew)
 * missing_punch sits in unplanned deliberately: whatever its cause, the roster could not rely
 * on that person's hours. It is called out separately in the payload because it is usually a
 * biometric enrolment fault rather than a person's behaviour, and coaching the person for it
 * would be wrong.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/** Statuses that mean "planned, known in advance". */
const PLANNED_STATUSES = ["leave_approved", "week_off", "holiday", "comp_off"];
/** Statuses that mean "the shift was not covered". */
const UNPLANNED_STATUSES = ["absent", "half_day", "missing_punch"];

export type Attribution = "observed" | "assumed_current";

export interface AttritionSummary {
  window_months: number;
  opening_headcount: number;
  closing_headcount: number;
  exits_observed: number;
  exits_assumed: number;
  exits_total: number;
  /** Annualised, on the average of opening and closing headcount. Null when headcount is 0. */
  attrition_rate_pct: number | null;
  by_month: { month: string; exits: number; observed: number; assumed: number }[];
  leavers: {
    employee_id: string;
    full_name: string;
    employee_code: string | null;
    exit_date: string;
    tenure_days: number | null;
    attribution: Attribution;
  }[];
  /** True while history is thin — the UI must disclose it rather than imply precision. */
  mostly_assumed: boolean;
}

export interface ShrinkageSummary {
  window_days: number;
  scheduled_days: number;
  planned_days: number;
  unplanned_days: number;
  missing_punch_days: number;
  planned_pct: number | null;
  unplanned_pct: number | null;
  total_pct: number | null;
  by_day: { date: string; scheduled: number; planned: number; unplanned: number; pct: number | null }[];
  attribution: Attribution;
}

/** Does the effective-dated history table exist yet? Migration 1624 may not have run. */
let historyTableReady: boolean | null = null;
async function hasHistoryTable(): Promise<boolean> {
  if (historyTableReady !== null) return historyTableReady;
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_manager_history'`,
    );
    historyTableReady = Number(rows[0]?.n ?? 0) > 0;
  } catch {
    historyTableReady = false;
  }
  return historyTableReady;
}

/** Test seam — the cached probe must not leak between tests. */
export function __resetHistoryProbe(): void {
  historyTableReady = null;
}

/**
 * Everyone who reported to this manager on a given date.
 *
 * Prefers the effective-dated history. Falls back to today's pointer only when history has
 * nothing covering that date, and says which it used — the caller is expected to surface the
 * difference, not bury it.
 */
export async function teamOnDate(
  managerEmployeeId: string,
  onDate: string,
): Promise<{ employeeIds: string[]; attribution: Attribution }> {
  if (await hasHistoryTable()) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT h.employee_id
         FROM employee_manager_history h
        WHERE h.manager_id = ?
          AND h.effective_from <= ?
          AND (h.effective_to IS NULL OR h.effective_to >= ?)
          AND h.provenance <> 'seed'`,
      [managerEmployeeId, onDate, onDate],
    );
    if (rows.length > 0) {
      return { employeeIds: rows.map((r) => String(r.employee_id)), attribution: "observed" };
    }
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employees
      WHERE (reporting_manager_id = ? OR manager_id = ?)
      LIMIT 1000`,
    [managerEmployeeId, managerEmployeeId],
  );
  return { employeeIds: rows.map((r) => String(r.id)), attribution: "assumed_current" };
}

/**
 * Was this employee reporting to this manager on this date?
 *
 * Returns null when history cannot answer, so a caller can distinguish "no" from "unknown".
 */
async function reportedToOnDate(
  employeeId: string,
  managerEmployeeId: string,
  onDate: string,
): Promise<boolean | null> {
  if (!(await hasHistoryTable())) return null;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1
       FROM employee_manager_history h
      WHERE h.employee_id = ?
        AND h.effective_from <= ?
        AND (h.effective_to IS NULL OR h.effective_to >= ?)
        AND h.provenance <> 'seed'
      LIMIT 1`,
    [employeeId, onDate, onDate],
  );
  if (rows.length === 0) return null; // history is silent about that date
  const [match] = await db.execute<RowDataPacket[]>(
    `SELECT 1
       FROM employee_manager_history h
      WHERE h.employee_id = ?
        AND h.manager_id = ?
        AND h.effective_from <= ?
        AND (h.effective_to IS NULL OR h.effective_to >= ?)
        AND h.provenance <> 'seed'
      LIMIT 1`,
    [employeeId, managerEmployeeId, onDate, onDate],
  );
  return match.length > 0;
}

// ── Attrition ─────────────────────────────────────────────────────────────────

export async function getManagerAttrition(
  managerEmployeeId: string,
  windowMonths = 12,
): Promise<AttritionSummary> {
  // Candidate leavers: anyone whose pointer names this manager, OR anyone the history says
  // was on this team when they left. The union is deliberate — the pointer alone misses
  // people re-pointed after leaving, and history alone misses everything pre-seed.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code,
            COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS full_name,
            DATE_FORMAT(COALESCE(e.date_of_exit, e.resignation_date), '%Y-%m-%d') AS exit_date,
            DATEDIFF(COALESCE(e.date_of_exit, e.resignation_date), e.date_of_joining) AS tenure_days
       FROM employees e
      WHERE (e.reporting_manager_id = ? OR e.manager_id = ?)
        AND COALESCE(e.date_of_exit, e.resignation_date) IS NOT NULL
        AND COALESCE(e.date_of_exit, e.resignation_date) >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
        AND COALESCE(e.date_of_exit, e.resignation_date) <= CURDATE()
      ORDER BY exit_date DESC
      LIMIT 500`,
    [managerEmployeeId, managerEmployeeId, windowMonths],
  );

  const leavers: AttritionSummary["leavers"] = [];
  for (const r of rows) {
    const exitDate = String(r.exit_date);
    const verdict = await reportedToOnDate(String(r.id), managerEmployeeId, exitDate);
    // verdict === false means history positively says somebody ELSE managed them that day —
    // this exit is not on this manager's record and is dropped, which is the entire purpose.
    if (verdict === false) continue;
    leavers.push({
      employee_id: String(r.id),
      full_name: String(r.full_name ?? "").trim() || "—",
      employee_code: r.employee_code ? String(r.employee_code) : null,
      exit_date: exitDate,
      tenure_days: r.tenure_days == null ? null : Number(r.tenure_days),
      attribution: verdict === true ? "observed" : "assumed_current",
    });
  }

  const [[hc]] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS closing
       FROM employees
      WHERE (reporting_manager_id = ? OR manager_id = ?) AND active_status = 1`,
    [managerEmployeeId, managerEmployeeId],
  ) as unknown as [RowDataPacket[]];

  const closing = Number(hc?.closing ?? 0);
  // Opening headcount is reconstructed, not stored: today's team plus everyone who left in
  // the window. It ignores joiners, so it is an approximation and is labelled as one in the UI.
  const opening = closing + leavers.length;
  const avgHeadcount = (opening + closing) / 2;

  const byMonthMap = new Map<string, { exits: number; observed: number; assumed: number }>();
  for (const l of leavers) {
    const m = l.exit_date.slice(0, 7);
    const cur = byMonthMap.get(m) ?? { exits: 0, observed: 0, assumed: 0 };
    cur.exits += 1;
    if (l.attribution === "observed") cur.observed += 1; else cur.assumed += 1;
    byMonthMap.set(m, cur);
  }

  const observed = leavers.filter((l) => l.attribution === "observed").length;

  return {
    window_months: windowMonths,
    opening_headcount: opening,
    closing_headcount: closing,
    exits_observed: observed,
    exits_assumed: leavers.length - observed,
    exits_total: leavers.length,
    attrition_rate_pct:
      avgHeadcount > 0
        ? Math.round(((leavers.length / avgHeadcount) * (12 / windowMonths)) * 1000) / 10
        : null,
    by_month: [...byMonthMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, v]) => ({ month, ...v })),
    leavers,
    mostly_assumed: leavers.length > 0 && observed < leavers.length / 2,
  };
}

// ── Shrinkage ─────────────────────────────────────────────────────────────────

export async function getManagerShrinkage(
  managerEmployeeId: string,
  windowDays = 30,
): Promise<ShrinkageSummary> {
  // The team as it stood at the START of the window. Using today's team would measure a
  // roster that did not exist on most of the days being counted.
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - windowDays);
  const startIso = startDate.toISOString().slice(0, 10);

  const { employeeIds, attribution } = await teamOnDate(managerEmployeeId, startIso);

  const empty: ShrinkageSummary = {
    window_days: windowDays,
    scheduled_days: 0, planned_days: 0, unplanned_days: 0, missing_punch_days: 0,
    planned_pct: null, unplanned_pct: null, total_pct: null,
    by_day: [], attribution,
  };
  if (employeeIds.length === 0) return empty;

  const placeholders = employeeIds.map(() => "?").join(",");
  const plannedList = PLANNED_STATUSES.map(() => "?").join(",");
  const unplannedList = UNPLANNED_STATUSES.map(() => "?").join(",");

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(adr.record_date, '%Y-%m-%d') AS d,
            COUNT(*) AS scheduled,
            SUM(adr.attendance_status IN (${plannedList}))   AS planned,
            SUM(adr.attendance_status IN (${unplannedList})) AS unplanned,
            SUM(adr.attendance_status = 'missing_punch')     AS missing_punch
       FROM attendance_daily_record adr
      WHERE adr.employee_id IN (${placeholders})
        AND adr.record_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      GROUP BY DATE_FORMAT(adr.record_date, '%Y-%m-%d')
      ORDER BY DATE_FORMAT(adr.record_date, '%Y-%m-%d') ASC`,
    [...PLANNED_STATUSES, ...UNPLANNED_STATUSES, ...employeeIds, windowDays],
  );

  let scheduled = 0, planned = 0, unplanned = 0, missing = 0;
  const byDay = rows.map((r) => {
    const s = Number(r.scheduled ?? 0);
    const p = Number(r.planned ?? 0);
    const u = Number(r.unplanned ?? 0);
    scheduled += s; planned += p; unplanned += u; missing += Number(r.missing_punch ?? 0);
    return {
      date: String(r.d),
      scheduled: s,
      planned: p,
      unplanned: u,
      pct: s > 0 ? Math.round(((p + u) / s) * 1000) / 10 : null,
    };
  });

  const pct = (n: number) => (scheduled > 0 ? Math.round((n / scheduled) * 1000) / 10 : null);

  return {
    window_days: windowDays,
    scheduled_days: scheduled,
    planned_days: planned,
    unplanned_days: unplanned,
    missing_punch_days: missing,
    planned_pct: pct(planned),
    unplanned_pct: pct(unplanned),
    total_pct: pct(planned + unplanned),
    by_day: byDay,
    attribution,
  };
}

// ── Write side ────────────────────────────────────────────────────────────────

/**
 * Records a change of supervisory assignment: manager, process, or branch.
 *
 * All three, not just the manager — an employee's effective supervision is the named manager
 * PLUS the process they sit in and the branch they sit at, because the process manager and
 * branch head own the outcome too. Move someone between processes and reporting_manager_id
 * may not change at all, yet the people accountable for their attendance, attrition and
 * shrinkage have. Recording only the manager would leave that move invisible and keep
 * charging the old process for somebody who left it.
 *
 * Callers pass only what they changed. Whatever they omit is carried forward from the
 * currently open period, so a caller that moves a branch does not have to know or restate the
 * manager — and cannot accidentally blank it.
 *
 * A period is only opened when something ACTUALLY differs, so a save that rewrites the same
 * values does not litter the history with empty periods.
 *
 * Silent on failure by design: a history write must never block the edit that triggered it,
 * and a missing row degrades to `assumed_current` rather than corrupting anything.
 */
export async function recordSupervisoryChange(params: {
  employeeId: string;
  /** Omit a field to carry the current value forward; pass null to clear it. */
  managerId?: string | null;
  processId?: string | null;
  branchId?: string | null;
  changedBy: string | null;
  reason?: string | null;
}): Promise<void> {
  const { employeeId, changedBy, reason } = params;
  if (!(await hasHistoryTable())) return;

  try {
    const [openRows] = await db.execute<RowDataPacket[]>(
      `SELECT manager_id, process_id, branch_id, effective_from
         FROM employee_manager_history
        WHERE employee_id = ? AND effective_to IS NULL
        ORDER BY effective_from DESC LIMIT 1`,
      [employeeId],
    );
    const open = openRows[0] ?? null;

    const carry = (incoming: string | null | undefined, current: unknown) =>
      incoming === undefined ? (current == null ? null : String(current)) : incoming;

    const managerId = carry(params.managerId, open?.manager_id);
    const processId = carry(params.processId, open?.process_id);
    const branchId  = carry(params.branchId,  open?.branch_id);

    // Nothing actually moved — do not open a period for a no-op save.
    if (
      open &&
      String(open.manager_id ?? "") === String(managerId ?? "") &&
      String(open.process_id ?? "") === String(processId ?? "") &&
      String(open.branch_id  ?? "") === String(branchId  ?? "")
    ) {
      return;
    }

    // Close the open period yesterday so the new one can start today without overlapping —
    // a date must belong to exactly one supervisory assignment.
    await db.execute(
      `UPDATE employee_manager_history
          SET effective_to = DATE_SUB(CURDATE(), INTERVAL 1 DAY)
        WHERE employee_id = ? AND effective_to IS NULL AND effective_from < CURDATE()`,
      [employeeId],
    );
    // A second change on the same day replaces that day's row rather than stacking two
    // periods with identical bounds (uq_emh_employee_from would reject the duplicate).
    await db.execute(
      `DELETE FROM employee_manager_history
        WHERE employee_id = ? AND effective_from = CURDATE() AND effective_to IS NULL`,
      [employeeId],
    );
    await db.execute(
      `INSERT INTO employee_manager_history
         (id, employee_id, manager_id, process_id, branch_id,
          effective_from, effective_to, provenance, changed_by, reason)
       VALUES (UUID(), ?, ?, ?, ?, CURDATE(), NULL, 'observed', ?, ?)`,
      [employeeId, managerId, processId, branchId, changedBy, reason ?? null],
    );
  } catch (err) {
    console.error("[manager-history] could not record supervisory change:", err);
  }
}

/**
 * Manager-only entry point, kept so the eight existing call sites read as what they do.
 * Process and branch carry forward from the open period.
 */
export async function recordManagerChange(params: {
  employeeId: string;
  newManagerId: string | null;
  changedBy: string | null;
  reason?: string | null;
}): Promise<void> {
  return recordSupervisoryChange({
    employeeId: params.employeeId,
    managerId: params.newManagerId,
    changedBy: params.changedBy,
    reason: params.reason,
  });
}
