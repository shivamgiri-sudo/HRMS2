/**
 * The NotificationDeliverer — the last piece, and the only one that actually sends.
 *
 * The gateway owns policy (kill switch, recipient resolution, deny-list, claim); this owns
 * transport. Keeping them apart is what let phases 1a-1c ship inert and fully tested: with
 * no deliverer registered, a live event throws instead of silently doing nothing.
 *
 * It sends ONE message with real To/CC/BCC rather than looping per recipient, which is why
 * it does not reuse dispatchService.send(). That method loops over employees and drops CC
 * entirely (dispatch.service.ts:200 never passes the attachments the provider interface
 * already accepts), so a five-person escalation would arrive as five separate mails with
 * nobody able to see who else was told.
 *
 * Registered at bootstrap by registerNotificationDeliverer().
 */
import { randomUUID } from 'crypto';
import type { ResultSetHeader } from 'mysql2';
import { db } from '../../db/mysql.js';
import { emailService } from './email.service.js';
import type { EmailAttachment } from './email.service.js';
import { templateService } from './template.service.js';
import { registerDeliverer } from './notification.gateway.js';
import type { NotificationDeliverer } from './notification.gateway.js';
import type { ResolvedRecipient } from '../../shared/recipient-resolver.types.js';
import { inboxService } from '../inbox/inbox.service.js';

/** More than this many CC addresses becomes BCC — recipients should not be exposed to
 *  each other on a broadcast. NOTIFICATION_CATALOGUE.md section 5. */
const CC_TO_BCC_THRESHOLD = 5;

function addressList(people: ResolvedRecipient[]): string {
  return people.map((p) => (p.name ? `"${p.name.replace(/"/g, '')}" <${p.email}>` : p.email)).join(', ');
}

/**
 * Minimal, deliberately plain fallback body.
 *
 * Used only when an event has no template. It is intentionally boring: a missing template
 * should look unfinished so somebody fixes it, rather than looking polished enough to
 * leave. It still carries the "why you got this" line, which is mandatory on every copy.
 */
export function fallbackBody(eventCode: string, data: Record<string, unknown>): { subject: string; html: string; text: string } {
  const rows = Object.entries(data)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
    .slice(0, 12)
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:13px">${k.replace(/_/g, ' ')}</td>` +
                     `<td style="padding:4px 0;color:#111827;font-size:13px"><strong>${String(v)}</strong></td></tr>`)
    .join('');
  const title = eventCode.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  return {
    subject: `MAS Callnet HRMS — ${title}`,
    html:
      `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px">` +
      `<p style="font-size:15px;color:#111827;margin:0 0 12px"><strong>${title}</strong></p>` +
      `<table style="border-collapse:collapse">${rows}</table>` +
      `<p style="margin-top:18px;font-size:12px;color:#6b7280">` +
      `You are receiving this from MAS Callnet PeopleOS. This notification has no template ` +
      `configured yet — please report it to HR Systems.</p></div>`,
    text: `${title}\n\n` + Object.entries(data).map(([k, v]) => `${k}: ${String(v)}`).join('\n'),
  };
}

export const notificationDeliverer: NotificationDeliverer = {
  async deliver({ eventCode, templateKey, data, resolution, isCritical, correlationId, entityType, entityId }) {
    // Split CC into BCC past the threshold so a broadcast does not leak an address book.
    let cc = resolution.cc;
    let bcc = resolution.bcc;
    if (cc.length > CC_TO_BCC_THRESHOLD) {
      bcc = [...bcc, ...cc];
      cc = [];
    }

    let subject: string;
    let html: string;
    let text: string | undefined;

    if (templateKey) {
      const rendered = await templateService
        .renderTemplate({ template_name: templateKey, channel: 'email', data })
        .catch(() => null);
      if (rendered?.html) {
        subject = rendered.subject ?? fallbackBody(eventCode, data).subject;
        html = rendered.html;
        text = rendered.text;
      } else {
        // Template named but not found. Fall back rather than fail: a missing template
        // must not silently suppress an escalation.
        const f = fallbackBody(eventCode, data);
        subject = f.subject; html = f.html; text = f.text;
        console.warn(`[notification-deliverer] template '${templateKey}' not found for ${eventCode}; used fallback`);
      }
    } else {
      const f = fallbackBody(eventCode, data);
      subject = f.subject; html = f.html; text = f.text;
    }

    const attachments = (data.__attachments as EmailAttachment[] | undefined) ?? undefined;

    const { messageId } = await emailService.send({
      to: addressList(resolution.to),
      ...(cc.length ? { cc: addressList(cc) } : {}),
      ...(bcc.length ? { bcc: addressList(bcc) } : {}),
      subject,
      html,
      text,
      attachments,
    });

    // One dispatch_log row per envelope, not per recipient — envelope columns come from
    // migration 1023.
    const logId = randomUUID();
    await db.execute<ResultSetHeader>(
      `INSERT INTO dispatch_log
         (id, template_name, event_code, correlation_id, recipient_employee_id,
          recipient_contact, cc_contacts, bcc_contacts, recipient_count,
          channel, status, subject, body_preview, sent_at, is_critical)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'email', 'sent', ?, ?, NOW(), ?)`,
      [
        logId, templateKey ?? eventCode, eventCode, correlationId ?? null,
        resolution.to[0]?.employeeId ?? null,
        resolution.to.map((r) => r.email).join(', '),
        cc.length ? cc.map((r) => r.email).join(', ') : null,
        bcc.length ? bcc.map((r) => r.email).join(', ') : null,
        resolution.to.length + cc.length + bcc.length,
        subject.slice(0, 200),
        html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500),
        isCritical ? 1 : 0,
      ],
    ).catch((err) => {
      // The mail is already gone. Losing its log row must not turn a delivered message
      // into a reported failure, which would make the gateway retry and double-send.
      console.error(`[notification-deliverer] dispatch_log insert failed for ${eventCode}:`, (err as Error).message);
      return [{} as ResultSetHeader];
    });

    // Mirror to the in-app inbox for internal recipients who have a user account.
    // entity_type/entity_id are passed because inboxService.createItem dedupes on
    // (user, type, entity, action_url) — omitting them defeats that dedupe entirely.
    for (const r of [...resolution.to, ...cc]) {
      if (!r.userId) continue;
      await inboxService.createItem({
        user_id: r.userId,
        type: eventCode,
        title: subject,
        description: text?.slice(0, 500) ?? subject,
        entity_type: entityType,
        entity_id: entityId,
        priority: isCritical ? 'high' : 'normal',
      }).catch(() => { /* inbox is a mirror, never the reason a send fails */ });
    }

    void messageId;   // captured for future provider-side status correlation
    return { dispatchLogId: logId };
  },
};

/** Called once at bootstrap. Until this runs, a 'live' event throws NOT_WIRED. */
export function registerNotificationDeliverer(): void {
  registerDeliverer(notificationDeliverer);
  console.log('[notification-deliverer] registered — live events can now send');
}
