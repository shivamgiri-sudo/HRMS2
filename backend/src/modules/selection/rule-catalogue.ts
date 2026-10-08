// The rule catalogue: one entry per editable selection rule (plan 2026-10-09, Design 1 table).
// Completeness weights: location, education, shift, age 15 each; experience, salary band, skills, sources 8 each;
// English 2 + typing 2 (one "English/typing" item of 4); notice period 4 = 100. The certificate item (4 in the plan)
// is weighted 0 here because it only counts when a process template asks for it; S4 adds it in that case.
import type { MissingPolicy, RuleKey, RuleMode, SourceKind, SubSource } from "./selection-types.js";

export interface CatalogueEntry {
  key: RuleKey;
  label: string;
  group: "who" | "where" | "skills" | "availability" | "money" | "history" | "contact";
  home: "column" | "meta_screening_config" | "selection_rules";
  columns?: string[];
  ops: string[];
  defaultMode: RuleMode;
  defaultMissing: Exclude<MissingPolicy, "fail">;
  /** Only where a source can never supply the fact and the plan names the default (Meta forms have no age). */
  defaultMissingBySource?: Partial<Record<SubSource | SourceKind, Exclude<MissingPolicy, "fail">>>;
  defaultWeight?: number;
  /** Stored in selection_rules.rules[key].value; undefined = the value lives in a column or meta_screening_config. */
  defaultValue?: unknown;
  editableAfterApproval: boolean;
  completenessWeight: number;
  coverageHint: Partial<Record<SubSource, string>>;
}

const META_NONE = { meta_live: "never on the form", meta_old: "never on the form" } as const;

export const RULE_CATALOGUE: ReadonlyArray<CatalogueEntry> = [
  { key: "sources", label: "Sources", group: "contact", home: "column", columns: ["preferred_sources"], ops: ["include", "exclude"],
    defaultMode: "must", defaultMissing: "pass", defaultValue: { exclude: [] }, editableAfterApproval: true, completenessWeight: 8, coverageHint: {} },
  { key: "contact_recent", label: "Not contacted in the last N days", group: "contact", home: "selection_rules", ops: ["none_within_days"],
    defaultMode: "must", defaultMissing: "pass", defaultValue: { days: 7 }, editableAfterApproval: true, completenessWeight: 0, coverageHint: {} },
  { key: "record_age", label: "Record recent enough", group: "contact", home: "selection_rules", ops: ["within_days"],
    defaultMode: "prefer", defaultMissing: "pass", defaultWeight: 5, defaultValue: { maxDays: 365 }, editableAfterApproval: true, completenessWeight: 0,
    coverageHint: { naukri_import: "last active known for 90%" } },
  { key: "valid_email", label: "Has a valid email", group: "contact", home: "selection_rules", ops: ["has"],
    defaultMode: "off", defaultMissing: "review", defaultValue: true, editableAfterApproval: true, completenessWeight: 0,
    coverageHint: { naukri_import: "known for 100%", workindia_import: "never known", candidate: "known for 82%" } },
  { key: "location_region", label: "Lives in the branch area", group: "where", home: "column", columns: ["branch_name"], ops: ["local"],
    defaultMode: "must", defaultMissing: "review", editableAfterApproval: true, completenessWeight: 0,
    coverageHint: { meta_live: "known for 47%", meta_old: "known for 47%", naukri_import: "known for 100%", workindia_import: "known for 65%", candidate: "known for 70%" } },
  { key: "location_cities", label: "Lives in these cities", group: "where", home: "column", columns: ["meta_target_locations"], ops: ["in_list"],
    defaultMode: "must", defaultMissing: "review", editableAfterApproval: true, completenessWeight: 15,
    coverageHint: { meta_live: "known for 47%", meta_old: "known for 47%", naukri_import: "known for 100%", workindia_import: "known for 65%", candidate: "known for 70%" } },
  { key: "relocation_ok", label: "Accept people willing to relocate", group: "where", home: "selection_rules", ops: ["turns_elsewhere_into_pass"],
    defaultMode: "off", defaultMissing: "pass", defaultValue: true, editableAfterApproval: true, completenessWeight: 0, coverageHint: {} },
  { key: "age", label: "Age", group: "who", home: "column", columns: ["meta_target_age_min", "meta_target_age_max"], ops: ["between"],
    defaultMode: "must", defaultMissing: "review", defaultMissingBySource: { meta_live: "pass", meta_old: "pass" }, editableAfterApproval: true, completenessWeight: 15,
    coverageHint: { ...META_NONE, naukri_import: "known for 89%", workindia_import: "never known", candidate: "known for 33%", pool_other: "known for 78%" } },
  { key: "education_min", label: "Minimum qualification", group: "who", home: "column", columns: ["education_requirement"], ops: ["at_least"],
    defaultMode: "must", defaultMissing: "review", editableAfterApproval: true, completenessWeight: 15,
    coverageHint: { meta_live: "known for 43%", meta_old: "known for 43%", naukri_import: "known for 90%", workindia_import: "never known (import default)", candidate: "known for 70%", pool_other: "known for 21%" } },
  { key: "experience", label: "Experience (years)", group: "who", home: "column", columns: ["experience_min_years", "experience_max_years"], ops: ["between"],
    defaultMode: "must", defaultMissing: "review", editableAfterApproval: true, completenessWeight: 8,
    coverageHint: { meta_live: "when the form asks", meta_old: "when the form asks", naukri_import: "known for 100%", workindia_import: "never known", candidate: "known for 81%", pool_other: "known for 56%" } },
  { key: "night_shift", label: "Willing to work night shift", group: "availability", home: "column", columns: ["night_shift_required", "shift_requirement"], ops: ["yes"],
    defaultMode: "must", defaultMissing: "review", editableAfterApproval: true, completenessWeight: 15,
    coverageHint: { meta_live: "when the form asks (about 37%)", meta_old: "when the form asks (about 37%)", naukri_import: "never known", workindia_import: "never known", candidate: "known for 36%", pool_other: "known for 9%" } },
  { key: "rotational_shift", label: "OK with rotational shifts", group: "availability", home: "column", columns: ["rotational_shift"], ops: ["yes"],
    defaultMode: "must", defaultMissing: "review", editableAfterApproval: true, completenessWeight: 0, coverageHint: {} },
  { key: "certificate", label: "Certificate (e.g. DRA)", group: "skills", home: "meta_screening_config", columns: ["meta_screening_config.certifications"], ops: ["holds"],
    defaultMode: "must", defaultMissing: "review", defaultValue: { level: "declared" }, editableAfterApproval: true, completenessWeight: 0,
    coverageHint: { meta_live: "declared answer when asked", meta_old: "declared answer when asked", naukri_import: "never known", workindia_import: "never known" } },
  { key: "gender", label: "Gender (only where the client contract requires it)", group: "who", home: "meta_screening_config", columns: ["meta_screening_config.gender"], ops: ["is"],
    defaultMode: "must", defaultMissing: "review", editableAfterApproval: true, completenessWeight: 0, coverageHint: {} },
  { key: "languages", label: "Languages", group: "skills", home: "meta_screening_config", columns: ["meta_screening_config.language_requirements"], ops: ["all_of"],
    defaultMode: "must", defaultMissing: "review", editableAfterApproval: true, completenessWeight: 0, coverageHint: {} },
  { key: "english", label: "English level", group: "skills", home: "meta_screening_config", columns: ["meta_screening_config.written_english_level"], ops: ["at_least"],
    defaultMode: "must", defaultMissing: "review", editableAfterApproval: true, completenessWeight: 2, coverageHint: {} },
  { key: "typing", label: "Typing speed", group: "skills", home: "meta_screening_config", columns: ["meta_screening_config.min_typing_speed_wpm"], ops: ["gte_wpm"],
    defaultMode: "must", defaultMissing: "review", editableAfterApproval: true, completenessWeight: 2, coverageHint: { candidate: "known for 5%" } },
  { key: "form_answer", label: "Answer on the Meta form", group: "who", home: "meta_screening_config", columns: ["meta_screening_config.custom_field_rules"],
    ops: ["eq", "neq", "contains", "not_contains", "gte", "is_yes"], defaultMode: "must", defaultMissing: "pass", editableAfterApproval: true, completenessWeight: 0, coverageHint: {} },
  { key: "notice_period", label: "Can join within N days", group: "availability", home: "selection_rules", ops: ["within_days"],
    defaultMode: "prefer", defaultMissing: "pass", defaultWeight: 5, editableAfterApproval: true, completenessWeight: 4,
    coverageHint: { naukri_import: "known for 10%", workindia_import: "never known", candidate: "never known" } },
  { key: "salary_fit", label: "Current or expected salary fits the band", group: "money", home: "column", columns: ["salary_max"], ops: ["expected_lte_max_times_ratio"],
    defaultMode: "prefer", defaultMissing: "pass", defaultWeight: 5, defaultValue: { maxRatio: 1.25 }, editableAfterApproval: false, completenessWeight: 8,
    coverageHint: { naukri_import: "known for 100%", workindia_import: "never known", candidate: "never known" } },
  { key: "employer_exclude", label: "Previous employer is not", group: "history", home: "selection_rules", ops: ["none_of"],
    defaultMode: "must", defaultMissing: "pass", editableAfterApproval: true, completenessWeight: 0, coverageHint: { naukri_import: "known for 80%" } },
  { key: "ex_employee", label: "Former MAS employees", group: "history", home: "selection_rules", ops: ["allow_clean", "exclude"],
    defaultMode: "off", defaultMissing: "pass", defaultValue: "allow_clean", editableAfterApproval: true, completenessWeight: 0, coverageHint: {} },
  { key: "skills", label: "Skills", group: "skills", home: "column", columns: ["skills_required"], ops: ["any", "all", "at_least"],
    defaultMode: "prefer", defaultMissing: "pass", defaultWeight: 10, defaultValue: { match: "any" }, editableAfterApproval: true, completenessWeight: 8, coverageHint: {} },
  { key: "education_stream", label: "Stream", group: "who", home: "selection_rules", ops: ["any_of"],
    defaultMode: "prefer", defaultMissing: "pass", defaultWeight: 5, editableAfterApproval: true, completenessWeight: 0, coverageHint: {} },
  { key: "education_completed", label: "Qualification completed", group: "who", home: "selection_rules", ops: ["completed", "pursuing_ok"],
    defaultMode: "prefer", defaultMissing: "pass", defaultWeight: 5, defaultValue: "completed", editableAfterApproval: true, completenessWeight: 0, coverageHint: {} },
  { key: "employer_include", label: "Previous employer is", group: "history", home: "selection_rules", ops: ["any_of"],
    defaultMode: "prefer", defaultMissing: "pass", defaultWeight: 10, editableAfterApproval: true, completenessWeight: 0, coverageHint: { naukri_import: "known for 80%" } },
  { key: "rejected_other_process", label: "Rejected in another process before", group: "history", home: "selection_rules", ops: ["minus_weight"],
    defaultMode: "prefer", defaultMissing: "pass", defaultWeight: 10, editableAfterApproval: true, completenessWeight: 0, coverageHint: {} },
  { key: "location_radius", label: "Within N km of the branch", group: "where", home: "column", columns: ["meta_target_radius_km"], ops: ["lte_km"],
    defaultMode: "prefer", defaultMissing: "pass", defaultWeight: 5, editableAfterApproval: true, completenessWeight: 0,
    coverageHint: { meta_live: "never known (no coordinates)", naukri_import: "never known (no coordinates)", workindia_import: "never known (no coordinates)", candidate: "never known (no coordinates)" } },
];

const BY_KEY = new Map(RULE_CATALOGUE.map((e) => [e.key, e]));

export function catalogueEntry(key: RuleKey): CatalogueEntry {
  const e = BY_KEY.get(key);
  if (!e) throw new Error(`no catalogue entry for ${key}`);
  return e;
}
