/**
 * Exit / Attrition module for the D-1 Daily Manager Briefing Engine.
 *
 * Reuses verified-live tables and columns (confirmed against the live schema and against
 * modules/exit/exit.service.ts / modules/exit/exit-intelligence.service.ts, not guessed):
 *   - exit_request: status, submitted_at, manager_actioned_at, hr_actioned_at,
 *     last_working_day_proposed, last_working_day_confirmed, employee_id.
 *     Live status values (verified in exit.service.ts's own pending_review CASE):
 *     'submitted','manager_review','hr_review','admin_review','accepted','notice_serving',
 *     'exited','exit_confirmed','revoked','rejected'.
 *   - exit_clearance_task: status ('pending','in_progress','cleared','blocked','waived'),
 *     exit_request_id, employee_id, due_date. Completion = status IN ('cleared','waived'),
 *     matching exit-intelligence.service.ts's own cleared_tasks SUM exactly.
 *   - full_final_calculation: exit_request_id, status ('draft'/'approved'/'paid' — verified
 *     in modules/exit/ff.service.ts's createFF/approve/markPaid state machine). Used here only
 *     as a handoff-status signal, never any monetary column (F&F amounts are never surfaced
 *     anywhere in the daily brief, per CLAUDE.md's payroll-safety rules).
 *
 * Role gating: only branch_head/manager/team_leader/tl get their own team's exits
 * (scope.teamEmployeeIds), and only hr/admin/super_admin get the broader scope
 * (scope.hrScope). Every other role gets an explicit NOT_APPLICABLE, empty result — never a
 * silent zero that could be misread as "no exits" for a role never entitled to see this.
 *
 * EDITORIAL DEFAULTS (not sourced from an existing convention — flagged for review):
 *  - "Manager discussion pending" = status = 'manager_review'; "HR discussion pending" =
 *    status = 'hr_review'. These are the live status values themselves (not invented labels),
 *    but no existing UI/service was found naming them "discussion pending" verbatim — that
 *    phrasing is this module's own, matching the prompt's wording.
 *  - "Upcoming LWD" prefers last_working_day_confirmed when set, else
 *    last_working_day_proposed — no existing convention for which field is authoritative once
 *    both exist was found in the code read for this module.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import type { BriefSignal, SourceHealth } from "./daily-brief.types.js";

export interface ExitScope {
  teamEmployeeIds?: string[];
  hrScope?: boolean;
}

export interface ExitModuleResult {
  applicable: boolean;
  resignationsSubmittedD1: BriefSignal | null;
  managerDiscussionsPending: BriefSignal | null;
  hrDiscussionsPending: BriefSignal | null;
  upcomingLwdNext7Days: BriefSignal | null;
  clearancePendingCount: BriefSignal | null;
  clearanceCompletionPct: BriefSignal | null;
  /** F&F handoff status breakdown (draft/approved/paid), scoped to open exits in scope. Null if not applicable. */
  ffHandoffStatus: BriefSignal[] | null;
  sourceHealth: SourceHealth[];
}

const TEAM_ROLES = new Set(["branch_head", "manager", "team_leader", "tl"]);
const HR_ROLES = new Set(["hr", "admin", "super_admin"]);

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

type ScopeMode = "team" | "hr" | "none";

/**
 * The `role` param governs eligibility; `scope` supplies the actual id list. A team-eligible
 * role with no teamEmployeeIds, or an hr-eligible role without hrScope set, still resolves to
 * "none" (NOT_APPLICABLE with a clear reason) rather than silently falling through to an
 * unscoped query.
 */
function resolveScopeMode(scope: ExitScope, recipientRole: string): ScopeMode {
  const role = recipientRole.trim().toLowerCase();
  if (TEAM_ROLES.has(role)) {
    return scope.teamEmployeeIds?.length ? "team" : "none";
  }
  if (HR_ROLES.has(role)) {
    return scope.hrScope ? "hr" : "none";
  }
  return "none";
}

function employeeScopeClause(scope: ExitScope, mode: ScopeMode, alias: string): { sql: string; params: unknown[] } {
  if (mode === "team") {
    const placeholders = scope.teamEmployeeIds!.map(() => "?").join(",");
    return { sql: `AND ${alias}.employee_id IN (${placeholders})`, params: [...scope.teamEmployeeIds!] };
  }
  return { sql: "", params: [] };
}

const OPEN_STATUSES_SQL = `er.status NOT IN ('exited','exit_confirmed','revoked','rejected')`;

async function buildResignationAndDiscussionCounts(
  scope: ExitScope,
  mode: ScopeMode,
  reportingDate: string,
): Promise<{
  submittedD1: BriefSignal | null;
  managerPending: BriefSignal | null;
  hrPending: BriefSignal | null;
  health: SourceHealth;
}> {
  if (mode === "none") {
    return {
      submittedD1: null,
      managerPending: null,
      hrPending: null,
      health: { module: "exit_resignations", state: "NOT_APPLICABLE", detail: "Role/scope not eligible for exit visibility", asOfDate: reportingDate },
    };
  }
  const scopeClause = employeeScopeClause(scope, mode, "er");
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         SUM(DATE(COALESCE(er.submitted_at, er.created_at)) = ?) AS submitted_d1,
         SUM(er.status = 'manager_review') AS manager_pending,
         SUM(er.status = 'hr_review') AS hr_pending
         FROM exit_request er
        WHERE 1 = 1
          ${scopeClause.sql}`,
      [reportingDate, ...scopeClause.params],
    );
    const row = rows[0] ?? {};
    return {
      submittedD1: { key: "exit_resignations_submitted_d1", label: "Resignations submitted (D-1)", value: numberValue(row.submitted_d1), unit: "count" },
      managerPending: { key: "exit_manager_discussions_pending", label: "Manager discussions pending", value: numberValue(row.manager_pending), unit: "count" },
      hrPending: { key: "exit_hr_discussions_pending", label: "HR discussions pending", value: numberValue(row.hr_pending), unit: "count" },
      health: { module: "exit_resignations", state: "AVAILABLE", asOfDate: reportingDate },
    };
  } catch (err) {
    return {
      submittedD1: null,
      managerPending: null,
      hrPending: null,
      health: {
        module: "exit_resignations",
        state: "ERROR",
        detail: `Resignation/discussion query failed: ${err instanceof Error ? err.message : String(err)}`,
        asOfDate: reportingDate,
      },
    };
  }
}

async function buildUpcomingLwd(
  scope: ExitScope,
  mode: ScopeMode,
  reportingDate: string,
): Promise<{ upcoming: BriefSignal | null; health: SourceHealth }> {
  if (mode === "none") {
    return {
      upcoming: null,
      health: { module: "exit_upcoming_lwd", state: "NOT_APPLICABLE", detail: "Role/scope not eligible for exit visibility", asOfDate: reportingDate },
    };
  }
  const scopeClause = employeeScopeClause(scope, mode, "er");
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS upcoming_count
         FROM exit_request er
        WHERE ${OPEN_STATUSES_SQL}
          AND COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed) BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
          ${scopeClause.sql}`,
      scopeClause.params,
    );
    return {
      upcoming: { key: "exit_upcoming_lwd_7d", label: "Upcoming last working day (next 7 days)", value: numberValue(rows[0]?.upcoming_count), unit: "count" },
      health: { module: "exit_upcoming_lwd", state: "AVAILABLE", asOfDate: reportingDate },
    };
  } catch (err) {
    return {
      upcoming: null,
      health: {
        module: "exit_upcoming_lwd",
        state: "ERROR",
        detail: `Upcoming-LWD query failed: ${err instanceof Error ? err.message : String(err)}`,
        asOfDate: reportingDate,
      },
    };
  }
}

async function buildClearanceStatus(
  scope: ExitScope,
  mode: ScopeMode,
  reportingDate: string,
): Promise<{ pending: BriefSignal | null; completionPct: BriefSignal | null; health: SourceHealth }> {
  if (mode === "none") {
    return {
      pending: null,
      completionPct: null,
      health: { module: "exit_clearance", state: "NOT_APPLICABLE", detail: "Role/scope not eligible for exit visibility", asOfDate: reportingDate },
    };
  }
  // exit_clearance_task carries its own employee_id (denormalized off exit_request), so the
  // same employeeScopeClause helper applies directly against alias "ect" without joining back
  // through exit_request — matching how exit-intelligence.service.ts's own queries read this
  // table (LEFT JOIN exit_employee_health_snapshot hs ON hs.exit_request_id = er.id and
  // similar patterns keep employee_id on the child table itself).
  const scopeClause = employeeScopeClause(scope, mode, "ect");
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total_tasks,
         SUM(ect.status IN ('cleared','waived')) AS cleared_tasks,
         SUM(ect.status NOT IN ('cleared','waived')) AS pending_tasks
         FROM exit_clearance_task ect
         JOIN exit_request er ON er.id = ect.exit_request_id
        WHERE ${OPEN_STATUSES_SQL}
          ${scopeClause.sql}`,
      scopeClause.params,
    );
    const row = rows[0] ?? {};
    const total = numberValue(row.total_tasks);
    const cleared = numberValue(row.cleared_tasks);
    const pct = total > 0 ? Number(((cleared / total) * 100).toFixed(2)) : null;
    return {
      pending: { key: "exit_clearance_pending", label: "Clearance tasks pending", value: numberValue(row.pending_tasks), unit: "count" },
      completionPct: { key: "exit_clearance_completion_pct", label: "Clearance completion", value: pct, unit: "percent" },
      health: { module: "exit_clearance", state: total > 0 ? "AVAILABLE" : "NO_DATA", asOfDate: reportingDate },
    };
  } catch (err) {
    return {
      pending: null,
      completionPct: null,
      health: {
        module: "exit_clearance",
        state: "ERROR",
        detail: `Clearance query failed: ${err instanceof Error ? err.message : String(err)}`,
        asOfDate: reportingDate,
      },
    };
  }
}

async function buildFfHandoffStatus(
  scope: ExitScope,
  mode: ScopeMode,
  reportingDate: string,
): Promise<{ statuses: BriefSignal[] | null; health: SourceHealth }> {
  if (mode === "none") {
    return {
      statuses: null,
      health: { module: "exit_ff_handoff", state: "NOT_APPLICABLE", detail: "Role/scope not eligible for exit visibility", asOfDate: reportingDate },
    };
  }
  const scopeClause = employeeScopeClause(scope, mode, "er");
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(ff.status, 'not_started') AS ff_status, COUNT(*) AS cnt
         FROM exit_request er
         LEFT JOIN full_final_calculation ff ON ff.exit_request_id = er.id
        WHERE ${OPEN_STATUSES_SQL}
          ${scopeClause.sql}
        GROUP BY COALESCE(ff.status, 'not_started')`,
      scopeClause.params,
    );
    const statuses: BriefSignal[] = (rows as RowDataPacket[]).map((r) => ({
      key: `exit_ff_handoff_${String(r.ff_status)}`,
      label: `F&F ${String(r.ff_status).replace(/_/g, " ")}`,
      value: numberValue(r.cnt),
      unit: "count" as const,
    }));
    return {
      statuses,
      health: { module: "exit_ff_handoff", state: statuses.length > 0 ? "AVAILABLE" : "NO_DATA", asOfDate: reportingDate },
    };
  } catch (err) {
    return {
      statuses: null,
      health: {
        module: "exit_ff_handoff",
        state: "ERROR",
        detail: `F&F handoff query failed: ${err instanceof Error ? err.message : String(err)}`,
        asOfDate: reportingDate,
      },
    };
  }
}

export async function buildExitModule(
  scope: ExitScope,
  recipientRole: string,
  reportingDate: string,
): Promise<ExitModuleResult> {
  const mode = resolveScopeMode(scope, recipientRole);

  const [resignationResult, lwdResult, clearanceResult, ffResult] = await Promise.all([
    buildResignationAndDiscussionCounts(scope, mode, reportingDate),
    buildUpcomingLwd(scope, mode, reportingDate),
    buildClearanceStatus(scope, mode, reportingDate),
    buildFfHandoffStatus(scope, mode, reportingDate),
  ]);

  return {
    applicable: mode !== "none",
    resignationsSubmittedD1: resignationResult.submittedD1,
    managerDiscussionsPending: resignationResult.managerPending,
    hrDiscussionsPending: resignationResult.hrPending,
    upcomingLwdNext7Days: lwdResult.upcoming,
    clearancePendingCount: clearanceResult.pending,
    clearanceCompletionPct: clearanceResult.completionPct,
    ffHandoffStatus: ffResult.statuses,
    sourceHealth: [resignationResult.health, lwdResult.health, clearanceResult.health, ffResult.health],
  };
}
