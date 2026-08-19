/**
 * Types for Phase B (MVP) of the D-1 Daily Manager Intelligence Briefing Engine.
 *
 * MVP scope only: attendance, hygiene/discipline (attendance_reconciliation_issue),
 * work-inbox actions, and a payroll_readiness signal for payroll-entitled recipients.
 * Grievance data is deliberately OUT OF SCOPE for this pass (confidentiality
 * complexity — see hrms2-daily-brief memory / prompt) and payroll monetary values are
 * never surfaced at all, even to payroll-role recipients.
 */

/** How trustworthy a section of the brief is. Never silently render a zero for ERROR. */
export type SourceHealthState =
  | "AVAILABLE"
  | "NO_DATA"
  | "NOT_APPLICABLE"
  | "STALE"
  | "ERROR"
  | "INSUFFICIENT_SAMPLE";

export interface SourceHealth {
  module: string;
  state: SourceHealthState;
  /** Present only for STALE/ERROR/INSUFFICIENT_SAMPLE — human-readable, no raw error text with PII. */
  detail?: string;
  /** The attendance/business date this module's data reflects, if applicable. */
  asOfDate?: string | null;
}

/**
 * A single quantified fact for the KPI strip or a section body.
 *
 * INTEGRATION-PASS WIDENING (see daily-brief-dedup.ts's original header comment for the
 * full history): dedupeSignals()/rankSignals() need to correlate and merge signals
 * produced by different modules for the same employee+issue (spec §46), and rank them
 * into the priority ladder in spec §45. Doing that needs a stable "which employee",
 * "which module produced this", "what kind of issue" and "does it link to an action"
 * vocabulary that the original MVP-only BriefSignal never carried. Rather than keep a
 * parallel `DedupableSignal` type that every producing module would need to remember to
 * satisfy, this integration pass widens the canonical BriefSignal itself — spec §25
 * already anticipates most of these fields, and a single canonical shape means every
 * module that builds a BriefSignal-shaped value automatically produces something
 * dedupeSignals()/rankSignals() can operate on with no separate cast or adapter type.
 * All new fields are optional so every pre-existing BriefSignal literal in the eleven
 * domain modules remains valid without modification.
 */
export interface BriefSignal {
  key: string;
  label: string;
  value: number | string | null;
  unit?: "count" | "percent" | "text";
  /** Employee this signal is about. Signals with no employeeId are never merged with
   * each other by dedupeSignals() — there is no safe correlation key for an org-level
   * metric. */
  employeeId?: string | null;
  /** Producing module, e.g. "attendance", "hygiene", "business_action_queue", "kpi_performance". */
  source?: string;
  /** Module-local issue classifier used for dedup correlation, e.g. "missing_punch". */
  category?: string;
  /** Present only on signals that link to an actionable item (Action Centre / work item). */
  actionUrl?: string | null;
  priority?: "critical" | "high" | "medium" | "low";
  /** True for a signal reporting a positive/improvement metric (used by rankSignals). */
  isPositive?: boolean;
  /** Explicit rank-bucket classification for rankSignals (spec §45); inferred when absent. */
  kind?: "action" | "business_risk" | "anomaly" | "hygiene" | "positive" | "metric" | "info";
}

/** One row in "Your Priorities Today" — sourced from work-inbox, never invented. */
export interface BriefAction {
  id: string;
  title: string;
  priority: "critical" | "high" | "medium" | "low";
  dueAt: string | null;
  sourceTable: string;
}

/** One row in the hygiene/discipline top-N list. */
export interface HygieneIssue {
  id: string;
  employeeCode: string | null;
  issueType: string;
  severity: "blocker" | "warning";
  issueDate: string;
}

export interface AttendanceSummary {
  recordDate: string | null;
  present: number;
  halfDay: number;
  absent: number;
  missingPunch: number;
  lateCount: number;
  expectedToWork: number;
  attendancePct: number | null;
}

export interface RecipientInfo {
  employeeId: string;
  userId: string | null;
  fullName: string;
  /** Primary (highest-priority) role — kept for backward compatibility with the MVP
   * single-role rendering path and with existing tests that construct RecipientInfo. */
  role: string;
  /**
   * INTEGRATION-PASS ADDITION: every active role_key the recipient's account holds
   * (roleResolver.getUserRoleContext's roleKeys), not just the primary one. A recipient
   * holding multiple roles (e.g. team_leader + qa) must get ONE merged brief, not
   * multiple emails — daily-brief-role-modules.ts's resolveModulesForRoles() unions
   * every applicable module across allRoles, and the aggregator dedupes the resulting
   * signals via daily-brief-dedup.ts. Defaults to `[role]` when not explicitly supplied,
   * so any pre-existing RecipientInfo literal (tests, older callers) keeps working with
   * single-role behavior.
   */
  allRoles?: string[];
  scopeLabel: string;
  teamEmployeeIds: string[];
  email: string | null;
  /**
   * RECIPIENT-ELIGIBILITY-WIDENING ADDITION: an explicit branch/process scope
   * descriptor, populated ONLY for the payroll/finance role family (payroll,
   * payroll_admin, payroll_head, payroll_hr, finance, finance_head, accounts_head —
   * see daily-brief-recipient.resolver.ts's PAYROLL_FINANCE_ROLES). These roles don't
   * have a per-employee "team" the way a manager does; their brief is dominated by
   * buildPayrollReadinessModule, which takes a branch/process scope, not employee ids.
   * When present (even as `{branchIds: [], processIds: []}`, which correctly means
   * "org-wide" to buildPayrollReadinessModule — see that module's own scope-rule doc),
   * the aggregator uses this directly instead of inferring branch/process from
   * teamEmployeeIds (which is deliberately left empty/small for this family — see
   * resolver header). Undefined for every other role family; those keep the existing
   * employee-id-inference path unchanged.
   */
  scopeDescriptor?: { branchIds: string[]; processIds: string[] };
}

/** A recipient the resolver could not deliver to, with the reason recorded rather than dropped. */
export interface UnresolvedRecipient {
  employeeId: string;
  userId: string | null;
  fullName: string | null;
  role: string;
  reason: string;
}

/** A capped list plus the human-readable "+N more" overflow text spec §48 requires. */
export interface CappedList<T> {
  items: T[];
  /** Total count before capping. */
  totalCount: number;
  /** e.g. "+3 more — View in HRMS". Null when nothing was cut. */
  overflowText: string | null;
}

export interface ManagerDailyBrief {
  recipient: RecipientInfo;
  businessDate: string;
  generatedAtIST: string;
  attendance: AttendanceSummary;
  hygieneIssues: HygieneIssue[];
  actions: BriefAction[];
  /** Only populated when the recipient is payroll-entitled; null otherwise. */
  payrollReadiness: BriefSignal | null;
  sourceHealth: SourceHealth[];

  // ---------------------------------------------------------------------------
  // Integration-pass additions (spec §44 payload shape / §48 caps). All optional
  // so any pre-existing MVP-only construction of ManagerDailyBrief keeps compiling;
  // buildManagerDailyBrief always populates them going forward.
  // ---------------------------------------------------------------------------

  /** 3-5 ranked genuinely-positive observations (spec §48). */
  positives?: BriefSignal[];
  /** 3-5 ranked items needing the recipient's attention, deduped + ranked (spec §45/§48). */
  attention?: BriefSignal[];
  /** Top-5 hygiene/discipline issues with overflow text; supersedes reading hygieneIssues directly once populated. */
  hygieneTop5?: CappedList<HygieneIssue>;
  /** Top-5 performance/quality exceptions (KPI below-target/below-min, quality deterioration), ranked. */
  performanceExceptionsTop5?: CappedList<BriefSignal>;
  /** Top-5 actionable items with overflow text; supersedes reading actions directly once populated. */
  actionsTop5?: CappedList<BriefAction>;

  /** Raw per-module results for whichever modules applied to this recipient's role. Omitted (not merely
   * empty) modules were not applicable to this recipient's role — see daily-brief-role-modules.ts. */
  modules?: {
    kpi?: import("./daily-brief-kpi.module.js").KpiPerformanceModuleResult;
    quality?: import("./daily-brief-quality.module.js").QualityModuleResult;
    roster?: import("./daily-brief-roster.module.js").RosterModuleResult;
    peopleRisk?: import("./daily-brief-people-risk.module.js").PeopleRiskModuleResult;
    helpdesk?: import("./daily-brief-helpdesk.module.js").HelpdeskModuleResult;
    recruitment?: import("./daily-brief-recruitment.module.js").RecruitmentModuleResult;
    exit?: import("./daily-brief-exit.module.js").ExitModuleResult;
    training?: import("./daily-brief-training.module.js").TrainingModuleResult;
    /** Only ever populated for a PAYROLL_ROLES recipient — see daily-brief-payroll.module.ts's
     * security-critical scope rule and daily-brief-aggregator.service.ts's role gate. */
    payrollReadinessDetail?: import("./daily-brief-payroll.module.js").PayrollReadinessModuleResult;
    /** Populated for every non-payroll-role recipient instead of payrollReadinessDetail. */
    payrollOperationalHint?: string | null;
  };
}
