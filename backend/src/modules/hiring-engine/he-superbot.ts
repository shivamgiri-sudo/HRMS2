/**
 * Superbot (the voice-bot platform) data mapping, pure. Two jobs: shape the call we queue, and read the post-call feedback it posts back.
 * Fields and values follow the Mascall integration sheet:
 *   name_confirmation yes/no/others · good_time_to_talk yes/no · email_received yes/no · details_filled yes/no · walkin_interview_attendance yes/no/maybe
 *   talk_to_hr yes/no/later · callback_request yes/no · callback_details open · already_done already_done/already_done_elsewhere · not_applied yes
 *   outcome abandoned/disposed/voicemail · status answered/failed
 */
import type { DeclineReason, VoiceResult } from "./he-signals.js";

export interface SuperbotParams { name: string; role: string; interview_date: string; interview_time: string; branch_address: string }

/** DD/MM/YYYY as in the integration sample ("12/10/2026"). */
export const sbDate = (ymd: string) => { const [y, m, d] = ymd.slice(0, 10).split("-"); return `${d}/${m}/${y}`; };
/** "10 AM" / "10:30 AM" as in the sample. */
export const sbTime = (hhmm: string) => { const [h, m] = hhmm.slice(0, 5).split(":").map(Number); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h >= 12 ? "PM" : "AM"}`; };
export const sbPhone = (mobile10: string) => `+91${mobile10}`;

export interface SuperbotFeedback {
  phone?: string; campaign?: string; time?: string; status?: string; call_duration?: string | number; call_status?: string; outcome?: string | null;
  call_recording_url?: string; disposition?: string; reference_id?: string;
  call_parameters?: Record<string, unknown>;
  feedback?: Record<string, { label?: string; value?: unknown } | undefined>;
}

const val = (f: SuperbotFeedback, k: string) => { const v = f.feedback?.[k]?.value; return v == null ? "" : String(v).trim().toLowerCase(); };

export interface MappedFeedback {
  referenceId: string | null; phone: string | null; providerCallId: string; startedAt: string | null;
  result: VoiceResult; summary: string | null; recordingUrl: string | null;
  /** A person should call this candidate (asked for HR, a callback, or was unsure); null when nothing is needed. */
  humanFollowUp: string | null;
  /** Answered and the right person, but no answer to the walk-in question (call ended early, or "maybe"): record it, never mark declined. */
  incomplete: boolean;
}

export function mapSuperbotFeedback(f: SuperbotFeedback): MappedFeedback {
  const status = String(f.status ?? "").toLowerCase();
  const outcome = String(f.outcome ?? "").toLowerCase();
  const dur = Number(f.call_duration);
  const durationS = Number.isFinite(dur) ? Math.round(dur) : undefined;
  const ref = f.reference_id ? String(f.reference_id) : null;
  const base = { referenceId: ref, phone: f.phone ? String(f.phone) : null, providerCallId: `${ref ?? f.phone ?? "unknown"}:${f.time ?? ""}`.slice(0, 120), startedAt: f.time ? String(f.time).slice(0, 19).replace("T", " ") : null,
    recordingUrl: f.call_recording_url ? String(f.call_recording_url) : null, summary: f.disposition ? String(f.disposition).slice(0, 1000) : f.call_status ? String(f.call_status) : null };

  if (status === "failed") return { ...base, result: { answered: false, durationS, failedReason: String(f.call_status || "failed").slice(0, 60) }, humanFollowUp: null, incomplete: false };
  // Answered by a machine or hung up before the conversation: treated as not answered (the engine retries and falls back to WhatsApp).
  if (outcome === "voicemail" || outcome === "abandoned") return { ...base, result: { answered: false, durationS }, humanFollowUp: null, incomplete: false };

  const name = val(f, "name_confirmation");
  const attendance = val(f, "walkin_interview_attendance");
  const goodTime = val(f, "good_time_to_talk");
  const callback = val(f, "callback_request") === "yes";
  const hr = val(f, "talk_to_hr");
  const done = val(f, "already_done");
  const notApplied = val(f, "not_applied") === "yes";
  const result: VoiceResult = {
    answered: true, durationS,
    identityConfirmed: name === "yes" ? "yes" : name === "no" ? "no" : name ? "unclear" : /name not verified|picked by someone else/i.test(String(f.disposition ?? "")) ? "no" : "yes",
    emailReceived: val(f, "email_received") === "yes" ? "yes" : val(f, "email_received") === "no" ? "no" : undefined,
    assessmentDone: val(f, "details_filled") === "yes" ? "yes" : val(f, "details_filled") === "no" ? "no" : undefined,
    originalSlotAnswer: attendance === "yes" ? "yes" : attendance === "no" ? "no" : undefined,
    declineReason: ((done === "already_done_elsewhere" ? "found_job" : notApplied ? "not_looking" : attendance === "no" ? "other" : null) as DeclineReason | null),
    sentiment: attendance === "yes" ? "positive" : attendance === "no" ? "negative" : "neutral",
  };
  const ask: string[] = [];
  if (attendance === "maybe") ask.push("unsure about attending");
  if (goodTime === "no" && attendance !== "yes") ask.push("was not free to talk");
  if (hr === "yes" || hr === "later") ask.push(`asked to talk to HR${hr === "later" ? " later" : ""}`);
  if (callback) ask.push(`callback requested${val(f, "callback_details") ? ` (${String(f.feedback?.callback_details?.value).slice(0, 60)})` : ""}`);
  if (done === "already_done") ask.push("says the interview is already done");
  const identityOk = result.identityConfirmed === "yes";
  const incomplete = identityOk && attendance !== "yes" && attendance !== "no";
  if (incomplete && attendance !== "maybe") ask.push("call ended before the walk-in question");
  return { ...base, result, incomplete, humanFollowUp: ask.length ? `Voice call: ${ask.join("; ")}` : null };
}

/** Superbot's error replies for a queued call, as the integration doc lists them. */
export type QueueFailure = "already_queued" | "bad_number" | "params_missing" | "auth" | "validation" | "provider_error";
export function classifyQueueError(status: number, body: { message?: string; errors?: string[] } | null): QueueFailure {
  const m = `${body?.message ?? ""} ${(body?.errors ?? []).join(" ")}`.toLowerCase();
  if (status === 401) return "auth";
  if (/already queued/.test(m)) return "already_queued";
  if (/phone number is incorrect|incorrect/.test(m)) return "bad_number";
  if (/parameter empty/.test(m)) return "params_missing";
  if (status === 400) return "validation";
  return "provider_error";
}
