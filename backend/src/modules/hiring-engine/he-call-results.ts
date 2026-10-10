/**
 * Results coming back from the third-party calling tool (until the direct integration exists). The vendor's report
 * layout is not known, so this is deliberately tolerant: headers are matched by alias and the vendor's free-text
 * disposition is classified into the same six outcomes the BRD defines. Anything it cannot classify is reported per row
 * instead of being guessed, because a wrong "confirmed" would tell a branch to expect someone who is not coming.
 */
import { normalizeMobile10 } from "./he-phone.js";
import { parseDate, parseTime } from "./he-bulk-call.js";
import type { CallOutcome, VoiceResult } from "./he-signals.js";

const ALIASES = {
  phone: ["phone", "phone_number", "phonenumber", "mobile", "mobile_number", "mobile_no", "contact", "number", "customer_number", "to_number", "called_number"],
  result: ["result", "outcome", "status", "disposition", "call_status", "call_result", "call_outcome", "response", "candidate_response", "call_disposition", "final_status"],
  remarks: ["remarks", "remark", "notes", "note", "comment", "comments", "summary", "feedback", "transcript_summary"],
  new_date: ["new_date", "new_interview_date", "rescheduled_date", "reschedule_date", "revised_date", "interview_date_new"],
  new_time: ["new_time", "new_interview_time", "rescheduled_time", "reschedule_time", "revised_time", "interview_time_new"],
  duration: ["duration", "duration_s", "duration_sec", "duration_seconds", "talk_time", "call_duration", "talktime"],
  call_time: ["call_time", "called_at", "call_date_time", "call_datetime", "timestamp", "start_time", "call_start", "date_time", "call_dial_time"],
  call_id: ["call_id", "callid", "id", "call_sid", "uuid", "call_uuid", "session_id", "unique_call_id"],
  attendance: ["walkin_interview_attendance", "walk_in_interview_attendance", "walkin_attendance"],
  bot_outcome: ["outcome", "call_outcome_type"],
  bot_status: ["status", "call_status"],
  reference_id: ["reference_id", "referenceid", "reference", "ref", "ref_id"],
  email_received: ["email_received", "email_status", "got_email"],
  assessment_done: ["assessment_done", "assessment", "form_filled", "link_filled"],
  language: ["language", "lang"],
} as const;
type Col = keyof typeof ALIASES;
const key = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export function mapResultHeaders(headers: string[]): { map: Partial<Record<Col, string>>; missing: string[] } {
  const map: Partial<Record<Col, string>> = {};
  for (const h of headers) {
    const k = key(h);
    for (const col of Object.keys(ALIASES) as Col[]) if (!map[col] && (ALIASES[col] as readonly string[]).includes(k)) map[col] = h;
  }
  // "result" must be the disposition when the file has one (the calling tool's own export also has Outcome and Status columns).
  const disposition = headers.find((h) => key(h) === "disposition");
  if (disposition) map.result = disposition;
  const missing: string[] = [];
  if (!map.phone) missing.push("phone");
  if (!map.result) missing.push("result (the call outcome/disposition column)");
  return { map, missing };
}

const has = (t: string, re: RegExp) => re.test(t);
/** Free-text disposition -> BRD outcome. Order matters: negatives and "wrong person" before "yes". null = cannot tell. */
export function classifyOutcome(raw: unknown): CallOutcome | "CALL_FAILED" | null {
  // eslint-disable-next-line no-misleading-character-class -- the whole Devanagari block as a range, not a combined character
  const t = String(raw ?? "").toLowerCase().replace(/[^a-z0-9\u0900-\u097f ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (has(t, /\bwrong (person|number|no)\b|not the candidate|someone else|galat/)) return "WRONG_PERSON_REACHED";
  if (has(t, /invalid|not exist|does not exist|disconnect|switched off|switch off|out of (coverage|service)|not reachable|unreachable|barred|not in service|number busy|network|failed|dnd|do not call/)) return "CALL_FAILED";
  if (has(t, /no answer|not answer|unanswer|not pick|didn.?t pick|no response|not responding|ringing|voicemail|missed|not connected|busy|call back later|callback/)) return "NO_ANSWER";
  if (has(t, /resched|re sched|postpone|prepone|another (day|date|time)|different (day|date|time)|new (date|slot|time)|change (the )?(date|slot|time)|kal aaunga|baad mein|later date/)) return "WALKIN_RESCHEDULED";
  if (has(t, /not interested|decline|refus|reject|cannot come|can.?t come|not coming|won.?t come|unable to (come|attend)|not available|will not|nahi aa|interested nahi|\bno\b/)) return "WALKIN_DECLINED_NEEDS_FOLLOWUP";
  if (has(t, /confirm|will come|coming|attend|\byes\b|\bhaan\b|ok\b|okay|interested|agreed|accepted|walk ?in confirmed|aaunga|aungi/)) return "WALKIN_CONFIRMED_YES";
  return null;
}

export interface ResultRowOut {
  rowNo: number; ok: boolean; errors: string[]; warnings: string[];
  display: { phone: string; result: string };
  mobile10?: string; outcome?: CallOutcome | "CALL_FAILED"; failedReason?: string; callId?: string;
  newInterviewAt?: string; durationS?: number; startedAt?: string; remarks?: string; referenceId?: string;
  /** Answered without a decision on the walk-in (a bot step): recorded, no state change. */
  undecided?: boolean;
  voice?: VoiceResult;
}

const text = (v: unknown) => (v == null ? "" : String(v).trim());
const yesNo = (v: unknown): "yes" | "no" | undefined => { const t = text(v).toLowerCase(); return /^(y|yes|true|1|received|done|filled|completed)$/.test(t) ? "yes" : /^(n|no|false|0|not received|pending|not done)$/.test(t) ? "no" : undefined; };

/** The calling tool's own report: an "Walkin Interview Attendance" column, its Disposition steps and an Outcome / Status pair. */
export const isBotReport = (headers: string[]): boolean => headers.some((h) => key(h) === "walkin_interview_attendance");

export interface BotVerdict { outcome: CallOutcome | "CALL_FAILED"; /** Answered, but no answer to the walk-in question yet: recorded, no state change. */ undecided: boolean }

/**
 * The bot's disposition steps (name verified, email received, details filled, interested to talk to an expert, callback requested)
 * are answered calls without a decision on the walk-in; "Walkin Interview Attendance" yes/no is the decision when it is there.
 * Order: explicit attendance disposition, then attendance column, then known steps, then the generic text rules. Pure.
 */
export function classifyBotRow(i: { disposition: string; attendance: string; outcome: string; status: string }): BotVerdict | null {
  const d = i.disposition.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const att = i.attendance.toLowerCase().trim();
  const out = i.outcome.toLowerCase().trim();
  const st = i.status.toLowerCase().trim();
  if (/^will not attend/.test(d) || /not interested to talk|already done elsewhere|interview already done|not applied/.test(d)) return { outcome: "WALKIN_DECLINED_NEEDS_FOLLOWUP", undecided: false };
  if (/^will attend/.test(d)) return { outcome: "WALKIN_CONFIRMED_YES", undecided: false };
  if (att === "yes") return { outcome: "WALKIN_CONFIRMED_YES", undecided: false };
  if (att === "no") return { outcome: "WALKIN_DECLINED_NEEDS_FOLLOWUP", undecided: false };
  if (!d) {
    if (st === "failed") return { outcome: "CALL_FAILED", undecided: false };
    if (out === "abandoned" || st === "answered") return { outcome: "NO_ANSWER", undecided: false };
    return null;
  }
  if (/uncertain|callback|call back|interested to talk|email received|details (filled|not filled)|name (verified|not verified)|only name verified|good time|not a good time|picked by someone/.test(d)) {
    return { outcome: "WALKIN_DECLINED_NEEDS_FOLLOWUP", undecided: true };
  }
  return null;
}

/** "7th Oct 2026 04:13 PM" (IST wall clock) -> "2026-10-07 16:13:00"; undefined when it is not that shape. */
export function parseBotDialTime(v: string): string | undefined {
  const m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})[a-z]*\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP]M)?$/i.exec(v.trim());
  if (!m) return undefined;
  const mon = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[2].toLowerCase());
  if (mon < 0) return undefined;
  let h = Number(m[4]);
  if (m[6]) { const pm = m[6].toUpperCase() === "PM"; if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${m[3]}-${p2(mon + 1)}-${p2(Number(m[1]))} ${p2(h)}:${m[5]}:00`;
}

export function parseResultRows(rawRows: Array<Record<string, unknown>>): { rows: ResultRowOut[]; missingColumns: string[]; tooMany: boolean } {
  const headers = Array.from(new Set(rawRows.flatMap((r) => Object.keys(r))));
  const { map, missing } = mapResultHeaders(headers);
  if (missing.length) return { rows: [], missingColumns: missing, tooMany: false };
  if (rawRows.length > 2000) return { rows: [], missingColumns: [], tooMany: true };
  const cell = (r: Record<string, unknown>, c: Col) => (map[c] ? r[map[c] as string] : undefined);
  const bot = isBotReport(headers);
  const seen = new Map<string, number>();
  const rows = rawRows.map((r, i): ResultRowOut => {
    const rowNo = i + 2;
    const errors: string[] = [];
    const warnings: string[] = [];
    const mobile10 = normalizeMobile10(cell(r, "phone"));
    const resultText = text(cell(r, "result"));
    const remarks = text(cell(r, "remarks"));
    if (!mobile10) errors.push("phone is not a valid 10-digit Indian mobile");
    // The disposition is the main signal; remarks only break a tie when the disposition alone is ambiguous.
    const verdict = bot ? classifyBotRow({ disposition: resultText, attendance: text(cell(r, "attendance")), outcome: text(cell(r, "bot_outcome")), status: text(cell(r, "bot_status")) }) : null;
    const outcome = verdict?.outcome ?? (bot ? null : classifyOutcome(resultText) ?? (resultText ? null : classifyOutcome(remarks)));
    if (!outcome) errors.push(resultText ? `could not understand the result "${resultText}" (expected confirmed / rescheduled / declined / no answer / wrong person / failed)` : "result is empty");
    const nd = parseDate(cell(r, "new_date")), nt = parseTime(cell(r, "new_time"));
    let newInterviewAt: string | undefined;
    if (outcome === "WALKIN_RESCHEDULED") {
      if (nd && nt) newInterviewAt = `${nd} ${nt}`;
      else if (nd) { newInterviewAt = `${nd} 10:00:00`; warnings.push("no new time given - assumed 10:00"); }
      else warnings.push("rescheduled but no new date given - the interview date is left unchanged");
    }
    const dur = Number(cell(r, "duration"));
    const ct = text(cell(r, "call_time"));
    const callId = text(cell(r, "call_id")).slice(0, 100) || undefined;
    if (mobile10) {
      const k = `${mobile10}|${callId ?? ct}|${outcome ?? ""}`;
      if (seen.has(k)) errors.push(`same call as row ${seen.get(k)} (duplicate)`); else seen.set(k, rowNo);
    }
    const ok = errors.length === 0 && Boolean(outcome);
    const undecided = Boolean(verdict?.undecided);
    const answered = outcome === "WALKIN_CONFIRMED_YES" || outcome === "WALKIN_RESCHEDULED" || outcome === "WALKIN_DECLINED_NEEDS_FOLLOWUP" || outcome === "WRONG_PERSON_REACHED";
    const voice: VoiceResult | undefined = ok ? {
      answered,
      identityConfirmed: outcome === "WRONG_PERSON_REACHED" ? "no" : answered ? "yes" : undefined,
      originalSlotAnswer: outcome === "WALKIN_CONFIRMED_YES" ? "yes" : outcome === "WALKIN_RESCHEDULED" || outcome === "WALKIN_DECLINED_NEEDS_FOLLOWUP" ? "no" : undefined,
      offeredSlotAnswer: outcome === "WALKIN_RESCHEDULED" ? "yes" : outcome === "WALKIN_DECLINED_NEEDS_FOLLOWUP" ? "no" : undefined,
      emailReceived: yesNo(cell(r, "email_received")) ?? undefined,
      assessmentDone: yesNo(cell(r, "assessment_done")) ?? undefined,
      durationS: Number.isFinite(dur) && dur >= 0 ? Math.round(dur) : undefined,
      failedReason: outcome === "CALL_FAILED" ? (resultText || "failed").slice(0, 80) : undefined,
    } : undefined;
    return {
      rowNo, ok, errors, warnings, display: { phone: text(cell(r, "phone")), result: resultText },
      mobile10: mobile10 ?? undefined, outcome: outcome ?? undefined, callId, newInterviewAt, remarks: remarks || undefined,
      referenceId: text(cell(r, "reference_id")).slice(0, 40) || undefined,
      durationS: voice?.durationS, startedAt: /^\d{4}-\d{2}-\d{2}/.test(ct) ? ct.slice(0, 19).replace("T", " ") : parseBotDialTime(ct), undecided, voice,
    };
  });
  return { rows, missingColumns: [], tooMany: false };
}
