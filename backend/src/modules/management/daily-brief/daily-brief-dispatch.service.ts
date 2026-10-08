/**
 * Orchestrates the D-1 Daily Manager Intelligence Briefing Engine (Phase B / MVP):
 * resolve recipient -> build payload -> render template -> (dry-run) return it, or
 * (explicit opt-in only) actually dispatch through the existing communication pipeline.
 *
 * NOT WIRED to any scheduler/cron/worker in this phase. The only caller today is
 * daily-brief.routes.ts's preview endpoint, which always passes dryRun:true. A real
 * send requires an explicit `dryRun:false` argument at the call site — there is no
 * route, cron entry or worker registration that supplies one.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import { dispatchService } from "../../communication/dispatch.service.js";
import { templateService } from "../../communication/template.service.js";
import { getDispatchBlock } from "../../../shared/notification-dispatch-block.js";
import { getBusinessDateIST, getGeneratedAtIST } from "../../../shared/istDate.js";
import { resolveDailyBriefRecipient } from "./daily-brief-recipient.resolver.js";
import { buildManagerDailyBrief, buildExecutiveDailyBrief, type ExecutiveDailyBrief } from "./daily-brief-aggregator.service.js";
import { resolveModulesForRoles } from "./daily-brief-role-modules.js";
import { buildDailyBriefSubject, buildExecutiveDailyBriefSubject } from "./daily-brief-subject.js";
import type { ManagerDailyBrief, RecipientInfo, UnresolvedRecipient } from "./daily-brief.types.js";

const TEMPLATE_NAME = "management/daily-brief";

export function dailyBriefEventCode(businessDate: string): string {
  return `manager_daily_brief:${businessDate}`;
}

/**
 * Renders the brief into the shape the Handlebars templates expect. Kept separate from
 * the ManagerDailyBrief domain type so the template's presentation concerns (formatted
 * percentages, a boolean per severity, a filtered "what's incomplete" list) don't leak
 * into the payload the preview route returns as JSON.
 *
 * INTEGRATION-PASS WIDENING: every new section below is OMITTED (undefined, never an
 * empty object/array) when the recipient's role config didn't include that module or
 * the module had nothing to report — the templates gate each section on
 * `{{#if sectionName}}` for exactly that reason (see daily-brief.hbs/.txt.hbs). No
 * section here ever surfaces a payroll amount, a grievance record, or (for the
 * payroll-readiness section) anything beyond what daily-brief-payroll.module.ts itself
 * already promises never to select.
 */
export function buildTemplateContext(brief: ManagerDailyBrief): Record<string, unknown> {
  const incomplete = brief.sourceHealth.filter((h) => h.state === "ERROR" || h.state === "STALE");
  const modules = brief.modules;

  return {
    recipientName: brief.recipient.fullName,
    scopeLabel: brief.recipient.scopeLabel,
    businessDate: brief.businessDate,
    generatedAtIST: brief.generatedAtIST,
    kpi: {
      attendancePctDisplay: brief.attendance.attendancePct == null ? "—" : `${brief.attendance.attendancePct}%`,
      absent: brief.attendance.absent,
      missingPunch: brief.attendance.missingPunch,
      lateCount: brief.attendance.lateCount,
    },
    payrollReadiness: brief.payrollReadiness,
    hygieneIssues: brief.hygieneIssues.map((issue) => ({ ...issue, isBlocker: issue.severity === "blocker" })),
    actions: brief.actions,
    sourceHealthIssues: incomplete,
    company: { name: "Mas Callnet India Pvt Ltd" },

    // ---- Integration-pass sections (all optional; templates omit when absent) ----
    positives: brief.positives && brief.positives.length > 0 ? brief.positives : undefined,
    attention: brief.attention && brief.attention.length > 0 ? brief.attention : undefined,

    performance: modules?.kpi && modules.kpi.employeeSignals.length > 0
      ? {
          exceptions: brief.performanceExceptionsTop5?.items ?? [],
          overflowText: brief.performanceExceptionsTop5?.overflowText ?? null,
          coachingDueOrOverdueCount: modules.kpi.coaching.dueOrOverdueCount,
          trainingNeedsOpenedCount: modules.kpi.trainingNeeds.openedD1Count,
        }
      : undefined,

    quality: modules?.quality && modules.quality.scoredCallCount > 0
      ? {
          avgQualityPctDisplay: modules.quality.avgQualityPct == null ? "—" : `${modules.quality.avgQualityPct}%`,
          auditCoveragePctDisplay: modules.quality.auditCoveragePct == null ? "—" : `${modules.quality.auditCoveragePct}%`,
          deteriorationNote: modules.quality.deterioration?.isMaterial ? modules.quality.deterioration.note : null,
          parameterFailRates: modules.quality.parameterFailRates,
        }
      : undefined,

    training: modules?.training && modules.training.applicable
      ? {
          completionPctDisplay: modules.training.completionPct?.value == null ? "—" : `${modules.training.completionPct.value}%`,
          coursesCompletedD1: modules.training.coursesCompletedD1?.value ?? 0,
          overdueMandatoryTraining: modules.training.overdueMandatoryTraining?.value ?? 0,
          certificationsExpiring30d: modules.training.certificationsExpiring30d?.value ?? 0,
          certificationsExpired: modules.training.certificationsExpired?.value ?? 0,
        }
      : undefined,

    roster: modules?.roster && (modules.roster.lookingAhead.length > 0 || numberOrZero(modules.roster.uncoveredHc.value) > 0)
      ? {
          uncoveredHc: modules.roster.uncoveredHc.value,
          worstSeverity: modules.roster.worstSeverity,
          pendingAcknowledgement: modules.roster.pendingAcknowledgement?.value ?? 0,
          pendingRejectedByEmployee: modules.roster.pendingRejectedByEmployee?.value ?? 0,
        }
      : undefined,

    peopleRisk: modules?.peopleRisk && modules.peopleRisk.applicable && modules.peopleRisk.severity
      ? {
          count: modules.peopleRisk.countRequiringAttention?.value ?? 0,
          severity: modules.peopleRisk.severity,
          actionLabel: modules.peopleRisk.actionLabel,
        }
      : undefined,

    helpdesk: modules?.helpdesk && (modules.helpdesk.summary.openTickets > 0 || modules.helpdesk.summary.newTickets > 0)
      ? {
          businessImpactLine: modules.helpdesk.businessImpactLine,
          openTickets: modules.helpdesk.summary.openTickets,
          slaBreached: modules.helpdesk.summary.slaBreached,
          categoryBreakdown: modules.helpdesk.categoryBreakdown,
        }
      : undefined,

    recruitment: modules?.recruitment && modules.recruitment.applicable
      ? {
          candidatesMovedD1: modules.recruitment.candidatesMovedD1?.value ?? 0,
          interviewsScheduledD1: modules.recruitment.interviewsScheduledD1?.value ?? 0,
          pendingOfferApprovals: modules.recruitment.pendingOfferApprovals?.value ?? 0,
          bgvPending: modules.recruitment.bgvPending?.value ?? 0,
          joiningToday: modules.recruitment.joiningToday?.value ?? 0,
          joiningThisWeek: modules.recruitment.joiningThisWeek?.value ?? 0,
        }
      : undefined,

    exit: modules?.exit && modules.exit.applicable
      ? {
          resignationsSubmittedD1: modules.exit.resignationsSubmittedD1?.value ?? 0,
          managerDiscussionsPending: modules.exit.managerDiscussionsPending?.value ?? 0,
          hrDiscussionsPending: modules.exit.hrDiscussionsPending?.value ?? 0,
          upcomingLwdNext7Days: modules.exit.upcomingLwdNext7Days?.value ?? 0,
          clearanceCompletionPctDisplay: modules.exit.clearanceCompletionPct?.value == null ? "—" : `${modules.exit.clearanceCompletionPct.value}%`,
        }
      : undefined,

    // Payroll-readiness-or-hint: mutually exclusive by construction (aggregator never
    // populates both — see daily-brief-aggregator.service.ts's security gate).
    payrollReadinessDetail: modules?.payrollReadinessDetail && modules.payrollReadinessDetail.runs.length > 0
      ? {
          runs: modules.payrollReadinessDetail.runs.map((r) => ({
            runMonth: r.runMonth,
            status: r.status,
            blockerCount: r.blockerCount,
            warningCount: r.warningCount,
            financeApproved: r.financeApproved,
            ceoAcknowledged: r.ceoAcknowledged,
          })),
          pendingApprovalsCount: modules.payrollReadinessDetail.pendingApprovalsCount,
        }
      : undefined,
    payrollOperationalHint: modules?.payrollOperationalHint ?? undefined,
  };
}

function numberOrZero(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Rollup-shaped template context (Gap 2 — see daily-brief-executive-rollup.module.ts
 * and daily-brief-aggregator.service.ts's ExecutiveDailyBrief). Deliberately a
 * DIFFERENT shape from buildTemplateContext above: grouped by branch, not by employee.
 * daily-brief.hbs/.txt.hbs render this via `{{#if rollup}}`-gated sections that do not
 * exist in the per-employee context, so the same template file safely serves both.
 * `kpi` is still populated (from the org-wide attendance rollup) so the existing KPI
 * strip markup — which is NOT itself gated by `{{#if kpi}}` — renders organizational
 * attendance instead of a per-employee team's, satisfying spec §29's "organizational
 * attendance" requirement without a template change to that block. `hygieneIssues` and
 * `actions` are intentionally omitted (undefined) — daily-brief.hbs/.txt.hbs wrap those
 * two per-employee-shaped sections in `{{#unless rollup}}` for exactly this reason.
 */
export function buildExecutiveTemplateContext(brief: ExecutiveDailyBrief): Record<string, unknown> {
  const incomplete = brief.sourceHealth.filter((h) => h.state === "ERROR" || h.state === "STALE");
  const r = brief.rollup;

  return {
    rollup: true,
    recipientName: brief.recipient.fullName,
    scopeLabel: brief.recipient.scopeLabel,
    businessDate: brief.businessDate,
    generatedAtIST: brief.generatedAtIST,
    kpi: {
      attendancePctDisplay: r.orgAttendance.attendancePct == null ? "—" : `${r.orgAttendance.attendancePct}%`,
      absent: r.orgAttendance.absent,
      missingPunch: r.orgAttendance.missingPunch,
      lateCount: r.orgAttendance.lateCount,
    },
    sourceHealthIssues: incomplete,
    company: { name: "Mas Callnet India Pvt Ltd" },

    executiveRollup: {
      isOrgWide: r.isOrgWide,
      branchAttendance: r.branchAttendance.map((b) => ({
        ...b,
        attendancePctDisplay: b.attendancePct == null ? "—" : `${b.attendancePct}%`,
      })),
      bestPerformingBranch: r.bestPerformingBranch,
      worstPerformingBranch: r.worstPerformingBranch,
      topActions: r.topActions,
      hiringAttrition: r.hiringAttrition,
    },

    payrollReadinessDetail: brief.payrollReadinessDetail && brief.payrollReadinessDetail.runs.length > 0
      ? {
          runs: brief.payrollReadinessDetail.runs.map((run) => ({
            runMonth: run.runMonth,
            status: run.status,
            blockerCount: run.blockerCount,
            warningCount: run.warningCount,
            financeApproved: run.financeApproved,
            ceoAcknowledged: run.ceoAcknowledged,
          })),
          pendingApprovalsCount: brief.payrollReadinessDetail.pendingApprovalsCount,
        }
      : undefined,
  };
}

export type BuildBriefResult =
  | { ok: true; brief: ManagerDailyBrief; html: string; text?: string; subject: string }
  | { ok: true; brief: ExecutiveDailyBrief; html: string; text?: string; subject: string }
  | { ok: false; unresolved: UnresolvedRecipient };

/** Whether a resolved recipient must be routed through the executive rollup path
 * rather than the per-employee module set — see daily-brief-aggregator.service.ts's
 * buildExecutiveDailyBrief header for why this single call site is the ONLY place that
 * decision is made. */
function isExecutiveRecipient(recipient: RecipientInfo): boolean {
  const roles = recipient.allRoles?.length ? recipient.allRoles : [recipient.role];
  return Boolean(resolveModulesForRoles(roles).isExecutiveRollup);
}

/**
 * Resolve + build + render a brief for one employee. Always dry (no dispatch, no
 * dispatch_log write) — used by both the preview route and dispatchDailyBrief below.
 */
export async function buildDailyBriefForEmployee(
  employeeId: string,
  businessDate: string = getBusinessDateIST(),
): Promise<BuildBriefResult> {
  const resolution = await resolveDailyBriefRecipient(employeeId);
  if (!resolution.ok) return { ok: false, unresolved: resolution.unresolved };

  const generatedAtIST = getGeneratedAtIST();

  if (isExecutiveRecipient(resolution.recipient)) {
    const brief = await buildExecutiveDailyBrief(resolution.recipient, businessDate, generatedAtIST);
    const context = buildExecutiveTemplateContext(brief);
    const rendered = await templateService.renderTemplate({ template_name: TEMPLATE_NAME, data: context });
    const subject = buildExecutiveDailyBriefSubject(brief);
    return { ok: true, brief, html: rendered.html, text: rendered.text, subject };
  }

  const brief = await buildManagerDailyBrief(resolution.recipient, businessDate, generatedAtIST);
  const context = buildTemplateContext(brief);
  const rendered = await templateService.renderTemplate({ template_name: TEMPLATE_NAME, data: context });
  const subject = buildDailyBriefSubject(brief);
  return { ok: true, brief, html: rendered.html, text: rendered.text, subject };
}

interface ExistingDispatchRow extends RowDataPacket {
  id: string;
}

async function alreadyDispatched(employeeId: string, eventCode: string): Promise<boolean> {
  const [rows] = await db.execute<ExistingDispatchRow[]>(
    `SELECT id FROM dispatch_log
      WHERE event_code = ? AND recipient_employee_id = ? AND status IN ('sent','delivered','skipped')
      LIMIT 1`,
    [eventCode, employeeId],
  );
  return rows.length > 0;
}

/**
 * In-process mutex, keyed by "employeeId:businessDate", so two overlapping calls within
 * the same process for the same recipient+day cannot both pass the idempotency check and
 * both dispatch. This is NOT a distributed lock — it protects one process only. Multiple
 * app instances or worker processes calling this concurrently could still double-send;
 * a real distributed lock (e.g. a DB-backed advisory lock or a unique constraint on
 * (event_code, recipient_employee_id)) is out of scope for this MVP pass and is called
 * out here deliberately rather than silently assumed safe.
 */
const inFlight = new Map<string, Promise<unknown>>();

async function withRecipientLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = inFlight.get(key) ?? Promise.resolve();
  let release: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const chained = previous.then(() => gate);
  inFlight.set(key, chained);
  await previous;
  try {
    return await fn();
  } finally {
    release!();
    if (inFlight.get(key) === chained) inFlight.delete(key);
  }
}

export type DispatchOutcome =
  | { status: "unresolved"; unresolved: UnresolvedRecipient }
  | { status: "skipped_already_sent" }
  | { status: "skipped_blocked"; reason?: string | null }
  | { status: "dry_run"; brief: ManagerDailyBrief | ExecutiveDailyBrief; html: string; text?: string; subject: string }
  | { status: "dispatched"; dispatchIds: string[] };

/**
 * Full orchestration for one recipient. Default is dry-run (dryRun defaults to true) —
 * callers must pass dryRun:false explicitly to actually send mail. See file header: no
 * route or scheduler in this phase passes that.
 */
export async function dispatchDailyBrief(
  employeeId: string,
  options: { businessDate?: string; dryRun?: boolean } = {},
): Promise<DispatchOutcome> {
  const businessDate = options.businessDate ?? getBusinessDateIST();
  const dryRun = options.dryRun !== false;
  const eventCode = dailyBriefEventCode(businessDate);

  const built = await buildDailyBriefForEmployee(employeeId, businessDate);
  if (!built.ok) return { status: "unresolved", unresolved: built.unresolved };

  if (dryRun) {
    return { status: "dry_run", brief: built.brief, html: built.html, text: built.text, subject: built.subject };
  }

  return withRecipientLock(`${employeeId}:${businessDate}`, async () => {
    if (await alreadyDispatched(employeeId, eventCode)) {
      return { status: "skipped_already_sent" };
    }
    const block = await getDispatchBlock(eventCode);
    if (block.blocked) {
      return { status: "skipped_blocked", reason: block.reason };
    }

    const context = "mode" in built.brief && built.brief.mode === "executive_rollup"
      ? buildExecutiveTemplateContext(built.brief)
      : buildTemplateContext(built.brief as ManagerDailyBrief);
    const result = await dispatchService.send({
      template_name: TEMPLATE_NAME,
      recipient_employee_ids: [employeeId],
      data: context,
      channel: "email",
      event_code: eventCode,
      prefer_official_email: true,
      portal: false,
    });
    return { status: "dispatched", dispatchIds: result.dispatch_ids };
  });
}
