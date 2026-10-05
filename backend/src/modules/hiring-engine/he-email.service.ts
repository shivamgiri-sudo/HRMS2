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
import { dateLabel, sendsPaused, timeLabel, type SendResult } from "./he-send.service.js";

export const INVITE_EMAIL_KEY = "he_walkin_invite_email";
const env = (k: string, d: string) => (process.env[k]?.trim() ? process.env[k]!.trim() : d);
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const emailConfigured = (): boolean => emailService.isConfigured();

export function buildInviteEmail(c: { name: string; role: string; company: string; branch: string; address: string; date: string; time: string; maps: string | null; docs: string; reference: string; contact: string }): { subject: string; html: string } {
  const subject = `Interview on ${c.date}, ${c.time} - ${c.role} at ${c.company}`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a;max-width:560px">
<p>Hi ${esc(c.name)},</p>
<p>You are shortlisted for <b>${esc(c.role)}</b> at ${esc(c.company)}. Your walk-in interview slot is reserved:</p>
<table style="border-collapse:collapse;margin:8px 0">
<tr><td style="padding:4px 12px 4px 0;color:#475569">Date and time</td><td><b>${esc(c.date)}, ${esc(c.time)}</b></td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#475569">Venue</td><td>${esc(c.branch)}${c.address ? `, ${esc(c.address)}` : ""}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#475569">Carry</td><td>${esc(c.docs)}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#475569">Reference</td><td>${esc(c.reference)}</td></tr></table>
${c.maps ? `<p><a href="${esc(c.maps)}">Open the location in Google Maps</a></p>` : ""}
<p>To confirm or change the time, reply to this email or to our WhatsApp message${c.contact ? `, or contact ${esc(c.contact)}` : ""}.</p>
<p>Regards,<br/>${esc(c.company)} Hiring Team</p></div>`;
  return { subject, html };
}

export async function sendInviteEmail(matchId: string, o: { dryRun?: boolean } = {}): Promise<SendResult> {
  const [mr] = await db.execute<RowDataPacket[]>(
    `SELECT m.id, m.lead_id, m.requisition_id, m.slot_at, d.id AS drive_id, d.drive_date, d.status AS drive_status,
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
  const [dup] = await db.execute<RowDataPacket[]>("SELECT 1 FROM he_message WHERE lead_id = ? AND requisition_id = ? AND template_key = ? AND direction = 'out' AND delivery_status <> 'failed' LIMIT 1", [m.lead_id, m.requisition_id, INVITE_EMAIL_KEY]);
  if (dup.length) return { status: "blocked", reason: "already_emailed" };
  if (!emailService.isConfigured()) return { status: "blocked", reason: "email_not_configured" };

  const slot = String(m.slot_at);
  const maps = m.latitude != null && m.longitude != null ? `https://maps.google.com/?q=${m.latitude},${m.longitude}` : m.address ? `https://maps.google.com/?q=${encodeURIComponent(String(m.address))}` : null;
  const phone = env("HE_HR_CONTACT_PHONE", ""), cname = env("HE_HR_CONTACT_NAME", "");
  const mail = buildInviteEmail({
    name: String(m.full_name ?? "").trim().split(/\s+/)[0] || "Candidate", role: String(m.designation_name ?? "the role"), company: env("HE_COMPANY_NAME", "MAS Callnet"),
    branch: String(m.branch_name ?? ""), address: String(m.address ?? ""), date: m.drive_date ? dateLabel(String(m.drive_date)) : slot.slice(0, 10), time: timeLabel(slot), maps,
    docs: env("HE_DOCS_LIST", "Aadhaar, PAN, 12th marksheet"), reference: `HE-${String(m.id).replace(/-/g, "").slice(0, 6).toUpperCase()}`, contact: [cname, phone].filter(Boolean).join(" "),
  });
  if (o.dryRun) return { status: "dry_run", body: mail.subject, lang: "en", params: [] };

  const messageId = randomUUID();
  try {
    const r = await emailService.send({ to, subject: mail.subject, html: mail.html });
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
