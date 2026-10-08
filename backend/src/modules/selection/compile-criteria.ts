// compileCriteria: one requisition row -> a versioned, ordered rule list (plan 2026-10-09, S4). Pure.
// Legacy mode (selection_rules NULL) reproduces today's two screeners rule for rule: Meta rules (only Meta sources) come from
// the columns + meta_screening_config with missing = pass (screenLead: unknown never disqualifies); drive rules (only the
// Hiring Engine pool) come from today's line-up requisition with missing = review (the strict line-up leaves unknowns out).
import { createHash } from "node:crypto";
import type { MetaScreeningConfig } from "../job-requisition/job-requisition.types.js";
import { legacyMatchRequisition, type MatchReqRow } from "../hiring-engine/he-match-requisition.js";
import type { MatchRequisition } from "../hiring-engine/he-matcher.js";
import { eduRank, isSoftRequirement } from "../meta-campaign/lead-screener.service.js";
import { catalogueEntry } from "./rule-catalogue.js";
import { completeness, WEIGHTED_DECIDABLE } from "./completeness.js";
import { requiredText, splitList, type Required } from "./compile-rules.js";
import {
  ENGINE_VERSION, RULE_KEYS, type CompiledCriteria, type CompiledRule, type MissingPolicy, type RuleKey, type RuleSetting, type SelectionRules, type SourceKind,
} from "./selection-types.js";

export interface RequisitionCriteriaRow {
  id: string; code: string; branchName: string; branchCity: string | null; branchState: string | null; branchLat?: number | null; branchLng?: number | null;
  processName: string | null;
  educationRequirement: string | null; skillsRequired: string | null; experienceMinYears: number | null; experienceMaxYears: number | null; ageMin: number | null; ageMax: number | null;
  targetLocations: string[] | null; radiusKm: number | null; shiftRequirement: string | null; nightShiftRequired: number | null; rotationalShift: number | null;
  salaryMin: number | null; salaryMax: number | null; preferredSources: string[] | null; screeningConfig: MetaScreeningConfig | null; selectionRules: SelectionRules | null;
  approvalStatus: string | null;
  /** For the "age MUST while Live Meta campaigns run" warning only. */
  hasLiveMetaCampaign?: boolean;
}

const META: SourceKind[] = ["meta_live", "meta_old"];
const HE: SourceKind[] = ["he"];
const n = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const blank = (v: string | null | undefined) => !v || !v.trim();
// screenLead checks gender before certificates and typing before English; legacy keeps that order so the first failing reason matches.
const LEGACY_ORDER: RuleKey[] = (() => {
  const o = [...RULE_KEYS] as RuleKey[];
  const swap = (a: RuleKey, b: RuleKey) => { const i = o.indexOf(a), j = o.indexOf(b); [o[i], o[j]] = [o[j], o[i]]; };
  swap("certificate", "gender");
  swap("english", "typing");
  return o;
})();

export function toMatchReqRow(r: RequisitionCriteriaRow) {
  return {
    id: r.id, branch_name: r.branchName, process_name: r.processName, designation_name: "", requested_headcount: 0, fulfilled_headcount: 0,
    approval_status: r.approvalStatus ?? "", active_status: 1, meta_target_age_min: r.ageMin, meta_target_age_max: r.ageMax, meta_target_radius_km: r.radiusKm,
    education_requirement: r.educationRequirement, experience_min_years: r.experienceMinYears, night_shift_required: Number(r.nightShiftRequired ?? 0),
    salary_max: r.salaryMax, meta_screening_config: r.screeningConfig, skills_required: r.skillsRequired,
    blat: r.branchLat ?? null, blng: r.branchLng ?? null, bcity: r.branchCity, bstate: r.branchState,
  };
}

/** The drive line-up's requisition row (MatchReqRow) as a criteria row, for requisitions that carry selection_rules. */
export function fromMatchReqRow(r: MatchReqRow, selectionRules: SelectionRules): RequisitionCriteriaRow {
  return {
    id: r.id, code: "", branchName: r.branch_name, branchCity: r.bcity ?? null, branchState: r.bstate ?? null, branchLat: n(r.blat), branchLng: n(r.blng), processName: r.process_name,
    educationRequirement: r.education_requirement, skillsRequired: r.skills_required ?? null, experienceMinYears: n(r.experience_min_years), experienceMaxYears: null,
    ageMin: n(r.meta_target_age_min), ageMax: n(r.meta_target_age_max), targetLocations: null, radiusKm: n(r.meta_target_radius_km), shiftRequirement: null,
    nightShiftRequired: Number(r.night_shift_required ?? 0), rotationalShift: 0, salaryMin: null, salaryMax: n(r.salary_max),
    preferredSources: null, screeningConfig: cfgOf({ screeningConfig: r.meta_screening_config } as RequisitionCriteriaRow), selectionRules, approvalStatus: r.approval_status,
  };
}

function cfgOf(r: RequisitionCriteriaRow): MetaScreeningConfig {
  const c = r.screeningConfig as unknown;
  if (typeof c === "string") { try { return JSON.parse(c) as MetaScreeningConfig; } catch { return {}; } }
  return (c && typeof c === "object" ? c : {}) as MetaScreeningConfig;
}

type Draft = { key: RuleKey; required: unknown; mode: "must" | "prefer"; weight: number; missing: MissingPolicy; missingBySource?: CompiledRule["missingBySource"]; origin: string; only?: SourceKind[] };
const finish = (d: Draft): CompiledRule => ({
  key: d.key, label: catalogueEntry(d.key).label, op: catalogueEntry(d.key).ops[0], required: d.required, requiredText: requiredText(d.key, d.required),
  mode: d.mode, weight: d.mode === "prefer" ? d.weight : 0, missing: d.missing, ...(d.missingBySource && Object.keys(d.missingBySource).length ? { missingBySource: d.missingBySource } : {}),
  origin: d.origin, ...(d.only ? { only: d.only } : {}),
});

/** The value each column/config-backed key has on the row, or null when blank. */
function columnValues(r: RequisitionCriteriaRow, cfg: MetaScreeningConfig, relocationOk: boolean): Partial<Record<RuleKey, unknown[]>> {
  const out: Partial<Record<RuleKey, unknown[]>> = {};
  const edu = r.educationRequirement?.trim() ?? "";
  if (n(r.ageMin) != null || n(r.ageMax) != null) out.age = [{ min: n(r.ageMin), max: n(r.ageMax) } satisfies Required["age"]];
  if (edu) out.education_min = [{ text: edu, rank: eduRank(edu), soft: isSoftRequirement(edu) } satisfies Required["education_min"]];
  if (n(r.experienceMinYears) != null || n(r.experienceMaxYears) != null) out.experience = [{ min: n(r.experienceMinYears), max: n(r.experienceMaxYears) }];
  if (Number(r.nightShiftRequired ?? 0) === 1) out.night_shift = [{}];
  if (Number(r.rotationalShift ?? 0) === 1) out.rotational_shift = [{}];
  if (r.targetLocations?.length) out.location_cities = [{ cities: r.targetLocations, relocationOk } satisfies Required["location_cities"]];
  if ((n(r.radiusKm) ?? 0) > 0) out.location_radius = [{ km: n(r.radiusKm)!, lat: r.branchLat ?? null, lng: r.branchLng ?? null }];
  if (!blank(r.skillsRequired)) out.skills = [{ skills: splitList(r.skillsRequired), match: "any" }];
  if ((n(r.salaryMax) ?? 0) > 0) out.salary_fit = [{ max: n(r.salaryMax)!, maxRatio: 1.25, expectationOnly: false }];
  if (cfg.gender === "male" || cfg.gender === "female") out.gender = [{ gender: cfg.gender }];
  if (cfg.certifications?.length) out.certificate = cfg.certifications.map((code) => ({ code: String(code).toUpperCase(), level: "declared", verifiedBonus: 0 }));
  const langs = normLangs(cfg.language_requirements);
  if (langs.length) out.languages = [{ langs }];
  if (cfg.written_english_level) out.english = [{ level: cfg.written_english_level }];
  if ((n(cfg.min_typing_speed_wpm) ?? 0) > 0) out.typing = [{ wpm: n(cfg.min_typing_speed_wpm)! }];
  if (cfg.custom_field_rules?.length) out.form_answer = cfg.custom_field_rules.map((rule) => ({ rule }));
  return out;
}

/** Language requirements as stored: {language, skills} objects, or plain strings on older rows (skills unknown -> []). */
export function normLangs(v: unknown): Array<{ language: string; skills: Array<"speak" | "read" | "write"> }> {
  if (!Array.isArray(v)) return [];
  return v.map((l) => (typeof l === "string" ? { language: l, skills: [] } : { language: String((l as { language?: unknown })?.language ?? ""), skills: Array.isArray((l as { skills?: unknown })?.skills) ? (l as { skills: Array<"speak" | "read" | "write"> }).skills : [] }))
    .filter((l) => l.language.trim());
}

function shiftDecided(r: RequisitionCriteriaRow) {
  return Number(r.nightShiftRequired ?? 0) === 1 || Number(r.rotationalShift ?? 0) === 1 || !blank(r.shiftRequirement);
}

function compileLegacy(r: RequisitionCriteriaRow, cfg: MetaScreeningConfig, m: MatchRequisition): Draft[] {
  const cols = columnValues(r, cfg, false);
  const out: Draft[] = [];
  const meta = (key: RuleKey) => (cols[key] ?? []).forEach((required) => out.push({ key, required, mode: "must", weight: 0, missing: "pass", origin: key === "age" || key === "education_min" || key === "experience" ? "column" : "meta_screening_config", only: META }));
  const he = (key: RuleKey, required: unknown, missing: MissingPolicy = "review") => out.push({ key, required, mode: "must", weight: 0, missing, origin: "line_up", only: HE });
  for (const key of LEGACY_ORDER) {
    switch (key) {
      case "age":
        meta("age");
        if (m.ageMin != null || m.ageMax != null) he("age", { min: m.ageMin ?? null, max: m.ageMax ?? null });
        break;
      case "education_min":
        meta("education_min");
        if (m.minEducationRank != null) he("education_min", { text: null, rank: m.minEducationRank, soft: false });
        break;
      case "experience":
        // screenLead and the line-up both check the minimum only
        if (n(r.experienceMinYears) != null) out.push({ key, required: { min: n(r.experienceMinYears), max: null }, mode: "must", weight: 0, missing: "pass", origin: "column", only: META });
        if ((n(m.minExperienceYears) ?? 0) > 0) he("experience", { min: n(m.minExperienceYears), max: null });
        break;
      case "night_shift": if (m.nightShift === true) he("night_shift", {}); break;
      case "location_region": he("location_region", { branchName: r.branchName, branchCity: r.branchCity, branchState: r.branchState, relocationOk: false }); break;
      case "gender":
        meta("gender");
        if (m.gender) he("gender", { gender: m.gender });
        break;
      case "certificate":
        meta("certificate");
        for (const code of m.certifications ?? []) he("certificate", { code, level: "declared", verifiedBonus: 0 });
        break;
      case "languages":
        meta("languages");
        if (m.languages?.length) he("languages", { langs: m.languages.map((language) => ({ language, skills: [] })) });
        break;
      case "typing": case "english": case "form_answer": meta(key); break;
      case "salary_fit": if (m.salaryMax) he("salary_fit", { max: m.salaryMax, maxRatio: 1.25, expectationOnly: true }, "pass"); break;
      case "skills": (cols.skills ?? []).forEach((required) => out.push({ key, required, mode: "prefer", weight: catalogueEntry("skills").defaultWeight ?? 10, missing: "pass", origin: "column" })); break;
      default: break;
    }
  }
  return out;
}

function settingValue<K extends RuleKey>(key: K, s: RuleSetting): unknown {
  return s.value ?? catalogueEntry(key).defaultValue;
}

function compileRules(r: RequisitionCriteriaRow, cfg: MetaScreeningConfig, sr: SelectionRules, decided: Set<RuleKey>): Draft[] {
  const reloc = sr.rules.relocation_ok;
  const relocationOk = !!reloc && reloc.mode !== "off" && settingValue("relocation_ok", reloc) !== false;
  if (reloc && (reloc.mode !== "off" || reloc.decided)) decided.add("relocation_ok");
  const cols = columnValues(r, cfg, relocationOk);
  const order = [...new Set([...(sr.order ?? []), ...RULE_KEYS])] as RuleKey[];
  const out: Draft[] = [];
  for (const key of order) {
    if (key === "relocation_ok") continue;
    const entry = catalogueEntry(key);
    const s = sr.rules[key] as RuleSetting | undefined;
    const col = cols[key];
    if (!s) {
      if (col && entry.home !== "selection_rules" && key !== "location_region") {
        decided.add(key);
        for (const required of col) out.push(draftOf(key, required, { mode: entry.defaultMode === "off" ? "must" : entry.defaultMode }, entry.home));
      }
      continue;
    }
    if (s.mode === "off") { if (s.decided) decided.add(key); continue; }
    const requireds = requiredFor(key, s, r, col, relocationOk);
    if (!requireds.length) continue; // on, but no value: validateCriteria reports it; never a silent rule
    decided.add(key);
    for (const required of requireds) out.push(draftOf(key, required, s, entry.home));
  }
  return out;
}

function draftOf(key: RuleKey, required: unknown, s: Pick<RuleSetting, "mode" | "weight" | "missing" | "missingBySource">, home: string): Draft {
  const e = catalogueEntry(key);
  const mode = s.mode === "prefer" ? "prefer" : "must";
  const missingBySource = { ...(s.missing === undefined ? e.defaultMissingBySource : {}), ...s.missingBySource };
  return { key, required, mode, weight: mode === "prefer" ? s.weight ?? e.defaultWeight ?? 10 : 0, missing: s.missing ?? e.defaultMissing, missingBySource, origin: home };
}

function requiredFor(key: RuleKey, s: RuleSetting, r: RequisitionCriteriaRow, col: unknown[] | undefined, relocationOk: boolean): unknown[] {
  const v = settingValue(key, s) as never;
  switch (key) {
    case "location_region": return [{ branchName: r.branchName, branchCity: r.branchCity, branchState: r.branchState, relocationOk }];
    case "skills": return col ? col.map((c) => ({ ...(c as object), ...(v as object) })) : [];
    case "salary_fit": return col ? [{ ...(col[0] as object), maxRatio: (v as { maxRatio?: number })?.maxRatio ?? 1.25 }] : [];
    case "certificate": return col ? col.map((c) => ({ ...(c as object), level: (v as { level?: string })?.level ?? "declared", verifiedBonus: (v as { verifiedBonus?: number })?.verifiedBonus ?? 0 })) : [];
    case "sources": {
      const include = r.preferredSources ?? [];
      const exclude = (v as { exclude?: string[] })?.exclude ?? [];
      return include.length || exclude.length ? [{ include, exclude }] : [];
    }
    case "education_stream": return [{ streams: v }];
    case "employer_exclude": case "employer_include": return [{ names: v }];
    case "education_completed": case "ex_employee": return [{ value: v }];
    case "notice_period": case "record_age": case "contact_recent": return v ? [v] : [];
    case "rejected_other_process": case "valid_email": return [{}];
    default: return col ?? [];
  }
}

function matchReqFor(base: MatchRequisition, rules: CompiledRule[], legacy: boolean): MatchRequisition {
  if (legacy) return base;
  const must = (k: RuleKey) => rules.find((x) => x.key === k && x.mode === "must")?.required as never;
  const any = (k: RuleKey) => rules.find((x) => x.key === k)?.required as never;
  const age = must("age") as Required["age"] | undefined;
  const edu = must("education_min") as Required["education_min"] | undefined;
  const exp = must("experience") as Required["experience"] | undefined;
  const g = must("gender") as Required["gender"] | undefined;
  const langs = must("languages") as Required["languages"] | undefined;
  const certs = rules.filter((x) => x.key === "certificate" && x.mode === "must").map((x) => (x.required as Required["certificate"]).code);
  const typing = any("typing") as Required["typing"] | undefined;
  const eng = any("english") as Required["english"] | undefined;
  const radius = any("location_radius") as Required["location_radius"] | undefined;
  const streams = any("education_stream") as Required["education_stream"] | undefined;
  return {
    ...base,
    ageMin: age?.min ?? null, ageMax: age?.max ?? null,
    minEducationRank: edu && edu.rank > 0 ? edu.rank : null,
    minExperienceYears: exp?.min ?? null,
    nightShift: rules.some((x) => x.key === "night_shift" && x.mode === "must"),
    gender: g?.gender ?? null,
    languages: langs ? langs.langs.map((l) => l.language.toLowerCase()) : null,
    certifications: certs.length ? certs : null,
    minTypingWpm: typing?.wpm ?? null, englishLevel: eng?.level ?? null,
    maxDistanceKm: radius?.km ?? base.maxDistanceKm ?? null,
    streams: streams?.streams ?? base.streams ?? null,
  };
}

/** Deterministic JSON: object keys sorted at every level. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function compileCriteria(r: RequisitionCriteriaRow, o: { versionId?: string | null } = {}): CompiledCriteria {
  const cfg = cfgOf(r);
  const legacy = r.selectionRules == null;
  const base = legacyMatchRequisition(toMatchReqRow(r));
  const decided = new Set<RuleKey>();
  const drafts = legacy ? compileLegacy(r, cfg, base) : compileRules(r, cfg, r.selectionRules!, decided);
  const rules = drafts.map(finish);
  const cols = columnValues(r, cfg, false);
  if (legacy) for (const k of WEIGHTED_DECIDABLE) if (cols[k]) decided.add(k);
  if (shiftDecided(r)) decided.add("night_shift");
  // Sources default to "all non-legacy sources" (S-O14), which is a decision.
  decided.add("sources");
  if (!legacy && decided.has("location_region")) decided.add("location_cities");
  const templateId = r.selectionRules?.template?.id ?? null;
  const decidedList = RULE_KEYS.filter((k) => decided.has(k));
  const undecided = (["education_min", "experience", "age", "location_cities", "night_shift"] as RuleKey[]).filter((k) => !decided.has(k));
  const matchReq = matchReqFor(base, rules, legacy);
  const hash = sha256(canonicalJson({ engineVersion: ENGINE_VERSION, rules, undecided, decided: decidedList, matchReq }));
  const partial = { requisitionId: r.id, versionId: o.versionId ?? null, hash, engineVersion: ENGINE_VERSION, rules, undecided, matchReq, legacy, decided: decidedList, templateId };
  return { ...partial, completeness: completeness(partial) };
}
