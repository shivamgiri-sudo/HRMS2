/**
 * Step 1 of the outreach cadence: the walk-in invite by email (slot, address, map, documents, reference id).
 * One email per match. Honours the pause switch, opt-out, quiet hours and the closed-requisition check.
 * Logged in he_message (channel 'email') so the cadence, the 360 view and the attempt view all see it.
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

export const INVITE_EMAIL_KEY = "he_walkin_invite_email";
const env = (k: string, d: string) => (process.env[k]?.trim() ? process.env[k]!.trim() : d);
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const emailConfigured = (): boolean => emailService.isConfigured();

export interface InviteEmailInput {
  name: string; role: string; company: string; branch: string; address: string; date: string; time: string; maps: string | null;
  docs: string; reference: string; contact: string;
  /** Candidate's invitation page; the Yes / Cannot come / Another time buttons open it with ?a=... */
  answerUrl?: string | null;
  optInUrl?: string | null;
}

/**
 * Email-client-safe layout (tables + inline styles, no web fonts, works in Gmail/Outlook/phone mail apps).
 * The answer buttons open the candidate's invitation page, which asks for one more tap before recording anything,
 * so mail scanners that pre-open links never confirm or decline on the candidate's behalf.
 */
export function buildInviteEmail(c: InviteEmailInput): { subject: string; html: string; text: string } {
  const subject = `Walk-in interview: ${c.date}, ${c.time} - ${c.role}, ${c.company}`;
  const docs = c.docs.split(/\s*,\s*/).filter(Boolean);
  const btn = (href: string, label: string, bg: string, fg: string, border: string) =>
    `<a href="${esc(href)}" style="display:inline-block;background:${bg};color:${fg};border:1px solid ${border};padding:12px 18px;border-radius:8px;font-weight:bold;font-size:15px;text-decoration:none;margin:4px 6px 4px 0">${label}</a>`;
  const row = (label: string, value: string) =>
    `<tr><td style="padding:10px 0;border-top:1px solid #e2e8f0;width:110px;color:#64748b;font-size:13px;vertical-align:top">${label}</td><td style="padding:10px 0;border-top:1px solid #e2e8f0;font-size:15px;color:#0f172a">${value}</td></tr>`;
  const answer = c.answerUrl ? `
<tr><td style="padding:8px 28px 4px"><p style="margin:0 0 8px;font-size:15px;font-weight:bold;color:#0f172a">Will you come?</p>
${btn(`${c.answerUrl}?a=yes`, "Yes, I will come", "#15803d", "#ffffff", "#15803d")}${btn(`${c.answerUrl}?a=later`, "Need another time", "#ffffff", "#1e3a8a", "#94a3b8")}${btn(`${c.answerUrl}?a=no`, "Cannot come", "#ffffff", "#b91c1c", "#fecaca")}
<p style="margin:6px 0 0;font-size:12px;color:#64748b">One tap tells the branch to expect you, or frees your slot for someone else.</p></td></tr>` : "";
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f1f5f9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<tr><td style="background:#1e3a8a;padding:18px 28px;color:#ffffff;font-size:18px;font-weight:bold;letter-spacing:.3px">${esc(c.company)} <span style="font-weight:normal;font-size:13px;color:#c7d2fe">&nbsp;|&nbsp; Careers</span></td></tr>
<tr><td style="padding:26px 28px 6px">
<p style="margin:0 0 6px;font-size:16px">Hi ${esc(c.name)},</p>
<p style="margin:0;font-size:15px;line-height:1.55;color:#334155">Thank you for your interest. Your profile matches our <b>${esc(c.role)}</b> opening, and we have reserved a walk-in interview slot for you.</p>
</td></tr>
<tr><td style="padding:16px 28px 6px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px"><tr><td style="padding:16px 18px">
<div style="font-size:12px;color:#1e40af;text-transform:uppercase;letter-spacing:1px;font-weight:bold">Your slot</div>
<div style="font-size:22px;font-weight:bold;color:#0f172a;margin-top:4px">${esc(c.date)}</div>
<div style="font-size:18px;color:#1e3a8a;margin-top:2px">${esc(c.time)}</div>
</td></tr></table></td></tr>
${answer}
<tr><td style="padding:14px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${row("Venue", `<b>${esc(c.branch)}</b>${c.address ? `<br/><span style="font-size:14px;color:#334155">${esc(c.address)}</span>` : ""}${c.maps ? `<br/><a href="${esc(c.maps)}" style="font-size:14px;color:#1d4ed8">Get directions</a>` : ""}`)}
${row("Please carry", `<ul style="margin:0;padding-left:18px">${docs.map((d) => `<li style="margin:2px 0">${esc(d)}</li>`).join("")}</ul>`)}
${row("Reference", `<span style="font-family:Consolas,monospace">${esc(c.reference)}</span> <span style="font-size:13px;color:#64748b">(show this at reception)</span>`)}
${c.contact ? row("Questions", esc(c.contact)) : ""}
</table></td></tr>
${c.optInUrl ? `<tr><td style="padding:12px 28px 0;font-size:13px;color:#475569">Want reminders and directions on WhatsApp? <a href="${esc(c.optInUrl)}" style="color:#15803d;font-weight:bold">Turn on WhatsApp updates</a> (optional).</td></tr>` : ""}
<tr><td style="padding:22px 28px 26px;font-size:14px;color:#334155">All the best,<br/><b>${esc(c.company)} Hiring Team</b></td></tr>
<tr><td style="background:#f8fafc;padding:14px 28px;font-size:11px;color:#94a3b8;line-height:1.5">You are receiving this because you applied for a job with ${esc(c.company)} or shared your profile with us. The interview is free of charge; we never ask for money.</td></tr>
</table></td></tr></table></body></html>`;
  const text = [`Hi ${c.name},`, "", `Your profile matches our ${c.role} opening. Your walk-in interview slot:`, `${c.date}, ${c.time}`,
    `Venue: ${c.branch}${c.address ? `, ${c.address}` : ""}`, c.maps ? `Directions: ${c.maps}` : "", `Please carry: ${docs.join(", ")}`, `Reference: ${c.reference}`,
    c.answerUrl ? `\nWill you come? Yes: ${c.answerUrl}?a=yes | Another time: ${c.answerUrl}?a=later | Cannot come: ${c.answerUrl}?a=no` : "",
    c.contact ? `Questions: ${c.contact}` : "", "", `All the best,`, `${c.company} Hiring Team`].filter((l) => l !== "").join("\n");
  return { subject, html, text };
}

export async function sendInviteEmail(matchId: string, o: { dryRun?: boolean } = {}): Promise<SendResult> {
  const [mr] = await db.execute<RowDataPacket[]>(
    `SELECT m.id, m.lead_id, m.requisition_id, m.slot_at, m.token, d.id AS drive_id, d.drive_date, d.status AS drive_status,
            l.full_name, l.email, l.status AS lead_status, l.mobile10,
            jr.designation_name, jr.branch_name, jr.approval_status, jr.active_status, jr.requested_headcount, jr.fulfilled_headcount, bm.address, bm.latitude, bm.longitude
       FROM he_match m JOIN he_lead l ON l.id = m.lead_id LEFT JOIN he_drive d ON d.id = m.drive_id
       JOIN job_requisition jr ON jr.id = m.requisition_id LEFT JOIN branch_master bm ON bm.branch_name = jr.branch_name AND bm.active_status = 1
      WHERE m.id = ? LIMIT 1`, [matchId]);
  const m = mr[0];
  if (!m) return { status: "blocked", reason: "match_not_found" };
  if (sendsPaused() || m.drive_status === "paused") return { status: "blocked", reason: "paused" };
  if (m.lead_status === "opted_out") return { status: "blocked", reason: "opted_out" };
  const to = normaliseEmail(String(m.email ?? ""));
  if (!to) return { status: "blocked", reason: "no_email" };
  if (m.approval_status !== "approved" || !m.active_status || Number(m.fulfilled_headcount) >= Number(m.requested_headcount)) return { status: "blocked", reason: "requisition_closed" };
  if (!m.slot_at) return { status: "blocked", reason: "no_slot" };
  const h = istHour(new Date());
  if (h >= 20 || h < 9) return { status: "blocked", reason: "quiet_hours" };
  // One invite per drive (a later drive for the same requisition is a new date and gets its own email).
  const [dup] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM he_message WHERE lead_id = ? AND requisition_id = ? AND template_key = ? AND direction = 'out' AND delivery_status <> 'failed'
        AND (drive_id <=> ?) LIMIT 1`, [m.lead_id, m.requisition_id, INVITE_EMAIL_KEY, m.drive_id ?? null]);
  if (dup.length) return { status: "blocked", reason: "already_emailed" };
  if (!emailService.isConfigured()) return { status: "blocked", reason: "email_not_configured" };

  const slot = String(m.slot_at);
  const maps = m.latitude != null && m.longitude != null ? `https://maps.google.com/?q=${m.latitude},${m.longitude}` : m.address ? `https://maps.google.com/?q=${encodeURIComponent(String(m.address))}` : null;
  const phone = env("HE_HR_CONTACT_PHONE", ""), cname = env("HE_HR_CONTACT_NAME", "");
  const base = env("HE_PUBLIC_BASE_URL", env("FRONTEND_URL", "https://mcnhrms.teammas.in")).replace(/\/$/, "");
  const mail = buildInviteEmail({
    name: displayFirstName(m.full_name), role: String(m.designation_name ?? "the role"), company: env("HE_COMPANY_NAME", "MAS Callnet"),
    branch: String(m.branch_name ?? ""), address: String(m.address ?? ""), date: m.drive_date ? dateLabel(String(m.drive_date)) : slot.slice(0, 10), time: timeLabel(slot), maps,
    docs: env("HE_DOCS_LIST", "Aadhaar, PAN, 12th marksheet"), reference: `HE-${String(m.id).replace(/-/g, "").slice(0, 6).toUpperCase()}`, contact: [cname, phone].filter(Boolean).join(" "),
    answerUrl: m.token ? `${base}/w/${m.token}` : null,
    optInUrl: m.token ? `${base}/w/${m.token}` : null,
  });
  if (o.dryRun) return { status: "dry_run", body: mail.subject, lang: "en", params: [] };

  const messageId = randomUUID();
  try {
    const r = await emailService.send({ to, subject: mail.subject, html: mail.html, text: mail.text });
    await db.execute(
      "INSERT INTO he_message (id, lead_id, mobile10, direction, channel, template_key, body, provider_message_id, delivery_status, requisition_id, drive_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [messageId, m.lead_id, m.mobile10, "out", "email", INVITE_EMAIL_KEY, mail.subject.slice(0, 2000), r?.messageId ?? null, "sent", m.requisition_id, m.drive_id ?? null]);
    await addEvent(String(m.lead_id), `sent_${INVITE_EMAIL_KEY}`, { channel: "email", driveId: m.drive_id, detail: to.replace(/^(.).*(@.*)$/, "$1***$2") });
    await db.execute("UPDATE he_lead SET last_contact_at = NOW() WHERE id = ?", [m.lead_id]);
    return { status: "sent", messageId, providerMessageId: r?.messageId ?? "" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.execute(
      "INSERT INTO he_message (id, lead_id, mobile10, direction, channel, template_key, body, delivery_status, error_message, requisition_id, drive_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [messageId, m.lead_id, m.mobile10, "out", "email", INVITE_EMAIL_KEY, mail.subject.slice(0, 2000), "failed", msg.slice(0, 480), m.requisition_id, m.drive_id ?? null]);
    await addEvent(String(m.lead_id), "send_failed", { channel: "email", detail: msg.slice(0, 300), driveId: m.drive_id });
    logger.warn({ leadId: m.lead_id, error: msg }, "[he-email] failed");
    return { status: "failed", error: msg };
  }
}
