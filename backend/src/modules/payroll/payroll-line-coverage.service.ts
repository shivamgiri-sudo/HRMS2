/**
 * Who worked this month and is NOT going to be paid for it.
 *
 * WHY THIS EXISTS
 * ---------------
 * Everything that went wrong in the 2026-07 and 2026-08 runs had the same shape: somebody worked,
 * the system knew they worked, and nothing anywhere said they were about to be missed. Three
 * different mechanisms, one symptom.
 *
 *   1. NO LINE. The run selects its population once, at calculation. 43 employees eligible for
 *      2026-08 held no line at all — mid-month leavers whose date_of_exit was written after the
 *      run was calculated, so employmentWindowPredicate() could not see them when it mattered.
 *      25 of them had worked, worth Rs 1.19 lakh.
 *
 *   2. NO SALARY. employee_salary_assignment is a hard join in the engine, so an employee without
 *      one cannot appear in any run — silently, forever. 9 people reached the floor in August,
 *      worked 27 days between them, and no salary was ever recorded for 7 of them anywhere.
 *
 *   3. LINE PAYS ZERO. A line calculated before its attendance arrived keeps its zero. 63
 *      employees in the LOCKED 2026-07 run pay Rs 0 against 292 attendance days, every one of
 *      them stamped attendance_data_source = 'NO_DATA'. By the time anyone noticed, the run was
 *      closed to recomputation and the fix had become an arrears decision.
 *
 * MEASURED AGAINST THE ENGINE'S OWN PREDICATE, NEVER A PRIVATE COPY OF IT.
 * payroll-run-coverage.service.ts already answers "does every cost centre have a run", but it
 * counts `active_status = 1 AND employment_status = 'active'` employees. That is a DIFFERENT
 * population from the one payroll pays: a mid-month leaver is inactive today and still owed for
 * the days they worked. So a month could read fully covered while gap 1 was live in it — which is
 * exactly what happened. This module imports employmentWindowPredicate() from employment-end-date
 * so the question "who should have a line" cannot drift from the code that creates the lines. If
 * that predicate changes, this changes with it, by construction.
 *
 * ATTENDANCE IS THE EVIDENCE, NOT THE ROSTER. Present and half-day only, matching
 * hrms2-attendance-must-not-read-roster: a day someone was recorded working is the thing that
 * makes an unpaid line wrong, and a roster entry is not that.
 */

import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { employmentWindowPredicate, EMPLOYMENT_END_DATE_SELECT } from "./employment-end-date.js";

export type CoverageGapKind = "no_line" | "no_salary_structure" | "zero_paid_with_attendance";

export type LineCoverageGap = {
  employeeId: string;
  employeeCode: string;
  kind: CoverageGapKind;
  attendanceDays: number;
  /** Resolved last working day, where one exists — the reason a leaver is still owed pay. */
  employmentEndDate: string | null;
  detail: string;
};

export type RunLineCoverage = {
  runId: string;
  runMonth: string;
  linesInRun: number;
  gaps: LineCoverageGap[];
  /** Gaps where somebody actually worked. The ones that cost money if the run is signed off. */
  gapsWithAttendance: number;
  unpaidAttendanceDays: number;
  clean: boolean;
};

/**
 * Days of recorded work in the month. Half a day counts as half — a half-day paid as nothing is
 * still half a day unpaid.
 */
const ATTENDANCE_DAYS_SQL = `
  COALESCE((SELECT SUM(CASE a.attendance_status
                         WHEN 'present'  THEN 1
                         WHEN 'half_day' THEN 0.5
                         ELSE 0 END)
              FROM attendance_daily_record a
             WHERE a.employee_id = e.id
               AND a.record_date BETWEEN CONCAT(?, '-01') AND LAST_DAY(CONCAT(?, '-01'))), 0)`;

export async function getRunLineCoverage(runId: string): Promise<RunLineCoverage> {
  const [runRows] = await db.execute<RowDataPacket[]>(
    "SELECT id, run_month FROM salary_prep_run WHERE id = ? LIMIT 1",
    [runId],
  );
  const run = runRows[0];
  if (!run) throw Object.assign(new Error("Run not found"), { statusCode: 404 });
  const month = String(run.run_month);

  const [[countRow]] = await db.execute<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM salary_prep_line WHERE run_id = ?",
    [runId],
  ) as unknown as [RowDataPacket[]];
  const linesInRun = Number(countRow?.n ?? 0);

  /*
   * Gap 1 — eligible, holds a salary assignment, has no line.
   *
   * The salary join is the engine's own point-in-time COALESCE, not `active_status = 1`: a leaver's
   * assignment is deactivated when they go, and joining on the live flag would drop the very people
   * this is looking for and report them under gap 2 instead, pointing at the wrong fix.
   */
  const [noLine] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, ${EMPLOYMENT_END_DATE_SELECT} AS end_date,
            ${ATTENDANCE_DAYS_SQL} AS days
       FROM employees e
       JOIN employee_salary_assignment esa ON esa.id = COALESCE(
            (SELECT p.id FROM employee_salary_assignment p
              WHERE p.employee_id = e.id AND p.effective_from <= LAST_DAY(CONCAT(?, '-01'))
              ORDER BY p.effective_from DESC, p.active_status DESC, p.created_at DESC LIMIT 1),
            (SELECT a2.id FROM employee_salary_assignment a2
              WHERE a2.employee_id = e.id AND a2.active_status = 1
              ORDER BY a2.effective_from DESC, a2.created_at DESC LIMIT 1))
       JOIN salary_structure_master ss ON ss.id = esa.structure_id
      WHERE ${employmentWindowPredicate()}
        AND NOT EXISTS (SELECT 1 FROM salary_prep_line l
                         WHERE l.run_id = ? AND l.employee_id = e.id)
      ORDER BY days DESC, e.employee_code`,
    [month, month, month, month, month, runId],
  );

  /*
   * Gap 2 — worked, but no salary the engine can resolve, so no run can ever contain them.
   *
   * Deliberately keyed on attendance rather than on the employment predicate: someone with no
   * salary row and no attendance is a records-cleanup question, not an unpaid-wages one, and
   * mixing the two buries the cases that matter. A zero-CTC assignment counts as absent — it
   * resolves in SQL and then pays nothing, which is the same outcome wearing a different mask.
   */
  const [noSalary] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, ${EMPLOYMENT_END_DATE_SELECT} AS end_date,
            ${ATTENDANCE_DAYS_SQL} AS days
       FROM employees e
      WHERE ${ATTENDANCE_DAYS_SQL} > 0
        AND NOT EXISTS (
              SELECT 1 FROM employee_salary_assignment s
               JOIN salary_structure_master ss ON ss.id = s.structure_id
              WHERE s.employee_id = e.id
                AND COALESCE(s.ctc_annual, 0) > 0
                AND s.effective_from <= LAST_DAY(CONCAT(?, '-01')))
      ORDER BY days DESC, e.employee_code`,
    [month, month, month, month, month],
  );

  /*
   * Gap 3 — holds a line, worked, and the line pays nothing.
   *
   * This is the July shape, and it is the one that goes unnoticed longest: the employee IS in the
   * run and IS on the register, so every count reconciles. Only the amount is wrong.
   */
  const [zeroPaid] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, ${EMPLOYMENT_END_DATE_SELECT} AS end_date,
            ${ATTENDANCE_DAYS_SQL} AS days,
            l.attendance_data_source
       FROM salary_prep_line l
       JOIN employees e ON e.id = l.employee_id
      WHERE l.run_id = ?
        AND l.final_payable_days = 0
        AND l.net_salary = 0
        AND ${ATTENDANCE_DAYS_SQL} > 0
      ORDER BY days DESC, e.employee_code`,
    [month, month, runId, month, month],
  );

  const row = (r: RowDataPacket, kind: CoverageGapKind, detail: string): LineCoverageGap => ({
    employeeId: String(r.id),
    employeeCode: String(r.employee_code ?? ""),
    kind,
    attendanceDays: Number(r.days ?? 0),
    employmentEndDate: r.end_date ? String(r.end_date) : null,
    detail,
  });

  const gaps: LineCoverageGap[] = [
    ...noLine.map((r) =>
      row(r, "no_line", r.end_date
        ? `eligible through ${r.end_date} but the run holds no line — recalculate the run to add them`
        : "eligible but the run holds no line — recalculate the run to add them")),
    ...noSalary.map((r) =>
      row(r, "no_salary_structure",
        "worked, but has no salary assignment the engine can resolve — no run can include them until HR assigns one")),
    ...zeroPaid.map((r) =>
      row(r, "zero_paid_with_attendance",
        `line pays zero against recorded attendance (source ${r.attendance_data_source ?? "unset"}) — recalculate before the run closes`)),
  ];

  /*
   * One employee, one gap — the most specific one.
   *
   * The three queries are deliberately independent, and an employee can satisfy two at once: a
   * zero-CTC assignment resolves in the salary join (so they read as "eligible, no line") while
   * still paying nothing (so they read as "no salary"). Counting them twice inflates both the
   * headcount and the unpaid days, and the two entries name different fixes — one says recalculate,
   * which would do nothing for them. Ordering here is fixed: no salary supersedes no line, because
   * assigning the salary is what has to happen first and a recalculation before it is wasted.
   */
  const precedence: Record<CoverageGapKind, number> = {
    no_salary_structure: 0,
    zero_paid_with_attendance: 1,
    no_line: 2,
  };
  const byEmployee = new Map<string, LineCoverageGap>();
  for (const g of gaps) {
    const held = byEmployee.get(g.employeeId);
    if (!held || precedence[g.kind] < precedence[held.kind]) byEmployee.set(g.employeeId, g);
  }
  const deduped = [...byEmployee.values()].sort(
    (a, b) => b.attendanceDays - a.attendanceDays || a.employeeCode.localeCompare(b.employeeCode),
  );

  const withAttendance = deduped.filter((g) => g.attendanceDays > 0);
  return {
    runId,
    runMonth: month,
    linesInRun,
    gaps: deduped,
    gapsWithAttendance: withAttendance.length,
    unpaidAttendanceDays: Number(withAttendance.reduce((s, g) => s + g.attendanceDays, 0).toFixed(1)),
    // Clean means nobody who worked is being left out. A gap with no attendance behind it is a
    // records question, and must not block a payroll that is otherwise correct.
    clean: withAttendance.length === 0,
  };
}
