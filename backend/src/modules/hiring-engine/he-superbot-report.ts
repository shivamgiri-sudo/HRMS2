/**
 * Reads the call report downloaded from the Superbot portal (the file the bot team sends back) into the same shape as the live feedback webhook,
 * so one mapping (mapSuperbotFeedback) decides what each call means. Headers are matched loosely ("Walkin Interview Attendance" = walkin_interview_attendance).
 */
import type { SuperbotFeedback } from "./he-superbot.js";

const key = (h: string) => String(h).toLowerCase().replace(/[^a-z0-9]+/g, "");
const blank = (v: unknown) => { const s = String(v ?? "").trim(); return s === "" || s === "-" || s.toLowerCase() === "null" || s.toLowerCase() === "undefined" ? "" : s; };

/** "7th Oct 2026 04:13 PM" -> "2026-10-07 16:13:00" (IST, as the portal shows it). */
export function parseDialTime(v: unknown): string | null {
  const m = /(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})[a-z]*\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(String(v ?? ""));
  if (!m) return null;
  const mon = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[2].toLowerCase());
  if (mon < 0) return null;
  let h = Number(m[4]) % 12; if (/pm/i.test(m[6] ?? "") ) h += 12; if (!m[6]) h = Number(m[4]);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${m[3]}-${p(mon + 1)}-${p(Number(m[1]))} ${p(h)}:${m[5]}:00`;
}

export interface ReportRow { feedback: SuperbotFeedback; uniqueCallId: string | null; attemptNo: number | null; dialTime: string | null; phone10: string | null }

export function reportRowToFeedback(raw: Record<string, unknown>): ReportRow | null {
  const r = new Map<string, unknown>(Object.entries(raw).map(([k, v]) => [key(k), v]));
  const g = (...names: string[]) => { for (const n of names) { const v = blank(r.get(key(n))); if (v) return v; } return ""; };
  const ref = g("Reference ID", "reference_id");
  const phone = g("Phone Number", "phone").replace(/\D/g, "").slice(-10);
  if (!ref && !phone) return null;
  const dial = parseDialTime(g("Call Dial Time", "time"));
  const fields = ["name_confirmation", "good_time_to_talk", "email_received", "details_filled", "walkin_interview_attendance", "talk_to_hr", "callback_details", "callback_request", "already_done", "not_applied"];
  const feedback: NonNullable<SuperbotFeedback["feedback"]> = {};
  for (const f of fields) { const v = g(f); if (v) feedback[f] = { label: f, value: v }; }
  const att = Number(g("No Of Attempt", "Retry Count"));
  return {
    uniqueCallId: g("Unique Call Id") || null, attemptNo: Number.isFinite(att) && att > 0 ? att : null, dialTime: dial, phone10: phone || null,
    feedback: {
      phone: phone ? `+91${phone}` : undefined, time: dial ? dial.replace(" ", "T") : undefined, status: g("Status").toLowerCase() || undefined,
      call_duration: g("Duration(s)", "Duration") || undefined, call_status: g("Disposition") || undefined, outcome: g("Outcome").toLowerCase() || null,
      call_recording_url: g("Audio URL") || undefined, disposition: g("Disposition") || undefined, reference_id: ref || undefined, feedback,
    },
  };
}
