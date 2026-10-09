// What accepting text suggestions writes (S-O8): one CriteriaPatch for saveRequisitionCriteria, the only write path. Pure.
// Values go where the catalogue keeps them (column, meta_screening_config or selection_rules); each accepted rule is recorded as
// decided with its MUST/PREFER mode. Existing rules, config keys and list entries are kept; lists are merged.
import { normaliseLanguageRequirements } from "../meta-campaign/lead-screener.service.js";
import type { RequisitionCriteriaRow } from "./compile-criteria.js";
import { catalogueEntry } from "./rule-catalogue.js";
import type { RuleKey, RuleMode, RuleSetting, SelectionRules } from "./selection-types.js";
import type { CriteriaPatch } from "./templates.js";
import type { JdSuggestion } from "./jd-suggestions.js";

const BOUNDS = { wpm: [10, 120], years: [0, 40] } as const;
const NEEDS_TEXT = { wpm: "Typing speed needs a number (wpm): the text gives none", years: "Experience needs a number of years: the text gives none" } as const;
const RANGE_TEXT = { wpm: "Typing speed must be between 10 and 120 wpm", years: "Experience must be between 0 and 40 years" } as const;

function cfgOf(r: RequisitionCriteriaRow): Record<string, unknown> {
  const c = r.screeningConfig as unknown;
  if (typeof c === "string") { try { return JSON.parse(c) as Record<string, unknown>; } catch { return {}; } }
  return c && typeof c === "object" ? (c as Record<string, unknown>) : {};
}

function setting(key: RuleKey, mode: RuleMode, value?: unknown): RuleSetting {
  if (mode === "off") return { mode: "off", decided: true };
  const s: RuleSetting = { mode, decided: true };
  if (mode === "prefer") s.weight = catalogueEntry(key).defaultWeight ?? 10;
  if (value !== undefined) s.value = value;
  return s;
}

/**
 * The patch for these accepted suggestions. `values` holds HR's number for suggestions that "need" one (by suggestion id).
 * Errors (a missing or out-of-range number) mean nothing may be saved.
 */
export function patchFromSuggestions(r: RequisitionCriteriaRow, picks: JdSuggestion[], values: Record<string, number> = {}): { patch: CriteriaPatch; errors: string[] } {
  const errors: string[] = [];
  const patch: CriteriaPatch = {};
  const p = patch as Record<string, unknown>;
  const cfg: Record<string, unknown> = {};
  const stored = cfgOf(r);
  const rules: SelectionRules["rules"] = { ...(r.selectionRules?.rules ?? {}) };
  const put = (key: RuleKey, s: RuleSetting) => { (rules as Record<string, RuleSetting>)[key] = s; };
  let skills = r.skillsRequired ?? "";
  let skillsMode: RuleMode | null = null;
  for (const s of picks) {
    const v = s.value;
    let n: number | null = null;
    if (s.needs) {
      const given = values[s.id];
      if (given === undefined || given === null || !Number.isFinite(Number(given))) { errors.push(NEEDS_TEXT[s.needs]); continue; }
      n = Number(given);
      const [lo, hi] = BOUNDS[s.needs];
      if (n < lo || n > hi) { errors.push(RANGE_TEXT[s.needs]); continue; }
    }
    switch (s.key) {
      case "education_min": p.educationRequirement = v.level; put(s.key, setting(s.key, s.mode)); break;
      case "typing": cfg.min_typing_speed_wpm = n ?? v.wpm; put(s.key, setting(s.key, s.mode)); break;
      case "english": cfg.written_english_level = v.level; put(s.key, setting(s.key, s.mode)); break;
      case "languages": {
        const base = normaliseLanguageRequirements(cfg.language_requirements ?? stored.language_requirements);
        for (const l of v.languages as string[]) if (!base.some((b) => b.language.toLowerCase() === l.toLowerCase())) base.push({ language: l, skills: ["speak"] });
        cfg.language_requirements = base;
        put(s.key, setting(s.key, s.mode));
        break;
      }
      case "certificate": {
        const base = ((cfg.certifications ?? stored.certifications) as unknown[] | undefined ?? []).map((c) => String(c).toUpperCase());
        for (const c of v.codes as string[]) if (!base.includes(c)) base.push(c);
        cfg.certifications = base;
        put(s.key, setting(s.key, s.mode, { level: "declared" }));
        break;
      }
      case "experience":
        if (s.mode !== "off") {
          if (n !== null) p.experienceMinYears = n;
          else { if (v.min !== null && v.min !== undefined) p.experienceMinYears = v.min; if (v.max !== null && v.max !== undefined) p.experienceMaxYears = v.max; }
        }
        put(s.key, setting(s.key, s.mode));
        break;
      case "age":
        if (v.min !== null && v.min !== undefined) p.ageMin = v.min;
        if (v.max !== null && v.max !== undefined) p.ageMax = v.max;
        put(s.key, setting(s.key, s.mode));
        break;
      case "night_shift":
        if (s.mode === "off") {
          if (!r.shiftRequirement?.trim()) p.shiftRequirement = "Day";
          if (Number(r.nightShiftRequired ?? 0) === 1) p.nightShiftRequired = 0;
        } else {
          p.nightShiftRequired = 1;
          if (!r.shiftRequirement?.trim()) p.shiftRequirement = "Night";
        }
        put(s.key, setting(s.key, s.mode));
        break;
      case "rotational_shift": p.rotationalShift = 1; put(s.key, setting(s.key, s.mode)); break;
      case "location_cities": {
        const base = [...((p.targetLocations as string[] | undefined) ?? r.targetLocations ?? [])];
        for (const c of v.cities as string[]) if (!base.some((b) => b.toLowerCase() === c.toLowerCase())) base.push(c);
        p.targetLocations = base;
        put(s.key, setting(s.key, s.mode));
        break;
      }
      case "notice_period": put(s.key, setting(s.key, s.mode, { maxDays: v.maxDays })); break;
      case "skills": {
        const kw = String(v.keyword);
        if (!skills.split(/[,;\n]+/).some((x) => x.trim().toLowerCase() === kw.toLowerCase())) skills = skills.trim() ? `${skills.trimEnd()}\n${kw}` : kw;
        skillsMode = skillsMode === "must" || s.mode === "must" ? "must" : s.mode;
        break;
      }
      default: errors.push(`${s.key} cannot be accepted from text`);
    }
  }
  if (skillsMode) {
    p.skillsRequired = skills;
    const existing = r.selectionRules?.rules?.skills as RuleSetting | undefined;
    const mode: RuleMode = existing?.mode === "must" ? "must" : skillsMode;
    put("skills", { ...setting("skills", mode), value: (existing?.value as object | undefined) ?? { match: "any" } });
  }
  if (Object.keys(cfg).length) patch.screeningConfig = cfg as CriteriaPatch["screeningConfig"];
  if (picks.length && !errors.length) patch.selectionRules = { ...(r.selectionRules ?? {}), schema: 1, rules } as SelectionRules;
  return { patch: errors.length ? {} : patch, errors };
}
