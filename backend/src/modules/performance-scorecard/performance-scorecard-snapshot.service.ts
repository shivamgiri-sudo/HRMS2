import { randomUUID } from "node:crypto";
import { db } from "../../db/mysql.js";
import type { EmployeePerformanceSnapshotRow } from "./performance-scorecard.types.js";
import { shrinkageService } from "../rta/rta.service.js";
import { managementService } from "../management/management.service.js";
import { getStatement } from "../process-pnl/pnl-statement.service.js";

const UNPLANNED_STATUSES = new Set(["absent", "missing_punch"]);

export async function computeEmployeeSnapshot(
  employeeId: string,
  date: string,
): Promise<EmployeePerformanceSnapshotRow> {
  const [[attendance]] = (await db.execute(
    `SELECT attendance_status, late_by_minutes FROM attendance_daily_record
      WHERE employee_id = ? AND record_date = ? LIMIT 1`,
    [employeeId, date],
  )) as any;

  // Whether a PIP was active ON `date` (the snapshot date), not whether one is
  // active right now. `pr.status = 'active'` with no date bound stamped a
  // HISTORICAL/backfilled snapshot row with TODAY's current PIP status —
  // flattening the PIP trend in the drilldown to today's value and silently
  // back-dating the current PIP state across all of history on any backfill.
  // The checkpoint join is bounded the same way so a checkpoint recorded
  // AFTER the snapshot date cannot leak into a historical row.
  const [pipRows] = (await db.execute(
    `SELECT pr.status, pc.rating
       FROM pip_record pr
       LEFT JOIN pip_checkpoint pc ON pc.pip_id = pr.id AND pc.checkpoint_date <= ?
      WHERE pr.employee_id = ? AND pr.start_date <= ? AND (pr.end_date IS NULL OR pr.end_date >= ?)
      ORDER BY pc.checkpoint_date DESC LIMIT 1`,
    [date, employeeId, date, date],
  )) as any;

  const [[quality]] = (await db.execute(
    `SELECT AVG(kda.actual_value) AS overall_score
       FROM kpi_daily_actual kda
      WHERE kda.employee_id = ? AND kda.score_date = ?`,
    [employeeId, date],
  )) as any;

  // Known limitation: designation_id is read as-of-now (employees.designation_id
  // has no history table in this schema), so a historical backfill stamps a
  // past snapshot with the employee's CURRENT designation, not the one they
  // held on `date`. Not fixed here — there is nothing to fix it against.
  const [[emp]] = (await db.execute(
    `SELECT designation_id FROM employees WHERE id = ? LIMIT 1`,
    [employeeId],
  )) as any;

  const attendanceStatus: string | null = attendance?.attendance_status ?? null;
  const pipRow = pipRows?.[0];
  const pipStatus: EmployeePerformanceSnapshotRow["pipStatus"] = pipRow
    ? pipRow.rating === "off_track"
      ? "off_track"
      : pipRow.rating === "at_risk"
        ? "at_risk"
        : "active"
    : "none";

  // Manager-tier detection: an employee "manages a team" if anyone reports to
  // them via either the current or legacy manager column. Individual
  // contributors get null for all 3 rollup fields — never a copy of their
  // process's numbers.
  const [[reportsCheck]] = (await db.execute(
    `SELECT EXISTS(
       SELECT 1 FROM employees WHERE reporting_manager_id = ? OR manager_id = ?
     ) AS has_reports`,
    [employeeId, employeeId],
  )) as any;

  let teamAttritionPct: number | null = null;
  let teamShrinkagePct: number | null = null;
  let teamRevenue: number | null = null;

  if (Number(reportsCheck?.has_reports) === 1) {
    // Active reports only — kept consistent with getDashboardSummary's own
    // headcount count (active-only). Without this filter, a manager whose
    // only direct reports have since exited gets an empty active headcount
    // denominator, which can push its attrition formula toward 200%.
    const [reportRows] = (await db.execute(
      `SELECT id FROM employees WHERE (reporting_manager_id = ? OR manager_id = ?) AND active_status = 1`,
      [employeeId, employeeId],
    )) as any;
    const directReportIds = (reportRows as Array<{ id: string }>).map((r) => r.id);

    const [[managerScope]] = (await db.execute(
      `SELECT process_id, branch_id FROM employees WHERE id = ? LIMIT 1`,
      [employeeId],
    )) as any;
    const processId: string | undefined = managerScope?.process_id ?? undefined;
    const branchId: string | undefined = managerScope?.branch_id ?? undefined;

    // If the manager has neither a process nor a branch on their own record,
    // skip the rollup calls entirely rather than calling the scoped services
    // with no scope at all — an unscoped call silently returns company-wide
    // (or all-branch) totals, which would otherwise get attributed to this
    // one manager as their "team" numbers.
    const hasScope = processId !== undefined || branchId !== undefined;

    // Each of these 3 calls degrades to null on its own failure, independently
    // of the other two — one service being down must not blank the whole row.
    if (hasScope) {
      try {
        // Shrinkage snapshots are currently only computed at branch grain
        // (RTA's process-level roster data isn't reliable enough yet — see
        // rta-nightly.cron.ts), so matching on processId too would never
        // find a row.
        const snapshots = await shrinkageService.listSnapshots({
          fromDate: date,
          toDate: date,
          branchId,
        });
        if (snapshots.length > 0 && snapshots[0].total_shrinkage_pct !== null) {
          teamShrinkagePct = Number(snapshots[0].total_shrinkage_pct);
        }
      } catch (err) {
        console.error(`[performance-scorecard] shrinkage lookup failed for manager ${employeeId}`, err);
      }

      try {
        // Known limitation, specific to backfills: getDashboardSummary's
        // attrition calculation is anchored to CURDATE() inside the shared
        // management.service.ts, not to `date` (the historical snapshot
        // date passed in here). A backfilled historical row therefore gets
        // stamped with TODAY's 30-day attrition rate, not the rate as of
        // that historical date. Sharper version of the already-accepted
        // "30-day rolling, not a true daily figure" caveat. Not fixed here —
        // fixing it means changing the shared service, out of scope.
        const summary = await managementService.getDashboardSummary(processId, directReportIds);
        if (summary?.attrition_rate !== undefined && summary.attrition_rate !== null) {
          teamAttritionPct = Number(summary.attrition_rate);
        }
      } catch (err) {
        console.error(`[performance-scorecard] attrition lookup failed for manager ${employeeId}`, err);
      }

      try {
        // Attrition (30-day rolling) and revenue (monthly P&L) are not true
        // daily figures — accepted, documented behavior; not a bug.
        const period = date.slice(0, 7); // YYYY-MM
        const statement = await getStatement({ period, processId }, "process");
        const revenueRow = statement.rows.find(
          (r: { componentKey: string }) => r.componentKey === "recognized_revenue",
        );
        if (revenueRow) {
          const values = Object.values(revenueRow.values as Record<string, number | null>).filter(
            (v): v is number => v !== null,
          );
          if (values.length > 0) {
            teamRevenue = values.reduce((sum, v) => sum + v, 0);
          }
        }
      } catch (err) {
        console.error(`[performance-scorecard] revenue lookup failed for manager ${employeeId}`, err);
      }
    }
  }

  return {
    employeeId,
    snapshotDate: date,
    attendanceStatus,
    lateByMinutes: Number(attendance?.late_by_minutes ?? 0),
    unplannedLeaveFlag: attendanceStatus !== null && UNPLANNED_STATUSES.has(attendanceStatus),
    pipStatus,
    designationId: emp?.designation_id ?? null,
    qualityScore:
      quality?.overall_score === null || quality?.overall_score === undefined
        ? null
        : Number(quality.overall_score),
    templateMetrics: null,
    teamAttritionPct,
    teamShrinkagePct,
    teamRevenue,
  };
}

/**
 * Writes daily performance snapshots for all active employees.
 *
 * Each employee is processed independently: a failure computing or writing
 * one employee's snapshot (bad data, FK issue, transient connection error)
 * is caught, logged and recorded in `errors`, and processing continues with
 * the remaining employees rather than aborting the whole batch.
 */
export async function writeEmployeePerformanceSnapshots(
  date: string,
): Promise<{ written: number; errors: Array<{ employeeId: string; error: string }> }> {
  const [rows] = (await db.execute(
    `SELECT id FROM employees WHERE active_status = 1`,
  )) as any;

  let written = 0;
  const errors: Array<{ employeeId: string; error: string }> = [];

  for (const { id: employeeId } of rows as Array<{ id: string }>) {
    try {
      const snapshot = await computeEmployeeSnapshot(employeeId, date);
      await db.execute(
        `INSERT INTO employee_performance_daily_snapshot
           (id, employee_id, snapshot_date, attendance_status, late_by_minutes, unplanned_leave_flag,
            pip_status, designation_id, quality_score, template_metrics,
            team_attrition_pct, team_shrinkage_pct, team_revenue)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           attendance_status = VALUES(attendance_status),
           late_by_minutes = VALUES(late_by_minutes),
           unplanned_leave_flag = VALUES(unplanned_leave_flag),
           pip_status = VALUES(pip_status),
           designation_id = VALUES(designation_id),
           quality_score = VALUES(quality_score),
           template_metrics = VALUES(template_metrics),
           team_attrition_pct = VALUES(team_attrition_pct),
           team_shrinkage_pct = VALUES(team_shrinkage_pct),
           team_revenue = VALUES(team_revenue),
           updated_at = CURRENT_TIMESTAMP`,
        [
          randomUUID(),
          snapshot.employeeId,
          snapshot.snapshotDate,
          snapshot.attendanceStatus,
          snapshot.lateByMinutes,
          snapshot.unplannedLeaveFlag ? 1 : 0,
          snapshot.pipStatus,
          snapshot.designationId,
          snapshot.qualityScore,
          snapshot.templateMetrics ? JSON.stringify(snapshot.templateMetrics) : null,
          snapshot.teamAttritionPct,
          snapshot.teamShrinkagePct,
          snapshot.teamRevenue,
        ],
      );
      written += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[performance-scorecard-snapshot] failed to write snapshot for employeeId=${employeeId}:`,
        err,
      );
      errors.push({ employeeId, error: message });
    }
  }
  return { written, errors };
}
