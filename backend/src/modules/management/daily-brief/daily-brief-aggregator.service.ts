/**
 * Builds the ManagerDailyBrief payload for one resolved recipient + one D-1 business date.
 *
 * INTEGRATION PASS (this file): wires the eleven independently-built domain modules
 * (daily-brief-kpi/-quality/-positive-signals/-roster/-people-risk/-helpdesk/
 * -recruitment/-exit/-training/-payroll/-dedup) into the original MVP payload built
 * here. Every module call below is wrapped so a single module's failure (whether it
 * fails closed internally with its own SourceHealth = ERROR, or throws unexpectedly)
 * produces an ERROR sourceHealth entry for that module only — the rest of the brief
 * is never taken down with it. See hrms2-silent-failure-patterns memory, the exact
 * defect class this guards against.
 *
 * PAYROLL SECURITY GATE (spec §22 — the security-critical rule of this integration
 * pass): `buildPayrollReadinessModule` (daily-brief-payroll.module.ts) — the ONLY
 * function anywhere in this feature allowed to read `salary_prep_run` — is invoked
 * IF AND ONLY IF `hasRole(userId, ...PAYROLL_ROLES)` resolves true, verified directly
 * in this file, not merely inferred from the role-modules matrix's `payroll: "readiness"`
 * setting (that setting expresses INTENT; this hasRole() call is the actual gate).
 * Every other recipient — including one whose merged role config happens to include
 * `payroll: "readiness"` from an unentitled row — gets `buildPayrollOperationalHint`
 * instead, which never references `salary_prep_run` at all. See
 * __tests__/daily-brief-payroll-security.integration.test.ts for the hard assertion
 * (JSON-serialize the payload, grep for forbidden field names) that a non-payroll
 * recipient's payload never carries payroll-run-detail shaped data.
 *
 * Grievance data is deliberately NOT included anywhere in this file — out of scope for
 * this MVP pass per the governing spec (confidentiality complexity).
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import { hasRole } from "../../../shared/accessGuard.js";
import { PAYROLL_ROLES } from "../../../platform/policy/roles.js";
import {
  EXPECTED_TO_WORK_EXCLUSIONS,
  HALF_DAY_STATUS,
  attendedDaysSql,
  expectedToWorkSql,
  presentSql,
} from "../../../shared/attendanceStatus.js";
import type {
  AttendanceSummary,
  BriefAction,
  BriefSignal,
  CappedList,
  HygieneIssue,
  ManagerDailyBrief,
  RecipientInfo,
  SourceHealth,
} from "./daily-brief.types.js";
import {
  resolveModulesForRoles,
  canonicalRoleForModuleGating,
  type RoleModuleConfig,
} from "./daily-brief-role-modules.js";
import { dedupeSignals, rankSignals } from "./daily-brief-dedup.js";
import {
  buildKpiPerformanceModule,
  type KpiPerformanceModuleResult,
} from "./daily-brief-kpi.module.js";
import { buildQualityModule, type QualityModuleResult } from "./daily-brief-quality.module.js";
import {
  buildPositiveSignals,
  buildOperationalPositiveSignals,
} from "./daily-brief-positive-signals.module.js";
import { buildRosterModule, type RosterModuleResult, type RosterScopeIds } from "./daily-brief-roster.module.js";
import { buildPeopleRiskModule, type PeopleRiskModuleResult } from "./daily-brief-people-risk.module.js";
import { buildHelpdeskModule, type HelpdeskModuleResult } from "./daily-brief-helpdesk.module.js";
import {
  buildRecruitmentModule,
  type RecruitmentModuleResult,
} from "./daily-brief-recruitment.module.js";
import { buildExitModule, type ExitModuleResult } from "./daily-brief-exit.module.js";
import { buildTrainingModule, type TrainingModuleResult } from "./daily-brief-training.module.js";
import {
  buildPayrollOperationalHint,
  buildPayrollReadinessModule,
  type PayrollReadinessModuleResult,
} from "./daily-brief-payroll.module.js";
import {
  BRIEF_CAP_ACTIONS_TOP,
  BRIEF_CAP_ATTENTION_MAX,
  BRIEF_CAP_HYGIENE_TOP,
  BRIEF_CAP_PERFORMANCE_EXCEPTIONS_TOP,
  BRIEF_CAP_POSITIVES_MAX,
} from "./daily-brief-editorial-constants.js";
import {
  buildExecutiveRollupModule,
  type ExecutiveRollupModuleResult,
} from "./daily-brief-executive-rollup.module.js";

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function emptyAttendance(businessDate: string): AttendanceSummary {
  return {
    recordDate: businessDate,
    present: 0,
    halfDay: 0,
    absent: 0,
    missingPunch: 0,
    lateCount: 0,
    expectedToWork: 0,
    attendancePct: null,
  };
}

async function buildAttendanceSummary(
  teamEmployeeIds: string[],
  businessDate: string,
): Promise<{ summary: AttendanceSummary; health: SourceHealth }> {
  if (teamEmployeeIds.length === 0) {
    return {
      summary: emptyAttendance(businessDate),
      health: { module: "attendance", state: "NOT_APPLICABLE", detail: "No team members in scope", asOfDate: businessDate },
    };
  }
  const placeholders = teamEmployeeIds.map(() => "?").join(",");
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
       WHERE adr.record_date = ? AND adr.employee_id IN (${placeholders})`,
      [businessDate, ...teamEmployeeIds],
    );
    const row = rows[0] ?? {};
    const expectedToWork = numberValue(row.expected_to_work);
    const attendedDays = numberValue(row.attended_days);
    const summary: AttendanceSummary = {
      recordDate: businessDate,
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
      summary,
      health: {
        module: "attendance",
        state: total > 0 ? "AVAILABLE" : "NO_DATA",
        asOfDate: businessDate,
      },
    };
  } catch (err) {
    return {
      summary: emptyAttendance(businessDate),
      health: {
        module: "attendance",
        state: "ERROR",
        detail: `Attendance query failed: ${err instanceof Error ? err.message : String(err)}`,
        asOfDate: businessDate,
      },
    };
  }
}

async function buildHygieneIssues(
  teamEmployeeIds: string[],
  businessDate: string,
): Promise<{ issues: HygieneIssue[]; health: SourceHealth }> {
  if (teamEmployeeIds.length === 0) {
    return {
      issues: [],
      health: { module: "hygiene", state: "NOT_APPLICABLE", detail: "No team members in scope", asOfDate: businessDate },
    };
  }
  const placeholders = teamEmployeeIds.map(() => "?").join(",");
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, employee_code, issue_type, severity, DATE_FORMAT(issue_date, '%Y-%m-%d') AS issue_date
         FROM attendance_reconciliation_issue
        WHERE issue_date = ?
          AND employee_id IN (${placeholders})
          AND resolved_at IS NULL
        ORDER BY FIELD(severity, 'blocker', 'warning'), issue_date DESC
        LIMIT 10`,
      [businessDate, ...teamEmployeeIds],
    );
    const issues: HygieneIssue[] = (rows as RowDataPacket[]).map((r) => ({
      id: String(r.id),
      employeeCode: r.employee_code ? String(r.employee_code) : null,
      issueType: String(r.issue_type),
      severity: r.severity as "blocker" | "warning",
      issueDate: String(r.issue_date),
    }));
    return {
      issues,
      health: { module: "hygiene", state: issues.length > 0 ? "AVAILABLE" : "NO_DATA", asOfDate: businessDate },
    };
  } catch (err) {
    return {
      issues: [],
      health: {
        module: "hygiene",
        state: "ERROR",
        detail: `Hygiene/discipline query failed: ${err instanceof Error ? err.message : String(err)}`,
        asOfDate: businessDate,
      },
    };
  }
}

/**
 * "Your Priorities Today" — sourced from `work_item`, scoped to the recipient's team.
 *
 * DEVIATION FROM PROMPT: work-inbox.service.ts's exported `getTeamWorkItems(userId)`
 * scopes by the CALLER's own branch_id, not by an explicit employee-id list — it would
 * not correctly scope a team_leader/manager's TEAM_ONLY (direct/indirect reports) team,
 * which can cross branches. `getMyWorkItems`'s DERIVED_REGISTRY_UNION_SQL fragment is
 * not exported. So this mirrors the shape of the `work_item` arm of getMyWorkItems
 * (same status/priority normalization) against the resolved team-employee-id list
 * instead, which is the correct scope for this feature.
 */
async function buildPriorityActions(
  teamEmployeeIds: string[],
): Promise<{ actions: BriefAction[]; health: SourceHealth }> {
  if (teamEmployeeIds.length === 0) {
    return {
      actions: [],
      health: { module: "actions", state: "NOT_APPLICABLE", detail: "No team members in scope" },
    };
  }
  const placeholders = teamEmployeeIds.map(() => "?").join(",");
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT wi.id, wi.title,
              CASE WHEN wi.priority = 'urgent' THEN 'critical' ELSE wi.priority END AS priority,
              wi.due_at
         FROM work_item wi
         JOIN employees e ON e.user_id = wi.assigned_to_user_id
        WHERE e.id IN (${placeholders})
          AND wi.status NOT IN ('completed', 'cancelled')
        ORDER BY FIELD(priority, 'critical', 'high', 'medium', 'low'),
                 wi.due_at IS NULL, wi.due_at ASC, wi.created_at DESC
        LIMIT 10`,
      teamEmployeeIds,
    );
    const actions: BriefAction[] = (rows as RowDataPacket[]).map((r) => ({
      id: String(r.id),
      title: String(r.title),
      priority: (r.priority ?? "medium") as BriefAction["priority"],
      dueAt: r.due_at ? String(r.due_at) : null,
      sourceTable: "work_item",
    }));
    return {
      actions,
      health: { module: "actions", state: actions.length > 0 ? "AVAILABLE" : "NO_DATA" },
    };
  } catch (err) {
    return {
      actions: [],
      health: {
        module: "actions",
        state: "ERROR",
        detail: `Work-inbox query failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
}

/**
 * Payroll readiness signal (MVP shape, unchanged by this integration pass). Only
 * populated for recipients who hold a PAYROLL_ROLES role. Title/count only — no
 * monetary values, per CLAUDE.md's payroll-safety rules and the governing spec for
 * this feature.
 */
async function buildPayrollReadinessSignal(
  userId: string,
): Promise<{ signal: BriefSignal | null; health: SourceHealth }> {
  const payrollEligible = await hasRole(userId, ...(PAYROLL_ROLES as string[]));
  if (!payrollEligible) {
    return { signal: null, health: { module: "payroll_readiness", state: "NOT_APPLICABLE" } };
  }
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS open_count
         FROM business_action_queue
        WHERE risk_type = 'payroll_readiness'
          AND status NOT IN ('completed', 'cancelled')`,
    );
    const openCount = numberValue(rows[0]?.open_count);
    return {
      signal: { key: "payroll_readiness", label: "Open payroll readiness items", value: openCount, unit: "count" },
      health: { module: "payroll_readiness", state: openCount > 0 ? "AVAILABLE" : "NO_DATA" },
    };
  } catch (err) {
    return {
      signal: null,
      health: {
        module: "payroll_readiness",
        state: "ERROR",
        detail: `Payroll readiness query failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Integration-pass module orchestration
// ---------------------------------------------------------------------------

/** Runs `fn`, converting an unexpected throw into an ERROR-state result instead of
 * letting it propagate — the defense-in-depth layer spec'd for this pass on TOP of
 * each module's own internal try/catch (which already fails closed for query errors;
 * this catches anything else, e.g. a programming error in the module itself). */
async function safeModule<T>(
  moduleName: string,
  fn: () => Promise<T>,
): Promise<{ value: T | null; crashHealth: SourceHealth | null }> {
  try {
    const value = await fn();
    return { value, crashHealth: null };
  } catch (err) {
    return {
      value: null,
      crashHealth: {
        module: moduleName,
        state: "ERROR",
        detail: `Module crashed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
}

function emptyKpiResult(): KpiPerformanceModuleResult {
  return {
    employeeSignals: [],
    performanceAlerts: { unacknowledgedCount: 0, items: [] },
    coaching: { dueOrOverdueCount: 0, completedD1Count: 0, dueOrOverdue: [], completedD1: [] },
    trainingNeeds: { openedD1Count: 0, resolvedD1Count: 0, openedD1: [], resolvedD1: [] },
    sourceHealth: [],
  };
}

function emptyQualityResult(): QualityModuleResult {
  return {
    detailLevel: "summary",
    teamSize: 0,
    auditedEmployeeCount: 0,
    auditCoveragePct: null,
    avgQualityPct: null,
    scoredCallCount: 0,
    topPerformers: [],
    trailingBaseline: null,
    deterioration: null,
    parameterFailRates: null,
    sourceHealth: [],
  };
}

interface RosterPayrollScope {
  branchIds: string[];
  processIds: string[];
}

/**
 * Best-effort branch/process scope for the roster and payroll-readiness modules,
 * derived from the recipient's own employee row plus the distinct process_id values
 * among their team. Neither module is spec'd with its own scope-resolution rule, so
 * this is this integration pass's own interpretation, not a discovered convention —
 * flagged in the integration report. A failure here degrades to an empty scope
 * (both modules already treat "no scope" as their own NOT_APPLICABLE, never a crash).
 */
async function resolveRosterPayrollScope(recipient: RecipientInfo): Promise<RosterPayrollScope> {
  try {
    const ids = [recipient.employeeId, ...recipient.teamEmployeeIds];
    if (ids.length === 0) return { branchIds: [], processIds: [] };
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT branch_id, process_id FROM employees WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    const branchIds = new Set<string>();
    const processIds = new Set<string>();
    for (const r of rows as RowDataPacket[]) {
      if (r.branch_id) branchIds.add(String(r.branch_id));
      if (r.process_id) processIds.add(String(r.process_id));
    }
    return { branchIds: Array.from(branchIds), processIds: Array.from(processIds) };
  } catch {
    return { branchIds: [], processIds: [] };
  }
}

function capList<T>(items: T[], max: number): CappedList<T> {
  const totalCount = items.length;
  const capped = items.slice(0, max);
  const remaining = totalCount - capped.length;
  return {
    items: capped,
    totalCount,
    overflowText: remaining > 0 ? `+${remaining} more — View in HRMS` : null,
  };
}

/** Maps a subset of each applicable module's notable exceptions into the shared
 * BriefSignal vocabulary so dedupeSignals()/rankSignals() can operate on them
 * alongside the MVP hygiene/action signals. This selection (which facts become
 * "attention" signals, and their kind/priority) is this integration pass's own
 * judgment call, not a literal transcription of every module field — flagged in
 * the integration report. */
function buildAttentionSignals(params: {
  kpi: KpiPerformanceModuleResult | null;
  quality: QualityModuleResult | null;
  roster: RosterModuleResult | null;
  peopleRisk: PeopleRiskModuleResult | null;
  helpdesk: HelpdeskModuleResult | null;
  recruitment: RecruitmentModuleResult | null;
  exit: ExitModuleResult | null;
  training: TrainingModuleResult | null;
  payrollPendingApprovalsCount: number | null;
}): BriefSignal[] {
  const out: BriefSignal[] = [];

  if (params.kpi) {
    for (const alert of params.kpi.performanceAlerts.items) {
      out.push({
        key: `perf_alert_${alert.id}`,
        label: alert.message ?? `${alert.alertType} performance alert`,
        value: alert.employeeCode ?? alert.fullName ?? 1,
        unit: "text",
        employeeId: alert.employeeId,
        source: "kpi_performance",
        category: alert.alertType,
        priority: alert.severity === "critical" || alert.severity === "high" ? alert.severity : "medium",
        kind: alert.severity === "critical" || alert.severity === "high" ? "business_risk" : "anomaly",
      });
    }
    for (const s of params.kpi.employeeSignals) {
      if (s.observation === "below_min_threshold" || s.observation === "below_target") {
        out.push({
          key: `kpi_${s.employeeId}_${s.metricId}`,
          label: `${s.metricName}: ${s.note}`,
          value: s.d1Value,
          unit: "text",
          employeeId: s.employeeId,
          source: "kpi_performance",
          category: s.observation,
          priority: s.observation === "below_min_threshold" ? "high" : "medium",
          kind: "anomaly",
        });
      }
    }
  }

  if (params.quality?.deterioration?.isMaterial) {
    out.push({
      key: "quality_deterioration",
      label: params.quality.deterioration.note,
      value: params.quality.deterioration.deltaPoints,
      unit: "percent",
      source: "quality",
      category: "quality_deterioration",
      priority: "high",
      kind: "anomaly",
    });
  }

  if (params.roster?.worstSeverity) {
    out.push({
      key: "roster_shortage",
      label: `Roster coverage shortage (${params.roster.worstSeverity})`,
      value: params.roster.uncoveredHc.value,
      unit: "count",
      source: "roster_forecast",
      category: "roster_shortage",
      priority: params.roster.worstSeverity === "critical" ? "critical" : params.roster.worstSeverity === "high" ? "high" : "medium",
      kind: "business_risk",
    });
  }

  if (params.peopleRisk?.severity) {
    out.push({
      key: "people_risk",
      label: params.peopleRisk.countRequiringAttention?.label ?? "People risk",
      value: params.peopleRisk.countRequiringAttention?.value ?? null,
      unit: "count",
      source: "people_risk",
      category: "people_risk",
      priority: params.peopleRisk.severity,
      kind: "business_risk",
      actionUrl: params.peopleRisk.actionLabel ? "/people-risk" : null,
    });
  }

  if (params.helpdesk && params.helpdesk.summary.urgentHighPriorityOpen > 0) {
    out.push({
      key: "helpdesk_urgent",
      label: "Urgent/high-priority helpdesk tickets open",
      value: params.helpdesk.summary.urgentHighPriorityOpen,
      unit: "count",
      source: "helpdesk",
      category: "helpdesk_urgent",
      priority: "high",
      kind: "anomaly",
    });
  }

  if (params.recruitment && numberValue(params.recruitment.candidatesStuckBeyondThreshold?.value) > 0) {
    out.push({
      key: "recruitment_stuck",
      label: params.recruitment.candidatesStuckBeyondThreshold!.label,
      value: params.recruitment.candidatesStuckBeyondThreshold!.value,
      unit: "count",
      source: "recruitment_stage_activity",
      category: "recruitment_stuck",
      priority: "medium",
      kind: "anomaly",
    });
  }

  if (params.exit) {
    const managerPending = numberValue(params.exit.managerDiscussionsPending?.value);
    if (managerPending > 0) {
      out.push({
        key: "exit_manager_discussion",
        label: params.exit.managerDiscussionsPending!.label,
        value: managerPending,
        unit: "count",
        source: "exit_resignations",
        category: "exit_manager_discussion",
        priority: "medium",
        kind: "action",
        actionUrl: "/exit",
      });
    }
  }

  if (params.training && numberValue(params.training.overdueMandatoryTraining?.value) > 0) {
    out.push({
      key: "training_overdue",
      label: params.training.overdueMandatoryTraining!.label,
      value: params.training.overdueMandatoryTraining!.value,
      unit: "count",
      source: "training_progress",
      category: "training_overdue",
      priority: "medium",
      kind: "hygiene",
    });
  }

  if (params.payrollPendingApprovalsCount && params.payrollPendingApprovalsCount > 0) {
    out.push({
      key: "payroll_pending_approvals",
      label: "Payroll run(s) pending finance/CEO sign-off",
      value: params.payrollPendingApprovalsCount,
      unit: "count",
      source: "payroll_readiness_detail",
      category: "payroll_pending_approval",
      priority: "high",
      kind: "action",
      actionUrl: "/payroll",
    });
  }

  return out;
}

export async function buildManagerDailyBrief(
  recipient: RecipientInfo,
  businessDate: string,
  generatedAtIST: string,
): Promise<ManagerDailyBrief> {
  const roles = recipient.allRoles?.length ? recipient.allRoles : [recipient.role];
  const config: RoleModuleConfig = resolveModulesForRoles(roles);
  const gatingRole = canonicalRoleForModuleGating(recipient.role);

  const [attendanceResult, hygieneResult, actionsResult, payrollSignalResult] = await Promise.all([
    buildAttendanceSummary(recipient.teamEmployeeIds, businessDate),
    buildHygieneIssues(recipient.teamEmployeeIds, businessDate),
    buildPriorityActions(recipient.teamEmployeeIds),
    recipient.userId
      ? buildPayrollReadinessSignal(recipient.userId)
      : Promise.resolve<{ signal: BriefSignal | null; health: SourceHealth }>({
          signal: null,
          health: { module: "payroll_readiness", state: "NOT_APPLICABLE" },
        }),
  ]);

  // ---------------------------------------------------------------------------
  // Security gate: hasRole(...PAYROLL_ROLES) is checked HERE, independent of the
  // role-modules matrix's `payroll: "readiness"` setting, and is the ONLY thing
  // that may cause buildPayrollReadinessModule (which reads salary_prep_run) to be
  // invoked. See file header.
  // ---------------------------------------------------------------------------
  const payrollEntitled = recipient.userId
    ? await hasRole(recipient.userId, ...(PAYROLL_ROLES as string[]))
    : false;

  const needsRosterOrPayrollScope = Boolean(config.roster) || payrollEntitled;
  const scopeIds: RosterPayrollScope = needsRosterOrPayrollScope
    ? await resolveRosterPayrollScope(recipient)
    : { branchIds: [], processIds: [] };

  const moduleCalls = await Promise.allSettled([
    config.kpi
      ? safeModule("kpi_performance", () => buildKpiPerformanceModule(recipient.teamEmployeeIds, businessDate))
      : Promise.resolve({ value: null, crashHealth: null }),
    config.quality
      ? safeModule("quality", () => buildQualityModule(recipient.teamEmployeeIds, businessDate, config.quality!))
      : Promise.resolve({ value: null, crashHealth: null }),
    config.roster
      ? safeModule("roster", () => buildRosterModule(scopeIds as RosterScopeIds, businessDate))
      : Promise.resolve({ value: null, crashHealth: null }),
    config.peopleRisk
      ? safeModule("people_risk", () => buildPeopleRiskModule(recipient.teamEmployeeIds, gatingRole, businessDate))
      : Promise.resolve({ value: null, crashHealth: null }),
    config.helpdesk
      ? safeModule("helpdesk", () => buildHelpdeskModule(recipient.teamEmployeeIds, businessDate, config.helpdesk!))
      : Promise.resolve({ value: null, crashHealth: null }),
    config.recruitment
      ? safeModule("recruitment", () =>
          buildRecruitmentModule(
            config.recruitment === "hr"
              ? { hrScope: true }
              : { teamEmployeeIds: [recipient.employeeId, ...recipient.teamEmployeeIds] },
            businessDate,
          ))
      : Promise.resolve({ value: null, crashHealth: null }),
    config.exit
      ? safeModule("exit", () =>
          buildExitModule(
            config.exit === "hr"
              ? { hrScope: true }
              : { teamEmployeeIds: recipient.teamEmployeeIds },
            gatingRole,
            businessDate,
          ))
      : Promise.resolve({ value: null, crashHealth: null }),
    config.training
      ? safeModule("training_progress", () => buildTrainingModule(recipient.teamEmployeeIds, businessDate))
      : Promise.resolve({ value: null, crashHealth: null }),
    payrollEntitled
      ? safeModule("payroll_readiness_detail", () =>
          buildPayrollReadinessModule(recipient.role, scopeIds, businessDate))
      : Promise.resolve({ value: null, crashHealth: null }),
    !payrollEntitled
      ? safeModule("payroll_operational_hint", () =>
          buildPayrollOperationalHint(recipient.teamEmployeeIds, businessDate))
      : Promise.resolve({ value: null, crashHealth: null }),
  ]);

  // Promise.allSettled over already-caught safeModule() results means every entry
  // here is a "fulfilled" settlement carrying either a value or a crashHealth — this
  // unwraps them, treating an unexpected top-level rejection (should not happen given
  // safeModule, but defended anyway) the same way a module-level ERROR would be.
  function unwrap<T>(idx: number, moduleName: string): { value: T | null; crashHealth: SourceHealth | null } {
    const settled = moduleCalls[idx];
    if (settled.status === "fulfilled") return settled.value as { value: T | null; crashHealth: SourceHealth | null };
    return {
      value: null,
      crashHealth: {
        module: moduleName,
        state: "ERROR",
        detail: `Module rejected: ${settled.reason instanceof Error ? settled.reason.message : String(settled.reason)}`,
      },
    };
  }

  const kpiOut = unwrap<KpiPerformanceModuleResult>(0, "kpi_performance");
  const qualityOut = unwrap<QualityModuleResult>(1, "quality");
  const rosterOut = unwrap<RosterModuleResult>(2, "roster");
  const peopleRiskOut = unwrap<PeopleRiskModuleResult>(3, "people_risk");
  const helpdeskOut = unwrap<HelpdeskModuleResult>(4, "helpdesk");
  const recruitmentOut = unwrap<RecruitmentModuleResult>(5, "recruitment");
  const exitOut = unwrap<ExitModuleResult>(6, "exit");
  const trainingOut = unwrap<TrainingModuleResult>(7, "training_progress");
  const payrollDetailOut = unwrap<PayrollReadinessModuleResult>(8, "payroll_readiness_detail");
  const payrollHintOut = unwrap<string | null>(9, "payroll_operational_hint");

  // ---------------------------------------------------------------------------
  // Positives (spec §48: 3-5 ranked genuinely-positive observations)
  // ---------------------------------------------------------------------------
  const positiveCandidates: BriefSignal[] = [
    ...buildPositiveSignals(
      attendanceResult.summary,
      kpiOut.value ?? emptyKpiResult(),
      qualityOut.value ?? emptyQualityResult(),
    ),
    ...buildOperationalPositiveSignals(
      hygieneResult.issues,
      actionsResult.actions,
      recipient.teamEmployeeIds.length,
    ),
  ];
  const positives = positiveCandidates.slice(0, BRIEF_CAP_POSITIVES_MAX);

  // ---------------------------------------------------------------------------
  // Attention (spec §45 dedup+rank, §48 cap 3-5)
  // ---------------------------------------------------------------------------
  const attentionCandidates = buildAttentionSignals({
    kpi: kpiOut.value,
    quality: qualityOut.value,
    roster: rosterOut.value,
    peopleRisk: peopleRiskOut.value,
    helpdesk: helpdeskOut.value,
    recruitment: recruitmentOut.value,
    exit: exitOut.value,
    training: trainingOut.value,
    payrollPendingApprovalsCount: payrollDetailOut.value?.pendingApprovalsCount ?? null,
  });
  const attention = rankSignals(dedupeSignals(attentionCandidates)).slice(0, BRIEF_CAP_ATTENTION_MAX);

  const performanceExceptionsTop5 = capList(
    attentionCandidates.filter((s) => s.source === "kpi_performance" || s.source === "quality"),
    BRIEF_CAP_PERFORMANCE_EXCEPTIONS_TOP,
  );

  const sourceHealth: SourceHealth[] = [
    attendanceResult.health,
    hygieneResult.health,
    actionsResult.health,
    payrollSignalResult.health,
    ...(kpiOut.value?.sourceHealth ?? (kpiOut.crashHealth ? [kpiOut.crashHealth] : [])),
    ...(qualityOut.value?.sourceHealth ?? (qualityOut.crashHealth ? [qualityOut.crashHealth] : [])),
    ...(rosterOut.value?.sourceHealth ?? (rosterOut.crashHealth ? [rosterOut.crashHealth] : [])),
    ...(peopleRiskOut.value ? [peopleRiskOut.value.sourceHealth] : peopleRiskOut.crashHealth ? [peopleRiskOut.crashHealth] : []),
    ...(helpdeskOut.value ? [helpdeskOut.value.sourceHealth] : helpdeskOut.crashHealth ? [helpdeskOut.crashHealth] : []),
    ...(recruitmentOut.value?.sourceHealth ?? (recruitmentOut.crashHealth ? [recruitmentOut.crashHealth] : [])),
    ...(exitOut.value?.sourceHealth ?? (exitOut.crashHealth ? [exitOut.crashHealth] : [])),
    ...(trainingOut.value?.sourceHealth ?? (trainingOut.crashHealth ? [trainingOut.crashHealth] : [])),
    ...(payrollDetailOut.value ? [payrollDetailOut.value.sourceHealth] : payrollDetailOut.crashHealth ? [payrollDetailOut.crashHealth] : []),
    ...(payrollHintOut.crashHealth ? [payrollHintOut.crashHealth] : []),
  ];

  return {
    recipient,
    businessDate,
    generatedAtIST,
    attendance: attendanceResult.summary,
    hygieneIssues: hygieneResult.issues,
    actions: actionsResult.actions,
    payrollReadiness: payrollSignalResult.signal,
    sourceHealth,
    positives,
    attention,
    hygieneTop5: capList(hygieneResult.issues, BRIEF_CAP_HYGIENE_TOP),
    performanceExceptionsTop5,
    actionsTop5: capList(actionsResult.actions, BRIEF_CAP_ACTIONS_TOP),
    modules: {
      kpi: kpiOut.value ?? undefined,
      quality: qualityOut.value ?? undefined,
      roster: rosterOut.value ?? undefined,
      peopleRisk: peopleRiskOut.value ?? undefined,
      helpdesk: helpdeskOut.value ?? undefined,
      recruitment: recruitmentOut.value ?? undefined,
      exit: exitOut.value ?? undefined,
      training: trainingOut.value ?? undefined,
      // SECURITY: payrollReadinessDetail is populated from payrollDetailOut, which is
      // ONLY ever non-null when payrollEntitled was verified true above. A non-payroll
      // recipient's payload can never carry this field.
      payrollReadinessDetail: payrollDetailOut.value ?? undefined,
      payrollOperationalHint: payrollHintOut.value ?? null,
    },
  };
}

// Exported for the exclusion-list unit test that pins this module to the shared vocabulary.
export const _EXPECTED_TO_WORK_EXCLUSIONS_FOR_TEST = EXPECTED_TO_WORK_EXCLUSIONS;

// ---------------------------------------------------------------------------
// Executive rollup path (spec §29) — Gap 2 of this integration pass.
//
// A recipient whose merged role config carries isExecutiveRollup:true (today: ceo,
// admin, super_admin — see daily-brief-role-modules.ts's EXECUTIVE_CONFIG) is NEVER
// routed through buildManagerDailyBrief above. That function's module set is
// per-employee-shaped (kpi/quality/roster/peopleRisk/helpdesk/recruitment/exit/training
// all iterate recipient.teamEmployeeIds), which for an org-wide population of 1000+
// employees is exactly the performance disaster / "50-page email" spec §29 warns
// against. buildExecutiveDailyBrief below is the alternate entrypoint: it calls
// daily-brief-executive-rollup.module.ts's GROUP BY-aggregated queries instead, and
// produces a DELIBERATELY DIFFERENT result shape (ExecutiveDailyBrief, not
// ManagerDailyBrief) — grouped by branch/process, not by employee.
//
// CALLER CONTRACT: daily-brief-dispatch.service.ts's buildDailyBriefForEmployee is the
// single place that decides which of these two entrypoints to call, by checking
// resolveModulesForRoles(recipient.allRoles ?? [recipient.role]).isExecutiveRollup — see
// that file. daily-brief.hbs/.txt.hbs render this shape via a distinct
// buildExecutiveTemplateContext (also in the dispatch service), gated by `{{#if
// rollup}}` blocks that do not exist in the per-employee context, so one template file
// safely serves both payload shapes without cross-contaminating sections.
// ---------------------------------------------------------------------------

export interface ExecutiveDailyBrief {
  mode: "executive_rollup";
  recipient: RecipientInfo;
  businessDate: string;
  generatedAtIST: string;
  rollup: ExecutiveRollupModuleResult;
  /**
   * Only ever populated when hasRole(recipient.userId, ...PAYROLL_ROLES) resolves true
   * — the SAME security gate buildManagerDailyBrief enforces for the per-employee path,
   * re-verified independently here rather than trusted from the role-modules matrix's
   * intent-only `payroll: "readiness"` setting. `ceo` is not a PAYROLL_ROLES member (see
   * daily-brief-role-modules.ts's EXECUTIVE_CONFIG doc) so this is undefined for a `ceo`
   * recipient even though isExecutiveRollup is true for all three executive roles.
   */
  payrollReadinessDetail?: PayrollReadinessModuleResult;
  sourceHealth: SourceHealth[];
}

export async function buildExecutiveDailyBrief(
  recipient: RecipientInfo,
  businessDate: string,
  generatedAtIST: string,
): Promise<ExecutiveDailyBrief> {
  // recipient.scopeDescriptor is populated by daily-brief-recipient.resolver.ts for the
  // executive family as `{branchIds: [], processIds: []}` (org-wide, or the admin's
  // authorized scope in the general case — ceo/admin/super_admin always resolve
  // ORG_ALL today, per dashboardScope.ts's SYSTEM_WIDE_ROLES/HEAD_OFFICE_ROLES
  // short-circuit). Falling back to an explicit org-wide scope defends against a future
  // caller constructing an ExecutiveDailyBrief for a recipient object that didn't go
  // through the resolver (e.g. a hand-built test fixture) — never silently narrows.
  const scope = recipient.scopeDescriptor ?? { branchIds: [], processIds: [] };

  const [rollup, payrollEntitled] = await Promise.all([
    buildExecutiveRollupModule(scope, businessDate),
    recipient.userId ? hasRole(recipient.userId, ...(PAYROLL_ROLES as string[])) : Promise.resolve(false),
  ]);

  let payrollReadinessDetail: PayrollReadinessModuleResult | undefined;
  const sourceHealth: SourceHealth[] = [...rollup.sourceHealth];
  if (payrollEntitled) {
    const { value, crashHealth } = await safeModule("payroll_readiness_detail", () =>
      buildPayrollReadinessModule(recipient.role, scope, businessDate));
    if (value) {
      payrollReadinessDetail = value;
      sourceHealth.push(value.sourceHealth);
    } else if (crashHealth) {
      sourceHealth.push(crashHealth);
    }
  } else {
    sourceHealth.push({
      module: "payroll_readiness_detail",
      state: "NOT_APPLICABLE",
      detail: `Role '${recipient.role}' is not payroll-entitled (see PAYROLL_ROLES) — executive rollup omits payroll detail.`,
      asOfDate: businessDate,
    });
  }

  return {
    mode: "executive_rollup",
    recipient,
    businessDate,
    generatedAtIST,
    rollup,
    payrollReadinessDetail,
    sourceHealth,
  };
}
