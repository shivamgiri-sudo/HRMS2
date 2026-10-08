// Shapes of the selection API (backend/src/modules/selection) as the screens read them.
export type RuleKey = string;
export type RuleMode = "must" | "prefer" | "off";
export type MissingPolicy = "review" | "fail" | "pass";
export type SourceKind = "meta_live" | "meta_old" | "he";
export type SubSource = "meta_live" | "meta_old" | "candidate" | "naukri_import" | "workindia_import" | "intake_upload" | "walk_in" | "pool_other";
export type Verdict = "pass" | "fail" | "review";

export interface Completeness { score: number; label: "complete" | "partial" | "incomplete"; missing: RuleKey[]; enrolmentReady: boolean }
export interface CompiledRuleView {
  key: RuleKey; label: string; requiredText: string; mode: "must" | "prefer"; weight: number; missing: MissingPolicy;
  missingBySource?: Partial<Record<string, MissingPolicy>>; origin: string; only?: SourceKind[]; defaulted?: true;
}
export interface VersionInfo { versionNo: number; at: string; by: string | null; source: string }
export interface Permissions { read: boolean; edit: boolean; export: boolean; approve: boolean; override: boolean }
export interface CriteriaIssue { level: "error" | "warning"; keys: RuleKey[]; text: string }

export interface RuleSetting { mode: RuleMode; decided?: boolean; weight?: number; missing?: MissingPolicy; missingBySource?: Partial<Record<string, MissingPolicy>>; value?: unknown }
export interface SelectionRules { schema: 1; rules: Record<string, RuleSetting | undefined>; order?: string[]; enrolment?: { mode: "off" | "hr_approves"; standingApprovalDays: number }; template?: unknown }

/** RequisitionCriteriaRow (camelCase) as GET /:id/criteria returns it. */
export interface CriteriaRow {
  id: string; code: string; branchName: string; branchCity: string | null; processName: string | null; approvalStatus: string | null;
  educationRequirement: string | null; skillsRequired: string | null; experienceMinYears: number | null; experienceMaxYears: number | null;
  ageMin: number | null; ageMax: number | null; targetLocations: string[] | null; radiusKm: number | null; shiftRequirement: string | null;
  nightShiftRequired: number | null; rotationalShift: number | null; salaryMin: number | null; salaryMax: number | null;
  screeningConfig: Record<string, unknown> | null; selectionRules: SelectionRules | null;
}
export interface CompiledView { rules: CompiledRuleView[]; undecided: RuleKey[]; completeness: Completeness; legacy: boolean; hash: string }
export interface CriteriaResponse {
  row: CriteriaRow; compiled: CompiledView; completeness: Completeness; issues: CriteriaIssue[];
  versions: Array<{ id: string; versionNo: number; createdAt: string; createdBy: string | null; source: string; reason: string | null }>; permissions: Permissions;
}
export type CriteriaPatch = Partial<Pick<CriteriaRow, "educationRequirement" | "skillsRequired" | "experienceMinYears" | "experienceMaxYears" | "ageMin" | "ageMax" | "targetLocations" | "radiusKm" | "shiftRequirement" | "nightShiftRequired" | "rotationalShift">>
  & { screeningConfig?: Record<string, unknown>; selectionRules?: SelectionRules };
export interface SaveResult { versionId: string | null; versionNo: number | null; changed: string[]; diff: Array<{ field: string; from: unknown; to: unknown }>; issues: CriteriaIssue[]; compiled: CompiledView }

export interface CriteriaSummaryData { completeness: Completeness; rules: CompiledRuleView[]; legacy: boolean; version: VersionInfo | null }
export interface RequisitionItem {
  id: string; code: string; branch: string; process: string | null; designation: string | null; approvalStatus: string | null;
  completeness: Completeness; legacy: boolean; undecided: RuleKey[]; defaultedMust: RuleKey[]; version: VersionInfo | null;
}

export interface FunnelStep { key: string; label: string; kind: "system" | "must" | "override"; remaining: number; failedHere: number; reviewHere: number; onlyThisRuleFails: number; ifRemovedGain: number }
export interface PreviewResult {
  requisitionId: string; versionId: string | null; draft: boolean; source: SourceKind; subSource: SubSource | "all"; start: number; steps: FunnelStep[];
  outcome: { shortlist: number; review: number; rejected: number; systemExcluded: number }; scoreBuckets: Array<{ from: number; to: number; n: number }>;
  sample: Array<{ maskedMobile: string; firstName: string; subSource: SubSource; verdict: Verdict; score: number; override: string | null; cells: Array<{ key: string; outcome: "pass" | "fail" | "unknown"; text: string }> }>;
  capPreview: { seatsLeft: number; dailyCap: number | null }; generatedAt: string; partial: string[];
}
export interface RuleResultView { key: string; label: string; outcome: "pass" | "fail" | "unknown"; actualText: string; requiredText: string; mode: string; effect: string }
export interface WhyNotPerson {
  person: { maskedMobile: string; fullMobileIfSearched: string | null; name: string; sources: SubSource[] };
  perRequisition: Array<{ requisitionId: string; code: string; verdict: Verdict; systemBlock: string | null; explanation: string | null; failed: RuleResultView[]; unknown: RuleResultView[];
    override: { kind: "include" | "exclude"; reason: string; actorId: string; at: string } | null; lastDecision: { runId: string; status: string; versionNo: number | null; at: string } | null;
    journey: { state: string; requisitionId: string } | null }>;
}
export interface ApprovalState {
  lastRun: { runId: string; at: string; versionId: string | null; counts: Record<string, number> } | null; currentVersion: { id: string; versionNo: number } | null;
  drift: boolean; blocker: string | null; standing: Array<{ id: string; validUntil: string; versionId: string | null; approvedBy: string; approvedAt: string }>; permissions: Permissions;
}
export interface BulkRow { requisitionId: string; diff: Array<{ field: string; from: unknown; to: unknown; skipped?: "filled" }>; issues: CriteriaIssue[]; versionId: string | null }
