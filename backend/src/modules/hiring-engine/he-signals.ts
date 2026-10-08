/**
 * Datapoint extraction. Every interaction (WhatsApp reply, email event, voice call) is turned into
 * typed signals that are stored append-only in he_signal with source + confidence, then rolled up in
 * he-insight.ts. Pure functions: the services persist what these return.
 */
import { parseReplyIntent, type ReplyIntent } from "./he-intent.js";

export type SignalSource = "whatsapp" | "email" | "voice" | "location" | "branch" | "import" | "system";
export interface Signal {
  key: string;
  value: string;
  confidence: number; // 0-100
  source: SignalSource;
}

export type DeclineReason = "distance" | "salary" | "shift" | "timing" | "found_job" | "not_looking" | "role_mismatch" | "other";
export type Language = "hi" | "en" | "hinglish";

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
const any = (t: string, re: RegExp) => re.test(t);

/** Why a candidate said no / asked to reschedule. Hinglish + English keywords; null when unclear. */
export function classifyDeclineReason(text: string | null | undefined): DeclineReason | null {
  if (!text) return null;
  const t = norm(text);
  if (any(t, /\b(door|dur|far|distance|travel|aana jaana|commute|bahut door)\b/)) return "distance";
  if (any(t, /\b(salary|paisa|paise|pay|package|ctc|kam hai|kitna milega)\b/)) return "salary";
  if (any(t, /\b(night|raat|shift|timing|rotational|late)\b/)) return "shift";
  if (any(t, /\b(job mil gayi|job mil gaya|selected|joined|kahin aur|other job|already working|another offer|offer mil)\b/)) return "found_job";
  if (any(t, /\b(abhi nahi|busy|exam|ghar|family|tabiyat|sick|emergency|function|shaadi|out of station|bahar)\b/)) return "timing";
  if (any(t, /\b(kaam|work|profile|role|process|sales|collection|calling)\b/) && any(t, /\b(pasand|nahi karna|not suitable|suit nahi|different)\b/)) return "role_mismatch";
  if (any(t, /\b(interested nahi|not interested|job nahi chahiye|no need|zarurat nahi)\b/)) return "not_looking";
  return null;
}

export function detectLanguage(text: string | null | undefined): Language | null {
  if (!text) return null;
  if (/[ऀ-ॿ]/.test(text)) return "hi";
  const t = norm(text);
  if (!t) return null;
  const hinglishWords = /\b(hai|haan|nahi|aap|aapka|kal|aaunga|kya|main|mein|karo|bhai|ji|theek|accha|thik|bata|batao|kitna|abhi)\b/;
  const englishWords = /\b(yes|no|ok|okay|the|is|what|when|where|can|will|thanks|thank|please|salary|interview)\b/;
  const h = hinglishWords.test(t);
  const e = englishWords.test(t);
  if (h && e) return "hinglish";
  if (h) return "hinglish";
  if (e) return "en";
  return null;
}

/** Profile facts volunteered in free text; each returned with a lower confidence than a direct button tap. */
export function extractProfileFacts(text: string | null | undefined): Signal[] {
  if (!text) return [];
  const t = norm(text);
  const out: Signal[] = [];
  const push = (key: string, value: string, confidence = 70) => out.push({ key, value, confidence, source: "whatsapp" });
  if (any(t, /\b(night shift|raat ki shift)\b.*\b(ok|chalega|theek|kar sakta|kar sakti|haan)\b/) || any(t, /\bnight (shift )?(ok|chalega)\b/)) push("night_shift_ok", "yes");
  if (any(t, /\b(night shift|raat ki shift)\b.*\b(nahi|no|nahin)\b/) || any(t, /\bno night\b/)) push("night_shift_ok", "no");
  if (any(t, /\b(fresher|experience nahi|no experience)\b/)) push("experience_level", "fresher");
  const yrs = t.match(/\b(\d{1,2})\s*(saal|year|years|yrs|yr)\b/);
  if (yrs) push("experience_years", yrs[1]);
  if (any(t, /\b(two wheeler|bike|scooty|scooter)\b/)) push("has_two_wheeler", "yes", 60);
  const pin = text.match(/\b([1-9]\d{5})\b/);
  if (pin) push("pincode", pin[1], 80);
  return out;
}

/** Signals from one inbound WhatsApp/email reply. */
export function signalsFromReply(text: string | null | undefined, source: "whatsapp" | "email"): { intent: ReplyIntent; signals: Signal[] } {
  const intent = parseReplyIntent(text);
  const signals: Signal[] = [{ key: "reply_intent", value: intent, confidence: intent === "unknown" ? 30 : 90, source }];
  const lang = detectLanguage(text);
  if (lang) signals.push({ key: "language", value: lang, confidence: 60, source });
  if (intent === "decline" || intent === "reschedule") {
    const reason = classifyDeclineReason(text);
    if (reason) signals.push({ key: "decline_reason", value: reason, confidence: 65, source });
  }
  for (const f of extractProfileFacts(text)) signals.push({ ...f, source });
  return { intent, signals };
}

export type EmailEvent = "sent" | "delivered" | "opened" | "clicked" | "bounced" | "replied" | "unsubscribed";
export function signalsFromEmailEvent(ev: EmailEvent, detail?: string): Signal[] {
  switch (ev) {
    case "bounced": return [{ key: "email_valid", value: "no", confidence: 95, source: "email" }];
    case "delivered": return [{ key: "email_valid", value: "yes", confidence: 70, source: "email" }];
    case "opened": return [{ key: "email_opened", value: "yes", confidence: 60, source: "email" }]; // proxy opens are noisy
    case "clicked": return [{ key: "link_clicked", value: detail ?? "link", confidence: 95, source: "email" }];
    case "unsubscribed": return [{ key: "reply_intent", value: "opt_out", confidence: 100, source: "email" }];
    default: return [];
  }
}

/** Structured voice-bot result (returned by the bot as a tool call, never parsed from the transcript). */
export interface VoiceResult {
  answered: boolean;
  identityConfirmed?: "yes" | "no" | "unclear";
  language?: Language;
  emailReceived?: "yes" | "no" | "resent" | "unknown";
  assessmentDone?: "yes" | "no" | "reminded" | "unknown";
  originalSlotAnswer?: "yes" | "no";
  offeredSlotAnswer?: "yes" | "no";
  declineReason?: DeclineReason | null;
  sentiment?: "positive" | "neutral" | "negative";
  durationS?: number;
  failedReason?: string; // busy / invalid / disconnected
}

export type CallOutcome =
  | "WALKIN_CONFIRMED_YES" | "WALKIN_RESCHEDULED" | "WALKIN_DECLINED_NEEDS_FOLLOWUP"
  | "NO_ANSWER" | "CALL_FAILED" | "WRONG_PERSON_REACHED";

/** BRD section 5 mapping, deterministic from the structured result. */
export function callOutcome(r: VoiceResult): CallOutcome {
  if (r.failedReason) return "CALL_FAILED";
  if (!r.answered) return "NO_ANSWER";
  if (r.identityConfirmed === "no" || r.identityConfirmed === "unclear") return "WRONG_PERSON_REACHED";
  if (r.originalSlotAnswer === "yes") return "WALKIN_CONFIRMED_YES";
  if (r.originalSlotAnswer === "no" && r.offeredSlotAnswer === "yes") return "WALKIN_RESCHEDULED";
  return "WALKIN_DECLINED_NEEDS_FOLLOWUP";
}

export function signalsFromVoice(r: VoiceResult): Signal[] {
  const s: Signal[] = [{ key: "call_outcome", value: callOutcome(r), confidence: 100, source: "voice" }];
  const add = (key: string, value?: string | null, confidence = 90) => { if (value) s.push({ key, value, confidence, source: "voice" }); };
  add("language", r.language, 80);
  add("email_received", r.emailReceived);
  add("assessment_done", r.assessmentDone);
  add("decline_reason", r.declineReason ?? undefined, 80);
  add("sentiment", r.sentiment, 70);
  if (r.answered && r.durationS != null) add("call_engaged_s", String(r.durationS), 100);
  if (r.failedReason) add("phone_valid", /invalid|disconnect|not.?exist/i.test(r.failedReason) ? "no" : "unknown", 85);
  return s;
}
