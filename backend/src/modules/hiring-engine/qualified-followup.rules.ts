import { FOLLOWUP_GAP_MIN, holdToWindow } from "./qualified-followup.schedule.js";
import type { SourceType } from "./qualified-followup.types.js";

const IST_MS = 5.5 * 3600_000;
const DAY_MS = 86_400_000;

/** criteria_failed / criteria_review: selection criteria S14 (only with SELECTION_FOLLOWUP_GUARD); criteria_review is a hold HR can release. */
export type StopReason = "opted_out" | "replied" | "requisition_closed" | "joined" | "no_contact_details" | "criteria_failed" | "criteria_review";
export interface StopFacts {
  optedOut: boolean;
  repliedSinceQualified: boolean;
  requisitionClosed: string | null;
  joined: boolean;
  hasMobile: boolean;
  hasEmail: boolean;
  /** The person's verdict against the requisition's current criteria, and whether they CONFIRMED (or arrived at) a walk-in for it (E2). Absent = no criteria fact. */
  criteria?: { verdict: "pass" | "fail" | "review" | string | null; booked: boolean };
}

/**
 * E2, the one criteria rule: a journey that has started but whose person has NOT confirmed (or arrived) is subject to the criteria
 * (fail = stopped, review = held for HR as held_manual); a confirmed person keeps their walk-in and shows on the booked-mismatch list.
 */
export const CRITERIA_EXEMPT_MATCH_STATES: readonly string[] = ["confirmed", "arrived", "selected"];
/** Journey states a criteria review may hold (stage A or waiting); a confirmed journey (stage B) never is. */
export const CRITERIA_HOLDABLE = "'enrolled','reach','engaged','held_best_offer','reinvite_wait'";

/** A reply no longer stops the journey (unified method): it ends stage A (journey 'engaged') and stage B continues. */
export function decideStop(f: StopFacts): StopReason | null {
  if (f.optedOut) return "opted_out";
  if (f.requisitionClosed) return "requisition_closed";
  if (f.joined) return "joined";
  if (!f.hasMobile && !f.hasEmail) return "no_contact_details";
  // a confirmed person keeps their date and reminders (HR sees them in the booked-mismatch list); anyone else is held or stopped
  if (f.criteria && !f.criteria.booked) {
    if (f.criteria.verdict === "fail") return "criteria_failed";
    if (f.criteria.verdict === "review") return "criteria_review";
  }
  return null;
}

export type MissingDetail = "slot" | "branch_address";
/** One template chooser for every source (lives in the cadence module). */
export { chooseWaTemplate } from "./qualified-followup.cadence.js";

export function nextStepDue(prev: Date, gapMin: number = FOLLOWUP_GAP_MIN): Date {
  return holdToWindow(new Date(prev.getTime() + gapMin * 60_000));
}

const TRANSIENT_RE = /rate.?limit|130429|131056|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|timeout|HTTP 5\d\d|\b421\b|\b45\d\b/i;

export function isTransientError(text: string | null | undefined): boolean {
  return text ? TRANSIENT_RE.test(text) : false;
}

export function metaErrorCode(text: string | null | undefined): string {
  const s = String(text ?? "");
  const code = /#?(13\d{4})/.exec(s);
  if (code) return code[1]!;
  const http = /HTTP \d{3}/.exec(s);
  return http ? http[0] : "other";
}

export const MAX_AUTO_ATTEMPTS = 3;
export const RETRY_BACKOFF_MIN = 15;
export const SENDING_STALE_MIN = 15;

export function afterFailure(attemptsBefore: number, error: string, now: Date): { status: "failed" | null; attempts: number; retryAt: Date | null } {
  const attempts = attemptsBefore + 1;
  if (isTransientError(error) && attempts < MAX_AUTO_ATTEMPTS) {
    return { status: null, attempts, retryAt: new Date(now.getTime() + RETRY_BACKOFF_MIN * attempts * 60_000) };
  }
  return { status: "failed", attempts, retryAt: null };
}

export type PinbotQuality = "GREEN" | "YELLOW" | "RED" | "UNKNOWN";

export function normaliseQuality(raw: unknown): PinbotQuality {
  const v = String(raw ?? "").trim().toUpperCase();
  if (v === "GREEN" || v === "HIGH") return "GREEN";
  if (v === "YELLOW" || v === "MEDIUM") return "YELLOW";
  if (v === "RED" || v === "LOW") return "RED";
  return "UNKNOWN";
}

export function waDailyBudget(q: PinbotQuality | null, max: number): number {
  if (q === "GREEN") return max;
  if (q === "RED") return 0;
  return Math.floor(max / 2);
}

/** Default calling-file batches (IST): every 2 hours inside the 09:00-20:00 window; 20:00 itself is quiet hours. Override: callFileConfig. */
export const CALL_FILE_SLOTS = ["10:00", "12:00", "14:00", "16:00", "18:00"] as const;
export const DAILY_REPORT_SLOTS = ["08:30"] as const;

function istDate(d: Date): string {
  return new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
}

/** Latest slot (IST) that has started, is within graceMin of now, and is not in done. Key "YYYY-MM-DD HH:MM". */
export function dueSlot(now: Date, slots: readonly string[], done: ReadonlySet<string>, graceMin = 120): string | null {
  const day = istDate(now);
  let best: { key: string; at: number } | null = null;
  for (const slot of slots) {
    const at = new Date(`${day}T${slot}:00+05:30`).getTime();
    const ageMin = (now.getTime() - at) / 60_000;
    const key = `${day} ${slot}`;
    if (ageMin < 0 || ageMin > graceMin || done.has(key)) continue;
    if (!best || at > best.at) best = { key, at };
  }
  return best ? best.key : null;
}

export function maskMobile(m: string | null | undefined): string {
  const digits = String(m ?? "").replace(/\D/g, "");
  return digits.length < 4 ? "xxxxxx" : `xxxxxx${digits.slice(-4)}`;
}

export function followupRef(id: string): string {
  return `QF-${String(id).replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

/** Next IST calendar day after now, skipping Sunday. YYYY-MM-DD. */
export function nextWorkingDayIst(now: Date): string {
  let t = new Date(now.getTime() + IST_MS);
  do {
    t = new Date(t.getTime() + DAY_MS);
  } while (t.getUTCDay() === 0);
  return t.toISOString().slice(0, 10);
}

/** Stale-claim error: a send may already have happened, so the step is never retried automatically or by hand. */
export const OUTCOME_UNKNOWN_ERROR = "outcome unknown (process stopped mid-send)";
