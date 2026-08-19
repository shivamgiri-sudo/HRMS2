/**
 * Shared editorial/invented thresholds for the D-1 Daily Manager Briefing Engine.
 *
 * Every constant below was introduced by one of the eleven domain-module builders
 * because no existing codebase convention answered the question it needed to
 * answer. None of these are discovered business rules — each is called out at its
 * point of origin (module + report) so a single follow-up review with Product can
 * sign off on (or change) all of them in one place instead of hunting through
 * eleven files. Behavior is unchanged by centralizing them here — each module
 * that used to declare its own literal now imports the same value from here.
 */

/**
 * "One audit is an incident, not a pattern" — minimum scored-call sample before a
 * team-level D-1 quality reading is treated as a signal rather than noise.
 * Reused (not invented) from modules/quality-dashboard/coaching-trigger.ts's
 * un-exported MIN_SAMPLE_FOR_TREND, adapted from a per-employee-per-period count
 * to a team-scope D-1 count by daily-brief-quality.module.ts. Applied here to the
 * same constant so quality and, by extension, positive-signal derivation agree.
 * Flagged by: daily-brief-quality.module.ts.
 */
export const QUALITY_MIN_SCORED_CALLS_FOR_SIGNAL = 3;

/**
 * Minimum percentage-point delta (quality %, or KPI achievement points) treated
 * as a "material" deterioration/improvement vs a 7-day trailing baseline. No
 * codebase-defined "material change" delta exists anywhere for either metric —
 * this conservative floor needs product sign-off before shipping to a real
 * recipient.
 * Flagged by: daily-brief-quality.module.ts (deterioration), daily-brief-kpi.module.ts
 * (via positive-signal usage), daily-brief-positive-signals.module.ts (improvement).
 */
export const MATERIAL_DELTA_POINTS = 5;

/**
 * How stale the last LMS sync snapshot (`synced_at` on lms_learning_progress_snapshot)
 * may be before this module reports SourceHealthState.STALE instead of AVAILABLE.
 * No existing "freshness SLA" constant was found anywhere in the LMS integration
 * layer for this snapshot table.
 * Flagged by: daily-brief-training.module.ts.
 */
export const LMS_STALE_THRESHOLD_HOURS = 24;

/**
 * Forward-looking window (in days, inclusive of today) for the roster/staffing
 * "Looking Ahead" slot forecast and pending-acknowledgement count. The governing
 * spec says "next 1-7 days" for the forecast only; the same window was reused for
 * pending-ack purely for internal consistency — no existing convention ties
 * pending-ack specifically to 7 days.
 * Flagged by: daily-brief-roster.module.ts.
 */
export const ROSTER_LOOK_AHEAD_DAYS = 7;

/**
 * Number of consecutive days beyond which a candidate in Selected/Offered stage
 * with an incomplete onboarding bridge status is treated as "stuck". Reused
 * verbatim from the live runOnboardingIncompleteReminders() cron query in
 * modules/ats/ats-reminders.cron.ts (the WHERE clause, not that job's own
 * human-readable "48 hours" title text) — a discovered value, not invented, but
 * centralized here so it is not silently re-typed as a different literal later.
 * Flagged by: daily-brief-recruitment.module.ts.
 */
export const RECRUITMENT_STUCK_THRESHOLD_DAYS = 3;

/**
 * Maximum number of in-flight payroll runs one payroll-role recipient's brief
 * will summarise. Defensive cap, not specified by any existing readiness
 * service — chosen so a pathological number of open runs cannot make one brief
 * unbounded.
 * Flagged by: daily-brief-payroll.module.ts.
 */
export const PAYROLL_MAX_RUNS_PER_BRIEF = 25;

/**
 * Spec section 48 display caps applied by the aggregator when assembling the
 * final ManagerDailyBrief payload. These are the ONLY caps sourced directly from
 * the governing spec text (not editorial guesses) but are collected alongside
 * the editorial constants above so every "why is this list only N items" number
 * used by this feature lives in one file.
 */
export const BRIEF_CAP_POSITIVES_MIN = 3;
export const BRIEF_CAP_POSITIVES_MAX = 5;
export const BRIEF_CAP_ATTENTION_MIN = 3;
export const BRIEF_CAP_ATTENTION_MAX = 5;
export const BRIEF_CAP_HYGIENE_TOP = 5;
export const BRIEF_CAP_PERFORMANCE_EXCEPTIONS_TOP = 5;
export const BRIEF_CAP_ACTIONS_TOP = 5;

/**
 * Spec §29's own number: the executive rollup shows the "top 5 actions/exceptions"
 * org-wide, sourced from business_action_queue ordered by severity. Same cap family
 * as the per-employee BRIEF_CAP_* constants above, kept separate because it bounds a
 * GROUP BY/ORDER BY-driven org-wide query, not a per-employee list.
 * Flagged by: daily-brief-executive-rollup.module.ts.
 */
export const EXECUTIVE_ROLLUP_TOP_ACTIONS = 5;

/**
 * Defensive cap on how many branch rows the executive rollup's branch-attendance
 * comparison table will return. Not specified by the spec — branch_master today
 * holds well under this many rows; chosen so a future branch-count explosion cannot
 * make one executive's brief unbounded, mirroring PAYROLL_MAX_RUNS_PER_BRIEF's rationale.
 * Flagged by: daily-brief-executive-rollup.module.ts.
 */
export const EXECUTIVE_ROLLUP_MAX_BRANCH_ROWS = 100;

/**
 * Bound on how many active employee ids resolveDailyBriefRecipient will resolve for
 * an ORG_ALL-scoped executive recipient (ceo/admin/super_admin). The executive rollup
 * module itself never uses this list (it queries with GROUP BY, not per-employee), so
 * this only bounds the `RecipientInfo.teamEmployeeIds` value carried for display/audit
 * purposes. Defensive, not a discovered business limit.
 * Flagged by: daily-brief-recipient.resolver.ts.
 */
export const EXECUTIVE_ORG_WIDE_EMPLOYEE_ID_CAP = 5000;
