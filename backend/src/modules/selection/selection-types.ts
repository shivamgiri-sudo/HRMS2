// Selection criteria: shared types (plan 2026-10-09 "Selection Criteria", Design 1-2).
// The job requisition is the single source of truth; these types describe how its columns plus
// job_requisition.selection_rules are read, compiled and evaluated. Pure declarations only.
import type { MatchLead, MatchRequisition } from "../hiring-engine/he-matcher.js";

export type Verdict = "pass" | "fail" | "review";
export type SourceKind = "meta_live" | "meta_old" | "he";
export type SubSource =
  | "meta_live" | "meta_old" | "candidate" | "naukri_import" | "workindia_import" | "intake_upload" | "walk_in" | "pool_other";

export const SOURCE_KINDS: readonly SourceKind[] = ["meta_live", "meta_old", "he"];
export const SUB_SOURCES: readonly SubSource[] = [
  "meta_live", "meta_old", "candidate", "naukri_import", "workindia_import", "intake_upload", "walk_in", "pool_other",
];

export type RuleMode = "must" | "prefer" | "off";
export type MissingPolicy = "review" | "fail" | "pass";
export const RULE_MODES: readonly RuleMode[] = ["must", "prefer", "off"];
export const MISSING_POLICIES: readonly MissingPolicy[] = ["review", "fail", "pass"];
export const MAX_WEIGHT = 50;

/** Every editable rule, in the default evaluation (funnel) order: cheap and decisive first. */
export const RULE_KEYS = [
  "sources", "contact_recent", "record_age", "valid_email", "location_region", "location_cities", "relocation_ok", "age",
  "education_min", "experience", "night_shift", "rotational_shift", "certificate", "gender", "languages", "english", "typing",
  "form_answer", "notice_period", "salary_fit", "employer_exclude", "ex_employee", "skills", "education_stream",
  "education_completed", "employer_include", "rejected_other_process", "location_radius",
] as const;
export type RuleKey = (typeof RULE_KEYS)[number];

/** Values stored in selection_rules for keys whose value has no requisition column. */
export interface RuleValues {
  education_stream: string[];
  education_completed: "completed" | "pursuing_ok";
  skills: { match: "any" | "all" | "at_least"; n?: number };
  relocation_ok: boolean;
  salary_fit: { maxRatio: number };
  notice_period: { maxDays: number };
  certificate: { level: "declared" | "verified" };
  employer_include: string[];
  employer_exclude: string[];
  ex_employee: "allow_clean" | "exclude";
  record_age: { maxDays: number };
  contact_recent: { days: number };
  valid_email: boolean;
  sources: { exclude: string[] };
}
export type ValueRuleKey = keyof RuleValues;

export interface RuleSetting<V = unknown> {
  mode: RuleMode;
  /** mode "off" + decided true is the explicit "No requirement" (counts as complete). */
  decided?: boolean;
  weight?: number;
  missing?: MissingPolicy;
  missingBySource?: Partial<Record<SubSource | SourceKind, MissingPolicy>>;
  value?: V;
}

export interface SelectionRules {
  schema: 1;
  rules: Partial<{ [K in RuleKey]: RuleSetting<K extends ValueRuleKey ? RuleValues[K] : never> }>;
  order?: RuleKey[];
  enrolment?: { mode: "off" | "hr_approves"; standingApprovalDays: number };
  template?: { id: string; version: number; appliedAt: string; appliedBy: string };
}

export interface FactValue<T> {
  value: T | null;
  quality: "ok" | "missing" | "placeholder" | "source_default" | "stale" | "ambiguous";
  from: string;
}

export interface CandidateFacts {
  personKey: string;
  sourceKind: SourceKind; subSource: SubSource; sourceDetail: string | null; recordType: string | null;
  age: FactValue<number>; educationRank: FactValue<number>; educationStatus: FactValue<"completed" | "pursuing" | "dropped">; stream: FactValue<string>;
  experienceYears: FactValue<number>; skillsText: FactValue<string>; locationText: FactValue<string>; preferredLocations: FactValue<string[]>; hometown: FactValue<string>;
  relocationOk: FactValue<boolean>; nightShiftOk: FactValue<boolean>; rotationalOk: FactValue<boolean>; salaryMonthly: FactValue<number>; salaryIsExpectation: boolean;
  noticeDays: FactValue<number>; englishLevel: FactValue<1 | 2 | 3>; typingWpm: FactValue<number>; languages: FactValue<string[]>; gender: FactValue<"male" | "female" | "other">;
  certificates: FactValue<Array<{ code: string; level: "declared" | "verified" }>>; employers: FactValue<string[]>; formAnswers: Record<string, string> | null;
  lastActiveAt: FactValue<string>; recordUpdatedAt: FactValue<string>; lastFirstContactAt: string | null; email: FactValue<string>; mobileValid: boolean;
  system: {
    eligibility: { ok: boolean; blocks: string[]; priority: number };
    inOtherJourney: string | null; bookedFor: string | null; exEmployee: "clean" | "not_clean" | null; rejectedOtherProcess: boolean;
  };
  match: MatchLead;
}

export interface CompiledRule {
  key: RuleKey; label: string; op: string; required: unknown; requiredText: string;
  mode: "must" | "prefer"; weight: number; missing: MissingPolicy;
  missingBySource?: Partial<Record<SubSource | SourceKind, MissingPolicy>>; origin: string;
}

export interface Completeness {
  score: number; label: "complete" | "partial" | "incomplete"; missing: RuleKey[];
  /** S-O6: location, education, shift and age each decided. */
  enrolmentReady: boolean;
}

export interface CompiledCriteria {
  requisitionId: string; versionId: string | null; hash: string; engineVersion: number;
  rules: CompiledRule[]; undecided: RuleKey[]; completeness: Completeness; matchReq: MatchRequisition;
}

export interface RuleResult {
  key: string; label: string; outcome: "pass" | "fail" | "unknown"; actualText: string; requiredText: string;
  mode: "must" | "prefer" | "system"; effect: "none" | "fail" | "review" | `+${number}` | `-${number}`;
}

export interface Evaluation {
  verdict: Verdict; score: number; systemBlock: string | null;
  passed: RuleResult[]; failed: RuleResult[]; unknown: RuleResult[]; reviewReasons: string[];
  criteriaHash: string; versionId: string | null; engineVersion: number; factsHash: string;
}
