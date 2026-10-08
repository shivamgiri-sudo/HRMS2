/** Reasons a walk-in candidate did not come or declined. Pure: codes, labels and note scrubbing. */
export const OUTCOME_REASONS = ["distance", "other_job", "salary", "timing", "not_interested", "other"] as const;
export type OutcomeReasonCode = (typeof OUTCOME_REASONS)[number];

export const OUTCOME_REASON_LABEL: Record<OutcomeReasonCode, string> = {
  distance: "Distance",
  other_job: "Got another job",
  salary: "Salary",
  timing: "Timing",
  not_interested: "Not interested",
  other: "Other",
};

export const NOTE_MAX = 140;
const RAW_NOTE_MAX = 500;

/** Optional free text: control characters out, whitespace collapsed, emails and phone-like digit runs masked, cut to NOTE_MAX. */
export function cleanNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = Array.from(raw).filter((ch) => { const c = ch.charCodeAt(0); return c === 9 || c === 10 || c === 13 || (c > 31 && c !== 127); }).join("")
    .replace(/\s+/g, " ")
    .replace(/[^\s@]+@[^\s@]+/g, "[email]")
    .replace(/\d(?:[ -]?\d){5,}/g, "#")
    .trim()
    .slice(0, NOTE_MAX)
    .trim();
  return t || null;
}

export function parseReasonBody(b: unknown): { reason: OutcomeReasonCode; note: string | null } | { error: string } {
  const o = b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
  const reason = OUTCOME_REASONS.find((c) => c === o.reason);
  if (!reason) return { error: "Pick a reason from the list" };
  if (typeof o.note === "string" && o.note.length > RAW_NOTE_MAX) return { error: "The note is too long" };
  return { reason, note: cleanNote(o.note) };
}
