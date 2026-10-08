// Pure state of the criteria editor (S16): the draft, what changed (-> CriteriaPatch), whether it can be saved, locks, the
// "undecided rules act as MUST" banner, template skips and the what-if delta. No I/O.
import { DEFAULT_WEIGHT, RULE_INFO, VALUE_DEFAULTS, labelOf } from "./ruleInfo";
import type { CriteriaIssue, CriteriaPatch, CriteriaResponse, MissingPolicy, PreviewResult, RuleMode, RuleSetting, SelectionRules } from "./selectionTypes";

export type RowMode = RuleMode | "undecided";
export interface RowState { mode: RowMode; weight: number; missing: MissingPolicy; missingBySource: Record<string, MissingPolicy>; value: unknown; defaulted: boolean;
  /** Legacy requisitions: how today's screening treats this rule (null when it does not apply or HR rules are saved). */
  today?: "MUST" | "PREFER" | null }
export const COLUMN_KEYS = ["educationRequirement", "skillsRequired", "experienceMinYears", "experienceMaxYears", "ageMin", "ageMax", "targetLocations", "radiusKm", "shiftRequirement", "nightShiftRequired", "rotationalShift"] as const;
export type ColumnKey = (typeof COLUMN_KEYS)[number];
export const CONFIG_KEYS = ["gender", "written_english_level", "min_typing_speed_wpm", "certifications", "language_requirements"] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];
export interface Draft {
  rows: Record<string, RowState>; cols: Record<ColumnKey, string | boolean>; cfg: Record<ConfigKey, string>;
  approvalStatus: string | null; canEdit: boolean; legacy: boolean; base: SelectionRules | null; enrolmentMode: "off" | "hr_approves";
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : str((x as { language?: unknown })?.language))).filter(Boolean).join(", ") : "");

function todayMode(r: CriteriaResponse, key: string): "MUST" | "PREFER" | null {
  if (!r.compiled.legacy) return null;
  const hits = r.compiled.rules.filter((c) => c.key === key);
  return hits.some((c) => c.mode === "must") ? "MUST" : hits.some((c) => c.mode === "prefer") ? "PREFER" : null;
}

export function initDraft(r: CriteriaResponse): Draft {
  const row = r.row;
  const settings = row.selectionRules?.rules ?? {};
  const rows: Record<string, RowState> = {};
  for (const key of Object.keys(RULE_INFO)) {
    const s = settings[key];
    rows[key] = {
      mode: s ? s.mode : "undecided", weight: s?.weight ?? DEFAULT_WEIGHT[key] ?? 10, missing: s?.missing ?? "review", missingBySource: { ...(s?.missingBySource ?? {}) } as Record<string, MissingPolicy>,
      value: s?.value ?? VALUE_DEFAULTS[key], defaulted: r.compiled.rules.some((c) => c.key === key && c.defaulted),
      today: todayMode(r, key),
    };
  }
  const cfg = row.screeningConfig ?? {};
  return {
    rows,
    cols: {
      educationRequirement: str(row.educationRequirement), skillsRequired: str(row.skillsRequired), experienceMinYears: str(row.experienceMinYears), experienceMaxYears: str(row.experienceMaxYears),
      ageMin: str(row.ageMin), ageMax: str(row.ageMax), targetLocations: (row.targetLocations ?? []).join(", "), radiusKm: str(row.radiusKm), shiftRequirement: str(row.shiftRequirement),
      nightShiftRequired: Number(row.nightShiftRequired ?? 0) === 1, rotationalShift: Number(row.rotationalShift ?? 0) === 1,
    },
    cfg: { gender: cfg.gender === "male" || cfg.gender === "female" ? String(cfg.gender) : "", written_english_level: str(cfg.written_english_level), min_typing_speed_wpm: str(cfg.min_typing_speed_wpm),
      certifications: list(cfg.certifications), language_requirements: list(cfg.language_requirements) },
    approvalStatus: row.approvalStatus, canEdit: r.permissions.edit && row.approvalStatus !== "closed", legacy: r.compiled.legacy,
    base: row.selectionRules, enrolmentMode: row.selectionRules?.enrolment?.mode ?? "off",
  };
}

const withRow = (d: Draft, key: string, patch: Partial<RowState>): Draft => ({ ...d, rows: { ...d.rows, [key]: { ...d.rows[key], ...patch } } });
export const setMode = (d: Draft, key: string, mode: RowMode) => withRow(d, key, { mode });
export const setWeight = (d: Draft, key: string, weight: number) => withRow(d, key, { weight: Math.max(0, Math.min(50, Math.round(weight / 5) * 5)) });
export const setMissing = (d: Draft, key: string, missing: MissingPolicy, missingBySource?: Record<string, MissingPolicy>) => withRow(d, key, { missing, ...(missingBySource ? { missingBySource } : {}) });
export const setValue = (d: Draft, key: string, value: unknown) => withRow(d, key, { value });
export const decideNoRequirement = (d: Draft, key: string) => setMode(d, key, "off");
export const setColumn = (d: Draft, key: ColumnKey, v: string | boolean): Draft => ({ ...d, cols: { ...d.cols, [key]: v } });
export const setConfig = (d: Draft, key: ConfigKey, v: string): Draft => ({ ...d, cfg: { ...d.cfg, [key]: v } });
export const setEnrolment = (d: Draft, mode: "off" | "hr_approves"): Draft => ({ ...d, enrolmentMode: mode });

function rulesOf(d: Draft): Record<string, RuleSetting> {
  const out: Record<string, RuleSetting> = {};
  for (const [key, r] of Object.entries(d.rows)) {
    if (r.mode === "undecided") continue;
    if (r.mode === "off") { out[key] = { mode: "off", decided: true }; continue; }
    const s: RuleSetting = { mode: r.mode, decided: true };
    if (r.mode === "prefer") s.weight = r.weight;
    if (r.mode === "must") {
      s.missing = r.missing;
      if (Object.keys(r.missingBySource).length) s.missingBySource = r.missingBySource;
    }
    if (key in VALUE_DEFAULTS) s.value = r.value ?? VALUE_DEFAULTS[key];
    out[key] = s;
  }
  return out;
}
const num = (v: string | boolean) => (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
function colValue(key: ColumnKey, v: string | boolean): unknown {
  if (key === "nightShiftRequired" || key === "rotationalShift") return v ? 1 : 0;
  if (key === "targetLocations") { const a = String(v).split(",").map((s) => s.trim()).filter(Boolean); return a.length ? a : null; }
  if (["experienceMinYears", "experienceMaxYears", "ageMin", "ageMax", "radiusKm"].includes(key)) return num(v);
  return String(v).trim() || null;
}
function cfgValue(key: ConfigKey, v: string): unknown {
  if (key === "min_typing_speed_wpm") return num(v);
  if (key === "certifications" || key === "language_requirements") { const a = v.split(",").map((s) => s.trim()).filter(Boolean); return a.length ? (key === "certifications" ? a.map((x) => x.toUpperCase()) : a) : null; }
  return v || null;
}
const same = (a: unknown, b: unknown) => JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b));
function sortDeep(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(sortDeep);
  if (x && typeof x === "object") return Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortDeep((x as Record<string, unknown>)[k])]));
  return x;
}

/** Only what changed. Rules travel as the whole selection_rules object (the server replaces it). */
export function toPatch(d: Draft, initial: Draft): CriteriaPatch {
  const p: CriteriaPatch = {};
  for (const k of COLUMN_KEYS) if (d.cols[k] !== initial.cols[k]) (p as Record<string, unknown>)[k] = colValue(k, d.cols[k]);
  const cfg: Record<string, unknown> = {};
  for (const k of CONFIG_KEYS) if (d.cfg[k] !== initial.cfg[k]) cfg[k] = cfgValue(k, d.cfg[k]);
  if (Object.keys(cfg).length) p.screeningConfig = cfg;
  const rules = rulesOf(d);
  if (!same(rules, rulesOf(initial)) || d.enrolmentMode !== initial.enrolmentMode) {
    const sr: SelectionRules = { schema: 1, rules };
    if (d.base?.order) sr.order = d.base.order;
    if (d.base?.template) sr.template = d.base.template;
    if (d.enrolmentMode !== "off" || d.base?.enrolment) sr.enrolment = { mode: d.enrolmentMode, standingApprovalDays: d.base?.enrolment?.standingApprovalDays ?? 7 };
    p.selectionRules = sr;
  }
  return p;
}

export function canSave(d: Draft, initial: Draft, o: { reason: string; issues: CriteriaIssue[]; ackWarnings: boolean }): { ok: boolean; why: string | null } {
  if (!d.canEdit) return { ok: false, why: "This requisition's criteria are read-only for you" };
  if (!Object.keys(toPatch(d, initial)).length) return { ok: false, why: "Nothing to save" };
  if (d.approvalStatus === "approved" && !o.reason.trim()) return { ok: false, why: "A reason is required to change an approved requisition" };
  if (o.issues.some((i) => i.level === "error")) return { ok: false, why: "Fix the errors first" };
  if (o.issues.some((i) => i.level === "warning") && !o.ackWarnings) return { ok: false, why: "Tick that you have read the warnings" };
  return { ok: true, why: null };
}

export function isLocked(key: string, approvalStatus: string | null): string | null {
  if (approvalStatus === "closed") return "Closed requisitions are read-only";
  if (key === "salary_fit" && approvalStatus === "approved") return "Change needs re-approval";
  return null;
}

/** Rules that act as MUST only because nobody decided them, with how many people each sends to review or rejects now. */
export function bannerItems(d: Draft, preview: PreviewResult | null): Array<{ key: string; label: string; review: number; fail: number }> {
  return Object.entries(d.rows).filter(([, r]) => r.defaulted && r.mode === "undecided").map(([key]) => {
    const steps = preview?.steps.filter((s) => s.key === key) ?? [];
    return { key, label: labelOf(key), review: steps.reduce((n, s) => n + s.reviewHere, 0), fail: steps.reduce((n, s) => n + s.failedHere, 0) };
  });
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
export function previewDelta(saved: PreviewResult, draft: PreviewResult) {
  const rows: Array<[string, keyof PreviewResult["outcome"]]> = [["Shortlist", "shortlist"], ["Review", "review"], ["Rejected", "rejected"], ["Never contacted (system)", "systemExcluded"]];
  return rows.map(([label, k]) => ({ label, saved: saved.outcome[k], draft: draft.outcome[k], change: signed(draft.outcome[k] - saved.outcome[k]) }));
}

export const skippedText = (keys: string[]) => (keys.length ? `Kept, already filled: ${keys.map(labelOf).join(", ")}` : "");
