// validateCriteria: contradictions and impossible values across a requisition's criteria (plan 2026-10-09, S4). Pure.
// Errors block a save; warnings are shown and must be acknowledged. selection_rules-only checks live in the schema (S3).
import { locationVerdict } from "../hiring-engine/he-location-match.js";
import { CERT_FIELD_PATTERNS } from "../meta-campaign/lead-screener.service.js";
import { compileCriteria, type RequisitionCriteriaRow } from "./compile-criteria.js";
import { splitList } from "./compile-rules.js";
import { catalogueEntry } from "./rule-catalogue.js";
import { parseSelectionRules } from "./selection-rules.schema.js";
import { RULE_KEYS, type RuleKey, type RuleSetting } from "./selection-types.js";

export interface CriteriaIssue { level: "error" | "warning"; keys: RuleKey[]; text: string }

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const keyOf = (msg: string): RuleKey[] => {
  const m = msg.match(/^rules\.([a-z_]+)/);
  return m && (RULE_KEYS as readonly string[]).includes(m[1]) ? [m[1] as RuleKey] : [];
};

/** Column-backed keys: a rule switched on in selection_rules needs its column value. */
const HAS_VALUE: Partial<Record<RuleKey, (r: RequisitionCriteriaRow, cfg: Record<string, unknown>) => boolean>> = {
  education_min: (r) => !!r.educationRequirement?.trim(),
  age: (r) => num(r.ageMin) != null || num(r.ageMax) != null,
  experience: (r) => num(r.experienceMinYears) != null || num(r.experienceMaxYears) != null,
  location_cities: (r) => !!r.targetLocations?.length,
  location_radius: (r) => (num(r.radiusKm) ?? 0) > 0,
  skills: (r) => !!r.skillsRequired?.trim(),
  salary_fit: (r) => (num(r.salaryMax) ?? 0) > 0,
  night_shift: (r) => Number(r.nightShiftRequired ?? 0) === 1,
  rotational_shift: (r) => Number(r.rotationalShift ?? 0) === 1,
  gender: (_r, c) => c.gender === "male" || c.gender === "female",
  languages: (_r, c) => Array.isArray(c.language_requirements) && c.language_requirements.length > 0,
  english: (_r, c) => !!c.written_english_level,
  typing: (_r, c) => (num(c.min_typing_speed_wpm) ?? 0) > 0,
  form_answer: (_r, c) => Array.isArray(c.custom_field_rules) && c.custom_field_rules.length > 0,
  certificate: (_r, c) => Array.isArray(c.certifications) && c.certifications.length > 0,
};

export function validateCriteria(r: RequisitionCriteriaRow): CriteriaIssue[] {
  const out: CriteriaIssue[] = [];
  const err = (keys: RuleKey[], text: string) => out.push({ level: "error", keys, text });
  const warn = (keys: RuleKey[], text: string) => out.push({ level: "warning", keys, text });
  const cfg = (typeof r.screeningConfig === "string" ? JSON.parse(r.screeningConfig) : r.screeningConfig ?? {}) as Record<string, unknown>;
  const rules = (r.selectionRules?.rules ?? {}) as Partial<Record<RuleKey, RuleSetting>>;
  const modeOf = (k: RuleKey, columnDefault: "must" | "prefer" | "off") => rules[k]?.mode ?? (r.selectionRules ? (HAS_VALUE[k]?.(r, cfg) ? catalogueEntry(k).defaultMode : "off") : columnDefault);

  if (r.selectionRules != null) {
    const p = parseSelectionRules(r.selectionRules);
    if (!p.ok) for (const e of p.errors) err(keyOf(e), e);
    else for (const w of p.warnings) warn(keyOf(w), w);
  }

  const aMin = num(r.ageMin), aMax = num(r.ageMax);
  if (aMin != null && aMax != null && aMin > aMax) err(["age"], `Age band ${aMin} to ${aMax}: the minimum is above the maximum`);
  if (aMax != null && aMax < 18) err(["age"], "The age band is entirely under 18");
  const eMin = num(r.experienceMinYears), eMax = num(r.experienceMaxYears);
  if (eMin != null && eMax != null && eMin > eMax) err(["experience"], `Experience ${eMin} to ${eMax} years: the minimum is above the maximum`);
  const sMin = num(r.salaryMin), sMax = num(r.salaryMax);
  if (sMin != null && sMax != null && sMin > sMax) err(["salary_fit"], `Salary band ${sMin} to ${sMax}: the minimum is above the maximum`);
  const radius = num(r.radiusKm);
  if (radius != null && (radius <= 0 || radius > 200)) err(["location_radius"], `Radius ${radius} km must be between 1 and 200`);

  if (rules.location_region?.mode === "must") {
    for (const city of r.targetLocations ?? []) {
      if (locationVerdict(city, r.branchName, r.branchCity, r.branchState) === "elsewhere") {
        err(["location_cities", "location_region"], `Target city ${city} is outside the ${r.branchCity ?? r.branchName} area while "Lives in the branch area" is MUST`);
      }
    }
  }
  const shift = String(r.shiftRequirement ?? "");
  if (Number(r.nightShiftRequired ?? 0) === 1 && modeOf("night_shift", "must") === "must" && /\bday\b/i.test(shift) && !/night|rotational/i.test(shift)) {
    err(["night_shift"], `Night shift is MUST but the shift says "${shift}" (day only)`);
  }
  if (modeOf("certificate", "must") === "must") {
    for (const code of (cfg.certifications as unknown[] | undefined) ?? []) {
      if (!CERT_FIELD_PATTERNS[String(code).toUpperCase()]) err(["certificate"], `Certificate ${String(code)} is not a known certificate (${Object.keys(CERT_FIELD_PATTERNS).join(", ")})`);
    }
  }
  for (const rule of (cfg.custom_field_rules as Array<{ field?: string }> | undefined) ?? []) {
    if (!String(rule.field ?? "").trim()) err(["form_answer"], "A form answer rule has no field");
  }
  for (const [k, s] of Object.entries(rules) as Array<[RuleKey, RuleSetting]>) {
    if (s && s.mode !== "off" && HAS_VALUE[k] && !HAS_VALUE[k]!(r, cfg)) err([k], `${k} (${catalogueEntry(k).label}) is ${s.mode.toUpperCase()} but has no value`);
  }

  // Warnings
  const c = compileCriteria(r);
  const musts = c.rules.filter((x) => x.mode === "must");
  if (!c.legacy && musts.length && musts.every((x) => x.missing === "pass" && Object.values(x.missingBySource ?? {}).every((v) => v === "pass"))) {
    warn([], "Every MUST rule lets missing data pass: people with unknown facts are shortlisted unchecked");
  }
  if (eMin != null && aMax != null && eMin > aMax - 18) warn(["experience", "age"], `Experience from ${eMin} years is more than an age band up to ${aMax} allows`);
  if ((num(cfg.min_typing_speed_wpm) ?? 0) > 60) warn(["typing"], `Typing ${String(cfg.min_typing_speed_wpm)} wpm is above 60: very few people will pass`);
  const skillsMatch = (rules.skills?.value as { match?: string } | undefined)?.match;
  if (skillsMatch === "all" && splitList(r.skillsRequired).length > 10) warn(["skills"], "More than 10 skills with \"all\": almost nobody will match every one");
  const certs = ((cfg.certifications as unknown[] | undefined) ?? []).map((x) => String(x).toUpperCase());
  if (certs.includes("DRA") && !/collect|recover|dra|npa/i.test(String(r.processName ?? ""))) warn(["certificate"], `DRA is asked on ${r.processName ?? "a process"} that is not a collections process`);
  if (rules.notice_period?.mode === "must") warn(["notice_period"], "Notice period MUST: only about 10% of Naukri records state it");
  const age = c.rules.find((x) => x.key === "age" && (!x.only || x.only.includes("meta_live")));
  if (r.hasLiveMetaCampaign && age?.mode === "must" && (age.missingBySource?.meta_live ?? age.missing) === "review") {
    warn(["age"], "Age is MUST and unknown goes to review, but Live Meta forms never ask age: every Meta lead will wait for HR");
  }
  return out;
}
