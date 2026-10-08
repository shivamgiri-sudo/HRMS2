/**
 * Process Dashboard alerts -- delivery through the repo's EXISTING infrastructure (no parallel mail system):
 *   in-app  -> inboxService.createItem (the Work Inbox bell; dedupes per user + type + entity)
 *   e-mail  -> emailService.send (the shared SMTP transport, localhost-link guard included) + a dispatch_log row like the notification deliverer writes
 * Recipients are re-resolved and re-scope-checked on every send (alerts.recipients.ts).
 */
import { randomUUID } from "node:crypto";
import { db } from "../../../db/mysql.js";
import { env } from "../../../config/env.js";
import { logger } from "../../../logger.js";
import { emailService } from "../../communication/email.service.js";
import { inboxService } from "../../inbox/inbox.service.js";
import { resolvePeople, type Person } from "./alerts.recipients.js";
import type { Channel, RecipientSpec, Severity } from "./alerts.types.js";

export const INBOX_TYPE = "process_dashboard_alert";
export const INBOX_ENTITY = "pd_alert_event";
export const DIGEST_EVENT_CODE = "process_dashboard_digest";
export const ALERT_EVENT_CODE = "process_dashboard_alert";

export interface NotifySummary { recipients: number; dropped: number; inApp: number; email: number; emailFailed: number; emailSkippedNoAddress: number; emailError?: string }
export const emptySummary = (): NotifySummary => ({ recipients: 0, dropped: 0, inApp: 0, email: 0, emailFailed: 0, emailSkippedNoAddress: 0 });

async function logDispatch(eventCode: string, p: Person, subject: string, html: string, status: "sent" | "failed", error?: string): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO dispatch_log (id, template_name, event_code, recipient_employee_id, recipient_contact, recipient_count, channel, status, subject, body_preview, sent_at, is_critical${status === "failed" ? ", error_message" : ""})
       VALUES (?, ?, ?, ?, ?, 1, 'email', ?, ?, ?, ${status === "sent" ? "NOW()" : "NULL"}, 0${status === "failed" ? ", ?" : ""})`,
      [randomUUID(), eventCode, eventCode, p.employeeId, p.email, status, subject.slice(0, 200), html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500), ...(status === "failed" ? [(error ?? "").slice(0, 500)] : [])]);
  } catch (err) { logger.warn({ err }, "[pd-alerts] dispatch_log insert failed (mail outcome unaffected)"); }
}

export interface Envelope { subject: string; html: string; text: string }

/** Sends one e-mail per recipient (nobody sees anyone else's address). A failing address never aborts the others. */
export async function sendEmails(eventCode: string, people: Person[], mail: Envelope, summary: NotifySummary): Promise<void> {
  for (const p of people) {
    if (!p.email) { summary.emailSkippedNoAddress++; continue; }
    try {
      await emailService.send({ to: p.email, subject: mail.subject, html: mail.html, text: mail.text });
      summary.email++; await logDispatch(eventCode, p, mail.subject, mail.html, "sent");
    } catch (err) {
      summary.emailFailed++; summary.emailError = (err as Error).message.slice(0, 200);
      await logDispatch(eventCode, p, mail.subject, mail.html, "failed", (err as Error).message);
    }
  }
}

export interface AlertNotice { processId: string; eventId: string; title: string; body: string; severity: Severity; channels: Channel[]; mail: Envelope }
export async function notifyAlert(spec: RecipientSpec, n: AlertNotice): Promise<NotifySummary> {
  const summary = emptySummary();
  const { people, dropped } = await resolvePeople(n.processId, spec);
  summary.recipients = people.length; summary.dropped = dropped;
  if (n.channels.includes("in_app")) {
    for (const p of people) {
      try {
        await inboxService.createItem({ user_id: p.userId, type: INBOX_TYPE, title: n.title.slice(0, 250), description: n.body.slice(0, 500), entity_type: INBOX_ENTITY, entity_id: n.eventId,
          action_url: `/performance/process-dashboard/${n.processId}?view=alerts`, priority: n.severity === "critical" ? "high" : "normal" });
        summary.inApp++;
      } catch (err) { logger.warn({ err }, "[pd-alerts] in-app notification failed"); }
    }
  }
  if (n.channels.includes("email")) await sendEmails(ALERT_EVENT_CODE, people, n.mail, summary);
  return summary;
}

export const publicBaseUrl = (): string => String(env.FRONTEND_URL);
