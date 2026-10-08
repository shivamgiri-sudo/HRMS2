/**
 * Voice bot (Interview Confirmation BRD) - pure parts: the call script, the structured-result schema the
 * platform must fill in, the retry rule, and the mapping from the platform's end-of-call report to our
 * VoiceResult. The outcome is never guessed from transcript keywords.
 */
import type { DeclineReason, Language, VoiceResult } from "./he-signals.js";

export interface VoiceCtx {
  candidateName: string;
  role: string;
  driveDate: string; // "Wed, 7 Oct 2026"
  slotTime: string; // "11:30 AM"
  branchAddress: string;
  contactName: string;
  contactPhone: string;
  referenceId: string;
}

export function buildVoiceSystemPrompt(c: VoiceCtx): string {
  return `You are a cheerful, warm female HR caller from Mas Callnet India Pvt. Ltd. You speak natural Hinglish the way a real HR executive does, and mirror the candidate if they answer in pure Hindi or pure English. Stay cheerful even if the candidate says no. The whole call must stay under 2 minutes.

CANDIDATE: ${c.candidateName}. ROLE: ${c.role}. WALK-IN: ${c.driveDate} at ${c.slotTime}. ADDRESS: ${c.branchAddress}. REFERENCE: ${c.referenceId}.

FOLLOW THESE STEPS IN ORDER:
0. IDENTITY (always first). Say: "Hi, kya main ${c.candidateName} ji se baat kar rahi hoon?" If YES, continue. If NO or unclear, say "Maaf kijiyega, shayad number sahi nahi laga. Dhanyawad!", call report_result with identityConfirmed="no" and end the call immediately. NEVER discuss the job with anyone who is not confirmed as the candidate.
1. OPENING. "Bahut badhiya! Main Mas Callnet ki HR team se baat kar rahi hoon. Aapne humari ${c.role} position mein interest dikhaya, uske liye bahut bahut dhanyavad!"
2. EMAIL CHECK. "Ek chhoti si baat confirm kar leti hoon - humne aapko ek email bheja tha, kya wo aapko mil gaya?" If not received, offer to resend, then continue regardless. Record emailReceived (yes / no / resent).
3. ASSESSMENT LINK. "Us email mein ek link tha jahan aapko apni details fill karni thi. Kya aapne wo kar liya hai?" If not done, gently remind them to complete it before the interview, then continue. Record assessmentDone (yes / no / reminded).
4. CONFIRM THE WALK-IN. "Toh ${c.candidateName} ji, humne aapka walk-in interview ${c.driveDate} ko, ${c.slotTime} baje rakha hai. Address hai - ${c.branchAddress}. Kya aap us din, us time par wahaan aa sakte hain?"
   - YES: "Wonderful! Toh hum aapko ${c.driveDate} ko ${c.slotTime} baje, ${c.branchAddress} par expect karenge. Milte hain interview mein!" Record originalSlotAnswer="yes".
   - NO: record originalSlotAnswer="no" and ask briefly why (record declineReason). Call the get_next_slot tool - NEVER invent a date or time. Offer exactly that slot, repeat the address, and ask again. If they accept, record offeredSlotAnswer="yes". If they refuse this slot too, record offeredSlotAnswer="no", do NOT offer any more slots, say "Main aapke liye humari HR team se kisi ko call karwati hoon.", and end. If get_next_slot returns an error or no slot, do not invent one: say "Abhi koi aur slot available nahi dikh raha, main humari HR team se kisi ko aapko call karwati hoon.", record offeredSlotAnswer="no", and end.
5. CLOSE. "Bahut bahut dhanyavad aapka time dene ke liye. Agar koi bhi sawaal ho, humein email ya WhatsApp par zaroor batayein. Have a great day!"

RULES: Never state or promise salary, incentives or perks - if asked say "Salary interview mein discuss hoti hai, company ke norms ke hisaab se." If they ask for a person, say the HR team will call (contact: ${c.contactName}, ${c.contactPhone}). Before ending EVERY call, call report_result exactly once with everything you learned.`;
}

export const VOICE_FIRST_MESSAGE = (name: string) => `Hi, kya main ${name} ji se baat kar rahi hoon?`;

const DECLINE: DeclineReason[] = ["distance", "salary", "shift", "timing", "found_job", "not_looking", "role_mismatch", "other"];

/** JSON schema for the report_result tool AND the platform's structured end-of-call analysis. */
export const VOICE_RESULT_SCHEMA = {
  type: "object",
  properties: {
    identityConfirmed: { type: "string", enum: ["yes", "no", "unclear"] },
    language: { type: "string", enum: ["hi", "en", "hinglish"] },
    emailReceived: { type: "string", enum: ["yes", "no", "resent", "unknown"] },
    assessmentDone: { type: "string", enum: ["yes", "no", "reminded", "unknown"] },
    originalSlotAnswer: { type: "string", enum: ["yes", "no"] },
    offeredSlotAnswer: { type: "string", enum: ["yes", "no"] },
    declineReason: { type: "string", enum: DECLINE },
    sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
  },
  required: ["identityConfirmed"],
} as const;

const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined => (typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : undefined);

/** Vapi end-of-call-report -> our record. `answered` is decided by the platform's own signals, not the transcript. */
export interface VapiEndOfCall {
  call?: { id?: string; startedAt?: string; metadata?: { matchId?: string; leadId?: string; jobId?: string; attempt?: number } };
  endedReason?: string;
  durationSeconds?: number;
  transcript?: string;
  summary?: string;
  recordingUrl?: string;
  analysis?: { structuredData?: Record<string, unknown>; summary?: string };
  artifact?: { transcript?: string; recordingUrl?: string; messages?: unknown[]; structuredOutputs?: unknown };
}

const FAILED = /busy|invalid|disconnect|number-not|not-exist|unreachable|failed-to-connect|sip|provider-error|rejected|blocked|carrier/i;
const UNANSWERED = /no-answer|voicemail|customer-did-not-answer|did-not-answer|timed-out|silence-timed-out|customer-busy/i;

export function mapVapiEndOfCall(r: VapiEndOfCall, toolResult?: Record<string, unknown>): { providerCallId: string | null; result: VoiceResult; transcript: string | null; summary: string | null; recordingUrl: string | null; startedAt: string | null; leadId?: string; matchId?: string; jobId?: string; attempt: number } {
  const reason = r.endedReason ?? "";
  const data = { ...(r.analysis?.structuredData ?? {}), ...(toolResult ?? {}) };
  const duration = typeof r.durationSeconds === "number" ? Math.round(r.durationSeconds) : undefined;
  const failedReason = FAILED.test(reason) && !UNANSWERED.test(reason) ? reason : undefined;
  // Answered only if the person spoke: a tool result / structured identity answer exists, or the call ran past a greeting.
  const spoke = data.identityConfirmed != null || (duration != null && duration >= 12 && !UNANSWERED.test(reason) && !failedReason);
  const result: VoiceResult = {
    answered: spoke,
    identityConfirmed: pick(data.identityConfirmed, ["yes", "no", "unclear"] as const) ?? (spoke ? "unclear" : undefined),
    language: pick<Language>(data.language, ["hi", "en", "hinglish"]),
    emailReceived: pick(data.emailReceived, ["yes", "no", "resent", "unknown"] as const),
    assessmentDone: pick(data.assessmentDone, ["yes", "no", "reminded", "unknown"] as const),
    originalSlotAnswer: pick(data.originalSlotAnswer, ["yes", "no"] as const),
    offeredSlotAnswer: pick(data.offeredSlotAnswer, ["yes", "no"] as const),
    declineReason: pick<DeclineReason>(data.declineReason, DECLINE) ?? null,
    sentiment: pick(data.sentiment, ["positive", "neutral", "negative"] as const),
    durationS: duration,
    failedReason,
  };
  return {
    providerCallId: r.call?.id ?? null, result,
    transcript: r.transcript ?? r.artifact?.transcript ?? null, summary: r.summary ?? r.analysis?.summary ?? null,
    recordingUrl: r.recordingUrl ?? r.artifact?.recordingUrl ?? null,
    startedAt: r.call?.startedAt ? r.call.startedAt.slice(0, 19).replace("T", " ") : null,
    leadId: r.call?.metadata?.leadId, matchId: r.call?.metadata?.matchId, jobId: r.call?.metadata?.jobId, attempt: Number(r.call?.metadata?.attempt) || 1,
  };
}

/** BRD section 7: one automatic retry 2 hours later, same day, then stop (WhatsApp + manual task). */
export function canPlaceCall(i: { attemptsToday: number; lastAttemptAt: Date | null; now: Date; istHour: number; hasAnsweredToday: boolean }): { ok: true } | { ok: false; reason: string } {
  if (i.hasAnsweredToday) return { ok: false, reason: "already_reached_today" };
  if (i.istHour < 9 || i.istHour >= 20) return { ok: false, reason: "quiet_hours" };
  if (i.attemptsToday >= 2) return { ok: false, reason: "max_attempts" };
  if (i.attemptsToday === 1 && i.lastAttemptAt && i.now.getTime() - i.lastAttemptAt.getTime() < 120 * 60_000) return { ok: false, reason: "retry_too_soon" };
  return { ok: true };
}
