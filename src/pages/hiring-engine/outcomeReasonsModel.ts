/**
 * Pure model of the "Did not come or declined" list on the walk-in board (GET /api/he/outcome-reasons, POST /api/he/matches/:id/outcome-reason;
 * backend he-outcome-reason.service.ts). Masked mobiles only. No I/O, no React, no regex literals.
 */
import { driveDayText } from "./command/actionQueueModel";

export type OutcomeReasonCode = "distance" | "other_job" | "salary" | "timing" | "not_interested" | "other";
export const REASON_CHIPS: ReadonlyArray<{ code: OutcomeReasonCode; label: string }> = [
  { code: "distance", label: "Distance" },
  { code: "other_job", label: "Got another job" },
  { code: "salary", label: "Salary" },
  { code: "timing", label: "Timing" },
  { code: "not_interested", label: "Not interested" },
  { code: "other", label: "Other" },
];
export const NOTE_MAX = 140;

export interface OutcomeRow {
  matchId: string; leadId: string; name: string | null; mobileMasked: string; driveId: string; driveDate: string; branch: string; requisitionCode: string;
  outcome: "no_show" | "declined"; slotAt: string | null; reason: OutcomeReasonCode | null; note: string | null;
}
export interface OutcomeList { enabled: boolean; rows: OutcomeRow[]; truncated: boolean; partial: boolean }

export const OUTCOMES_PATH = "/api/he/outcome-reasons";
export const reasonPath = (matchId: string): string => `/api/he/matches/${encodeURIComponent(matchId)}/outcome-reason`;
export const SECTION_TITLE = "Did not come or declined (last 3 days)";
export const EMPTY_TEXT = "Nobody missed a slot or declined in the last 3 days";
export const TRUNCATED_TEXT = "Showing the first 300; older drives are left out";
export const PARTIAL_TEXT = "Partial result: could not read the full list.";

export const reasonLabel = (code: OutcomeReasonCode | null): string => REASON_CHIPS.find((c) => c.code === code)?.label ?? "";
export const outcomeWord = (o: "no_show" | "declined"): string => (o === "declined" ? "Declined" : "Did not come");
export const slotText = (s: string | null): string => (s && s.length >= 16 ? s.slice(11, 16) : "–");
export const nameOf = (r: Pick<OutcomeRow, "name">): string => (r.name && r.name.trim() ? r.name.trim() : "Unknown");
export const counterText = (n: number): string => `${n} of ${NOTE_MAX}`;

export function groupByDrive(rows: OutcomeRow[]): Array<{ driveId: string; title: string; rows: OutcomeRow[] }> {
  const out: Array<{ driveId: string; title: string; rows: OutcomeRow[] }> = [];
  const at = new Map<string, number>();
  for (const r of rows) {
    let i = at.get(r.driveId);
    if (i === undefined) {
      i = out.push({ driveId: r.driveId, title: `${r.branch} · ${r.requisitionCode} · ${driveDayText(r.driveDate)}`, rows: [] }) - 1;
      at.set(r.driveId, i);
    }
    out[i].rows.push(r);
  }
  return out;
}

export function saveErrorText(e: unknown): string {
  const o = (e ?? {}) as { status?: unknown; message?: unknown };
  if (o.status === 409 && typeof o.message === "string" && o.message.trim()) return o.message;
  if (o.status === 404) return "This candidate is no longer visible to you; reload";
  if (o.status === 403) return "You do not have permission to record reasons";
  return "Could not save; try again";
}

export function savedText(name: string | null, label: string, changed: boolean): string {
  const who = name && name.trim() ? name.trim() : "this candidate";
  return changed ? `Changed for ${who} to ${label}` : `Saved for ${who}: ${label}`;
}

/** The note is optional: omitted when blank, trimmed, cut to NOTE_MAX. The server scrubs it again. */
export function reasonBody(code: OutcomeReasonCode, note: string): { reason: OutcomeReasonCode; note?: string } {
  const n = note.trim().slice(0, NOTE_MAX).trim();
  return n ? { reason: code, note: n } : { reason: code };
}

/** The page asks again only when the switch was last seen on (or never seen); a known-off answer draws nothing, not even a skeleton. */
let knownOff = false;
export const rememberReasonsEnabled = (on: boolean): void => { knownOff = !on; };
export const reasonsKnownOff = (): boolean => knownOff;
