/**
 * Per-lead rollup + next best action. Inputs are plain counts/lists the service reads from
 * he_message_event, he_message, he_call, he_signal and he_match; output is stored in he_lead_insight.
 * Deterministic and explainable: every action carries a reason string HR can read.
 */
import type { DeclineReason } from "./he-signals.js";

export interface InsightInput {
  now: Date;
  status: string; // he_lead.status
  outbound: Array<{ channel: "whatsapp" | "email" | "voice"; at: Date; delivered: boolean; read: boolean; replied: boolean; replyLatencyMin?: number }>;
  inboundHoursIst: number[]; // IST hours of every candidate reply / answered call
  callAttempts: number;
  callsAnswered: number;
  emailBounced: boolean;
  phoneInvalid: boolean;
  optedOut: boolean;
  confirmedCount: number; // times confirmed a slot
  arrivedCount: number;
  noShowCount: number;
  lastDeclineReason: DeclineReason | null;
  language?: string | null;
  hasLiveLocationConsent: boolean;
}

export type NextAction =
  | "none" | "send_invite" | "send_followup" | "voice_call" | "human_call" | "send_reminder"
  | "rematch_nearer" | "rematch_day_shift" | "rematch_other_role" | "recovery_message" | "dormant_winback_later" | "fix_contact";

export interface Insight {
  engagementScore: number;
  reliabilityScore: number | null;
  bestChannel: "whatsapp" | "email" | "voice" | null;
  bestHourIst: number | null;
  emailValid: boolean | null;
  waReachable: boolean | null;
  touches: number;
  replies: number;
  nextAction: NextAction;
  nextActionReason: string;
}

function mode(xs: number[]): number | null {
  if (!xs.length) return null;
  const c = new Map<number, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

export function computeInsight(i: InsightInput): Insight {
  const touches = i.outbound.length + i.callAttempts;
  const replies = i.outbound.filter((o) => o.replied).length + i.callsAnswered;
  const reads = i.outbound.filter((o) => o.read || o.replied).length;

  // Engagement: replied counts most, then read, then delivered; recency-weighted by touches without response.
  let eng = 0;
  eng += Math.min(50, replies * 25);
  eng += Math.min(20, reads * 7);
  eng += i.callsAnswered > 0 ? 15 : 0;
  eng += i.hasLiveLocationConsent ? 10 : 0;
  const ignored = Math.max(0, touches - replies - reads);
  eng -= Math.min(40, ignored * 10);
  const engagementScore = Math.max(0, Math.min(100, eng));

  const promised = i.confirmedCount;
  const reliabilityScore = promised > 0 ? Math.round(((promised - i.noShowCount) / promised) * 100) : null;

  // Best channel = highest reply rate among channels tried at least once.
  const rate = new Map<string, { n: number; r: number }>();
  for (const o of i.outbound) {
    const v = rate.get(o.channel) ?? { n: 0, r: 0 };
    v.n++; if (o.replied || o.read) v.r++;
    rate.set(o.channel, v);
  }
  if (i.callAttempts) rate.set("voice", { n: i.callAttempts, r: i.callsAnswered });
  let bestChannel: Insight["bestChannel"] = null;
  let bestRate = 0;
  for (const [ch, v] of rate) {
    const x = v.r / v.n;
    if (x > bestRate) { bestRate = x; bestChannel = ch as Insight["bestChannel"]; }
  }

  const emailValid = i.emailBounced ? false : i.outbound.some((o) => o.channel === "email" && o.delivered) ? true : null;
  const waReachable = i.outbound.some((o) => o.channel === "whatsapp" && o.delivered) ? true
    : i.outbound.filter((o) => o.channel === "whatsapp").length >= 2 ? false : null;

  const base = { engagementScore, reliabilityScore, bestChannel, bestHourIst: mode(i.inboundHoursIst), emailValid, waReachable, touches, replies };
  const act = (nextAction: NextAction, nextActionReason: string): Insight => ({ ...base, nextAction, nextActionReason });

  if (i.optedOut || i.status === "opted_out") return act("none", "Opted out - no contact allowed");
  if (["joined", "dead", "arrived"].includes(i.status)) return act("none", `Lead is ${i.status}`);
  if (i.phoneInvalid && (i.emailBounced || emailValid === null)) return act("fix_contact", "Phone invalid and no working email - needs corrected contact");

  if (i.status === "declined") {
    switch (i.lastDeclineReason) {
      case "distance": return act("rematch_nearer", "Declined for distance - offer a nearer branch");
      case "shift": return act("rematch_day_shift", "Declined for shift - offer a day-shift role");
      case "salary": case "role_mismatch": return act("rematch_other_role", `Declined (${i.lastDeclineReason}) - offer a different role`);
      case "found_job": case "not_looking": return act("dormant_winback_later", "Has a job / not looking - revisit at next drive");
      case "timing": return act("dormant_winback_later", "Bad timing - retry on the next drive");
      default: return act("human_call", "Declined with no clear reason - a human should ask why");
    }
  }
  if (i.status === "no_show") {
    return i.noShowCount >= 2
      ? act("dormant_winback_later", "Two no-shows - stop recovery, revisit later")
      : act("recovery_message", "No-show once - one recovery message with a new slot");
  }
  if (i.status === "confirmed" || i.status === "rescheduled") return act("send_reminder", "Confirmed - run the T-1d and T-2h reminders");

  // new / contacted / invited / interested: escalate channels by silence.
  const waSent = i.outbound.filter((o) => o.channel === "whatsapp").length;
  if (touches === 0) return act("send_invite", "No contact yet");
  if (i.callAttempts >= 2 && i.callsAnswered === 0) return act("human_call", "Two unanswered calls - hand to a recruiter");
  if (replies === 0 && waSent >= 2 && i.callAttempts === 0) return act("voice_call", "No reply to two WhatsApps - try a voice call");
  if (replies === 0 && i.callAttempts === 1 && i.callsAnswered === 0) return act("send_followup", "Call unanswered - WhatsApp follow-up before a retry");
  if (replies === 0) return act("send_followup", "Silent so far - follow up on the best channel");
  return act("send_followup", "Engaged but not confirmed - nudge to confirm a slot");
}
