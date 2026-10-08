// Criteria templates (plan 2026-10-09, S4; values from meta-campaign/shortlist-criteria.ts and the agreed rules). Pure.
// A template is only ever copied INTO a requisition (the requisition stays the single source of truth). With
// replaceFilled false, every rule whose requisition value or setting is already filled is skipped as a whole.
import type { MetaScreeningConfig } from "../job-requisition/job-requisition.types.js";
import type { RequisitionCriteriaRow } from "./compile-criteria.js";
import type { RuleKey, RuleSetting, SelectionRules } from "./selection-types.js";

export type CriteriaPatch = Partial<Pick<RequisitionCriteriaRow,
  "educationRequirement" | "skillsRequired" | "experienceMinYears" | "experienceMaxYears" | "ageMin" | "ageMax" | "targetLocations" | "radiusKm" | "shiftRequirement" | "nightShiftRequired" | "rotationalShift">>
  & { screeningConfig?: Omit<MetaScreeningConfig, "auto_notify">; selectionRules?: SelectionRules };

type ColumnField = Exclude<keyof CriteriaPatch, "screeningConfig" | "selectionRules">;
export const COLUMN_RULE: Record<ColumnField, RuleKey> = {
  educationRequirement: "education_min", skillsRequired: "skills", experienceMinYears: "experience", experienceMaxYears: "experience", ageMin: "age", ageMax: "age",
  targetLocations: "location_cities", radiusKm: "location_radius", shiftRequirement: "night_shift", nightShiftRequired: "night_shift", rotationalShift: "rotational_shift",
};
export const CONFIG_RULE: Record<string, RuleKey> = {
  gender: "gender", certifications: "certificate", language_requirements: "languages", written_english_level: "english", min_typing_speed_wpm: "typing", custom_field_rules: "form_answer",
};

interface TemplateDef {
  id: "telesales" | "night_shift_bpo" | "dra_collections" | "back_office"; version: number; label: string;
  columns: Partial<Record<ColumnField, unknown>>; config: Omit<MetaScreeningConfig, "auto_notify">; rules: SelectionRules["rules"];
}

const META_AGE_PASS = { meta_live: "pass", meta_old: "pass" } as const;
const CONTACT_7: RuleSetting<{ days: number }> = { mode: "must", missing: "pass", value: { days: 7 } };
const REGION: SelectionRules["rules"] = { location_region: { mode: "must", missing: "review" }, relocation_ok: { mode: "must", value: true } };

const DEFS: TemplateDef[] = [
  { id: "night_shift_bpo", version: 1, label: "Night-shift BPO (Onfido)",
    columns: { educationRequirement: "Graduate", nightShiftRequired: 1, shiftRequirement: "Night", ageMin: 18, ageMax: 35, experienceMinYears: 0, experienceMaxYears: 5, skillsRequired: "Computer basics, Typing, Customer support" },
    config: { written_english_level: "intermediate", min_typing_speed_wpm: 25 },
    rules: { education_min: { mode: "must", missing: "review" }, night_shift: { mode: "must", missing: "review" }, age: { mode: "must", missing: "review", missingBySource: META_AGE_PASS },
      english: { mode: "prefer", weight: 10 }, typing: { mode: "prefer", weight: 5 }, ...REGION, experience: { mode: "off", decided: true },
      skills: { mode: "prefer", weight: 10, value: { match: "any" } },
      notice_period: { mode: "prefer", weight: 5, value: { maxDays: 30 } }, contact_recent: CONTACT_7 } },
  { id: "dra_collections", version: 1, label: "DRA collections (SBI Ahmedabad)",
    columns: { educationRequirement: "12th", ageMin: 18, ageMax: 40 },
    config: { certifications: ["DRA"] },
    rules: { education_min: { mode: "must", missing: "review" }, certificate: { mode: "must", missing: "review", value: { level: "declared", verifiedBonus: 15 } }, ...REGION,
      age: { mode: "must", missing: "review", missingBySource: META_AGE_PASS }, experience: { mode: "off", decided: true },
      employer_include: { mode: "prefer", weight: 10, value: ["collection", "recovery", "bank", "finance", "bfsi"] }, contact_recent: CONTACT_7 } },
  { id: "telesales", version: 1, label: "Telesales (DZCV / 6GFX)",
    columns: { educationRequirement: "12th", ageMin: 18, ageMax: 35, skillsRequired: "Sales, Telecalling" },
    config: { written_english_level: "basic" },
    rules: { education_min: { mode: "must", missing: "review" }, ...REGION, age: { mode: "must", missing: "review", missingBySource: META_AGE_PASS },
      english: { mode: "must", missing: "review" }, skills: { mode: "prefer", weight: 10, value: { match: "any" } }, contact_recent: CONTACT_7 } },
  { id: "back_office", version: 1, label: "Back office",
    columns: { educationRequirement: "Graduate", shiftRequirement: "Day" },
    config: { min_typing_speed_wpm: 30, written_english_level: "intermediate" },
    rules: { education_min: { mode: "must", missing: "review" }, typing: { mode: "must", missing: "review" }, english: { mode: "must", missing: "review" },
      night_shift: { mode: "off", decided: true }, contact_recent: CONTACT_7 } },
];

export const TEMPLATES: ReadonlyArray<{ id: TemplateDef["id"]; version: number; label: string; patch: CriteriaPatch }> = DEFS.map((d) => ({
  id: d.id, version: d.version, label: d.label,
  patch: { ...(d.columns as CriteriaPatch), screeningConfig: d.config, selectionRules: { schema: 1, rules: d.rules } },
}));

export const TEMPLATE_ASKS_CERTIFICATE = new Set(DEFS.filter((d) => d.config.certifications?.length || d.rules.certificate).map((d) => d.id as string));

const filled = (v: unknown) => !(v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "string" && !v.trim()));
const cfgObject = (c: unknown): Record<string, unknown> => {
  if (typeof c === "string") { try { return JSON.parse(c); } catch { return {}; } }
  return c && typeof c === "object" ? { ...(c as Record<string, unknown>) } : {};
};

export function applyTemplate(r: RequisitionCriteriaRow, id: string, o: { replaceFilled: boolean; now?: Date; appliedBy?: string }): { patch: CriteriaPatch; skipped: RuleKey[] } {
  const t = DEFS.find((d) => d.id === id);
  if (!t) throw new Error(`unknown criteria template ${id}`);
  const cfg = cfgObject(r.screeningConfig);
  const existing = r.selectionRules?.rules ?? {};
  const skipped = new Set<RuleKey>();
  if (!o.replaceFilled) {
    for (const f of Object.keys(t.columns) as ColumnField[]) {
      const v = r[f];
      if (f === "nightShiftRequired" || f === "rotationalShift" ? Number(v ?? 0) === 1 : filled(v)) skipped.add(COLUMN_RULE[f]);
    }
    for (const k of Object.keys(t.config)) if (filled(cfg[k])) skipped.add(CONFIG_RULE[k]);
    for (const k of Object.keys(t.rules) as RuleKey[]) if (existing[k]) skipped.add(k);
  }
  const patch: CriteriaPatch = {};
  for (const [f, v] of Object.entries(t.columns) as Array<[ColumnField, unknown]>) if (!skipped.has(COLUMN_RULE[f])) (patch as Record<string, unknown>)[f] = v;
  let cfgChanged = false;
  for (const [k, v] of Object.entries(t.config)) if (!skipped.has(CONFIG_RULE[k])) { cfg[k] = v; cfgChanged = true; }
  if (cfgChanged) { delete cfg.auto_notify; patch.screeningConfig = cfg as CriteriaPatch["screeningConfig"]; }
  const rules: SelectionRules["rules"] = { ...existing };
  for (const [k, s] of Object.entries(t.rules) as Array<[RuleKey, RuleSetting]>) if (!skipped.has(k)) (rules as Record<string, RuleSetting>)[k] = s;
  patch.selectionRules = {
    ...(r.selectionRules ?? { schema: 1 }), schema: 1, rules,
    template: { id: t.id, version: t.version, appliedAt: (o.now ?? new Date()).toISOString(), appliedBy: o.appliedBy ?? "system" },
  };
  return { patch, skipped: [...skipped] };
}
