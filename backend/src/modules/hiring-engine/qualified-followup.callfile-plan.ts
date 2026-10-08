/**
 * Calling-file planning (pure): which candidates go into a batch, one line per person (mobile10), and why the others do not.
 *  - A person qualified in several requisitions / drive types appears once, with the best requisition by the best-offer ranking
 *    (he-best-offer.ts rankOffers, every row treated as not started so distance, score, urgency, then qualified time decide);
 *    the other open requisition codes are listed. Without offer data the earliest qualified row wins.
 *  - STOP / revoked consent, a confirmed or arrived person and a requisition the person declined are skipped.
 *  - A person already placed in a calling file or already called (he_call, Meta voice outcome) is not placed again, unless the cool
 *    period (days, 0 = never) has passed, or the last outcome was no answer / call failed and the BRD retry rule allows it
 *    (canPlaceCall: at most 2 attempts, the second at least 2 hours after the first). Too soon waits for a later batch.
 */
import { rankOffers, type OfferRow } from "./he-best-offer.js";
import { CALL_FILE_SLOTS } from "./qualified-followup.rules.js";
import type { SourceType } from "./qualified-followup.types.js";

const IST_MS = 5.5 * 3600_000;
const DAY_MS = 86_400_000;
export const CALL_FILE_MAX_ATTEMPTS = 2;
export const CALL_FILE_RETRY_GAP_MIN = 120;
const OPEN = "09:00";
const CLOSE = "20:00";

export interface CallFileConfig { slots: string[]; coolDays: number; emptyNote: boolean }

const hhmm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
const inWindow = (s: string) => s >= OPEN && s < CLOSE;
const tidy = (list: string[]): string[] | null => {
  const out = [...new Set(list.filter(inWindow))].sort();
  return out.length ? out : null;
};

/** "HH:MM,HH:MM" (env) -> sorted slots inside 09:00 to before 20:00 IST; null when nothing valid. */
export function parseCallFileSlots(raw: unknown): string[] | null {
  const out: string[] = [];
  for (const p of String(raw ?? "").split(",")) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(p.trim());
    if (m && +m[1] < 24 && +m[2] < 60) out.push(hhmm(+m[1], +m[2]));
  }
  return tidy(out);
}

/** he_model_param values are IST hours (DECIMAL): 10 = 10:00, 12.5 = 12:30. */
export function slotsFromHours(hours: number[]): string[] | null {
  const out: string[] = [];
  for (const h of hours) {
    if (!Number.isFinite(h) || h < 0 || h >= 24) continue;
    const min = Math.round(h * 60);
    out.push(hhmm(Math.floor(min / 60), min % 60));
  }
  return tidy(out);
}

const days = (v: unknown): number | null => {
  if (v == null || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(3650, Math.max(0, Math.round(n))) : null;
};

/**
 * Owner settings, he_model_param first (changeable without a deploy), then env, then the defaults:
 *   policy.callfile_slot_<any>  one row per batch time, value = IST hour   | QUAL_FOLLOWUP_CALL_FILE_SLOTS="10:00,12:00"
 *   policy.callfile_cool_days   days before a person can be filed again   | QUAL_FOLLOWUP_CALL_FILE_COOL_DAYS (0 = never, the default)
 *   QUAL_FOLLOWUP_CALL_FILE_EMPTY_NOTE=true sends a one-line "no new rows" mail for an empty batch (default: nothing).
 */
export function callFileConfig(env: NodeJS.ProcessEnv, params: ReadonlyMap<string, number>): CallFileConfig {
  const paramSlots = slotsFromHours([...params].filter(([k]) => k.startsWith("policy.callfile_slot_")).map(([, v]) => Number(v)));
  return {
    slots: paramSlots ?? parseCallFileSlots(env.QUAL_FOLLOWUP_CALL_FILE_SLOTS) ?? [...CALL_FILE_SLOTS],
    coolDays: days(params.get("policy.callfile_cool_days")) ?? days(env.QUAL_FOLLOWUP_CALL_FILE_COOL_DAYS) ?? 0,
    emptyNote: String(env.QUAL_FOLLOWUP_CALL_FILE_EMPTY_NOTE ?? "").trim().toLowerCase() === "true",
  };
}

export type DriveType = "Live Meta" | "Old Meta data" | "Hiring Engine";
/**
 * The drive-type label of a calling-file line. Today it reads source_type (set by classifySource at enqueue); the attribution rule being
 * built on another branch replaces this one function.
 */
export function callFileDriveType(r: { sourceType: SourceType }): DriveType {
  return r.sourceType === "meta_live" ? "Live Meta" : r.sourceType === "meta_old" ? "Old Meta data" : "Hiring Engine";
}

export interface CallFileCandidate {
  id: string; sourceType: SourceType; mobile10: string; fullName: string | null; roleName: string | null;
  requisitionId: string; requisitionCode: string; branchName: string | null; branchAddress: string | null; campaign: string;
  /** DATETIME strings, IST wall clock. */
  qualifiedAt: string; emailStatus: string | null; emailSentAt: string | null; waStatus: string | null; waSentAt: string | null;
  slotDate: string | null; slotTime: string | null;
  // person facts (same on every row of a mobile) and one row fact
  leadStatus: string | null; consentRevoked: boolean; matchStates: string[]; rowDeclined: boolean;
  callsN: number; callsAnswered: number; callsRetryable: number; lastCallAt: string | null; metaOutcome: string | null;
  filesN: number; lastFileAt: string | null;
  /** HR exported this person to the calling tool by hand in the last 18 h (he_lead_event exported_for_calling, not a follow-up batch). */
  exportedRecently?: boolean;
  /** The journey's booking (he_match), when booked: its HRMS reference goes in the file. */
  matchId?: string | null;
}

export type CallFileSkip = "opted_out" | "confirmed" | "arrived" | "declined" | "already_reached" | "already_in_file" | "already_called" | "already_exported";
export type Priority = "P1" | "P2" | "P3";
export interface PlannedRow {
  best: CallFileCandidate; siblings: CallFileCandidate[]; otherRequisitionCodes: string[];
  attempt: number; priority: Priority; interviewDate: string | null; interviewTime: string | null;
}
/** Counts for the email head, the batch row (summary JSON) and the 08:30 report. No phone numbers. */
export interface CallFileSummary {
  rows: number; files: number; byDriveType: Record<string, number>; byBranch: Record<string, number>;
  skipped: Partial<Record<CallFileSkip, number>>; merged: number; deferred: number;
}
export interface CallFilePlan {
  rows: PlannedRow[];
  /** Terminal: the row leaves the calling-file queue with this reason. */
  skipped: Array<{ id: string; reason: CallFileSkip }>;
  skippedByReason: Partial<Record<CallFileSkip, number>>;
  /** Not now: the row stays queued for a later batch. */
  deferred: Array<{ id: string; reason: "retry_too_soon" }>;
  /** Extra rows of a person folded into that person's one line. */
  merged: number;
}

const istMs = (v: string | null): number | null => {
  if (!v) return null;
  const t = new Date(String(v).replace(" ", "T").slice(0, 19) + "+05:30").getTime();
  return Number.isFinite(t) ? t : null;
};
const istDay = (ms: number) => new Date(ms + IST_MS).toISOString().slice(0, 10);
const answered = (o: string | null) => !!o && o !== "NO_ANSWER" && !o.startsWith("CALL_FAILED");
const byTime = (a: CallFileCandidate, b: CallFileCandidate) => (a.qualifiedAt < b.qualifiedAt ? -1 : a.qualifiedAt > b.qualifiedAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

type Gate = { ok: true; attempt: number } | { ok: false; skip: CallFileSkip } | { ok: false; defer: "retry_too_soon" };

function personGate(p: CallFileCandidate, now: number, coolDays: number): Gate {
  const lead = String(p.leadStatus ?? "");
  if (lead === "opted_out" || p.consentRevoked) return { ok: false, skip: "opted_out" };
  if (lead === "arrived" || lead === "joined" || p.matchStates.includes("arrived")) return { ok: false, skip: "arrived" };
  if (lead === "confirmed" || p.matchStates.includes("confirmed") || p.matchStates.includes("selected")) return { ok: false, skip: "confirmed" };
  if (p.exportedRecently) return { ok: false, skip: "already_exported" };
  // A file placement and the result imported for it are the same attempt, so the larger count is the number of attempts.
  const prior = Math.max(p.filesN, p.callsN, p.metaOutcome ? 1 : 0);
  if (prior === 0) return { ok: true, attempt: 1 };
  if (p.callsAnswered > 0 || answered(p.metaOutcome)) return { ok: false, skip: "already_reached" };
  const last = Math.max(istMs(p.lastFileAt) ?? 0, istMs(p.lastCallAt) ?? 0);
  if (coolDays > 0 && last > 0 && now - last >= coolDays * DAY_MS) return { ok: true, attempt: prior + 1 };
  const retryable = p.callsRetryable > 0 || (!!p.metaOutcome && !answered(p.metaOutcome));
  if (retryable && prior < CALL_FILE_MAX_ATTEMPTS) {
    if (last > 0 && now - last >= CALL_FILE_RETRY_GAP_MIN * 60_000) return { ok: true, attempt: prior + 1 };
    return { ok: false, defer: "retry_too_soon" };
  }
  return { ok: false, skip: p.filesN > 0 ? "already_in_file" : "already_called" };
}

function pickBest(rows: CallFileCandidate[], offers: OfferRow[] | undefined): CallFileCandidate {
  const sorted = [...rows].sort(byTime);
  if (sorted.length === 1 || !offers?.length) return sorted[0];
  const byId = new Map(offers.map((o) => [o.rowId, o]));
  const list: OfferRow[] = sorted.map((r) => ({
    ...(byId.get(r.id) ?? { distanceKm: null, score: null, headcountRemaining: null }),
    rowId: r.id, requisitionId: r.requisitionId, requisitionCode: r.requisitionCode, qualifiedAt: r.qualifiedAt, started: false, declined: false,
  }));
  const best = rankOffers(list).find((d) => !d.held)?.rowId;
  return sorted.find((r) => r.id === best) ?? sorted[0];
}

function slotOf(r: CallFileCandidate, today: string, tomorrow: string): Pick<PlannedRow, "interviewDate" | "interviewTime" | "priority"> {
  const d = r.slotDate ? String(r.slotDate).slice(0, 10) : null;
  if (!d || d < today) return { interviewDate: null, interviewTime: null, priority: "P3" };
  return { interviewDate: d, interviewTime: r.slotTime ? String(r.slotTime).slice(0, 5) : null, priority: d <= tomorrow ? "P1" : "P2" };
}

export function planCallFile(cands: CallFileCandidate[], o: { now: Date; coolDays: number; offerRows?: ReadonlyMap<string, OfferRow[]> }): CallFilePlan {
  const now = o.now.getTime();
  const today = istDay(now);
  const tomorrow = istDay(now + DAY_MS);
  const plan: CallFilePlan = { rows: [], skipped: [], skippedByReason: {}, deferred: [], merged: 0 };
  const skip = (id: string, reason: CallFileSkip) => { plan.skipped.push({ id, reason }); plan.skippedByReason[reason] = (plan.skippedByReason[reason] ?? 0) + 1; };

  const byMobile = new Map<string, CallFileCandidate[]>();
  for (const c of cands) { const b = byMobile.get(c.mobile10); if (b) b.push(c); else byMobile.set(c.mobile10, [c]); }

  for (const [mobile, rows] of byMobile) {
    const gate = personGate(rows[0], now, o.coolDays);
    if (!gate.ok) {
      for (const r of rows) {
        if ("skip" in gate) skip(r.id, gate.skip); else plan.deferred.push({ id: r.id, reason: gate.defer });
      }
      continue;
    }
    for (const r of rows) if (r.rowDeclined) skip(r.id, "declined");
    const open = rows.filter((r) => !r.rowDeclined);
    if (!open.length) continue;
    const offers = o.offerRows?.get(mobile);
    const best = pickBest(open, offers);
    const siblings = open.filter((r) => r !== best).sort(byTime);
    const codes = [...siblings.map((s) => s.requisitionCode), ...(offers ?? []).filter((x) => !open.some((r) => r.id === x.rowId)).map((x) => x.requisitionCode)];
    plan.merged += siblings.length;
    plan.rows.push({
      best, siblings, attempt: gate.attempt, ...slotOf(best, today, tomorrow),
      otherRequisitionCodes: [...new Set(codes.filter((c) => c && c !== best.requisitionCode))],
    });
  }
  plan.rows.sort((a, b) => (a.priority < b.priority ? -1 : a.priority > b.priority ? 1 : byTime(a.best, b.best)));
  return plan;
}
