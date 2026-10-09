// Pure view model of "Suggested from the requisition text" (S-O8): words, rows, gates and empty states. No I/O.
import type { Completeness, Permissions, PreviewResult } from "./selectionTypes";

export type JdField = "skills_required" | "job_description" | "shift_requirement" | "business_justification";
export interface JdSuggestionView {
  id: string; key: string; mode: "must" | "prefer" | "off"; value: Record<string, unknown>; plain: string; phrase: string; matched: string; field: JdField;
  confidence: "high" | "medium" | "low"; why: string; needs?: "wpm" | "years"; note?: string;
}
export interface JdSuggestionsData {
  suggestions: JdSuggestionView[]; dismissed: JdSuggestionView[];
  unparsed: Array<{ field: JdField; phrase: string; reason: string }>; skipped: Array<{ key: string; field: JdField; phrase: string; matched: string; reason: string }>;
  current: { approvalStatus: string | null; legacy: boolean; completeness: Completeness; undecided: string[]; structuredEmpty: boolean; hasText: boolean; versionNo: number | null; versionId: string | null };
  permissions: Permissions;
}
export type Values = Record<string, string>;

const FIELD: Record<JdField, string> = { skills_required: "Skills", job_description: "Job description", shift_requirement: "Shift", business_justification: "Justification" };
export const fieldLabel = (f: JdField) => FIELD[f] ?? f;
export const modeLabel = (m: JdSuggestionView["mode"]) => (m === "must" ? "MUST" : m === "prefer" ? "PREFER" : "No requirement");
const CONFIDENCE = { high: "Sure", medium: "Likely", low: "Check this" } as const;

const NEEDS = {
  wpm: { label: "Minimum typing speed (wpm)", min: 10, max: 120, missing: "Type the minimum typing speed" },
  years: { label: "Minimum experience (years)", min: 0, max: 40, missing: "Type the minimum years" },
} as const;
export function needsValueError(n: "wpm" | "years", raw: string | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return NEEDS[n].missing;
  const v = Number(t);
  return Number.isFinite(v) && v >= NEEDS[n].min && v <= NEEDS[n].max ? null : `Between ${NEEDS[n].min} and ${NEEDS[n].max}`;
}

export interface Row {
  id: string; source: string; rule: string; mode: string; why: string; confidence: string; confidenceLevel: JdSuggestionView["confidence"];
  needs: { label: string; min: number; max: number } | null; acceptable: boolean; note: string | null;
}
export function rowsOf(d: JdSuggestionsData, values: Values): Row[] {
  return d.suggestions.map((s) => ({
    id: s.id, source: `${fieldLabel(s.field)}: “${s.phrase}”`, rule: s.plain, mode: modeLabel(s.mode), why: s.why,
    confidence: CONFIDENCE[s.confidence], confidenceLevel: s.confidence,
    needs: s.needs ? { label: NEEDS[s.needs].label, min: NEEDS[s.needs].min, max: NEEDS[s.needs].max } : null,
    acceptable: !s.needs || needsValueError(s.needs, values[s.id]) === null, note: s.note ?? null,
  }));
}

/** Replaces "criteria incomplete" when nothing structured is decided yet but the text holds criteria. */
export function textHint(d: JdSuggestionsData): string | null {
  const n = d.suggestions.length;
  return d.current.structuredEmpty && n > 0 ? `Criteria found in text: ${n} ${n === 1 ? "suggestion" : "suggestions"}` : null;
}

export function emptyText(d: JdSuggestionsData): string | null {
  if (d.suggestions.length) return null;
  if (!d.current.hasText) return "This requisition has no free text (skills, job description, shift or justification) to read.";
  if (d.dismissed.length) return `Nothing left to suggest: ${d.dismissed.length} dismissed.`;
  return "Nothing to suggest: the text names no criteria the rules can use, or they are already set.";
}

export const canWrite = (d: JdSuggestionsData) => d.permissions.edit && d.current.approvalStatus !== "closed";

export function acceptAllState(d: JdSuggestionsData, values: Values, reason: string): { ok: boolean; why: string | null } {
  const missing = d.suggestions.filter((s) => s.needs && needsValueError(s.needs, values[s.id]) !== null).length;
  if (missing) return { ok: false, why: `Type the numbers the text does not give (${missing})` };
  return reasonGate(d, reason);
}
export function reasonGate(d: JdSuggestionsData, reason: string): { ok: boolean; why: string | null } {
  if (d.current.approvalStatus === "approved" && !reason.trim()) return { ok: false, why: "A reason is required to change an approved requisition" };
  return { ok: true, why: null };
}

/** Numbers HR typed, for the suggestions being accepted. */
export function valuesFor(ids: string[], d: JdSuggestionsData, values: Values): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of d.suggestions) if (ids.includes(s.id) && s.needs && values[s.id]?.trim()) out[s.id] = Number(values[s.id]);
  return out;
}

export const outcomeLine = (o: PreviewResult["outcome"]) => `${o.shortlist} shortlisted, ${o.review} to review, ${o.rejected} not matching`;
export const legacyNote = "Today's screening rules switch to the criteria engine on the first accepted rule; rules nobody decided then act as MUST (see the editor).";
