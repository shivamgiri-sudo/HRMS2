/**
 * Executive rollup module for the D-1 Daily Manager Briefing Engine (spec §29).
 *
 * CEO/admin/super_admin briefings must emphasize organization-wide attendance,
 * branch/process comparison, major positive wins, major operational deterioration,
 * critical people/staffing risks, SLA/business risks, high-severity business actions,
 * payroll readiness at aggregate level, and a hiring/attrition summary — NOT a
 * per-employee exception list (which would be both a performance disaster against a
 * 1000+-employee org-wide population and a "50-page email" violating spec §29's own
 * "not a per-employee list" instruction).
 *
 * PERFORMANCE RULE (spec §29, load-bearing): every query in this module is a single
 * GROUP BY aggregation over the whole (or scoped) population. None of them fetch every
 * employee row and reduce in application code — see each function's SQL for the actual
 * GROUP BY clause.
 *
 * SCOPE: takes a branch/process scope descriptor exactly like
 * daily-brief-payroll.module.ts's buildPayrollReadinessModule — `{branchIds: [],
 * processIds: []}` means org-wide (no filter), matching that module's own documented
 * scope rule so the same "empty scope = everything" convention holds across both
 * aggregate-level modules in this feature.
 *
 * PAYROLL: deliberately NOT built here. buildPayrollReadinessModule
 * (daily-brief-payroll.module.ts) already produces aggregate-level, non-monetary
 * payroll readiness output — reused as-is by the aggregator (daily-brief-aggregator.
 * service.ts's buildExecutiveDailyBrief), which also owns the security-critical
 * hasRole(...PAYROLL_ROLES) gate, exactly as it already does for the per-employee path.
 * This module does not import PAYROLL_ROLES or touch salary_prep_run at all.
 *
 * RESULT SHAPE: ExecutiveRollupModuleResult is intentionally NOT the ManagerDailyBrief
 * shape used by the per-employee path — it is grouped by branch/process, not by
 * employee. See daily-brief-aggregator.service.ts's ExecutiveDailyBrief type (the
 * top-level payload an executive recipient actually gets) and
 * daily-brief-dispatch.service.ts's buildExecutiveTemplateContext for how the
 * aggregator/template branch on recipient role to pick this shape over the per-employee
 * one, and daily-brief.hbs/.txt.hbs's `{{#if rollup}}` sections for the rendering split.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import {
  EXPECTED_TO_WORK_EXCLUSIONS,
  HALF_DAY_STATUS,
  attendedDaysSql,
  expectedToWorkSql,
  presentSql,
} from "../../../shared/attendanceStatus.js";
import type { SourceHealth } from "./daily-brief.types.js";
import {
  EXECUTIVE_ROLLUP_MAX_BRANCH_ROWS,
  EXECUTIVE_ROLLUP_TOP_ACTIONS,
} from "./daily-brief-editorial-constants.js";

export interface ExecutiveRollupScope {
  branchIds: string[];
  processIds: string[];
}

export interface OrgAttendanceRollup {
  present: number;
  halfDay: number;
  absent: number;
  missingPunch: number;
  lateCount: number;
  expectedToWork: number;
  attendancePct: number | null;
}

export interface BranchAttendanceRollupRow {
  branchId: string;
  branchName: string;
  present: number;
  halfDay: number;
  absent: number;
  missingPunch: number;
  lateCount: number;
  expectedToWork: number;
  attendancePct: number | null;
}

export interface TopBusinessAction {
  id: string;
  title: string;
  riskType: string;
  severity: "critical" | "high" | "medium" | "low";
  status: string;
  dueDate: string | null;
}

export interface HiringAttritionRollup {
  candidatesMovedD1: number;
  offerApprovalsPending: number;
  joiningToday: number;
  joiningThisWeek: number;
  resignationsSubmittedD1: number;
  openExitRequests: number;
  upcomingLwdNext7Days: number;
}

export interface ExecutiveRollupModuleResult {
  scope: ExecutiveRollupScope;
  isOrgWide: boolean;
  orgAttendance: OrgAttendanceRollup;
  branchAttendance: BranchAttendanceRollupRow[];
  /** Best/worst branch by attendance %, derived by sorting the already-aggregated
   * branchAttendance rows (not a second query) — spec §29's "major positive wins" /
   * "major operational deterioration" at the coarse attendance-comparison level. Null
   * when fewer than 2 branches have data (no meaningful comparison). */
  bestPerformingBranch: { branchId: string; branchName: string; attendancePct: number } | null;
  worstPerformingBranch: { branchId: string; branchName: string; attendancePct: number } | null;
  topActions: TopBusinessAction[];
  hiringAttrition: HiringAttritionRollup;
  sourceHealth: SourceHealth[];
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function scopeClause(scope: ExecutiveRollupScope, branchCol: string, processCol: string): { sql: string; params: string[] } {
  const conditions: string[] = [];
  const params: string[] = [];
  if (scope.branchIds.length > 0) {
    conditions.push(`${branchCol} IN (${scope.branchIds.map(() => "?").join(",")})`);
    params.push(...scope.branchIds);
  }
  if (scope.processIds.length > 0) {
    conditions.push(`${processCol} IN (${scope.processIds.map(() => "?").join(",")})`);
    params.push(...scope.processIds);
  }
  return conditions.length > 0 ? { sql: `AND ${conditions.join(" AND ")}`, params } : { sql: "", params: [] };
}

function emptyOrgAttendance(): OrgAttendanceRollup {
  return { present: 0, halfDay: 0, absent: 0, missingPunch: 0, lateCount: 0, expectedToWork: 0, attendancePct: null };
}

/**
 * Org-wide (or scoped) attendance rollup — ONE row, aggregated with SUM/COUNT across
 * every in-scope employee's D-1 attendance_daily_record row. No per-employee fetch.
 */
async function buildOrgAttendance(
  scope: ExecutiveRollupScope,
  businessDate: string,
): Promise<{ rollup: OrgAttendanceRollup; health: SourceHealth }> {
  const clause = scopeClause(scope, "e.branch_id", "e.process_id");
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total,
         ${expectedToWorkSql("adr.attendance_status")} AS expected_to_work,
         ${presentSql("adr.attendance_status")} AS present,
         ${attendedDaysSql("adr.attendance_status")} AS attended_days,
         SUM(adr.attendance_status = '${HALF_DAY_STATUS}') AS half_day,
         SUM(adr.attendance_status = 'absent') AS absent,
         SUM(adr.attendance_status = 'missing_punch') AS missing_punch,
         SUM(adr.late_mark = 1) AS late_count
       FROM attendance_daily_record adr
       JOIN employees e ON e.id = adr.employee_id AND e.active_status = 1
       WHERE adr.record_date = ?
         ${clause.sql}`,
      [businessDate, ...clause.params],
    );
    const row = rows[0] ?? {};
    const expectedToWork = numberValue(row.expected_to_work);
    const attendedDays = numberValue(row.attended_days);
    const rollup: OrgAttendanceRollup = {
      present: numberValue(row.present),
      halfDay: numberValue(row.half_day),
      absent: numberValue(row.absent),
      missingPunch: numberValue(row.missing_punch),
      lateCount: numberValue(row.late_count),
      expectedToWork,
      attendancePct: expectedToWork > 0 ? Number(((attendedDays / expectedToWork) * 100).toFixed(2)) : null,
    };
    const total = numberValue(row.total);
    return {
      rollup,
      health: { module: "executive_org_attendance", state: total > 0 ? "AVAILABLE" : "NO_DATA", asOfDate: businessDate },
    };
  } catch (err) {
    return {
      rollup: emptyOrgAttendance(),
      health: {
        module: "executive_org_attendance",
        state: "ERROR",
        detail: `Org attendance rollup query failed: ${err instanceof Error ? err.message : String(err)}`,
        asOfDate: businessDate,
      },
    };
  }
}

/**
 * Branch-level attendance comparison — one row per branch, GROUP BY e.branch_id. This
 * is the query the "fetch every employee then reduce in JS" trap would have replaced;
 * MySQL does the aggregation, not this module.
 */
async function buildBranchAttendance(
  scope: ExecutiveRollupScope,
  businessDate: string,
): Promise<{ rows: BranchAttendanceRollupRow[]; health: SourceHealth }> {
  const clause = scopeClause(scope, "e.branch_id", "e.process_id");
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         e.branch_id AS branch_id,
         COALESCE(bm.branch_name, 'Unassigned') AS branch_name,
         ${expectedToWorkSql("adr.attendance_status")} AS expected_to_work,
         ${presentSql("adr.attendance_status")} AS present,
         ${attendedDaysSql("adr.attendance_status")} AS attended_days,
         SUM(adr.attendance_status = '${HALF_DAY_STATUS}') AS half_day,
         SUM(adr.attendance_status = 'absent') AS absent,
         SUM(adr.attendance_status = 'missing_punch') AS missing_punch,
         SUM(adr.late_mark = 1) AS late_count
       FROM attendance_daily_record adr
       JOIN employees e ON e.id = adr.employee_id AND e.active_status = 1
       LEFT JOIN branch_master bm ON bm.id = e.branch_id
       WHERE adr.record_date = ?
         AND e.branch_id IS NOT NULL
         ${clause.sql}
       GROUP BY e.branch_id, bm.branch_name
       ORDER BY branch_name
       LIMIT ${EXECUTIVE_ROLLUP_MAX_BRANCH_ROWS}`,
      [businessDate, ...clause.params],
    );
    const branchRows: BranchAttendanceRollupRow[] = (rows as RowDataPacket[]).map((r) => {
      const expectedToWork = numberValue(r.expected_to_work);
      const attendedDays = numberValue(r.attended_days);
      return {
        branchId: String(r.branch_id),
        branchName: String(r.branch_name),
        present: numberValue(r.present),
        halfDay: numberValue(r.half_day),
        absent: numberValue(r.absent),
        missingPunch: numberValue(r.missing_punch),
        lateCount: numberValue(r.late_count),
        expectedToWork,
        attendancePct: expectedToWork > 0 ? Number(((attendedDays / expectedToWork) * 100).toFixed(2)) : null,
      };
    });
    return {
      rows: branchRows,
      health: { module: "executive_branch_attendance", state: branchRows.length > 0 ? "AVAILABLE" : "NO_DATA", asOfDate: businessDate },
    };
  } catch (err) {
    return {
      rows: [],
      health: {
        module: "executive_branch_attendance",
        state: "ERROR",
        detail: `Branch attendance rollup query failed: ${err instanceof Error ? err.message : String(err)}`,
        asOfDate: businessDate,
      },
    };
  }
}

/**
 * Top-N highest-severity open business actions, org-wide (or scoped) — reuses the same
 * business_action_queue table and open-status convention the aggregator's per-employee
 * `buildPayrollReadinessSignal` already reads from, at whole-queue scale instead of a
 * single COUNT. No employee/branch scoping column exists on business_action_queue
 * itself (verified against sql/264_business_action_queue.sql — it carries owner_user_id/
 * owner_role, not branch_id/process_id), so a branch/process scope narrows nothing here;
 * an org-wide/HQ recipient's rollup always sees the true org-wide top actions, which
 * matches spec §29's "high-severity business actions" being an org-level signal.
 */
async function buildTopActions(businessDate: string): Promise<{ actions: TopBusinessAction[]; health: SourceHealth }> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, title, risk_type, severity, status, due_date
         FROM business_action_queue
        WHERE status NOT IN ('completed', 'cancelled', 'closed')
        ORDER BY FIELD(severity, 'critical', 'high', 'medium', 'low'), due_date IS NULL, due_date ASC, created_at DESC
        LIMIT ${EXECUTIVE_ROLLUP_TOP_ACTIONS}`,
    );
    const actions: TopBusinessAction[] = (rows as RowDataPacket[]).map((r) => ({
      id: String(r.id),
      title: String(r.title),
      riskType: String(r.risk_type),
      severity: r.severity as TopBusinessAction["severity"],
      status: String(r.status),
      dueDate: r.due_date ? String(r.due_date) : null,
    }));
    return {
      actions,
      health: { module: "executive_top_actions", state: actions.length > 0 ? "AVAILABLE" : "NO_DATA", asOfDate: businessDate },
    };
  } catch (err) {
    return {
      actions: [],
      health: {
        module: "executive_top_actions",
        state: "ERROR",
        detail: `Top business-actions query failed: ${err instanceof Error ? err.message : String(err)}`,
        asOfDate: businessDate,
      },
    };
  }
}

/**
 * Hiring/attrition org-wide summary — reuses the same table/status/threshold
 * conventions daily-brief-recruitment.module.ts and daily-brief-exit.module.ts already
 * established (ats_candidate_stage_log, ats_interview... no — this module deliberately
 * keeps to the SAME counting logic those two modules use for their team/hr-scoped
 * counterparts (stage moves, offer approvals pending via work_item, joining window,
 * resignation submissions, open exit requests, upcoming LWD), just without a
 * teamEmployeeIds/recruiter-roster join — org-wide is the natural "no scope filter"
 * case those modules already support via `hrScope: true`. Written as direct scalar
 * aggregates here (not by calling buildRecruitmentModule/buildExitModule with
 * hrScope:true) so this module owns its own single round-trip query per concern and
 * stays independent of those modules' team-scoping code paths, per the prompt's
 * instruction to reuse the COUNTING LOGIC at GROUP BY/org scale, not the modules
 * themselves.
 */
async function buildHiringAttrition(businessDate: string): Promise<{ rollup: HiringAttritionRollup; health: SourceHealth }> {
  try {
    const [recruitmentRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         (SELECT COUNT(*) FROM ats_candidate_stage_log sl WHERE DATE(sl.stage_date) = ?) AS moved_d1,
         (SELECT COUNT(*) FROM work_item wi WHERE wi.item_type = 'OFFER_APPROVAL_PENDING' AND wi.status NOT IN ('completed','cancelled')) AS offer_approvals_pending,
         (SELECT COUNT(*) FROM ats_onboarding_bridge ob WHERE ob.joining_date = CURDATE() AND ob.status NOT IN ('joined','employee_created')) AS joining_today,
         (SELECT COUNT(*) FROM ats_onboarding_bridge ob WHERE ob.joining_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 6 DAY) AND ob.status NOT IN ('joined','employee_created')) AS joining_this_week`,
      [businessDate],
    );
    const [exitRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         SUM(DATE(COALESCE(er.submitted_at, er.created_at)) = ?) AS resignations_d1,
         SUM(er.status NOT IN ('exited','exit_confirmed','revoked','rejected')) AS open_exit_requests,
         SUM(er.status NOT IN ('exited','exit_confirmed','revoked','rejected')
             AND COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed) BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)) AS upcoming_lwd_7d
         FROM exit_request er`,
      [businessDate],
    );
    const rec = recruitmentRows[0] ?? {};
    const exit = exitRows[0] ?? {};
    const rollup: HiringAttritionRollup = {
      candidatesMovedD1: numberValue(rec.moved_d1),
      offerApprovalsPending: numberValue(rec.offer_approvals_pending),
      joiningToday: numberValue(rec.joining_today),
      joiningThisWeek: numberValue(rec.joining_this_week),
      resignationsSubmittedD1: numberValue(exit.resignations_d1),
      openExitRequests: numberValue(exit.open_exit_requests),
      upcomingLwdNext7Days: numberValue(exit.upcoming_lwd_7d),
    };
    return {
      rollup,
      health: { module: "executive_hiring_attrition", state: "AVAILABLE", asOfDate: businessDate },
    };
  } catch (err) {
    return {
      rollup: {
        candidatesMovedD1: 0, offerApprovalsPending: 0, joiningToday: 0, joiningThisWeek: 0,
        resignationsSubmittedD1: 0, openExitRequests: 0, upcomingLwdNext7Days: 0,
      },
      health: {
        module: "executive_hiring_attrition",
        state: "ERROR",
        detail: `Hiring/attrition rollup query failed: ${err instanceof Error ? err.message : String(err)}`,
        asOfDate: businessDate,
      },
    };
  }
}

export async function buildExecutiveRollupModule(
  scope: ExecutiveRollupScope,
  businessDate: string,
): Promise<ExecutiveRollupModuleResult> {
  const [orgAttendanceResult, branchAttendanceResult, topActionsResult, hiringAttritionResult] = await Promise.all([
    buildOrgAttendance(scope, businessDate),
    buildBranchAttendance(scope, businessDate),
    buildTopActions(businessDate),
    buildHiringAttrition(businessDate),
  ]);

  const withData = branchAttendanceResult.rows.filter((r) => r.attendancePct != null);
  let bestPerformingBranch: ExecutiveRollupModuleResult["bestPerformingBranch"] = null;
  let worstPerformingBranch: ExecutiveRollupModuleResult["worstPerformingBranch"] = null;
  if (withData.length >= 2) {
    const sorted = [...withData].sort((a, b) => (b.attendancePct as number) - (a.attendancePct as number));
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    bestPerformingBranch = { branchId: best.branchId, branchName: best.branchName, attendancePct: best.attendancePct as number };
    worstPerformingBranch = { branchId: worst.branchId, branchName: worst.branchName, attendancePct: worst.attendancePct as number };
  }

  return {
    scope,
    isOrgWide: scope.branchIds.length === 0 && scope.processIds.length === 0,
    orgAttendance: orgAttendanceResult.rollup,
    branchAttendance: branchAttendanceResult.rows,
    bestPerformingBranch,
    worstPerformingBranch,
    topActions: topActionsResult.actions,
    hiringAttrition: hiringAttritionResult.rollup,
    sourceHealth: [
      orgAttendanceResult.health,
      branchAttendanceResult.health,
      topActionsResult.health,
      hiringAttritionResult.health,
    ],
  };
}

// Exported for the exclusion-list unit test that pins this module to the shared vocabulary.
export const _EXPECTED_TO_WORK_EXCLUSIONS_FOR_TEST = EXPECTED_TO_WORK_EXCLUSIONS;
