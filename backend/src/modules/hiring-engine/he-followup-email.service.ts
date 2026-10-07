/**
 * Follow-up emails that mirror the WhatsApp follow-ups, so a candidate with an email address is kept informed on both channels:
 *   confirmed        right after they confirm (button, email tap or bot call)
 *   reminder_1d      the day before the interview, with the answer buttons
 *   reschedule_offer a new slot after they asked for another time
 *   no_show          after a missed interview, with a way to ask for a new time
 * Each is sent once per drive (logged in he_message), only to people with a valid email who have not opted out, and only 09:00-20:00 IST
 * except the two that answer something the candidate just did (confirmed, reschedule_offer).
 */
import type { RowDataPacket } from "mysql2";
import { randomUUID } from "node:crypto";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { emailService } from "../communication/email.service.js";
import { normaliseEmail } from "../../shared/email-domains.js";
import { addEvent } from "./he-lead.service.js";
import { istHour } from "./he-guardrails.js";
import { displayFirstName } from "./he-name.js";
import { dateLabel, sendsPaused, timeLabel, type SendResult } from "./he-send.service.js";

export type FollowKind = "confirmed" | "reminder_1d" | "reschedule_offer" | "no_show";
export const followKey = (k: FollowKind) => `he_email_${k}`;
const TRANSACTIONAL: FollowKind[] = ["confirmed", "reschedule_offer"];
const env = (k: string, d: string) => (process.env[k]?.trim() ? process.env[k]!.trim() : d);
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface FollowEmailInput {
  kind: FollowKind; name: string; role: string; company: string; branch: string; address: string; date: string; time: string; maps: string | null;
  docs: string; reference: string; contact: string; answerUrl: string | null;
}

const COPY: Record<FollowKind, { subject: (c: FollowEmailInput) => string; intro: (c: FollowEmailInput) => string; slotLabel: string; ask: string | null; buttons: Array<[string, string, string]> }> = {
  confirmed: {
    subject: (c) => `Confirmed: your interview on ${c.date}, ${c.time} - ${c.role}`,
    intro: (c) => `Thank you, your walk-in interview for <b>${esc(c.role)}</b> is confirmed. We will expect you.`,
    slotLabel: "Confirmed slot", ask: null, buttons: [],
  },
  reminder_1d: {
    subject: (c) => `Reminder: your interview on ${c.date}, ${c.time} - ${c.role}`,
    intro: (c) => `This is a reminder of your walk-in interview for <b>${esc(c.role)}</b>. Please confirm that you can still come.`,
    slotLabel: "Your slot", ask: "Will you come?",
    buttons: [["yes", "Yes, I will come", "green"], ["later", "Need another time", "blue"], ["no", "Cannot come", "red"]],
  },
  reschedule_offer: {
    subject: (c) => `New interview time for you: ${c.date}, ${c.time} - ${c.role}`,
    intro: (c) => `Here is a new time for your walk-in interview for <b>${esc(c.role)}</b>. Please tell us whether it works.`,
    slotLabel: "New slot", ask: "Does this time work?",
    buttons: [["yes", "Yes, this works", "green"], ["no", "This does not work either", "red"]],
  },
  no_show: {
    subject: (c) => `We missed you at your interview - ${c.role}`,
    intro: (c) => `We expected you for your walk-in interview for <b>${esc(c.role)}</b> on ${esc(c.date)} at ${esc(c.time)}, but could not see you. If you would still like to interview, we can find you a new time.`,
    slotLabel: "Missed slot", ask: "What would you like to do?",
    buttons: [["later", "I need a new slot", "blue"], ["no", "Not interested", "red"]],
  },
};
const STYLE = { green: ["#15803d", "#ffffff", "#15803d"], blue: ["#ffffff", "#1e3a8a", "#94a3b8"], red: ["#ffffff", "#b91c1c", "#fecaca"] } as const;

export function buildFollowUpEmail(c: FollowEmailInput): { subject: string; html: string; text: string } {
  const k = COPY[c.kind];
  const docs = c.docs.split(/\s*,\s*/).filter(Boolean);
  const btn = (a: string, label: string, tone: keyof typeof STYLE) => `<a href="${esc(`${c.answerUrl}?a=${a}`)}" style="display:block;text-align:center;background:${STYLE[tone][0]};color:${STYLE[tone][1]};border:1px solid ${STYLE[tone][2]};padding:14px 18px;border-radius:8px;font-weight:bold;font-size:16px;text-decoration:none;margin:0 0 10px">${esc(label)}</a>`;
  const row = (l: string, v: string) => `<tr><td style="padding:10px 0;border-top:1px solid #e2e8f0;width:110px;color:#64748b;font-size:13px;vertical-align:top">${l}</td><td style="padding:10px 0;border-top:1px solid #e2e8f0;font-size:15px;color:#0f172a">${v}</td></tr>`;
  const buttons = c.answerUrl && k.buttons.length ? `<tr><td style="padding:8px 28px 4px"><p style="margin:0 0 8px;font-size:15px;font-weight:bold;color:#0f172a">${esc(k.ask ?? "")}</p>${k.buttons.map(([a, l, t]) => btn(a, l, t as keyof typeof STYLE)).join("")}</td></tr>` : "";
  const change = c.kind === "confirmed" && c.answerUrl ? `<tr><td style="padding:6px 28px 0;font-size:13px;color:#475569">Something came up? <a href="${esc(`${c.answerUrl}?a=later`)}" style="color:#1d4ed8">Ask for another time</a>.</td></tr>` : "";
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f1f5f9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<tr><td style="background:#1e3a8a;padding:18px 28px;color:#ffffff;font-size:18px;font-weight:bold;letter-spacing:.3px">${esc(c.company)} <span style="font-weight:normal;font-size:13px;color:#c7d2fe">&nbsp;|&nbsp; Careers</span></td></tr>
<tr><td style="padding:26px 28px 6px"><p style="margin:0 0 6px;font-size:16px">Hi ${esc(c.name)},</p><p style="margin:0;font-size:15px;line-height:1.55;color:#334155">${k.intro(c)}</p></td></tr>
<tr><td style="padding:16px 28px 6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px"><tr><td style="padding:16px 18px">
<div style="font-size:12px;color:#1e40af;text-transform:uppercase;letter-spacing:1px;font-weight:bold">${esc(k.slotLabel)}</div>
<div style="font-size:22px;font-weight:bold;color:#0f172a;margin-top:4px">${esc(c.date)}</div><div style="font-size:18px;color:#1e3a8a;margin-top:2px">${esc(c.time)}</div></td></tr></table></td></tr>
${buttons}${change}
<tr><td style="padding:14px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${row("Venue", `<b>${esc(c.branch)}</b>${c.address ? `<br/><span style="font-size:14px;color:#334155">${esc(c.address)}</span>` : ""}${c.maps ? `<br/><a href="${esc(c.maps)}" style="font-size:14px;color:#1d4ed8">Get directions</a>` : ""}`)}
${c.kind === "no_show" ? "" : row("Please carry", `<ul style="margin:0;padding-left:18px">${docs.map((d) => `<li style="margin:2px 0">${esc(d)}</li>`).join("")}</ul>`)}
${row("Reference", `<span style="font-family:Consolas,monospace">${esc(c.reference)}</span> <span style="font-size:13px;color:#64748b">(show this at reception)</span>`)}
${c.contact ? row("Questions", esc(c.contact)) : ""}</table></td></tr>
<tr><td style="padding:22px 28px 26px;font-size:14px;color:#334155">All the best,<br/><b>${esc(c.company)} Hiring Team</b></td></tr>
<tr><td style="background:#f8fafc;padding:14px 28px;font-size:11px;color:#94a3b8;line-height:1.5">You are receiving this because you applied for a job with ${esc(c.company)}. The interview is free of charge; we never ask for money.</td></tr>
</table></td></tr></table></body></html>`;
  const text = [`Hi ${c.name},`, "", k.intro(c).replace(/<[^>]+>/g, ""), `${k.slotLabel}: ${c.date}, ${c.time}`, `Venue: ${c.branch}${c.address ? `, ${c.address}` : ""}`, c.maps ? `Directions: ${c.maps}` : "",
    c.kind === "no_show" ? "" : `Please carry: ${docs.join(", ")}`, `Reference: ${c.reference}`,
    c.answerUrl && k.buttons.length ? `\n${k.ask} ${k.buttons.map(([a, l]) => `${l}: ${c.answerUrl}?a=${a}`).join(" | ")}` : "", c.contact ? `Questions: ${c.contact}` : "", "", "All the best,", `${c.company} Hiring Team`].filter((l) => l !== "").join("\n");
  return { subject: k.subject(c), html, text };
}

export async function sendFollowUpEmail(kind: FollowKind, matchId: string, o: { dryRun?: boolean } = {}): Promise<SendResult> {
  const [mr] = await db.execute<RowRowData>(
    `SELECT m.id, m.lead_id, m.requisition_id, m.slot_at, m.token, d.id AS drive_id, d.drive_date, d.status AS drive_status, l.full_name, l.email, l.status AS lead_status, l.mobile10,
            jr.designation_name, jr.branch_name, jr.approval_status, jr.active_status, jr.requested_headcount, jr.fulfilled_headcount, bm.address, bm.latitude, bm.longitude
       FROM he_match m JOIN he_lead l ON l.id = m.lead_id LEFT JOIN he_drive d ON d.id = m.drive_id JOIN job_requisition jr ON jr.id = m.requisition_id
       LEFT JOIN branch_master bm ON bm.branch_name = jr.branch_name AND bm.active_status = 1 WHERE m.id = ? LIMIT 1`, [matchId]);
  const m = mr[0];
  if (!m) return { status: "blocked", reason: "match_not_found" };
  if (sendsPaused() || m.drive_status === "paused") return { status: "blocked", reason: "paused" };
  if (m.lead_status === "opted_out") return { status: "blocked", reason: "opted_out" };
  const to = normaliseEmail(String(m.email ?? ""));
  if (!to) return { status: "blocked", reason: "no_email" };
  if (!m.slot_at) return { status: "blocked", reason: "no_slot" };
  const open = m.approval_status === "approved" && Boolean(m.active_status) && Number(m.fulfilled_headcount) < Number(m.requested_headcount);
  if (!open && kind !== "confirmed") return { status: "blocked", reason: "requisition_closed" };
  const h = istHour(new Date());
  if (!TRANSACTIONAL.includes(kind) && (h >= 20 || h < 9)) return { status: "blocked", reason: "quiet_hours" };
  const [dup] = await db.execute<RowRowData>("SELECT 1 FROM he_message WHERE lead_id = ? AND requisition_id = ? AND template_key = ? AND direction = 'out' AND delivery_status <> 'failed' AND (drive_id <=> ?) LIMIT 1", [m.lead_id, m.requisition_id, followKey(kind), m.drive_id ?? null]);
  if (dup.length && kind !== "reschedule_offer") return { status: "blocked", reason: "already_emailed" };
  if (!emailService.isConfigured()) return { status: "blocked", reason: "email_not_configured" };
  const slot = String(m.slot_at);
  const maps = m.latitude != null && m.longitude != null ? `https://maps.google.com/?q=${m.latitude},${m.longitude}` : m.address ? `https://maps.google.com/?q=${encodeURIComponent(String(m.address))}` : null;
  const base = env("HE_PUBLIC_BASE_URL", env("FRONTEND_URL", "https://mcnhrms.teammas.in")).replace(/\/$/, "");
  const cname = env("HE_HR_CONTACT_NAME", ""), phone = env("HE_HR_CONTACT_PHONE", "");
  const mail = buildFollowUpEmail({
    kind, name: displayFirstName(m.full_name), role: String(m.designation_name ?? "the role"), company: env("HE_COMPANY_NAME", "MAS Callnet"), branch: String(m.branch_name ?? ""), address: String(m.address ?? ""),
    date: dateLabel(slot.slice(0, 10)), time: timeLabel(slot), maps, docs: env("HE_DOCS_LIST", "Aadhaar, PAN, 12th marksheet"), reference: `HE-${String(m.id).replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    contact: [cname, phone].filter(Boolean).join(" "), answerUrl: m.token ? `${base}/w/${m.token}` : null,
  });
  if (o.dryRun) return { status: "dry_run", body: mail.subject, lang: "en", params: [] };
  const messageId = randomUUID();
  try {
    const r = await emailService.send({ to, subject: mail.subject, html: mail.html, text: mail.text });
    await db.execute("INSERT INTO he_message (id, lead_id, mobile10, direction, channel, template_key, body, provider_message_id, delivery_status, requisition_id, drive_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [messageId, m.lead_id, m.mobile10, "out", "email", followKey(kind), mail.subject.slice(0, 2000), r?.messageId ?? null, "sent", m.requisition_id, m.drive_id ?? null]);
    await addEvent(String(m.lead_id), `sent_${followKey(kind)}`, { channel: "email", driveId: m.drive_id, detail: to.replace(/^(.).*(@.*)$/, "$1***$2") });
    return { status: "sent", messageId, providerMessageId: r?.messageId ?? "" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.execute("INSERT INTO he_message (id, lead_id, mobile10, direction, channel, template_key, body, delivery_status, error_message, requisition_id, drive_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [messageId, m.lead_id, m.mobile10, "out", "email", followKey(kind), mail.subject.slice(0, 2000), "failed", msg.slice(0, 480), m.requisition_id, m.drive_id ?? null]);
    logger.warn({ leadId: m.lead_id, kind, error: msg }, "[he-followup-email] failed");
    return { status: "failed", error: msg };
  }
}
type RowRowData = RowDataPacket[];
