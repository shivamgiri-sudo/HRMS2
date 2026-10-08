/**
 * Recruitment / Onboarding module for the D-1 Daily Manager Briefing Engine.
 *
 * Reuses `ats_candidate` via `excludeEmployeeShapedCandidatesSql` (modules/ats/ats-reporting-scope.ts)
 * on every ats_candidate query in this file — verified live: ats_candidate.record_type = 'candidate'
 * excludes the 29,926 legacy-imported employee-shaped rows that would otherwise inflate every count
 * here by roughly 4x (see ats-reporting-scope.ts's own header for the verification detail).
 *
 * Reuses the Action Centre / work-inbox item types already registered in
 * modules/work-inbox/action-item-registry.ts and populated by modules/work-inbox/work-inbox.triggers.ts
 * rather than re-deriving "pending" business logic:
 *   - ONBOARDING_STUCK       (entity_type='candidate', entity_id=candidate.id)
 *   - BGV_PENDING            (entity_type='candidate', entity_id=candidate.id)
 *   - OFFER_APPROVAL_PENDING (entity_type='candidate', entity_id=candidate.id)
 *   - JOINING_DOCS_INCOMPLETE (entity_type='employee', entity_id=employee.id — verified live in
 *     modules/work-inbox/work-inbox.triggers.ts's triggerJoiningDocsIncomplete)
 *
 * The "stuck beyond threshold" definition is reused verbatim from the existing, live
 * runOnboardingIncompleteReminders() job in modules/ats/ats-reminders.cron.ts (the job that
 * actually calls triggerOnboardingStuck): candidates in current_stage IN ('Selected','Offered')
 * whose ats_onboarding_bridge.status is NOT IN ('joined','documents_complete','employee_created'),
 * with a live onboarding token, and DATEDIFF(NOW(), ob.created_at) >= 3 (three days, not the 48
 * hours quoted in that trigger's own title text — the cron job's WHERE clause is the actual live
 * threshold and is what is reused here, not the human-readable string).
 *
 * Scope: recruiter/recruitment_hr-style callers pass `teamEmployeeIds` (their own employee id, or
 * a small owned set) and candidates are scoped through `ats_candidate.recruiter_id ->
 * ats_recruiter_roster.employee_id` (verified live: ats_recruiter_roster has an employee_id FK
 * column linking a recruiter roster row to an employees row). Broader HR/recruitment-admin callers
 * pass `hrScope: true` for an unfiltered (org-wide) view. Neither supplied -> NOT_APPLICABLE.
 *
 * EDITORIAL DEFAULTS (not sourced from an existing convention — flagged for review):
 *  - "Interviews scheduled/held D-1" reuses `ats_interview_assignment.interview_date` (the only
 *    live table with a scheduling date + candidate_id + status). "Scheduled D-1" = interview_date
 *    = D-1 (any status). "Held D-1" = interview_date = D-1 AND submitted_at IS NOT NULL (a result
 *    was actually recorded) — no existing convention names a "held" status value, so this is an
 *    inference from `submitted_at` being populated, not a copied rule. Needs product sign-off.
 *  - `ats_candidate.recruiter_id` (not `assigned_recruiter_id`, `preferred_recruiter_id`, or the
 *    free-text `recruiter_assigned_id`) was chosen as the FK into `ats_recruiter_roster.id`
 *    because it is the only char(36) column of that pair matching the roster's own id type. No
 *    single documented source of truth for "which recruiter owns this candidate" was found.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import { excludeEmployeeShapedCandidatesSql } from "../../ats/ats-reporting-scope.js";
import type { BriefSignal, SourceHealth } from "./daily-brief.types.js";
import { RECRUITMENT_STUCK_THRESHOLD_DAYS } from "./daily-brief-editorial-constants.js";

export interface RecruitmentScope {
  teamEmployeeIds?: string[];
  hrScope?: boolean;
}

export interface RecruitmentModuleResult {
  applicable: boolean;
  candidatesMovedD1: BriefSignal | null;
  interviewsScheduledD1: BriefSignal | null;
  interviewsHeldD1: BriefSignal | null;
  pendingOfferApprovals: BriefSignal | null;
  bgvPending: BriefSignal | null;
  documentsPending: BriefSignal | null;
  onboardingPending: BriefSignal | null;
  joiningToday: BriefSignal | null;
  joiningThisWeek: BriefSignal | null;
  candidatesStuckBeyondThreshold: BriefSignal | null;
  sourceHealth: SourceHealth[];
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

type ScopeMode = "hr" | "team" | "none";

function resolveScopeMode(scope: RecruitmentScope): ScopeMode {
  if (scope.hrScope) return "hr";
  if (scope.teamEmployeeIds?.length) return "team";
  return "none";
}

/** Candidate-alias ("c") scope fragment: recruiter-team filter, or none for hrScope. */
function candidateScopeClause(scope: RecruitmentScope, mode: ScopeMode): { sql: string; params: unknown[] } {
  if (mode === "team") {
    const placeholders = scope.teamEmployeeIds!.map(() => "?").join(",");
    return {
      sql: `AND c.recruiter_id IN (SELECT id FROM ats_recruiter_roster WHERE employee_id IN (${placeholders}))`,
      params: [...scope.teamEmployeeIds!],
    };
  }
  return { sql: "", params: [] };
}

async function buildStageActivity(
  scope: RecruitmentScope,
  mode: ScopeMode,
  reportingDate: string,
): Promise<{ movedD1: BriefSignal | null; stuck: BriefSignal | null; health: SourceHealth }> {
  if (mode === "none") {
    return {
      movedD1: null,
      stuck: null,
      health: { module: "recruitment_stage_activity", state: "NOT_APPLICABLE", detail: "No recruiter/HR scope supplied", asOfDate: reportingDate },
    };
  }
  const scopeClause = candidateScopeClause(scope, mode);
  try {
    const [movedRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS moved_count
         FROM ats_candidate_stage_log sl
         JOIN ats_candidate c ON c.id = sl.candidate_id
        WHERE DATE(sl.stage_date) = ?
          AND ${excludeEmployeeShapedCandidatesSql("c")}
          ${scopeClause.sql}`,
      [reportingDate, ...scopeClause.params],
    );

    // Reused verbatim from runOnboardingIncompleteReminders() in ats-reminders.cron.ts —
    // the live query that actually feeds triggerOnboardingStuck(). See file header.
    const [stuckRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS stuck_count
         FROM ats_candidate c
         JOIN ats_onboarding_bridge ob ON ob.candidate_id = c.id
        WHERE c.current_stage IN ('Selected','Offered')
          AND ob.status NOT IN ('joined','documents_complete','employee_created')
          AND COALESCE(c.candidate_status, '') <> 'not_joining'
          AND ob.onboarding_token IS NOT NULL
          AND (ob.onboarding_token_expires_at IS NULL OR ob.onboarding_token_expires_at > NOW())
          AND DATEDIFF(NOW(), ob.created_at) >= ${RECRUITMENT_STUCK_THRESHOLD_DAYS}
          AND ${excludeEmployeeShapedCandidatesSql("c")}
          ${scopeClause.sql}`,
      [...scopeClause.params],
    );

    return {
      movedD1: { key: "recruitment_candidates_moved_d1", label: "Candidates moved (D-1)", value: numberValue(movedRows[0]?.moved_count), unit: "count" },
      stuck: { key: "recruitment_candidates_stuck", label: `Candidates stuck beyond ${RECRUITMENT_STUCK_THRESHOLD_DAYS} days`, value: numberValue(stuckRows[0]?.stuck_count), unit: "count" },
      health: { module: "recruitment_stage_activity", state: "AVAILABLE", asOfDate: reportingDate },
    };
  } catch (err) {
    return {
      movedD1: null,
      stuck: null,
      health: {
        module: "recruitment_stage_activity",
        state: "ERROR",
        detail: `Stage-activity query failed: ${err instanceof Error ? err.message : String(err)}`,
        asOfDate: reportingDate,
      },
    };
  }
}

async function buildInterviews(
  scope: RecruitmentScope,
  mode: ScopeMode,
  reportingDate: string,
): Promise<{ scheduled: BriefSignal | null; held: BriefSignal | null; health: SourceHealth }> {
  if (mode === "none") {
    return {
      scheduled: null,
      held: null,
      health: { module: "recruitment_interviews", state: "NOT_APPLICABLE", detail: "No recruiter/HR scope supplied", asOfDate: reportingDate },
    };
  }
  const scopeClause = candidateScopeClause(scope, mode);
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS scheduled_count,
         SUM(ia.submitted_at IS NOT NULL) AS held_count
         FROM ats_interview_assignment ia
         JOIN ats_candidate c ON c.id = ia.candidate_id
        WHERE ia.interview_date = ?
          AND ${excludeEmployeeShapedCandidatesSql("c")}
          ${scopeClause.sql}`,
      [reportingDate, ...scopeClause.params],
    );
    const row = rows[0] ?? {};
    return {
      scheduled: { key: "recruitment_interviews_scheduled_d1", label: "Interviews scheduled (D-1)", value: numberValue(row.scheduled_count), unit: "count" },
      held: { key: "recruitment_interviews_held_d1", label: "Interviews held (D-1)", value: numberValue(row.held_count), unit: "count" },
      health: { module: "recruitment_interviews", state: numberValue(row.scheduled_count) > 0 ? "AVAILABLE" : "NO_DATA", asOfDate: reportingDate },
    };
  } catch (err) {
    return {
      scheduled: null,
      held: null,
      health: {
        module: "recruitment_interviews",
        state: "ERROR",
        detail: `Interview query failed: ${err instanceof Error ? err.message : String(err)}`,
        asOfDate: reportingDate,
      },
    };
  }
}

async function buildActionCentreCounts(
  scope: RecruitmentScope,
  mode: ScopeMode,
  reportingDate: string,
): Promise<{
  offerApprovals: BriefSignal | null;
  bgvPending: BriefSignal | null;
  documentsPending: BriefSignal | null;
  onboardingPending: BriefSignal | null;
  health: SourceHealth;
}> {
  if (mode === "none") {
    return {
      offerApprovals: null,
      bgvPending: null,
      documentsPending: null,
      onboardingPending: null,
      health: { module: "recruitment_action_centre", state: "NOT_APPLICABLE", detail: "No recruiter/HR scope supplied", asOfDate: reportingDate },
    };
  }
  try {
    // Candidate-entity item types (OFFER_APPROVAL_PENDING, BGV_PENDING, ONBOARDING_STUCK) are
    // scoped via the same recruiter-team join used elsewhere in this module. JOINING_DOCS_INCOMPLETE
    // is an employee-entity item type (entity_id = employee.id directly — verified live in
    // work-inbox.triggers.ts's triggerJoiningDocsIncomplete), so it is scoped directly by
    // teamEmployeeIds instead of through the recruiter join.
    const candidateScopeSql =
      mode === "team"
        ? `AND wi.entity_id IN (SELECT c.id FROM ats_candidate c
             WHERE c.recruiter_id IN (SELECT id FROM ats_recruiter_roster WHERE employee_id IN (${scope.teamEmployeeIds!.map(() => "?").join(",")}))
               AND ${excludeEmployeeShapedCandidatesSql("c")})`
        : "";
    const candidateScopeParams = mode === "team" ? [...scope.teamEmployeeIds!] : [];

    const employeeScopeSql = mode === "team" ? `AND wi.entity_id IN (${scope.teamEmployeeIds!.map(() => "?").join(",")})` : "";
    const employeeScopeParams = mode === "team" ? [...scope.teamEmployeeIds!] : [];

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         (SELECT COUNT(*) FROM work_item wi WHERE wi.item_type = 'OFFER_APPROVAL_PENDING' AND wi.status NOT IN ('completed','cancelled') ${candidateScopeSql}) AS offer_approvals,
         (SELECT COUNT(*) FROM work_item wi WHERE wi.item_type = 'BGV_PENDING' AND wi.status NOT IN ('completed','cancelled') ${candidateScopeSql}) AS bgv_pending,
         (SELECT COUNT(*) FROM work_item wi WHERE wi.item_type = 'JOINING_DOCS_INCOMPLETE' AND wi.status NOT IN ('completed','cancelled') ${employeeScopeSql}) AS documents_pending,
         (SELECT COUNT(*) FROM work_item wi WHERE wi.item_type = 'ONBOARDING_STUCK' AND wi.status NOT IN ('completed','cancelled') ${candidateScopeSql}) AS onboarding_pending`,
      [...candidateScopeParams, ...candidateScopeParams, ...employeeScopeParams, ...candidateScopeParams],
    );
    const row = rows[0] ?? {};
    return {
      offerApprovals: { key: "recruitment_offer_approvals_pending", label: "Offer approvals pending", value: numberValue(row.offer_approvals), unit: "count" },
      bgvPending: { key: "recruitment_bgv_pending", label: "BGV pending", value: numberValue(row.bgv_pending), unit: "count" },
      documentsPending: { key: "recruitment_documents_pending", label: "Joining documents pending", value: numberValue(row.documents_pending), unit: "count" },
      onboardingPending: { key: "recruitment_onboarding_pending", label: "Onboarding pending", value: numberValue(row.onboarding_pending), unit: "count" },
      health: { module: "recruitment_action_centre", state: "AVAILABLE", asOfDate: reportingDate },
    };
  } catch (err) {
    return {
      offerApprovals: null,
      bgvPending: null,
      documentsPending: null,
      onboardingPending: null,
      health: {
        module: "recruitment_action_centre",
        state: "ERROR",
        detail: `Action Centre query failed: ${err instanceof Error ? err.message : String(err)}`,
        asOfDate: reportingDate,
      },
    };
  }
}

async function buildJoiningWindow(
  scope: RecruitmentScope,
  mode: ScopeMode,
  reportingDate: string,
): Promise<{ today: BriefSignal | null; thisWeek: BriefSignal | null; health: SourceHealth }> {
  if (mode === "none") {
    return {
      today: null,
      thisWeek: null,
      health: { module: "recruitment_joining", state: "NOT_APPLICABLE", detail: "No recruiter/HR scope supplied", asOfDate: reportingDate },
    };
  }
  const scopeClause = candidateScopeClause(scope, mode);
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         SUM(ob.joining_date = CURDATE()) AS joining_today,
         SUM(ob.joining_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 6 DAY)) AS joining_this_week
         FROM ats_onboarding_bridge ob
         JOIN ats_candidate c ON c.id = ob.candidate_id
        WHERE ob.joining_date IS NOT NULL
          AND ob.status NOT IN ('joined','employee_created')
          AND ${excludeEmployeeShapedCandidatesSql("c")}
          ${scopeClause.sql}`,
      [...scopeClause.params],
    );
    const row = rows[0] ?? {};
    return {
      today: { key: "recruitment_joining_today", label: "Joining today", value: numberValue(row.joining_today), unit: "count" },
      thisWeek: { key: "recruitment_joining_this_week", label: "Joining this week", value: numberValue(row.joining_this_week), unit: "count" },
      health: { module: "recruitment_joining", state: "AVAILABLE", asOfDate: reportingDate },
    };
  } catch (err) {
    return {
      today: null,
      thisWeek: null,
      health: {
        module: "recruitment_joining",
        state: "ERROR",
        detail: `Joining-window query failed: ${err instanceof Error ? err.message : String(err)}`,
        asOfDate: reportingDate,
      },
    };
  }
}

export async function buildRecruitmentModule(
  scope: RecruitmentScope,
  reportingDate: string,
): Promise<RecruitmentModuleResult> {
  const mode = resolveScopeMode(scope);

  const [stageResult, interviewResult, actionResult, joiningResult] = await Promise.all([
    buildStageActivity(scope, mode, reportingDate),
    buildInterviews(scope, mode, reportingDate),
    buildActionCentreCounts(scope, mode, reportingDate),
    buildJoiningWindow(scope, mode, reportingDate),
  ]);

  return {
    applicable: mode !== "none",
    candidatesMovedD1: stageResult.movedD1,
    interviewsScheduledD1: interviewResult.scheduled,
    interviewsHeldD1: interviewResult.held,
    pendingOfferApprovals: actionResult.offerApprovals,
    bgvPending: actionResult.bgvPending,
    documentsPending: actionResult.documentsPending,
    onboardingPending: actionResult.onboardingPending,
    joiningToday: joiningResult.today,
    joiningThisWeek: joiningResult.thisWeek,
    candidatesStuckBeyondThreshold: stageResult.stuck,
    sourceHealth: [stageResult.health, interviewResult.health, actionResult.health, joiningResult.health],
  };
}
