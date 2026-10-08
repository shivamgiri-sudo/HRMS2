/**
 * Lead/match state transitions for walk-in replies and voice outcomes. Pure: services apply the
 * returned plan inside their own writes. Terminal states never regress; opt-out always wins; a second
 * decline of an offered slot is handed to a human instead of offering more automated slots (BRD).
 */
import type { ReplyIntent } from "./he-intent.js";
import type { CallOutcome } from "./he-signals.js";

export type LeadStatus =
  | "new" | "contacted" | "interested" | "invited" | "confirmed" | "rescheduled"
  | "arrived" | "no_show" | "declined" | "opted_out" | "joined" | "dead";
export type MatchState = "suggested" | "invited" | "confirmed" | "slot_released" | "arrived" | "no_show" | "declined" | "selected";

export interface TransitionPlan {
  leadStatus: LeadStatus | null; // null = leave unchanged
  matchState: MatchState | null;
  offerSlot: boolean; // orchestrator should offer the next free slot
  humanHandoff: boolean;
  revokeConsent: boolean;
  event: string; // he_lead_event.event_type
}

const TERMINAL: LeadStatus[] = ["arrived", "joined", "opted_out", "dead"];
const KEEP: TransitionPlan = { leadStatus: null, matchState: null, offerSlot: false, humanHandoff: false, revokeConsent: false, event: "reply_unclassified" };

export function planFromReply(current: LeadStatus, intent: ReplyIntent, priorSlotOffers: number): TransitionPlan {
  if (intent === "opt_out") return { leadStatus: "opted_out", matchState: "declined", offerSlot: false, humanHandoff: false, revokeConsent: true, event: "opted_out" };
  if (TERMINAL.includes(current)) return { ...KEEP, event: `reply_${intent}_ignored_terminal` };
  switch (intent) {
    case "confirm":
      return { leadStatus: "confirmed", matchState: "confirmed", offerSlot: false, humanHandoff: false, revokeConsent: false, event: "confirmed" };
    case "reschedule":
      // Already offered a replacement and they still cannot: stop automating.
      if (priorSlotOffers >= 1) return { leadStatus: "declined", matchState: "declined", offerSlot: false, humanHandoff: true, revokeConsent: false, event: "declined_after_offer_handoff" };
      return { leadStatus: current === "confirmed" ? "confirmed" : "interested", matchState: "slot_released", offerSlot: true, humanHandoff: false, revokeConsent: false, event: "reschedule_requested" };
    case "decline":
      if (priorSlotOffers >= 1) return { leadStatus: "declined", matchState: "declined", offerSlot: false, humanHandoff: true, revokeConsent: false, event: "declined_after_offer_handoff" };
      return { leadStatus: "declined", matchState: "declined", offerSlot: false, humanHandoff: false, revokeConsent: false, event: "declined" };
    case "on_my_way":
      return { ...KEEP, event: "on_my_way" };
    default:
      return KEEP;
  }
}

export function planFromCallOutcome(current: LeadStatus, outcome: CallOutcome): TransitionPlan {
  if (TERMINAL.includes(current)) return { ...KEEP, event: `call_${outcome}_ignored_terminal` };
  switch (outcome) {
    case "WALKIN_CONFIRMED_YES":
      return { leadStatus: "confirmed", matchState: "confirmed", offerSlot: false, humanHandoff: false, revokeConsent: false, event: "call_confirmed" };
    case "WALKIN_RESCHEDULED":
      return { leadStatus: "rescheduled", matchState: "confirmed", offerSlot: false, humanHandoff: false, revokeConsent: false, event: "call_rescheduled" };
    case "WALKIN_DECLINED_NEEDS_FOLLOWUP":
      return { leadStatus: "declined", matchState: "declined", offerSlot: false, humanHandoff: true, revokeConsent: false, event: "call_declined_handoff" };
    case "WRONG_PERSON_REACHED":
      return { ...KEEP, event: "call_wrong_person" };
    case "NO_ANSWER":
      return { leadStatus: current === "new" ? "contacted" : null, matchState: null, offerSlot: false, humanHandoff: false, revokeConsent: false, event: "call_no_answer" };
    default:
      return { ...KEEP, event: "call_failed" };
  }
}
