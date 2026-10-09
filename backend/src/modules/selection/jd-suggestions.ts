// Suggestions from a requisition's free text (plan 2026-10-09, S-O8). Pure, deterministic, rule-based: no LLM, no network.
// Prod holds the criteria as text in skills_required (and a few in business_justification); this reads that text into proposed
// rules for the existing catalogue. Nothing applies until HR accepts (jd-suggestions.service.ts -> saveRequisitionCriteria).
// Conservative: explicit must words => MUST, soft words => PREFER, unclear => PREFER (a stated qualification is MUST); numbers
// only when the text has them (else the suggestion "needs" HR's number); contradictions are reported, never resolved.
import { createHash } from "node:crypto";
import { CERT_FIELD_PATTERNS, normaliseLanguageRequirements } from "../meta-campaign/lead-screener.service.js";
import { canonicalJson, type RequisitionCriteriaRow } from "./compile-criteria.js";
import { splitList } from "./compile-rules.js";
import { catalogueEntry } from "./rule-catalogue.js";
import { detect, KEYWORD_ONLY, type Hit } from "./jd-detectors.js";
import type { RuleKey, RuleMode } from "./selection-types.js";

export { patchFromSuggestions } from "./jd-suggestions-patch.js";

export type JdField = "skills_required" | "job_description" | "shift_requirement" | "business_justification";
export type JdRequisition = RequisitionCriteriaRow & { jobDescription?: string | null; businessJustification?: string | null };
export type Confidence = "high" | "medium" | "low";
export interface JdSuggestion {
  /** Stable for the same text (dismissals are remembered by it, so they hold per text version). */
  id: string;
  key: RuleKey; mode: RuleMode; value: Record<string, unknown>;
  /** The proposed rule in plain words. */
  plain: string;
  /** The clause of the text it came from (exact substring) and the words that matched inside it. */
  phrase: string; matched: string; field: JdField;
  confidence: Confidence; why: string;
  /** The text gives no number: HR must type it before this can be accepted. */
  needs?: "wpm" | "years";
  note?: string;
}
export interface JdUnparsed { field: JdField; phrase: string; reason: string }
export interface JdSkipped { key: RuleKey; field: JdField; phrase: string; matched: string; reason: string }
export interface JdResult { suggestions: JdSuggestion[]; unparsed: JdUnparsed[]; skipped: JdSkipped[] }

const MAX_FIELD_CHARS = 50_000;
const MAX_UNPARSED = 20;
const FIELDS: Array<[JdField, (r: JdRequisition) => string | null | undefined]> = [
  ["skills_required", (r) => r.skillsRequired], ["job_description", (r) => r.jobDescription],
  ["shift_requirement", (r) => r.shiftRequirement], ["business_justification", (r) => r.businessJustification],
];
const NOT_UNDERSTOOD: Record<JdField, string | null> = {
  skills_required: "No matching rule; it stays in the Skills text as written", job_description: "Not understood", shift_requirement: "Not understood",
  business_justification: null, // the "why" of the requisition: only what is recognised is reported
};

/** Clauses of a text as exact substrings (newline, ; | ! ?, a comma not inside a number, a full stop before a space). */
function clauses(text: string): string[] {
  const t = text.length > MAX_FIELD_CHARS ? text.slice(0, MAX_FIELD_CHARS) : text;
  return t.split(/\r?\n|;|\||!|\?|(?<!\d),(?!\d)|\.(?=\s|$)/)
    .map((s) => s.replace(/^[\s*\-•●▪‣◦○#:>]+|[\s*\-•●▪‣◦○#:.]+$/g, "").replace(/^\d{1,2}[.)]\s+/, ""))
    .filter((s) => (s.match(/[a-z]/gi)?.length ?? 0) >= 3);
}

// ── modality ────────────────────────────────────────────────────────────────────────────────
const NEG = /\b(?:not|no|nahi|nahin)\s+(?:mandatory|required|compulsory|necessary|needed|must|zaroori|zaruri|jaruri)\b|\b(?:mandatory|required|compulsory|zaroori|zaruri|jaruri)\s+(?:nahi|nahin|not)\b|\boptional\b/i;
const MUST = /\b(must|mandatory|compulsory|required|requirement|essential|necessary|criteria|criterion|eligibility|minimum|min|at\s*least|atleast|only|zaroori|zaruri|jaruri|jaroori|anivarya)\b/i;
const SOFT = /\b(good|preferred|preferably|preferable|prefer|comfortable|desirable|desired|nice\s+to\s+have|plus|advantage|welcome|fluent|excellent|strong|decent|average|basic|achi|acchi|achha|accha|flexible|okay|ok)\b/i;
const STOP = /\b(?:with|and|or|plus|also|but)\b|&|\//i;

function lastWord(s: string): { kind: "must" | "soft"; word: string } | null {
  const re = new RegExp(`${MUST.source}|${SOFT.source}`, "gi");
  let m: RegExpExecArray | null, last: RegExpExecArray | null = null;
  while ((m = re.exec(s))) last = m;
  if (!last) return null;
  return { kind: MUST.test(last[0]) ? "must" : "soft", word: last[0] };
}

/** MUST / PREFER for a hit: words inside it and right after it first, then the nearest word before it, then the key's default. */
function modeOf(seg: string, h: Hit, field: JdField): { mode: "must" | "prefer"; why: string } {
  const after = seg.slice(h.end);
  const stop = after.search(STOP);
  const local = seg.slice(h.start, h.end) + " " + (stop < 0 ? after : after.slice(0, stop)).slice(0, 25);
  if (NEG.test(local)) return { mode: "prefer", why: `says "${local.match(NEG)![0].trim()}"` };
  const mw = local.match(MUST);
  if (mw) return { mode: "must", why: `says "${mw[0]}"` };
  const sw = local.match(SOFT);
  if (sw) return { mode: "prefer", why: `says "${sw[0]}"` };
  const before = seg.slice(0, h.start);
  if (NEG.test(before)) return { mode: "prefer", why: `says "${before.match(NEG)![0].trim()}"` };
  const lw = lastWord(before);
  if (lw) return { mode: lw.kind === "must" ? "must" : "prefer", why: `says "${lw.word}"` };
  if (h.key === "education_min") return { mode: "must", why: "a stated qualification is a requirement" };
  if (field === "shift_requirement") return { mode: "must", why: "the shift field states it" };
  return { mode: "prefer", why: "the wording is not explicit, so PREFER" };
}

// ── what the structured fields already decide ─────────────────────────────────────────────────
function cfgOf(r: JdRequisition): Record<string, unknown> {
  const c = r.screeningConfig as unknown;
  if (typeof c === "string") { try { return JSON.parse(c) as Record<string, unknown>; } catch { return {}; } }
  return c && typeof c === "object" ? (c as Record<string, unknown>) : {};
}
const has = (v: unknown) => v !== null && v !== undefined && v !== "";

/** Null when the hit is still open; otherwise why it is skipped. */
function alreadyDecided(r: JdRequisition, h: Hit): string | null {
  const rules = (r.selectionRules?.rules ?? {}) as Partial<Record<RuleKey, { mode: RuleMode; decided?: boolean }>>;
  const cfg = cfgOf(r);
  const label = catalogueEntry(h.key).label;
  const set = `Already set: ${label}`;
  if (h.key !== "skills" && h.key !== "languages" && h.key !== "certificate" && rules[h.key]) return `Already decided in the criteria: ${label}`;
  switch (h.key) {
    case "education_min": return r.educationRequirement?.trim() ? set : null;
    case "typing": return Number(cfg.min_typing_speed_wpm ?? 0) > 0 ? set : null;
    case "english": return cfg.written_english_level ? set : null;
    case "experience": return has(r.experienceMinYears) || has(r.experienceMaxYears) ? set : null;
    case "age": return has(r.ageMin) || has(r.ageMax) ? set : null;
    case "night_shift": return Number(r.nightShiftRequired ?? 0) === 1 ? set : null;
    case "rotational_shift": return Number(r.rotationalShift ?? 0) === 1 ? set : null;
    case "location_cities": return r.targetLocations?.length ? set : null;
    case "languages": {
      if (rules.languages?.mode === "off") return `Already decided in the criteria: ${label}`;
      const known = new Set(normaliseLanguageRequirements(cfg.language_requirements).map((l) => l.language.toLowerCase()));
      const left = (h.value.languages as string[]).filter((l) => !known.has(l.toLowerCase()));
      if (!left.length) return set;
      h.value = { languages: left };
      return null;
    }
    case "certificate": {
      if (rules.certificate?.mode === "off") return `Already decided in the criteria: ${label}`;
      const known = new Set(((cfg.certifications as unknown[] | undefined) ?? []).map((c) => String(c).toUpperCase()));
      const left = (h.value.codes as string[]).filter((c) => !known.has(c));
      if (!left.length) return set;
      h.value = { codes: left };
      return null;
    }
    case "skills": return splitList(r.skillsRequired).some((s) => s.toLowerCase() === String(h.value.keyword).toLowerCase()) ? `Already in Skills: ${String(h.value.keyword)}` : null;
    default: return null;
  }
}

// ── plain words ───────────────────────────────────────────────────────────────────────────────
function plainOf(key: RuleKey, mode: RuleMode, v: Record<string, unknown>): string {
  const n = (x: unknown) => (x === null || x === undefined ? null : Number(x));
  switch (key) {
    case "education_min": return `Minimum qualification: ${String(v.level)}`;
    case "typing": return v.wpm ? `Typing speed at least ${String(v.wpm)} wpm` : "Typing speed: you set the minimum wpm (the text gives no number)";
    case "english": return `English at least ${String(v.level)}`;
    case "languages": return `Speaks ${(v.languages as string[]).join(" and ")}`;
    case "experience": {
      if (mode === "off") return "No experience requirement (freshers welcome)";
      const lo = n(v.min), hi = n(v.max);
      if (lo === null && hi === null) return "Experience: you set the minimum years (the text gives no number)";
      if (hi === 0) return "Freshers only (no prior experience)";
      return lo !== null && hi !== null ? `Experience ${lo} to ${hi} years` : lo !== null ? `Experience at least ${lo} years` : `Experience at most ${hi} years`;
    }
    case "age": {
      const lo = n(v.min), hi = n(v.max);
      return lo !== null && hi !== null ? `Age ${lo} to ${hi}` : lo !== null ? `Age at least ${lo}` : `Age up to ${hi}`;
    }
    case "night_shift": return mode === "off" ? "No night shift (day shift)" : "Willing to work night shift";
    case "rotational_shift": return "OK with rotational shifts";
    case "location_cities": return `Lives in ${(v.cities as string[]).join(" or ")}`;
    case "certificate": return `Holds a ${(v.codes as string[]).join(" and ")} certificate`;
    case "notice_period": return Number(v.maxDays) === 0 ? "Can join immediately" : `Can join within ${String(v.maxDays)} days`;
    case "skills": return `Skills mention ${String(v.keyword)}`;
    default: return catalogueEntry(key).label;
  }
}

const EDU_ORDER = ["10th", "12th", "Diploma", "Graduate", "Post Graduate"];
const MULTI = new Set<RuleKey>(["languages", "location_cities", "certificate", "skills"]);
const STRONGER = (a: RuleMode, b: RuleMode): RuleMode => (a === "must" || b === "must" ? "must" : a);
const capConfidence = (c: Confidence, field: JdField): Confidence => (field === "business_justification" && c === "high" ? "medium" : c);
const idOf = (s: Pick<JdSuggestion, "field" | "key" | "value" | "matched" | "phrase">) =>
  createHash("sha1").update(`${s.field}|${s.key}|${canonicalJson(s.value)}|${s.matched.toLowerCase()}|${s.phrase}`).digest("hex").slice(0, 12);

/** The suggestions for one requisition: what its free text says that its structured criteria do not decide yet. */
export function suggestFromText(r: JdRequisition): JdResult {
  const found: JdSuggestion[] = [];
  const unparsed: JdUnparsed[] = [];
  const skipped: JdSkipped[] = [];
  const branchCity = (r.branchCity ?? r.branchName?.split(/[-\s]/)[0] ?? "").trim();
  for (const [field, get] of FIELDS) {
    const text = get(r);
    if (!text || !text.trim()) continue;
    for (const seg of clauses(text)) {
      const out = detect(seg, { field, branchCity });
      const hits = out.filter((x): x is Hit => "key" in x);
      for (const u of out) if ("reason" in u) unparsed.push({ field, phrase: seg, reason: u.reason });
      if (!out.length) {
        const reason = NOT_UNDERSTOOD[field];
        if (reason && !KEYWORD_ONLY.test(seg)) unparsed.push({ field, phrase: seg, reason });
        continue;
      }
      for (const h of hits) {
        const matched = seg.slice(h.start, h.end);
        const skip = alreadyDecided(r, h);
        if (skip) { skipped.push({ key: h.key, field, phrase: seg, matched, reason: skip }); continue; }
        const m = h.mode ? { mode: h.mode, why: h.why ?? "" } : modeOf(seg, h, field);
        const s: Omit<JdSuggestion, "id"> = {
          key: h.key, mode: m.mode, value: h.value, plain: plainOf(h.key, m.mode, h.value), phrase: seg, matched, field,
          confidence: capConfidence(h.confidence, field), why: m.why, ...(h.needs ? { needs: h.needs } : {}), ...(h.note ? { note: h.note } : {}),
        };
        found.push({ id: idOf(s), ...s });
      }
    }
  }
  const suggestions = combine(found, unparsed);
  const seen = new Set<string>();
  const unique = unparsed.filter((u) => { const k = `${u.field}|${u.phrase}|${u.reason}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { suggestions, unparsed: unique.slice(0, MAX_UNPARSED), skipped };
}

/** One suggestion per single-valued rule: equal values merge, the lowest education wins, other disagreements are contradictions. */
function combine(found: JdSuggestion[], unparsed: JdUnparsed[]): JdSuggestion[] {
  const out: JdSuggestion[] = [];
  const byKey = new Map<RuleKey, JdSuggestion[]>();
  for (const s of found) byKey.set(s.key, [...(byKey.get(s.key) ?? []), s]);
  const drop = new Set<JdSuggestion>();
  for (const [key, list] of byKey) {
    if (MULTI.has(key)) {
      const seenVals = new Map<string, JdSuggestion>();
      for (const s of list) {
        const k = canonicalJson(s.value);
        const first = seenVals.get(k);
        if (first) { first.mode = STRONGER(first.mode, s.mode); drop.add(s); } else seenVals.set(k, s);
      }
      continue;
    }
    if (list.length < 2) continue;
    let pool = list;
    if (key === "education_min" || key === "english") {
      const order = key === "education_min" ? EDU_ORDER : ["basic", "intermediate", "advanced"];
      const best = [...list].sort((a, b) => order.indexOf(String(a.value.level)) - order.indexOf(String(b.value.level)))[0];
      const others = list.filter((s) => s.value.level !== best.value.level);
      if (others.length) best.note = `The text also mentions ${[...new Set(others.map((s) => String(s.value.level)))].join(", ")}; the lowest is suggested`;
      for (const s of list) if (s !== best) { if (s.value.level === best.value.level) best.mode = STRONGER(best.mode, s.mode); drop.add(s); }
      continue;
    }
    if (pool.some((s) => !s.needs)) { for (const s of pool) if (s.needs) drop.add(s); pool = pool.filter((s) => !s.needs); }
    const vals = new Set(pool.map((s) => `${s.mode === "off" ? "off" : "on"}|${canonicalJson(s.value)}`));
    if (vals.size === 1) { for (const s of pool.slice(1)) { pool[0].mode = STRONGER(pool[0].mode, s.mode); drop.add(s); } continue; }
    for (const s of pool) {
      drop.add(s);
      const other = pool.find((o) => o !== s && `${o.mode === "off" ? "off" : "on"}|${canonicalJson(o.value)}` !== `${s.mode === "off" ? "off" : "on"}|${canonicalJson(s.value)}`)!;
      unparsed.push({ field: s.field, phrase: s.phrase, reason: `Contradicts "${other.phrase}"` });
    }
  }
  for (const s of found) if (!drop.has(s)) out.push({ ...s, id: idOf(s), plain: plainOf(s.key, s.mode, s.value) });
  return out;
}

/** Known certificate codes (what the screening can check). */
export const KNOWN_CERTS = Object.keys(CERT_FIELD_PATTERNS);
