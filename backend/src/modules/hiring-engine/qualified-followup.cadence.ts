/**
 * One cadence for Live Meta, Old Meta data and Hiring Engine journeys (spec 4.3, decisions D3-D7): the WhatsApp template choice, the
 * stage B send times and the re-invite rule. Pure. he-cadence.ts stays for people the engine still sends to until R7.
 */
import { inSendWindow, nextSendWindowOpen } from "./followup-guards.js";
import { MAX_APPROACHES_30D, MAX_NO_SHOWS_PER_REQUISITION } from "./he-eligibility.js";

export const REINVITE_MIN_DAYS = 7, REINVITE_MAX_30D = 2;

const IST_MS = 5.5 * 3600_000;
const HOUR_MS = 3600_000;
const DAY_MS = 86_400_000;
const istMidnight = (t: number) => Math.floor((t + IST_MS) / DAY_MS) * DAY_MS - IST_MS;
const istDow = (t: number) => new Date(t + IST_MS).getUTCDay();
const holdToWindow = (t: Date) => (inSendWindow(t) ? t : nextSendWindowOpen(t));

/** T1 when the person is booked and the branch has an address; T8 when not; on a re-invite T12 once approved, else T8. */
export function chooseWaTemplate(f: { booked: boolean; hasBranchAddress: boolean; reinvite: boolean; t12Approved: boolean }):
  { key: "he_walkin_invite" | "he_winback" | "he_reinvite"; missing: Array<"slot" | "branch_address"> } {
  const missing: Array<"slot" | "branch_address"> = [];
  if (!f.booked) missing.push("slot");
  if (!f.hasBranchAddress) missing.push("branch_address");
  if (missing.length) return { key: "he_winback", missing };
  if (f.reinvite) return { key: f.t12Approved ? "he_reinvite" : "he_winback", missing };
  return { key: "he_walkin_invite", missing };
}

/** The T1 assessment line: the requisition's BMI link, else the branch gives it on arrival. */
export function assessmentText(bmiLink: string | null): string {
  return bmiLink && bmiLink.trim() ? bmiLink.trim() : "given at the branch";
}

/** D-1 (T3 + email): slot - 24 h; when that is outside the window, 19:00 IST of the last Mon-Sat day before the slot's day. */
export function d1SendAt(slotAt: Date): Date {
  const at = new Date(slotAt.getTime() - DAY_MS);
  if (inSendWindow(at)) return at;
  let day = istMidnight(slotAt.getTime()) - DAY_MS;
  while (istDow(day) === 0) day -= DAY_MS;
  return new Date(day + 19 * HOUR_MS);
}

/** T4 (D6): a slot before 11:00 IST gets it at 09:00 the same morning; otherwise slot - 2 h. */
export function t4SendAt(slotAt: Date): Date {
  const morning = istMidnight(slotAt.getTime()) + 9 * HOUR_MS;
  return slotAt.getTime() < morning + 2 * HOUR_MS ? new Date(morning) : new Date(slotAt.getTime() - 2 * HOUR_MS);
}

/** No-show recovery (T6, confirmed only, D5): slot + 2 h, held to the window. */
export function noShowDueAt(slotAt: Date): Date {
  return holdToWindow(new Date(slotAt.getTime() + 2 * HOUR_MS));
}

/** D7. HR's override lifts only the time rules (too soon, re-invite cap); STOP, declined and the eligibility caps always hold. */
export function reinviteAllowed(f: {
  now: Date; lastFirstContactAt: Date | null; reinvites30d: number; approaches30d: number; noShowsForRequisition: number; declined: boolean; optedOut: boolean; hrOverride: boolean;
}): { ok: true } | { ok: false; reason: "too_soon" | "reinvite_cap" | "approach_cap" | "no_show_cap" | "declined" | "opted_out" } {
  if (f.optedOut) return { ok: false, reason: "opted_out" };
  if (f.declined) return { ok: false, reason: "declined" };
  if (f.noShowsForRequisition >= MAX_NO_SHOWS_PER_REQUISITION) return { ok: false, reason: "no_show_cap" };
  if (f.approaches30d >= MAX_APPROACHES_30D) return { ok: false, reason: "approach_cap" };
  if (!f.hrOverride) {
    if (f.lastFirstContactAt && f.now.getTime() - f.lastFirstContactAt.getTime() < REINVITE_MIN_DAYS * DAY_MS) return { ok: false, reason: "too_soon" };
    if (f.reinvites30d >= REINVITE_MAX_30D) return { ok: false, reason: "reinvite_cap" };
  }
  return { ok: true };
}
