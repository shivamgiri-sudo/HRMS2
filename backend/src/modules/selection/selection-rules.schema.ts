// job_requisition.selection_rules: parse, validate and resolve (plan 2026-10-09, S3).
// Structural checks are zod (strict: unknown keys are refused); then rule-level and cross-rule checks for settings
// that contradict each other or can never be met. Row-level checks that need the requisition columns are S4.
import { z } from "zod";
import { catalogueEntry } from "./rule-catalogue.js";
import {
  MAX_WEIGHT, MISSING_POLICIES, RULE_KEYS, RULE_MODES, SOURCE_KINDS, SUB_SOURCES,
  type MissingPolicy, type RuleKey, type RuleSetting, type SelectionRules, type SourceKind, type SubSource, type ValueRuleKey,
} from "./selection-types.js";

const nonBlank = z.string().max(120).refine((s) => s.trim().length > 0, "must not be blank");
const HE_SUB_SOURCES = SUB_SOURCES.filter((s) => s !== "meta_live" && s !== "meta_old");

// A source token is a sub-source, "he" (every pool sub-source) or "<sub-source>:<source_details>".
const sourceToken = z.string().refine((t) => {
  const i = t.indexOf(":");
  const base = i < 0 ? t : t.slice(0, i);
  const detail = i < 0 ? null : t.slice(i + 1);
  if (base !== "he" && !(SUB_SOURCES as readonly string[]).includes(base)) return false;
  return detail === null || (detail.trim().length > 0 && detail.length <= 120);
}, (t) => ({ message: `unknown source "${t}"` }));

const VALUE_SCHEMAS: Record<ValueRuleKey, z.ZodTypeAny> = {
  education_stream: z.array(nonBlank).min(1).max(20),
  education_completed: z.enum(["completed", "pursuing_ok"]),
  skills: z.object({ match: z.enum(["any", "all", "at_least"]), n: z.number().int().min(1).max(50).optional() }).strict(),
  relocation_ok: z.boolean(),
  salary_fit: z.object({ maxRatio: z.number().min(1).max(3) }).strict(),
  notice_period: z.object({ maxDays: z.number().int().min(0).max(365) }).strict(),
  certificate: z.object({ level: z.enum(["declared", "verified"]) }).strict(),
  employer_include: z.array(nonBlank).min(1).max(50),
  employer_exclude: z.array(nonBlank).min(1).max(50),
  ex_employee: z.enum(["allow_clean", "exclude"]),
  record_age: z.object({ maxDays: z.number().int().min(1).max(3650) }).strict(),
  contact_recent: z.object({ days: z.number().int().min(1).max(90) }).strict(),
  valid_email: z.boolean(),
  sources: z.object({ exclude: z.array(sourceToken).max(50) }).strict(),
};
const isValueKey = (k: RuleKey): k is ValueRuleKey => k in VALUE_SCHEMAS;

const policy = z.enum(MISSING_POLICIES as [MissingPolicy, ...MissingPolicy[]]);
const sourceKeys = [...new Set<string>([...SUB_SOURCES, ...SOURCE_KINDS])];
const settingSchema = z.object({
  mode: z.enum(RULE_MODES as [string, ...string[]]),
  decided: z.boolean().optional(),
  weight: z.number().int().min(0).max(MAX_WEIGHT).optional(),
  missing: policy.optional(),
  missingBySource: z.object(Object.fromEntries(sourceKeys.map((k) => [k, policy.optional()]))).strict().optional(),
  value: z.unknown().optional(),
}).strict();

const ruleKeyEnum = z.enum(RULE_KEYS as unknown as [RuleKey, ...RuleKey[]]);
const rootSchema = z.object({
  schema: z.literal(1),
  rules: z.object(Object.fromEntries(RULE_KEYS.map((k) => [k, settingSchema.optional()]))).strict(),
  order: z.array(ruleKeyEnum).max(RULE_KEYS.length * 2).optional(),
  enrolment: z.object({ mode: z.enum(["off", "hr_approves"]), standingApprovalDays: z.number().int().min(0).max(30) }).strict().optional(),
  template: z.object({ id: z.string().min(1).max(64), version: z.number().int().min(1), appliedAt: z.string().min(1).max(40), appliedBy: z.string().min(1).max(64) }).strict().optional(),
}).strict();

export type ParseResult =
  | { ok: true; legacy: boolean; value: SelectionRules; warnings: string[] }
  | { ok: false; errors: string[] };

export function emptySelectionRules(): SelectionRules {
  return { schema: 1, rules: {} };
}

const zodErrors = (e: z.ZodError, prefix = "") =>
  e.issues.map((i) => `${[prefix, ...i.path.map(String)].filter(Boolean).join(".") || "selection_rules"}: ${i.message}`);
const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function checkRule(key: RuleKey, s: RuleSetting, errors: string[], warnings: string[]) {
  const at = `rules.${key}`;
  const entry = catalogueEntry(key);
  if (s.mode === "must" && (s.weight ?? 0) > 0) errors.push(`${at}: a weight applies to PREFER rules only`);
  if (s.mode === "prefer") {
    if (s.missing === "fail" || Object.values(s.missingBySource ?? {}).includes("fail")) {
      errors.push(`${at}: a PREFER rule cannot reject on missing data (missing = fail)`);
    } else if (s.missing !== undefined || s.missingBySource !== undefined) {
      warnings.push(`${at}: the missing-data policy is ignored for PREFER rules (unknown adds nothing)`);
    }
    if (s.weight === 0) warnings.push(`${at}: PREFER with weight 0 has no effect`);
  }
  if (s.mode !== "off" && s.decided === false) errors.push(`${at}: a rule that is on is decided; use mode off to leave it undecided`);

  if (!isValueKey(key)) {
    if (s.value !== undefined) errors.push(`${at}: the value lives in the requisition column (or meta_screening_config), not in selection_rules`);
    return;
  }
  if (s.value === undefined) {
    if (s.mode !== "off" && entry.defaultValue === undefined) errors.push(`${at}: needs a value when the rule is on`);
    return;
  }
  const v = VALUE_SCHEMAS[key].safeParse(s.value);
  if (!v.success) { errors.push(...zodErrors(v.error, `${at}.value`)); return; }
  const value = v.data as unknown;
  if (key === "skills") {
    const sk = value as { match: string; n?: number };
    if (sk.match === "at_least" && sk.n === undefined) errors.push(`${at}: 'at least' needs n`);
    if (sk.match !== "at_least" && sk.n !== undefined) errors.push(`${at}: n is only used with 'at least'`);
  }
  if (key === "ex_employee" && value === "exclude" && s.mode === "prefer") errors.push(`${at}: excluding former employees (ex_employee) is a MUST rule`);
  if ((key === "relocation_ok" || key === "valid_email") && value === false && s.mode !== "off") errors.push(`${at}: value false: turn the rule off instead`);
}

function checkCrossRule(r: SelectionRules, errors: string[]) {
  const inc = r.rules.employer_include, exc = r.rules.employer_exclude;
  if (inc && exc && inc.mode !== "off" && exc.mode !== "off" && Array.isArray(inc.value) && Array.isArray(exc.value)) {
    const excluded = new Set(exc.value.map(normName));
    for (const name of inc.value) if (excluded.has(normName(name))) errors.push(`rules.employer_*: employer ${name.trim()} is on both the include and exclude lists`);
  }
  const src = r.rules.sources;
  const exclude = src && src.mode !== "off" ? (src.value as { exclude?: string[] } | undefined)?.exclude ?? [] : [];
  const covered = new Set(exclude.filter((t) => !t.includes(":")).flatMap((t) => (t === "he" ? HE_SUB_SOURCES : [t])));
  if (SUB_SOURCES.every((s) => covered.has(s))) errors.push("rules.sources: every source is excluded, so nobody can ever be selected");
  const seen = new Set<string>();
  for (const k of r.order ?? []) {
    if (seen.has(k)) errors.push(`order: ${k} appears twice`);
    seen.add(k);
  }
}

/** Parses job_requisition.selection_rules. null/undefined = legacy (no metadata: every key compiles in legacy mode). */
export function parseSelectionRules(raw: unknown): ParseResult {
  if (raw === null || raw === undefined) return { ok: true, legacy: true, value: emptySelectionRules(), warnings: [] };
  let input = raw;
  if (typeof input === "string") {
    try { input = JSON.parse(input); } catch { return { ok: false, errors: ["selection_rules: is not valid JSON"] }; }
  }
  const parsed = rootSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error) };
  const value = parsed.data as unknown as SelectionRules;
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const key of RULE_KEYS) {
    const s = value.rules[key] as RuleSetting | undefined;
    if (s) checkRule(key, s, errors, warnings);
  }
  checkCrossRule(value, errors);
  return errors.length ? { ok: false, errors } : { ok: true, legacy: false, value, warnings };
}

/** Missing-data policy for one rule and one source: HR per sub-source, HR per kind, HR general, catalogue per source, catalogue default. */
export function resolveMissing(key: RuleKey, setting: RuleSetting | undefined, sub: SubSource, kind: SourceKind): MissingPolicy {
  const e = catalogueEntry(key);
  return setting?.missingBySource?.[sub] ?? setting?.missingBySource?.[kind] ?? setting?.missing
    ?? e.defaultMissingBySource?.[sub] ?? e.defaultMissingBySource?.[kind] ?? e.defaultMissing;
}
