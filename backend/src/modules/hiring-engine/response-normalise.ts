/**
 * One answer set for every candidate response, whatever the channel: WhatsApp reply intents, Pinbot quick-reply button ids,
 * taps on the /w/<token> page, and call outcomes (Superbot, Vapi, calling-file imports). Pure.
 */
import type { ReplyIntent } from "./he-intent.js";

export type ResponseChannel = "email" | "whatsapp" | "voice_bot" | "call_file" | "hr" | "web";
export type ResponseMode = "button" | "text" | "call" | "manual";
export type ResponseAnswer = "confirm" | "decline" | "reschedule" | "question" | "unsubscribe" | "no_answer" | "on_my_way" | "wrong_person" | "other";
export type ResponseStatus = "applied" | "needs_review" | "ignored" | "duplicate" | "recorded";

const INTENT: Record<ReplyIntent, ResponseAnswer> = {
  confirm: "confirm", decline: "decline", reschedule: "reschedule", opt_out: "unsubscribe", on_my_way: "on_my_way", skip: "other", unknown: "question",
};
export const answerFromIntent = (i: ReplyIntent): ResponseAnswer => INTENT[i] ?? "other";

const TAP = { yes: "confirm", no: "decline", later: "reschedule", stop: "unsubscribe" } as const;
export const answerFromInviteTap = (a: keyof typeof TAP): ResponseAnswer => TAP[a];

export function answerFromCallOutcome(o: string): ResponseAnswer {
  const k = String(o ?? "").toUpperCase();
  if (k === "WALKIN_CONFIRMED_YES") return "confirm";
  if (k === "WALKIN_RESCHEDULED") return "reschedule";
  if (k === "WALKIN_DECLINED_NEEDS_FOLLOWUP") return "decline";
  if (k === "WRONG_PERSON_REACHED") return "wrong_person";
  if (k === "NO_ANSWER" || k === "CALL_INCOMPLETE" || k === "CALL_FAILED" || k.startsWith("CALL_FAILED:")) return "no_answer";
  return "other";
}

/** Pinbot quick-reply payload ids. Exact ids only: a button whose payload we do not know falls back to its title text. */
const BUTTON: Record<string, ResponseAnswer> = {
  "1": "confirm", yes: "confirm", confirm: "confirm", confirmed: "confirm",
  "2": "reschedule", later: "reschedule", reschedule: "reschedule", another_time: "reschedule", new_slot: "reschedule",
  "3": "decline", no: "decline", decline: "decline", cannot_come: "decline",
  stop: "unsubscribe", unsubscribe: "unsubscribe",
};
export function answerFromButtonId(id: string | null | undefined): ResponseAnswer | null {
  const k = String(id ?? "").trim().toLowerCase();
  return k ? BUTTON[k] ?? null : null;
}

/** The answers a WhatsApp button id maps onto the reply-intent rules (so a known button id applies exactly like its text would). */
const TO_INTENT: Partial<Record<ResponseAnswer, ReplyIntent>> = { confirm: "confirm", reschedule: "reschedule", decline: "decline", unsubscribe: "opt_out" };
export const intentFromButtonId = (id: string | null | undefined): ReplyIntent | null => {
  const a = answerFromButtonId(id);
  return a ? TO_INTENT[a] ?? null : null;
};

/** Free-text questions / unclear text wait for HR; anything a state plan applied is applied; the rest is recorded. */
export function statusFor(a: { answer: ResponseAnswer; mode: ResponseMode; applied: boolean }): "applied" | "needs_review" | "recorded" {
  if (a.mode === "text" && (a.answer === "question" || a.answer === "other")) return "needs_review";
  if (a.answer === "no_answer" || a.answer === "on_my_way") return "recorded";
  return a.applied ? "applied" : "recorded";
}
