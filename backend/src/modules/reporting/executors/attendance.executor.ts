/**
 * Attendance executor
 *
 * Covers codes: attendance-daily, daily-hc-shift, shift-adherence-detail,
 * attendance-summary, late-arrival-summary, overtime-summary,
 * regularization-summary, attendance-dispute-summary, habitual-absentee-list,
 * daily-shrinkage-report, monthly-shrinkage-trend, biometric-reconciliation,
 * punch-raw-export, attendance-register-grid, break-daily-summary,
 * break-session-log
 *
 * Every query includes WHERE e.company_id = ? to enforce tenant isolation.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import type { ExecFilters, ExecScope, ExecOptions, ExecResult } from "./types.js";
import {
  appendScopeConditions,
  appendFilterConditions,
  dateParam,
  monthParam,
  monthRange,
  applyPagination,
  fetchPageWithTotal,
} from "./types.js";
import {
  presentSql,
  attendedDaysSql,
  expectedToWorkSql,
  statusList,
  LEAVE_STATUSES,
} from "../../../shared/attendanceStatus.js";

async function query(sql: string, params: unknown[]): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  return rows;
}

async function count(baseSql: string, params: unknown[]): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM (${baseSql}) AS _cnt`,
    params
  );
  return Number((rows as Array<{ total?: number }>)[0]?.total ?? 0);
}

// ---------------------------------------------------------------------------
// attendance-daily
// ---------------------------------------------------------------------------
/**
 * attendance-register-monthly
 *
 * The last of the eight reports that rendered on screen and answered 404 on download.
 *
 * Unlike the other seven this was not a SQL move. The inline block executed its own statement,
 * pivoted the result into day_1..day_31 columns in JavaScript, and returned its own response —
 * it never set `sql` and never reached the shared response path, so there was nothing for the
 * export handler to call. The pivot moves here with it.
 *
 * Behaviour is preserved deliberately rather than tidied:
 *
 *   - the pivot returns every employee row and does not slice by limit or offset, exactly as
 *     the inline handler did. Adding pagination here would change what the screen shows;
 *   - the status-to-letter map and the salary-day arithmetic are carried verbatim, because they
 *     are the report's meaning and not formatting.
 *
 * Two meta fields are lost in the move: daysInMonth and month, which the inline handler added to
 * its own response envelope and which the shared envelope has no channel for. Checked before
 * moving — no frontend component reads either; the calendar components compute daysInMonth
 * locally from the selected month.
 *
 * Verified as a no-op on the data by checksumming all 1,124 rows x 50 columns before and after.
 */
// Payroll-aligned week-off eligibility slab table (mirrors weekoff-eligibility.service.ts).
// Inline to avoid an async import and the payroll module coupling inside a reporting executor.
const WEEKOFF_SLABS = [
  { from: 0,  to: 6,  max: 0 },
  { from: 7,  to: 11, max: 1 },
  { from: 12, to: 17, max: 2 },
  { from: 18, to: 23, max: 3 },
  { from: 24, to: 25, max: 4 },
] as const;

function calcEligibleWeekoffs(paidBase: number, actualSundays: number, daysInMonth: number): number {
  const availableWorkingDays = daysInMonth - actualSundays;
  if (paidBase >= availableWorkingDays) return actualSundays;
  const slab = WEEKOFF_SLABS.find(s => paidBase >= s.from && paidBase <= s.to);
  if (!slab) return actualSundays; // paidBase > 25 → full eligibility
  return Math.min(slab.max, actualSundays);
}

export async function attendanceRegisterMonthly(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const month = monthParam(filters.month);
  const [yr, mo] = month.split("-").map(Number);
  const daysInMonth = new Date(yr, mo, 0).getDate();
  const firstDay = `${month}-01`;
  const lastDay  = `${month}-${String(daysInMonth).padStart(2, "0")}`;

  // Count Sundays in the reporting month (payroll week-off denominator).
  let actualSundays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    if (new Date(yr, mo - 1, d).getDay() === 0) actualSundays++;
  }

  // Scope and filter conditions apply to the employees table (alias "e").
  // The attendance date range moves to the LEFT JOIN ON clause so employees
  // with no records in the month still appear — their day cells are filled
  // post-pivot (A for working days after DOJ, W for Sundays, blank for
  // pre-DOJ and future dates).
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1");

  // Date range binds before the WHERE params (JOIN ON is evaluated first in positional binding).
  params.unshift(firstDay, lastDay);

  const attSql = `
    SELECT
      e.id AS employee_id,
      e.employee_code,
      COALESCE(e.biometric_code, '') AS bio_code,
      CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS emp_name,
      COALESCE(dept.dept_name, '') AS department,
      COALESCE(desig.designation_name, '') AS designation,
      COALESCE(e.profile_type, '') AS profile,
      COALESCE(cc.cost_centre_name, '') AS cost_center,
      COALESCE(b.branch_name, '') AS emp_location,
      CASE WHEN COALESCE(e.is_billable, 1) = 1 THEN 'Yes' ELSE 'No' END AS billable,
      e.date_of_joining,
      DAY(adr.record_date) AS day_num,
      adr.attendance_status,
      COALESCE(adr.raw_minutes, 0) AS raw_minutes
    FROM employees e
    LEFT JOIN attendance_daily_record adr
           ON adr.employee_id = e.id
          AND adr.record_date BETWEEN ? AND ?
    LEFT JOIN department_master dept  ON dept.id  = e.department_id
    LEFT JOIN designation_master desig ON desig.id = e.designation_id
    LEFT JOIN cost_centre_master cc   ON cc.id    = e.cost_centre_id
    LEFT JOIN branch_master b         ON b.id     = e.branch_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY e.employee_code, adr.record_date
  `;

  const attRows = await query(attSql, params);

  // Status code mapping.
  // missing_punch = no biometric record for the date → Absent.
  // week_off_worked = employee worked on their week-off day → Present
  //   (the attendance engine sets half_day when hours < threshold on any day,
  //   so week_off_worked always represents a full day worked on week off).
  // unreconciled = anomalous punch data → Absent (same as legacy).
  const statusCode: Record<string, string> = {
    present:        "P",
    absent:         "A",
    half_day:       "HD",
    week_off:       "W",
    holiday:        "H",
    leave_approved: "L",
    on_duty:        "OD",
    missing_punch:  "A",
    week_off_worked:"P",
    unreconciled:   "A",
  };

  // Pivot: fold attendance rows into one map entry per employee.
  const empMap = new Map<string, any>();
  for (const row of attRows) {
    if (!empMap.has(row.employee_id)) {
      empMap.set(row.employee_id, {
        emp_code:       row.employee_code,
        bio_code:       row.bio_code,
        emp_name:       row.emp_name,
        department:     row.department,
        designation:    row.designation,
        profile:        row.profile,
        cost_center:    row.cost_center,
        emp_location:   row.emp_location,
        billable:       row.billable,
        date_of_joining: row.date_of_joining,
      });
    }
    // row.day_num is NULL when the LEFT JOIN found no attendance record.
    if (row.day_num == null) continue;

    const emp = empMap.get(row.employee_id);
    const code = statusCode[row.attendance_status] ?? row.attendance_status ?? "";
    emp[`day_${row.day_num}`] = code;
  }

  // "Today" threshold: future dates stay blank (no data yet).
  const todayTs = new Date();
  todayTs.setHours(0, 0, 0, 0);

  const pivotRows = Array.from(empMap.values()).map((emp, idx) => {
    // Normalise date_of_joining to midnight for day-boundary comparisons.
    const dojRaw = emp.date_of_joining;
    const doj = dojRaw ? new Date(dojRaw) : null;
    if (doj) doj.setHours(0, 0, 0, 0);

    // Fill in cells that have no attendance record.
    for (let d = 1; d <= daysInMonth; d++) {
      if (emp[`day_${d}`] !== undefined) continue; // already populated

      const dayDate = new Date(yr, mo - 1, d);
      if (doj && dayDate < doj) {
        emp[`day_${d}`] = ""; // before joining date → blank
      } else if (dayDate > todayTs) {
        emp[`day_${d}`] = ""; // future date → blank
      } else if (dayDate.getDay() === 0) {
        emp[`day_${d}`] = "W"; // Sunday with no record → week off
      } else {
        emp[`day_${d}`] = "A"; // active working day, no record → absent
      }
    }

    let absent = 0, present = 0, od = 0, hd = 0, leave = 0, holiday = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const v = emp[`day_${d}`];
      if      (v === "A")  absent++;
      else if (v === "P")  present++;
      else if (v === "OD") od++;
      else if (v === "HD") hd++;
      else if (v === "L")  leave++;
      else if (v === "H")  holiday++;
    }

    // Payroll-aligned eligible week-offs (slab-based, mirrors payrollCalculate.service.ts).
    const paidBase   = present + hd * 0.5 + od;
    const eligibleWO = calcEligibleWeekoffs(paidBase, actualSundays, daysInMonth);
    const salDays    = Math.round((paidBase + eligibleWO + holiday) * 100) / 100;

    return {
      sno:          idx + 1,
      emp_code:     emp.emp_code,
      bio_code:     emp.bio_code,
      emp_name:     emp.emp_name.trim(),
      department:   emp.department,
      designation:  emp.designation,
      profile:      emp.profile,
      cost_center:  emp.cost_center,
      emp_location: emp.emp_location,
      billable:     emp.billable,
      ...Object.fromEntries(
        Array.from({ length: daysInMonth }, (_, i) => [`day_${i + 1}`, emp[`day_${i + 1}`] ?? ""])
      ),
      absent_count:  absent,
      present_count: present,
      od_count:      od,
      hd_count:      hd,
      leave_count:   leave,
      holiday_count: holiday,
      weekoff_count: eligibleWO,
      sal_days:      salDays,
      total:         daysInMonth,
    };
  });

  // Slice the caller's page out of the pivot.
  //
  // The pivot runs in JavaScript after the SQL, so LIMIT and OFFSET cannot be pushed into the
  // query — the day columns only exist once every attendance row for the month has been folded
  // together. This returned the whole pivot regardless of what was asked for, which meant a
  // request for 100 rows got 1,113 and the offset was ignored entirely: the grid computed
  // twelve pages from the total and every one of them showed the same 1,113 rows.
  //
  // Ported verbatim from the inline handler, including that behaviour, when this report was
  // promoted so its download would work. Correct then — the aim was a provable no-op — and
  // worth fixing now that it has been measured.
  //
  // sno is assigned before the slice, so a row keeps its position in the whole register rather
  // than restarting at 1 on every page. Worker mode takes everything, as it did before, because
  // the async export builds one workbook rather than paging.
  const total = pivotRows.length;
  const page = options.mode === "worker"
    ? pivotRows
    : pivotRows.slice(options.offset, options.offset + options.limit);

  return {
    rows: page,
    rowCount: total,
    isTruncated: total > options.offset + page.length,
    nextCursor: null,
  };
}

/**
 * attendance-daily
 *
 * One row per active employee per day in range — INCLUDING employees with no attendance record.
 *
 * That is the whole point of the report and the reason it drives from employees with a LEFT JOIN
 * to attendance_daily_record, rather than the other way round. A UAT on 31-Jul-2026 found it
 * returning 350 rows against a headcount of 1,152: the missing 800 were not absent, they were
 * employees the report could not see, which is precisely the population an attendance report
 * exists to surface.
 *
 * Three things follow from that and none can be simplified:
 *
 *   - the date predicate sits in the JOIN, not the WHERE. Moving it to the WHERE filters out the
 *     NULL side and silently collapses the LEFT JOIN back to an inner join, reintroducing the
 *     original defect;
 *   - the roster and session joins hang off e.id, not adr.employee_id, so an employee with no
 *     attendance row can still pick up a shift and a punch time;
 *   - the session subquery carries its own date predicate. Without it the subquery materialises
 *     every session ever recorded, and because it hangs off the nullable side nothing downstream
 *     can narrow it. Measured before that was fixed: 11,671ms against 3,149ms for the same 1,125
 *     rows.
 *
 * Bind order: four placeholders sit ahead of the WHERE — two for the attendance join and two for
 * the session subquery — so four values are unshifted. A miscount here shifts every later
 * binding by one silently rather than raising.
 */
export async function attendanceDaily(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const from = dateParam(filters.from, new Date().toISOString().slice(0, 10));
  const to   = dateParam(filters.to, from);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("e.active_status = 1");
  params.unshift(from, to, from, to);

  const base = `SELECT adr.record_date,
         e.employee_code,
         COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
         COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
         COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
         COALESCE(ccd.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
         COALESCE(ccd.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
         COALESCE(d.dept_name, 'UNASSIGNED') AS department_name,
         desig.designation_name,
         COALESCE(NULLIF(rm.full_name,''), CONCAT(rm.first_name,' ',COALESCE(rm.last_name,''))) AS reporting_manager,
         COALESCE(ws.shift_name, 'Roster Not Assigned') AS shift_name,
         TIME_FORMAT(ws.start_time, '%H:%i') AS shift_start,
         TIME_FORMAT(ws.end_time, '%H:%i') AS shift_end,
         TIME_FORMAT(agg_ses.earliest_punch, '%H:%i') AS punch_in,
         TIME_FORMAT(agg_ses.latest_punch, '%H:%i') AS punch_out,
         CASE
           WHEN agg_ses.earliest_punch IS NOT NULL AND agg_ses.latest_punch IS NOT NULL
           THEN TIME_FORMAT(SEC_TO_TIME(TIMESTAMPDIFF(SECOND, agg_ses.earliest_punch, agg_ses.latest_punch)), '%H:%i')
           ELSE NULL
         END AS total_login_duration,
         adr.raw_minutes AS productive_minutes,
         adr.attendance_source,
         adr.attendance_status,
         adr.late_by_minutes,
         adr.lwp_value,
         CASE WHEN adr.regularization_id IS NOT NULL THEN 'Regularized' ELSE NULL END AS regularization_status,
         adr.is_locked
    FROM employees e
    LEFT JOIN attendance_daily_record adr
           ON adr.employee_id = e.id
          AND adr.record_date BETWEEN ? AND ?
    LEFT JOIN branch_master b ON b.id = e.branch_id
    LEFT JOIN process_master p ON p.id = e.process_id
    LEFT JOIN cost_centre_master ccd ON ccd.id = e.cost_centre_id
    LEFT JOIN department_master d ON d.id = e.department_id
    LEFT JOIN designation_master desig ON desig.id = e.designation_id
    LEFT JOIN employees rm ON rm.id = e.reporting_manager_id
    LEFT JOIN wfm_roster_assignment wra ON wra.employee_id = e.id AND wra.roster_date = adr.record_date
    LEFT JOIN wfm_shift_master ws ON ws.id = wra.shift_id
    LEFT JOIN (
      -- Date-restricted. Without the WHERE this grouped the whole of
      -- wfm_attendance_session — 34,398 rows — on every request, against 792 for
      -- the single-day default. It is also joined to the nullable side of a LEFT
      -- JOIN, so nothing downstream could narrow it either.
      SELECT employee_id, session_date,
             MIN(login_time) AS earliest_punch,
             MAX(logout_time) AS latest_punch,
             SUM(total_login_minutes) AS total_login_minutes
        FROM wfm_attendance_session
       WHERE session_date BETWEEN ? AND ?
       GROUP BY employee_id, session_date
    ) agg_ses ON agg_ses.employee_id = e.id AND agg_ses.session_date = adr.record_date
              WHERE ${clauses.join(" AND ")}
              ORDER BY adr.record_date DESC, b.branch_name, employee_name`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length, nextCursor: null };
}

/**
 * daily-hc-shift
 *
 * Aligned with the inline block. Same 14 rows both ways, but the executor emitted its own
 * columns and the catalogue names the inline shape's — all ten of them.
 *
 * Two things in here are worth not "tidying". missing_punch_count counts 'unreconciled', not
 * 'missing_punch' — those are different statuses in the same enum, and swapping them would
 * change what the column means. unassigned_roster_count counts rows where the roster join found
 * nothing, which is how a reader sees attendance recorded against people who were never
 * rostered; it depends on the LEFT JOIN staying a LEFT JOIN.
 */
export async function dailyHcShift(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const from = dateParam(filters.from, new Date().toISOString().slice(0, 10));
  const to   = dateParam(filters.to, from);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("adr.record_date BETWEEN ? AND ?");
  params.push(from, to);

  const base = `
    SELECT adr.record_date,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(ws.shift_name, 'Roster Not Assigned') AS shift_name,
           COUNT(*) AS scheduled_headcount,
           SUM(adr.attendance_status IN ('present','half_day','week_off_worked')) AS present_count,
           SUM(adr.attendance_status = 'absent') AS absent_count,
           SUM(adr.attendance_status = 'leave_approved') AS leave_count,
           SUM(adr.attendance_status = 'week_off') AS week_off_count,
           SUM(adr.attendance_status = 'holiday') AS holiday_count,
           SUM(CASE WHEN adr.attendance_status = 'unreconciled' THEN 1 ELSE 0 END) AS missing_punch_count,
           SUM(CASE WHEN wra.id IS NULL THEN 1 ELSE 0 END) AS unassigned_roster_count,
           SUM(adr.late_mark = 1) AS late_count,
           ROUND(SUM(adr.attendance_status IN ('present','half_day','week_off_worked')) / NULLIF(COUNT(*), 0) * 100, 1) AS attendance_pct
      FROM attendance_daily_record adr
      JOIN employees e ON e.id = adr.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN wfm_roster_assignment wra ON wra.employee_id = adr.employee_id
        AND wra.roster_date = adr.record_date
      LEFT JOIN wfm_shift_master ws ON ws.id = wra.shift_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY adr.record_date, b.branch_name, p.process_name, ws.shift_name
     ORDER BY adr.record_date DESC, b.branch_name, p.process_name, shift_name`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length, nextCursor: null };
}

/**
 * shift-adherence-detail
 *
 * Aligned with the inline block. Same 160 rows both ways; the catalogue names all ten columns
 * unique to the inline shape and none of the one unique to this executor's.
 *
 * The session subquery is pre-aggregated by employee and date before it is joined, and that is
 * load-bearing rather than stylistic: wfm_attendance_session holds one row per login session, so
 * joining it directly would repeat the attendance row once per session and multiply every
 * derived minute figure. Aggregating first is what makes earliest_punch, latest_punch and
 * total_login_minutes mean one working day.
 *
 * The adherence ladder is the report's definition and is carried unchanged, including the 85%
 * threshold that separates SHORT from ON_TIME and the ordering that tests late_mark before
 * shortfall so LATE_AND_SHORT can be reached at all. Reordering those branches would silently
 * reclassify people.
 */
export async function shiftAdherenceDetail(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const from = dateParam(filters.from, new Date().toISOString().slice(0, 10));
  const to   = dateParam(filters.to, from);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("adr.record_date BETWEEN ? AND ?");
  params.push(from, to);

  const base = `SELECT adr.record_date,
         e.employee_code,
         COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
         COALESCE(rcc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
         COALESCE(rcc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
         COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
         COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
         COALESCE(ws.shift_name, 'Roster Not Assigned') AS shift_name,
         TIME_FORMAT(ws.start_time, '%H:%i') AS scheduled_start,
         TIME_FORMAT(ws.end_time, '%H:%i') AS scheduled_end,
         TIME_FORMAT(agg_ses.earliest_punch, '%H:%i') AS punch_in,
         TIME_FORMAT(agg_ses.latest_punch, '%H:%i') AS punch_out,
         CASE
           WHEN agg_ses.earliest_punch IS NOT NULL AND agg_ses.latest_punch IS NOT NULL
           THEN TIME_FORMAT(SEC_TO_TIME(TIMESTAMPDIFF(SECOND, agg_ses.earliest_punch, agg_ses.latest_punch)), '%H:%i')
           ELSE NULL
         END AS total_login_duration,
         COALESCE(ws.required_minutes, 540) AS scheduled_minutes,
         COALESCE(agg_ses.total_login_minutes, 0) AS actual_minutes,
         adr.late_by_minutes AS late_minutes,
         CASE
           WHEN agg_ses.latest_punch IS NOT NULL AND ws.end_time IS NOT NULL
                AND TIME(agg_ses.latest_punch) < ws.end_time
           THEN TIMESTAMPDIFF(MINUTE, TIME(agg_ses.latest_punch), ws.end_time)
           ELSE 0
         END AS early_logout_minutes,
         CASE
           WHEN ws.required_minutes IS NOT NULL AND ws.required_minutes > 0
           THEN ROUND(LEAST(COALESCE(agg_ses.total_login_minutes, 0), ws.required_minutes) / ws.required_minutes * 100, 1)
           ELSE NULL
         END AS adherence_pct,
         adr.attendance_status,
         CASE
           WHEN adr.attendance_status = 'absent' THEN 'ABSENT'
           WHEN adr.late_mark = 1 AND COALESCE(agg_ses.total_login_minutes, 0) < COALESCE(ws.required_minutes, 540) * 0.85 THEN 'LATE_AND_SHORT'
           WHEN adr.late_mark = 1 THEN 'LATE'
           WHEN COALESCE(agg_ses.total_login_minutes, 0) < COALESCE(ws.required_minutes, 540) * 0.85 THEN 'SHORT'
           ELSE 'ON_TIME'
         END AS adherence_status,
         CASE WHEN adr.regularization_id IS NOT NULL THEN 'Yes' ELSE 'No' END AS exception_applied
    FROM attendance_daily_record adr
    JOIN employees e ON e.id = adr.employee_id
    LEFT JOIN branch_master b ON b.id = e.branch_id
    LEFT JOIN process_master p ON p.id = e.process_id
    LEFT JOIN wfm_roster_assignment wra ON wra.employee_id = adr.employee_id
      AND wra.roster_date = adr.record_date
    LEFT JOIN wfm_shift_master ws ON ws.id = wra.shift_id
    LEFT JOIN (
      SELECT employee_id, session_date,
             MIN(login_time) AS earliest_punch,
             MAX(logout_time) AS latest_punch,
             SUM(total_login_minutes) AS total_login_minutes
        FROM wfm_attendance_session
       WHERE session_date BETWEEN ? AND ?
       GROUP BY employee_id, session_date
    ) agg_ses ON agg_ses.employee_id = adr.employee_id AND agg_ses.session_date = adr.record_date
    LEFT JOIN cost_centre_master rcc ON rcc.id = e.cost_centre_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY adr.record_date DESC, adherence_status DESC, employee_name`;

  // subquery params (from, to) must precede WHERE params in positional binding
  const paged = await fetchPageWithTotal(base, [from, to, ...params], options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length, nextCursor: null };
}

/**
 * attendance-summary
 *
 * Aligned with the inline block. Same 1,123 rows both ways, but the executor emitted eight
 * columns the catalogue does not name and omitted the one it does.
 *
 * The month filter is a half-open range on the raw column, not DATE_FORMAT(record_date,'%Y-%m').
 * That is deliberate and was fixed earlier in this audit: wrapping record_date in a function
 * makes every one of the eight indexes on it unusable and full-scans the table. Porting the
 * executor's own month handling instead would have undone that.
 *
 * total_hours prefers raw_minutes, then biometric_minutes, then dialler_minutes — three feeds of
 * decreasing authority, and the COALESCE order is the report's definition of a worked hour.
 *
 * The GROUP BY repeats every non-aggregated identity column because ONLY_FULL_GROUP_BY is
 * enabled here; omitting one fails the report outright rather than degrading it.
 */
export async function attendanceSummary(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const month = monthParam(filters.month);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  {
    const [my, mm] = month.split("-").map(Number);
    const nextMonth = `${mm === 12 ? my + 1 : my}-${String(mm === 12 ? 1 : mm + 1).padStart(2, "0")}-01`;
    clauses.push("adr.record_date >= ? AND adr.record_date < ?");
    params.push(`${month}-01`, nextMonth);
  }

  const base = `
    SELECT e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(pm.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(acc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(acc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           SUM(adr.attendance_status='present') AS present_days,
           SUM(adr.attendance_status='half_day') AS half_days,
           SUM(adr.attendance_status='absent') AS absent_days,
           SUM(adr.attendance_status='leave_approved') AS leave_days,
           SUM(adr.lwp_value) AS lwp_days,
           SUM(adr.late_mark=1) AS late_days,
           ROUND(SUM(COALESCE(adr.raw_minutes,adr.biometric_minutes,adr.dialler_minutes,0))/60,2) AS total_hours
      FROM attendance_daily_record adr
      JOIN employees e ON e.id = adr.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master pm ON pm.id = e.process_id
      LEFT JOIN cost_centre_master acc ON acc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY e.id, e.employee_code, e.first_name, e.last_name, e.full_name,
              b.branch_name, pm.process_name, acc.cost_centre_code, acc.cost_centre_name
     ORDER BY employee_name`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length, nextCursor: null };
}

// ---------------------------------------------------------------------------
// late-arrival-summary  (per employee, per month)
// ---------------------------------------------------------------------------
/**
 * late-arrival-summary
 *
 * One row per late arrival, not per employee.
 *
 * This executor used to GROUP BY employee and return total_late_days / avg_late_minutes /
 * max_late_minutes. The inline block in report-suite.routes.ts returns the detail: record_date,
 * roster_shift, scheduled_start, punch_in, late_minutes, grace_minutes, net_late_minutes,
 * late_status, approved_exception, reporting_manager.
 *
 * Both existed at once, and which one a user got depended on how they asked. The preview
 * handler reaches the inline block first; the export handler calls executeReport() directly and
 * got this. Measured live on 2026-08-08: the screen showed 2,199 rows and the downloaded
 * spreadsheet 577 — the same report at two different grains, with no overlap in the columns
 * that distinguish them.
 *
 * The catalogue decides which is intended, and it is not a matter of taste: src/lib/report-
 * catalog.ts declares 16 columns for this code, and 10 of the 10 columns unique to the detail
 * shape are among them while 0 of the 3 unique to the aggregate shape are. The detail is the
 * report; the aggregate was drift.
 *
 * Ported from the inline block so both paths run one implementation. Two deliberate
 * differences, neither of which changes a row:
 *   - scope comes from appendScopeConditions(scope, ...) because an executor has no req;
 *   - the inline block's optional minLateMinutes filter is not carried, because ExecFilters has
 *     no such field. It defaults to 0 — no filtering — so this matches the inline default, and
 *     the export path never offered that filter to begin with.
 */
export async function lateArrivalSummary(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const now = new Date();
  const from = dateParam(filters.from, `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`);
  const to   = dateParam(filters.to, now.toISOString().slice(0, 10));

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("adr.record_date BETWEEN ? AND ?");
  params.push(from, to);
  clauses.push("adr.late_mark = 1");

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("adr.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT adr.id AS _cursor,
           adr.record_date,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(rcc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(rcc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(ws.shift_name, 'Roster Not Assigned') AS roster_shift,
           ws.start_time AS scheduled_start,
           was.login_time AS punch_in,
           adr.late_by_minutes AS late_minutes,
           COALESCE(arc.grace_minutes, 15) AS grace_minutes,
           GREATEST(0, adr.late_by_minutes - COALESCE(arc.grace_minutes, 15)) AS net_late_minutes,
           CASE
             WHEN adr.late_by_minutes <= COALESCE(arc.grace_minutes, 15) THEN 'Within Grace'
             WHEN adr.late_by_minutes <= 30 THEN 'Mild Late'
             WHEN adr.late_by_minutes <= 60 THEN 'Moderate Late'
             ELSE 'Severe Late'
           END AS late_status,
           CASE WHEN adr.regularization_id IS NOT NULL THEN 'Yes' ELSE 'No' END AS approved_exception,
           COALESCE(NULLIF(rm.full_name,''), CONCAT(rm.first_name,' ',COALESCE(rm.last_name,''))) AS reporting_manager
      FROM attendance_daily_record adr
      JOIN employees e ON e.id = adr.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN employees rm ON rm.id = e.reporting_manager_id
      LEFT JOIN wfm_roster_assignment wra ON wra.employee_id = adr.employee_id
        AND wra.roster_date = adr.record_date
      LEFT JOIN wfm_shift_master ws ON ws.id = wra.shift_id
      LEFT JOIN (
        SELECT employee_id, session_date, MIN(login_time) AS login_time
        FROM wfm_attendance_session
        GROUP BY employee_id, session_date
      ) was ON was.employee_id = adr.employee_id AND was.session_date = adr.record_date
      LEFT JOIN attendance_rule_config arc ON arc.id = adr.rule_config_id
      LEFT JOIN cost_centre_master rcc ON rcc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY adr.record_date DESC, adr.late_by_minutes DESC`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// overtime-summary  (per employee, per month)
// ---------------------------------------------------------------------------
/**
 * overtime-summary
 *
 * Hours, with the scheduled baseline the rest of the report is measured against — not a bare
 * minute total.
 *
 * This executor returned total_overtime_minutes and overtime_days against a baseline of
 * `ws.required_minutes`. The inline block returns days_attended, total_worked_hours,
 * total_scheduled_hours, overtime_hours, overtime_duration and overtime_pay, measured against
 * `arc.full_day_minutes` falling back to the rostered shift length and then to 480. Screen
 * showed 787 rows, the downloaded file 789 — close enough to look like the same report and far
 * enough apart to be a different one, since the two also disagree on which days count as
 * overtime at all.
 *
 * The catalogue declares 14 columns, of which 8 of the 8 unique to the hours shape appear and 0
 * of the 2 unique to the minutes shape do.
 *
 * Ported verbatim from the inline block, which already carries two fixes made earlier in this
 * audit and which the executor never received: the overtime_pay subquery is pre-aggregated by
 * employee so joining it cannot multiply the hours by that employee's payroll-line count, and
 * the month range is a sargable half-open comparison rather than a DATE_FORMAT wrapper.
 *
 * Bind order matters here and is easy to get wrong: the otp subquery's run_month placeholder
 * sits inside the JOIN, which binds before the WHERE, so its value must lead the list. Pushing
 * it last shifts every subsequent binding by one — silently, since the values are all strings.
 */
export async function overtimeSummary(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const month = monthParam(filters.month);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  {
    const [oy, om] = month.split("-").map(Number);
    const nextMonth = `${om === 12 ? oy + 1 : oy}-${String(om === 12 ? 1 : om + 1).padStart(2, "0")}-01`;
    clauses.push("adr.record_date >= ? AND adr.record_date < ?");
    params.push(`${month}-01`, nextMonth);
  }

  const base = `SELECT e.id AS _cursor,
         e.employee_code,
         COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
         COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
         COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
         COALESCE(d.dept_name, 'UNASSIGNED') AS department_name,
         COALESCE(occ.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
         COALESCE(occ.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
         dm.designation_name,
         COUNT(DISTINCT adr.record_date) AS days_attended,
         ROUND(SUM(adr.raw_minutes) / 60, 1) AS total_worked_hours,
         ROUND(SUM(
           CASE WHEN arc.full_day_minutes IS NOT NULL THEN arc.full_day_minutes
                ELSE TIMESTAMPDIFF(MINUTE, sm.start_time, sm.end_time) END
         ) / 60, 1) AS total_scheduled_hours,
         ROUND(SUM(
           GREATEST(0, adr.raw_minutes - COALESCE(arc.full_day_minutes, TIMESTAMPDIFF(MINUTE, sm.start_time, sm.end_time), 480))
         ) / 60, 1) AS overtime_hours,
         TIME_FORMAT(SEC_TO_TIME(SUM(
           GREATEST(0, adr.raw_minutes - COALESCE(arc.full_day_minutes, TIMESTAMPDIFF(MINUTE, sm.start_time, sm.end_time), 480))
         ) * 60), '%H:%i') AS overtime_duration,
         ROUND(COALESCE(MAX(otp.overtime_pay), 0), 0) AS overtime_pay
    FROM attendance_daily_record adr
    JOIN employees e ON e.id = adr.employee_id
    LEFT JOIN branch_master b ON b.id = e.branch_id
    LEFT JOIN process_master p ON p.id = e.process_id
    LEFT JOIN department_master d ON d.id = e.department_id
    LEFT JOIN designation_master dm ON dm.id = e.designation_id
    LEFT JOIN cost_centre_master occ ON occ.id = e.cost_centre_id
    LEFT JOIN attendance_rule_config arc ON arc.id = adr.rule_config_id
    LEFT JOIN wfm_roster_assignment wra ON wra.employee_id = e.id AND wra.roster_date = adr.record_date
    LEFT JOIN wfm_shift_master sm ON sm.id = wra.shift_id
    -- Pre-aggregated, not two open joins. spl2 was joined on employee_id ALONE, with
    -- no run filter, and spr2 was a LEFT JOIN so it did not filter either — every
    -- salary line the employee has ever had survived, then multiplied by every
    -- attendance day. Measured: 5.8 salary lines per employee against ~20 attendance
    -- days, so roughly a 116x row explosion before anything narrowed it. That is why
    -- this report did not come back.
    --
    -- It was also summing across that explosion: SUM(spl2.overtime_pay) counted every
    -- run's overtime once per attendance day. Harmless today only because overtime_pay
    -- is 0.00 on all 80,338 salary lines — verified — so this rewrite cannot move a
    -- number now, but it would have inflated real money the moment that column is used.
    LEFT JOIN (
      SELECT spl.employee_id,
             SUM(COALESCE(spl.overtime_pay, 0)) AS overtime_pay
        FROM salary_prep_line spl
        JOIN salary_prep_run spr ON spr.id = spl.run_id
       WHERE spr.run_month = ?
       GROUP BY spl.employee_id
    ) otp ON otp.employee_id = e.id
   WHERE ${clauses.join(" AND ")} AND adr.attendance_status IN ('present','half_day','week_off_worked')
   GROUP BY e.id, e.employee_code, e.first_name, e.last_name, e.full_name,
            b.branch_name, p.process_name, d.dept_name, dm.designation_name,
            occ.cost_centre_code, occ.cost_centre_name
   HAVING overtime_hours > 0
   ORDER BY overtime_hours DESC`;

  // The subquery's run_month placeholder is in the JOIN, which binds before the WHERE, so its
  // value leads the list.
  params.unshift(month);

  // One execution instead of two wherever the result fits the probe — see COUNT_FREE_PROBE.
  // This report takes about 250s for a full month and the COUNT it used to force doubled that,
  // to produce a number the same scan already knew. Identical rows; fewer round trips.
  const { rows, total } = await fetchPageWithTotal(base, params, options, query, count);
  const out = (rows as Record<string, unknown>[]).map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : out.length, isTruncated: total > out.length, nextCursor: null };
}

// ---------------------------------------------------------------------------
// regularization-summary
// ---------------------------------------------------------------------------
/**
 * regularization-summary
 *
 * One row per regularization request, not per employee.
 *
 * This grouped by employee and returned total_regularizations / approved / pending / rejected.
 * The inline block in report-suite.routes.ts returned the request detail — session date,
 * requested status, reason and reason label, who raised it, approval status, reviewer and
 * reviewed_at. Because the preview handler hits the inline block first and the export handler
 * calls executeReport() directly, the screen showed 2 rows and the downloaded spreadsheet 4:
 * the same data counted two different ways, with no shared column between them.
 *
 * The catalogue settles which is intended: it declares 19 columns for this code, and 15 of the
 * 15 unique to the detail shape are declared while 0 of the 4 unique to the aggregate are.
 *
 * Ported from the inline block verbatim so both paths run one implementation. Scope comes from
 * appendScopeConditions(scope, ...) because an executor has no req; the month filter keeps the
 * inline block's DATE_FORMAT form rather than being rewritten to a sargable range, so this
 * remains a move rather than a move plus an optimisation.
 */
export async function regularizationSummary(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const month = monthParam(filters.month);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  if (filters.status) { clauses.push("arr.status = ?"); params.push(String(filters.status)); }
  clauses.push("DATE_FORMAT(arr.session_date,'%Y-%m') = ?");
  params.push(month);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("arr.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT arr.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(zcc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(zcc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(d.dept_name, 'UNASSIGNED') AS department_name,
           dm.designation_name,
           arr.session_date AS attendance_date,
           arr.requested_status,
           arr.reason,
           arr.reason_code,
           arm.label AS reason_label,
           arr.requested_by_type,
           arr.status AS approval_status,
           arr.created_at AS submitted_at,
           reviewer.full_name AS reviewer_name,
           arr.reviewed_at AS approved_at,
           arr.reviewer_note
      FROM attendance_regularization arr
      JOIN employees e ON e.id = arr.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN department_master d ON d.id = e.department_id
      LEFT JOIN designation_master dm ON dm.id = e.designation_id
      LEFT JOIN attendance_reason_master arm ON arm.code = arr.reason_code
      LEFT JOIN employees reviewer ON reviewer.id = arr.reviewed_by
      LEFT JOIN cost_centre_master zcc ON zcc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY arr.session_date DESC, employee_name`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// attendance-dispute-summary
// Uses attendance_regularization as the source table since attendance_dispute
// may not exist as a separate table. Returns same shape as regularizationSummary
// with a dispute_type label column where available.
// ---------------------------------------------------------------------------
/**
 * attendance-dispute-summary
 *
 * One row per dispute, not per employee.
 *
 * Same divergence as regularization-summary and from the same table: this grouped by employee
 * into total_disputes / approved / pending / rejected while the inline block returned the
 * dispute detail — dispute type, old and new status, the original and requested punch times,
 * payroll impact, reviewer and resolution. Screen showed 2 rows, the downloaded file 4.
 *
 * The catalogue declares 25 columns here, of which 21 of the 21 unique to the detail shape
 * appear and 0 of the 4 unique to the aggregate do.
 *
 * Note the `arr.dispute_type IS NOT NULL` predicate, which the aggregate did not carry at all:
 * attendance_regularization holds both plain regularizations and disputes, and without it this
 * report counted every regularization as a dispute. That is why the two reports could read the
 * same table and both be wrong in different directions.
 */
export async function attendanceDisputeSummary(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const month = monthParam(filters.month);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  if (filters.status) { clauses.push("arr.status = ?"); params.push(String(filters.status)); }
  clauses.push("arr.dispute_type IS NOT NULL");
  clauses.push("DATE_FORMAT(arr.session_date,'%Y-%m') = ?");
  params.push(month);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("arr.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT arr.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(zcc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(zcc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(d.dept_name, 'UNASSIGNED') AS department_name,
           dm.designation_name,
           arr.session_date AS dispute_date,
           arr.dispute_type,
           arr.reason AS description,
           arr.reason_code,
           arm.label AS reason_label,
           arr.old_status,
           arr.new_status AS requested_status,
           TIME_FORMAT(arr.old_punch_in, '%H:%i') AS original_punch_in,
           TIME_FORMAT(arr.old_punch_out, '%H:%i') AS original_punch_out,
           TIME_FORMAT(arr.new_punch_in, '%H:%i') AS requested_punch_in,
           TIME_FORMAT(arr.new_punch_out, '%H:%i') AS requested_punch_out,
           arr.payroll_impact,
           arr.status AS approval_status,
           arr.created_at AS submitted_at,
           reviewer.full_name AS reviewer_name,
           arr.reviewed_at,
           arr.reviewer_note AS resolution
      FROM attendance_regularization arr
      JOIN employees e ON e.id = arr.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN department_master d ON d.id = e.department_id
      LEFT JOIN designation_master dm ON dm.id = e.designation_id
      LEFT JOIN attendance_reason_master arm ON arm.code = arr.reason_code
      LEFT JOIN employees reviewer ON reviewer.id = arr.reviewed_by
      LEFT JOIN cost_centre_master zcc ON zcc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY arr.session_date DESC, employee_name`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// habitual-absentee-list
// ---------------------------------------------------------------------------
export async function habitualAbsenteeList(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const month      = monthParam(filters.month);
  const threshold  = Number(filters.minAbsentDays ?? 3);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  clauses.push("adr.record_date >= ? AND adr.record_date < ?", "adr.attendance_status = 'absent'");
  params.push(monthRange(month).start, monthRange(month).endExclusive);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COUNT(*) AS absent_days
      FROM attendance_daily_record adr
      JOIN employees e ON e.id = adr.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY e.id, e.employee_code, employee_name, b.branch_name, p.process_name, sp_cc.cost_centre_code, sp_cc.cost_centre_name
     HAVING absent_days >= ${Number.isFinite(threshold) && threshold > 0 ? threshold : 3}
     ORDER BY e.id ASC`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];

  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number)
    : null;

  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// daily-shrinkage-report  (aggregate — no row-level cursor)
// ---------------------------------------------------------------------------
export async function dailyShrinkageReport(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, today);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  clauses.push("adr.record_date BETWEEN ? AND ?");
  params.push(from, to);

  const base = `
    -- Aligned with the inline block this used to disagree with, and with the catalogue.
    --
    -- This emitted three metrics — scheduled, absent_count, shrinkage_pct — where the catalogue
    -- declares nine: total_scheduled, present_hc, absent_hc, leave_hc, week_off_hc, holiday_hc,
    -- unplanned_shrinkage_hc, total_shrinkage_pct, unplanned_shrinkage_pct. Same 33 rows on
    -- screen and in the file, but the downloaded workbook carried none of the columns the grid
    -- draws, so a shrinkage report opened from a spreadsheet answered a different question from
    -- the one reviewed on screen.
    --
    -- Ported verbatim, including the status vocabulary. 'week_off' has zero rows live, which is
    -- a known gap in the shared attendance vocabulary and a separate question — porting it
    -- unchanged keeps this a move rather than a redefinition.
    SELECT adr.record_date,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COUNT(*) AS total_scheduled,
           SUM(adr.attendance_status IN ('present','half_day','week_off_worked')) AS present_hc,
           SUM(adr.attendance_status = 'absent') AS absent_hc,
           SUM(adr.attendance_status = 'leave_approved') AS leave_hc,
           SUM(adr.attendance_status = 'week_off') AS week_off_hc,
           SUM(adr.attendance_status = 'holiday') AS holiday_hc,
           COUNT(*) - SUM(adr.attendance_status IN ('present','half_day','leave_approved','week_off','holiday')) AS unplanned_shrinkage_hc,
           ROUND((COUNT(*) - SUM(adr.attendance_status IN ('present','half_day','week_off_worked'))) / NULLIF(COUNT(*), 0) * 100, 2) AS total_shrinkage_pct,
           ROUND((SUM(adr.attendance_status = 'absent')) / NULLIF(COUNT(*), 0) * 100, 2) AS unplanned_shrinkage_pct
      FROM attendance_daily_record adr
      JOIN employees e ON e.id = adr.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY adr.record_date, b.branch_name, p.process_name
     ORDER BY adr.record_date DESC, b.branch_name, p.process_name`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
}

/**
 * monthly-shrinkage-trend
 *
 * Aligned with the inline block. Same 430 rows both ways; the catalogue names all nine columns
 * unique to the inline shape and none of the four unique to this executor's.
 *
 * The derived table is structural, not stylistic: MySQL will not accept a window function over
 * aggregates computed at the same SELECT level, so the per-month aggregate has to be complete
 * before the three-month rolling average can read it. Flattening it would not compile.
 *
 * Known and not addressed here: this is the slowest report in the suite, because
 * GROUP BY DATE_FORMAT(record_date,'%Y-%m') cannot use any index (EXPLAIN reports type=ALL,
 * key=null, Using temporary) and the range covers the whole year. Making it sargable is a
 * separate change with its own before/after — folding it into a port would leave neither
 * verifiable.
 */
export async function monthlyShrinkageTrend(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const from = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to   = dateParam(filters.to, new Date().toISOString().slice(0, 10));

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("adr.record_date BETWEEN ? AND ?");
  params.push(from, to);

  const base = `
    SELECT *, ROUND(AVG(total_shrinkage_pct) OVER (
           PARTITION BY branch_name, process_name
           ORDER BY month
           ROWS BETWEEN 2 PRECEDING AND CURRENT ROW
         ), 2) AS three_month_avg_shrinkage
      FROM (
        SELECT DATE_FORMAT(adr.record_date,'%Y-%m') AS month, b.branch_name, p.process_name,
               COUNT(DISTINCT adr.record_date) AS working_days,
               COUNT(*) AS total_employee_days,
               SUM(adr.attendance_status IN ('present','half_day','week_off_worked')) AS present_days,
               SUM(adr.attendance_status = 'absent') AS absent_days,
               SUM(adr.attendance_status = 'leave_approved') AS leave_days,
               ROUND((COUNT(*) - SUM(adr.attendance_status IN ('present','half_day','week_off_worked'))) / NULLIF(COUNT(*), 0) * 100, 2) AS total_shrinkage_pct,
               ROUND(SUM(adr.attendance_status = 'absent') / NULLIF(COUNT(*), 0) * 100, 2) AS unplanned_shrinkage_pct
          FROM attendance_daily_record adr
          JOIN employees e ON e.id = adr.employee_id
          LEFT JOIN branch_master b ON b.id = e.branch_id
          LEFT JOIN process_master p ON p.id = e.process_id
         WHERE ${clauses.join(" AND ")}
         GROUP BY DATE_FORMAT(adr.record_date,'%Y-%m'), b.branch_name, p.process_name
      ) base_data
     ORDER BY month DESC, total_shrinkage_pct DESC`;

  // One execution instead of two wherever the result fits the probe. This report costs ~35s and
  // the COUNT it used to force cost another ~42s, for a number the same scan already knew — see
  // COUNT_FREE_PROBE. Identical rows either way; only the number of round trips changes.
  //
  // Before rewriting the SQL above to make this faster: don't, and be careful how you measure.
  // Seven rewrites have been tried and rejected. Run-to-run variance on this server is about
  // ±80% on identical SQL — removing the window function measured SLOWER than keeping it, which
  // is how the noise floor was found — so a handful of timings cannot support any query-shape
  // conclusion. Timings also depend heavily on which DB address you reached: the public route is
  // 3-4x slower than the office LAN for the same statement on the same server.
  // See docs/reports-slow-queries-root-cause.md before spending time here.
  const { rows, total } = await fetchPageWithTotal(base, params, options, query, count);
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length, nextCursor: null };
}

/**
 * biometric-reconciliation
 *
 * Aligned with the inline block. Same 375 rows both ways; the catalogue names all seven columns
 * unique to the inline shape and none of the one unique to this executor's.
 *
 * The report compares two independent records of the same day and names where they disagree:
 * attendance_daily_record, which is what payroll reads, against integration_biometric_daily,
 * which is the raw device feed. Both the processed and the raw minutes are reported side by
 * side on purpose — collapsing them to one number would remove the comparison the report exists
 * to make.
 *
 * Two details that must move together. The reconciliation CASE is repeated in the WHERE when a
 * status filter is supplied, because MySQL cannot filter on a SELECT alias; the two copies have
 * to stay identical or filtering silently selects a different set from the one displayed. And
 * the join to the raw feed is on employee_code, not employee id, because that is how the device
 * feed identifies people — the same reason punch-raw-export joins that way.
 */
export async function biometricReconciliation(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const from = dateParam(filters.from, new Date().toISOString().slice(0, 10));
  const to   = dateParam(filters.to, from);

  const RECONCILIATION_CASE = `CASE WHEN ibd.first_punch IS NULL AND adr.attendance_status IN ('present','half_day','week_off_worked') THEN 'NO_BIOMETRIC_FOR_PRESENT'
                          WHEN ibd.first_punch IS NOT NULL AND adr.attendance_status='absent' THEN 'PUNCHED_BUT_ABSENT'
                          ELSE 'OK' END`;

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  if (filters.status) {
    clauses.push(`${RECONCILIATION_CASE} = ?`);
    params.push(String(filters.status));
  }
  clauses.push("adr.record_date BETWEEN ? AND ?");
  params.push(from, to);

  const base = `
    SELECT adr.record_date,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(rcc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(rcc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           adr.attendance_status,
           adr.biometric_minutes AS processed_biometric_minutes,
           TIME_FORMAT(SEC_TO_TIME(adr.biometric_minutes * 60), '%H:%i') AS processed_biometric_duration,
           TIME_FORMAT(ibd.first_punch, '%H:%i:%s') AS biometric_punch_in,
           TIME_FORMAT(ibd.last_punch, '%H:%i:%s') AS biometric_punch_out,
           ibd.biometric_minutes AS raw_biometric_minutes,
           TIME_FORMAT(SEC_TO_TIME(ibd.biometric_minutes * 60), '%H:%i') AS raw_biometric_duration,
           ${RECONCILIATION_CASE} AS reconciliation_status,
           CASE WHEN ibd.first_punch IS NULL AND adr.attendance_status IN ('present','half_day','week_off_worked') THEN 'No biometric record for marked present'
                WHEN ibd.first_punch IS NOT NULL AND adr.attendance_status='absent' THEN 'Biometric punch exists but marked absent'
                ELSE 'Reconciled' END AS reconciliation_description
      FROM attendance_daily_record adr
      JOIN employees e ON e.id = adr.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN integration_biometric_daily ibd ON ibd.employee_code = e.employee_code AND ibd.activity_date = adr.record_date
      LEFT JOIN cost_centre_master rcc ON rcc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY adr.record_date DESC, reconciliation_status DESC`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length, nextCursor: null };
}

/**
 * punch-raw-export
 *
 * Aligned with the inline block. Same 160 rows both ways; the catalogue names all seven columns
 * unique to the inline shape and none of the five unique to this executor's.
 *
 * Reads integration_biometric_daily, the raw device feed, and joins employees by employee_code
 * rather than by id — that is how the feed identifies people. The join stays a LEFT JOIN on
 * purpose: a punch from a code with no matching employee is exactly what a raw export should
 * still show, since it is the evidence that someone is punching without being mapped.
 */
export async function punchRawExport(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const from = dateParam(filters.from, new Date().toISOString().slice(0, 10));
  const to   = dateParam(filters.to, from);

  const clauses: string[] = ["1 = 1"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  clauses.push("ibd.activity_date BETWEEN ? AND ?");
  params.push(from, to);

  const base = `
    SELECT ibd.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(rcc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(rcc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           e.biometric_code,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           ibd.activity_date,
           TIME_FORMAT(ibd.first_punch, '%H:%i:%s') AS first_punch,
           TIME_FORMAT(ibd.last_punch, '%H:%i:%s') AS last_punch,
           ibd.biometric_minutes,
           TIME_FORMAT(SEC_TO_TIME(ibd.biometric_minutes * 60), '%H:%i:%s') AS total_duration,
           ibd.total_punches
      FROM integration_biometric_daily ibd
      LEFT JOIN employees e ON e.employee_code = ibd.employee_code
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master rcc ON rcc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY ibd.activity_date DESC, ibd.employee_code`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length, nextCursor: null };
}

// ---------------------------------------------------------------------------
// attendance-register-grid
// NOTE: Full date-pivoted grid is under_validation in the report catalog.
// Returns a date-range attendance summary (same shape as attendanceSummary)
// grouped by employee, filtered by from/to date range instead of month.
// ---------------------------------------------------------------------------
export async function attendanceRegisterGrid(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, `${today.slice(0, 7)}-01`);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  clauses.push("adr.record_date BETWEEN ? AND ?");
  params.push(from, to);

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("e.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT e.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           SUM(CASE WHEN adr.attendance_status = 'present'  THEN 1 ELSE 0 END) AS present_days,
           SUM(CASE WHEN adr.attendance_status = 'absent'   THEN 1 ELSE 0 END) AS absent_days,
           SUM(CASE WHEN adr.attendance_status = 'half_day' THEN 1 ELSE 0 END) AS half_days,
           SUM(CASE WHEN adr.attendance_status = 'lwp'      THEN 1 ELSE 0 END) AS lwp_days,
           SUM(CASE WHEN adr.late_by_minutes > 0            THEN 1 ELSE 0 END) AS late_days,
           COUNT(*) AS working_days,
           '${from}' AS date_from,
           '${to}' AS date_to
      FROM attendance_daily_record adr
      JOIN employees e ON e.id = adr.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY e.id, e.employee_code, employee_name, b.branch_name, p.process_name, sp_cc.cost_centre_code, sp_cc.cost_centre_name
     ORDER BY e.id ASC`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];

  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number)
    : null;

  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// break-daily-summary  (aggregate — one row per employee per date, no cursor)
//
// Aggregated from break_sessions rather than the derived break_daily_summary
// table, so the report cannot go stale if the summary writer lags or misses a
// day. The date column on break_sessions is shift_date; there is no
// session_date column.
//
// Break count and minutes cover COMPLETED, AUTO_CLOSED and EXCEPTION sessions —
// the same set getBreakUsageSummary() in break-management.service.ts treats as
// consumed break time. ACTIVE (in-progress) sessions have no end time and no
// duration yet, so counting them would report break minutes that have not been
// taken.
//
// shift_name resolves through a correlated subquery rather than a join, so a
// duplicate roster assignment can never fan out and inflate break_count.
// ---------------------------------------------------------------------------
export async function breakDailySummary(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, today);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  clauses.push("bs.shift_date BETWEEN ? AND ?");
  params.push(from, to);

  clauses.push("bs.status IN ('COMPLETED','AUTO_CLOSED','EXCEPTION')");

  if (options.asOf) {
    clauses.push("bs.shift_date <= ?");
    params.push(options.asOf);
  }

  const base = `
    SELECT bs.shift_date AS break_date,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           (SELECT ws.shift_name
              FROM wfm_roster_assignment wra
              JOIN wfm_shift_master ws ON ws.id = wra.shift_id
             WHERE wra.employee_id = e.id
               AND wra.roster_date = bs.shift_date
             LIMIT 1) AS shift_name,
           COUNT(*) AS break_count,
           -- CAST to SIGNED so the driver returns a number; a bare SUM() on a
           -- DECIMAL column arrives as a string and lands in the XLSX as text.
           CAST(ROUND(SUM(COALESCE(bs.duration_minutes, 0))) AS SIGNED) AS total_break_minutes
      FROM break_sessions bs
      JOIN employees e ON e.id = bs.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     GROUP BY bs.shift_date, e.id, e.employee_code, e.full_name, e.first_name,
              e.last_name, b.branch_name, p.process_name, sp_cc.cost_centre_code, sp_cc.cost_centre_name
     ORDER BY bs.shift_date DESC, e.employee_code ASC`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];

  return {
    rows,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > rows.length : rows.length === options.limit,
  };
}

// ---------------------------------------------------------------------------
// break-session-log  (detail — one row per break, with in/out times)
//
// The per-break companion to break-daily-summary: every individual break punch
// with its start and end time, rather than the day's totals. ACTIVE sessions
// ARE included here — an in-progress break is exactly what someone reading a
// log needs to see — and show a blank break-out time with no duration. That is
// why the two reports' break counts can differ: the summary counts only
// finished breaks, this one shows everything on the log.
// ---------------------------------------------------------------------------
export async function breakSessionLog(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, today);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  clauses.push("bs.shift_date BETWEEN ? AND ?");
  params.push(from, to);

  if (filters.status) {
    clauses.push("bs.status = ?");
    params.push(String(filters.status).toUpperCase());
  }

  if (options.asOf) {
    clauses.push("bs.shift_date <= ?");
    params.push(options.asOf);
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("bs.id > ?");
    params.push(options.cursor);
  }

  // Worker mode pages by bs.id, so it must order by bs.id for the cursor to be
  // monotonic. Preview/export order the way a human reads a log: newest day
  // first, then each employee's breaks in the order they were taken.
  const orderBy = options.mode === "worker"
    ? "bs.id ASC"
    : "bs.shift_date DESC, e.employee_code ASC, bs.break_start_time ASC";

  const base = `
    SELECT bs.id AS _cursor,
           bs.shift_date AS break_date,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(zcc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(zcc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           bs.break_type,
           TIME_FORMAT(bs.break_start_time,'%H:%i:%s') AS break_in,
           TIME_FORMAT(bs.break_end_time,'%H:%i:%s')   AS break_out,
           CAST(ROUND(COALESCE(bs.duration_minutes, 0)) AS SIGNED) AS duration_minutes,
           bs.status,
           bs.start_source,
           bs.end_source,
           kd.kiosk_code,
           TIME_FORMAT(bs.biometric_punch_in_time,'%H:%i:%s')  AS biometric_punch_in,
           TIME_FORMAT(bs.biometric_punch_out_time,'%H:%i:%s') AS biometric_punch_out,
           bs.exception_reason,
           bs.break_reason
      FROM break_sessions bs
      JOIN employees e ON e.id = bs.employee_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN break_kiosk_devices kd ON kd.id = bs.kiosk_device_id
      LEFT JOIN cost_centre_master zcc ON zcc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY ${orderBy}`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];

  // break_sessions.id is a UUID, not an auto-increment. Keyset pagination still
  // works — ORDER BY bs.id ASC combined with bs.id > cursor is a stable total
  // order — but pages come out in id order rather than chronological order,
  // which is why worker mode sorts by bs.id instead of by date.
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as string)
    : null;

  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return {
    rows: out,
    rowCount: options.includeTotal ? total : rows.length,
    isTruncated: options.includeTotal ? total > out.length : rows.length === options.limit,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// productivity-individual-scorecard
//
// Folded in from an inline `case` block, and a positional-binding bug fixed on the way.
//
// The inline version built its SQL with two `?` placeholders inside the kpi_score_period
// JOIN — which appear BEFORE the WHERE clause in the SQL text — but appended their values
// with `params.push(month, month)` AFTER addScopedEmployeeFilters had already pushed the
// scope and filter values. mysql2 binds positionally, so the JOIN's two date placeholders
// took whatever came first in the array.
//
// For an unrestricted super_admin with no branchId that array is [month, month, month] and
// it works by luck. For ANY branch-scoped user, or anyone passing ?branchId=, the first two
// entries are branch UUIDs, so the join evaluated
// STR_TO_DATE(CONCAT('<uuid>','-01'), '%Y-%m-%d') — which MySQL returns as NULL (verified
// live), never matching. kpi_score and kpi_rating came back NULL for every such user, with
// no error: a silently empty column on a scorecard, exactly the kind of wrong answer that
// looks like "no KPI data yet".
//
// Fixed by binding in SQL order: join params first, then the WHERE params. This mirrors
// payrollVariance in payroll.executor.ts, which documents the same rule.
//
// kpi_score_summary holds 0 rows today, so nobody currently sees a score either way — but
// the bug would have bitten silently the moment KPI data landed.
// ---------------------------------------------------------------------------
export async function productivityIndividualScorecard(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const month = monthParam(filters.month);

  // Params for the two placeholders in the JOIN. These MUST precede the WHERE params.
  const joinParams: unknown[] = [month, month];

  const clauses: string[] = ["e.id IS NOT NULL"];
  const whereParams: unknown[] = [];
  appendScopeConditions(scope, clauses, whereParams);
  appendFilterConditions(filters, clauses, whereParams);
  clauses.push("DATE_FORMAT(adr.record_date,'%Y-%m') = ?");
  whereParams.push(month);

  const base = `
    SELECT e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           ROUND(SUM(adr.dialler_minutes) / 60, 2) AS login_hours,
           ROUND(SUM(adr.biometric_minutes) / 60, 2) AS biometric_hours,
           COUNT(CASE WHEN adr.attendance_status IN ('present','half_day','week_off_worked') THEN 1 END) AS present_days,
           kss.final_score AS kpi_score,
           kss.rating AS kpi_rating,
           ROUND(COUNT(CASE WHEN adr.attendance_status IN ('present','half_day','week_off_worked') THEN 1 END)
                 / NULLIF(COUNT(*),0) * 100, 1) AS attendance_pct
      FROM attendance_daily_record adr
      JOIN employees e ON e.id = adr.employee_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN branch_master b ON b.id = e.branch_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
      LEFT JOIN kpi_score_summary kss ON kss.employee_id = e.id
      LEFT JOIN kpi_score_period ksp ON ksp.id = kss.period_id
        AND ksp.period_start <= LAST_DAY(STR_TO_DATE(CONCAT(?, '-01'), '%Y-%m-%d'))
        AND ksp.period_end >= STR_TO_DATE(CONCAT(?, '-01'), '%Y-%m-%d')
     WHERE ${clauses.join(" AND ")}
     -- ONLY_FULL_GROUP_BY: cost centre and branch belong here as well as in the SELECT.
     GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name,
              p.process_name, b.branch_name, sp_cc.cost_centre_code, sp_cc.cost_centre_name,
              kss.final_score, kss.rating
     ORDER BY login_hours DESC`;

  const params = [...joinParams, ...whereParams];
  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  return { rows, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > rows.length };
}
