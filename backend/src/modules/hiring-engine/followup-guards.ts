/**
 * One guard chain for every follow-up step of every source (spec 4.6). Pure: the service loads the facts, this decides. The first
 * failing guard wins; `kind` tells the caller what to do with the row (hold = try again later, skip_step = this step is not sent,
 * end_journey = stop the journey for this requisition).
 */
import { requisitionClosedReason } from "../meta-campaign/lead-screener.service.js";

export type GuardStep = "email" | "whatsapp" | "call" | "call_file";
export type GuardReason = "kill_switch" | "source_off" | "source_paused" | "opted_out" | "requisition_closed" | "criteria_failed" | "criteria_review"
  | "requisition_end_date" | "journey_ended" | "outside_window" | "person_daily_cap" | "person_gap" | "call_attempts" | "wa_budget" | "branch_cap"
  | "recontact_hold" | "channel_off" | "upload_no_wa" | "template_not_approved" | "missing_variables";

export interface RequisitionFacts {
  approvalStatus: string | null; activeStatus: number | null; closedAt: string | Date | null;
  requestedHeadcount: number | null; fulfilledHeadcount: number | null;
  /** job_requisition.requisition_validity (the end date); only counts while policy.req_end_date_enforced = 1. */
  validityDate?: string | Date | null;
}

export interface GuardFacts {
  now: Date; step: GuardStep; transactional: boolean; firstContact: boolean;
  killSwitch: boolean; sourceRunnable: boolean; sourcePaused: boolean;
  optedOut: boolean; requisition: RequisitionFacts | null; journeyEnded: "joined" | "arrived" | "declined" | null;
  waUnpromptedToday: number; lastUnpromptedAt: Date | null; lastCadenceStepAt: Date | null; cadenceStep: boolean;
  callAttemptsToday: number; lastCallAt: Date | null;
  waBudgetLeft: number; branchCapLeft: number | null; lastFirstContactOtherReqAt: Date | null; hrOverride: boolean;
  channelAllowed: boolean; uploadWithoutOptIn: boolean; uploadWaAllowed: boolean; templateApproved: boolean; missingVariables: string[];
  /** Stage A = reaching the person, B = answering a booking they already have. Default: B for transactional sends, else A. */
  stage?: "A" | "B";
  /** Selection-criteria verdict stored on the row (criteria engine, built separately). Missing = pass. */
  criteriaVerdict?: "pass" | "fail" | "review" | null;
  endDateEnforced?: boolean;
}

export type GuardVerdict = { ok: true } | { ok: false; reason: GuardReason; kind: "hold" | "skip_step" | "end_journey"; retryAt?: Date; missing?: string[] };

export const PERSON_WA_DAILY_MAX = 2, PERSON_GAP_MIN = 120, CADENCE_GAP_MIN = 60, CALL_ATTEMPTS_MAX = 2, CALL_RETRY_GAP_MIN = 120, RECONTACT_HOLD_DAYS = 7;

const IST_MS = 5.5 * 3600_000;
const DAY_MS = 86_400_000;
const MIN_MS = 60_000;
const OPEN_HOUR = 9;
const CLOSE_HOUR = 20;

const istParts = (d: Date) => { const x = new Date(d.getTime() + IST_MS); return { hour: x.getUTCHours(), dow: x.getUTCDay() }; };
const istMidnight = (t: number) => Math.floor((t + IST_MS) / DAY_MS) * DAY_MS - IST_MS;
const istDate = (d: string | Date) => (typeof d === "string" ? d.slice(0, 10) : new Date(d.getTime() + IST_MS).toISOString().slice(0, 10));

/** Mon-Sat, 09:00 <= IST < 20:00 (D3). */
export function inSendWindow(now: Date): boolean {
  const { hour, dow } = istParts(now);
  return dow !== 0 && hour >= OPEN_HOUR && hour < CLOSE_HOUR;
}

/** The first Mon-Sat 09:00 IST at or after `now` (same rule as nextWindowOpen, Sunday skipped). */
export function nextSendWindowOpen(now: Date): Date {
  let open = istMidnight(now.getTime()) + OPEN_HOUR * 3600_000;
  if (now.getTime() > open) open += DAY_MS;
  while (istParts(new Date(open)).dow === 0) open += DAY_MS;
  return new Date(open);
}

/** D8, the one requisition-open rule: the screener's closed reasons, plus approved only; the end date only when enforced. */
export function requisitionOpenReason(r: RequisitionFacts | null, o: { endDateEnforced?: boolean; now?: Date } = {}): string | null {
  if (!r) return "requisition not found";
  const closed = requisitionClosedReason(r);
  if (closed) return closed;
  if (String(r.approvalStatus ?? "").toLowerCase() !== "approved") return "requisition is not approved";
  if (o.endDateEnforced && r.validityDate && istDate(r.validityDate) < istDate(o.now ?? new Date())) return "requisition end date passed";
  return null;
}

const no = (reason: GuardReason, kind: "hold" | "skip_step" | "end_journey", retryAt?: Date): GuardVerdict =>
  retryAt ? { ok: false, reason, kind, retryAt } : { ok: false, reason, kind };
const nextDayOpen = (now: Date) => nextSendWindowOpen(new Date(istMidnight(now.getTime()) + DAY_MS));

export function checkFollowupGuards(f: GuardFacts): GuardVerdict {
  const stage = f.stage ?? (f.transactional ? "B" : "A");
  const now = f.now.getTime();
  if (f.killSwitch) return no("kill_switch", "hold");
  if (!f.sourceRunnable) return no("source_off", "hold");
  if (f.sourcePaused) return no("source_paused", "hold");
  if (f.optedOut) return no("opted_out", "end_journey");
  if (requisitionOpenReason(f.requisition)) return no("requisition_closed", "end_journey");
  if (stage === "A" && f.criteriaVerdict === "fail") return no("criteria_failed", "end_journey");
  if (stage === "A" && f.criteriaVerdict === "review") return no("criteria_review", "hold");
  if (stage === "A" && requisitionOpenReason(f.requisition, { endDateEnforced: f.endDateEnforced, now: f.now })) return no("requisition_end_date", "skip_step");
  if (f.journeyEnded) return no("journey_ended", "end_journey");
  if (!f.transactional) {
    if (!inSendWindow(f.now)) return no("outside_window", "hold", nextSendWindowOpen(f.now));
    if (f.step === "whatsapp" && f.waUnpromptedToday >= PERSON_WA_DAILY_MAX) return no("person_daily_cap", "hold", nextDayOpen(f.now));
    if (f.step !== "call_file") {
      // A cadence step waits 60 min after the person's last touch; anything else unprompted waits 120 min.
      const gap = f.cadenceStep ? CADENCE_GAP_MIN : PERSON_GAP_MIN;
      const last = Math.max(f.lastUnpromptedAt?.getTime() ?? 0, f.cadenceStep ? f.lastCadenceStepAt?.getTime() ?? 0 : 0);
      if (last && now - last < gap * MIN_MS) return no("person_gap", "hold", new Date(last + gap * MIN_MS));
    }
    if (f.step === "call" || f.step === "call_file") {
      if (f.callAttemptsToday >= CALL_ATTEMPTS_MAX) return no("call_attempts", "hold", nextDayOpen(f.now));
      if (f.lastCallAt && now - f.lastCallAt.getTime() < CALL_RETRY_GAP_MIN * MIN_MS) return no("call_attempts", "hold", new Date(f.lastCallAt.getTime() + CALL_RETRY_GAP_MIN * MIN_MS));
    }
    if (f.step === "whatsapp" && f.waBudgetLeft <= 0) return no("wa_budget", "hold", nextDayOpen(f.now));
  }
  if (f.firstContact && f.branchCapLeft !== null && f.branchCapLeft <= 0) return no("branch_cap", "hold", nextDayOpen(f.now));
  if (f.firstContact && !f.hrOverride && f.lastFirstContactOtherReqAt) {
    const until = f.lastFirstContactOtherReqAt.getTime() + RECONTACT_HOLD_DAYS * DAY_MS;
    if (now < until) return no("recontact_hold", "hold", new Date(until));
  }
  if (!f.channelAllowed) return no("channel_off", "skip_step");
  if (f.step === "whatsapp" && stage === "A" && f.uploadWithoutOptIn && !f.uploadWaAllowed) return no("upload_no_wa", "skip_step");
  if (f.step === "whatsapp" && !f.templateApproved) return no("template_not_approved", "skip_step");
  if (f.missingVariables.length) return { ok: false, reason: "missing_variables", kind: "skip_step", missing: [...f.missingVariables] };
  return { ok: true };
}
