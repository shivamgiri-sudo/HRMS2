import { randomUUID } from 'crypto';
import { db } from '../../db/mysql.js';
import { isOfficialDomain } from '../../shared/email-domains.js';
import { getDispatchBlock } from '../../shared/notification-dispatch-block.js';
import type { RowDataPacket } from 'mysql2';
import { providerFactory } from './providers/provider.factory.js';
import { providerConfigService } from './provider-config.service.js';
import { templateService } from './template.service.js';
import { notificationPreferencesService } from './notification-preferences.service.js';
import { inboxService } from '../inbox/inbox.service.js';
import type {
  SendMessageDTO,
  BulkSendDTO,
  DispatchResult,
  DispatchLog,
  DispatchLogFilters,
  PaginatedDispatchLogs,
  DispatchStats,
  Channel,
} from './communication.types.js';

interface EmployeeRecipientRow extends RowDataPacket {
  id: string;
  user_id: string | null;
  full_name: string;
  email: string | null;
  official_email: string | null;
  phone: string | null;
}

/**
 * Which address an email actually goes to.
 *
 * Default is unchanged: `employees.email`. But that column holds a personal
 * address for 354 of the 1,125 active employees, and some notifications are
 * ABOUT SOMEONE ELSE — an eSign escalation naming an employee and their code, an
 * engagement/attrition risk assessment, an internal job application. Those were
 * being delivered to Gmail. It surfaced on 2026-08-08: a preboarding candidate
 * received 29 HR escalations naming a different employee's unsigned declaration,
 * because the branch-HR lookup returned a colleague whose `email` is personal.
 *
 * When `prefer_official_email` is set, an official_email on a company domain wins.
 * Anything else falls back to the normal address, so this can only ever redirect
 * a message — never drop one. Measured against live data: 354 recipients move off
 * personal mail and **0** lose delivery.
 *
 * isOfficialDomain is the same allowlist the notification gateway and report
 * delivery enforce; a second copy of a security allowlist drifts.
 */
export function resolveEmailContact(
  emp: Pick<EmployeeRecipientRow, 'email' | 'official_email'>,
  preferOfficial?: boolean,
): string | null {
  if (preferOfficial) {
    const official = (emp.official_email ?? '').trim();
    if (official && isOfficialDomain(official)) return official;
  }
  return emp.email;
}

interface SubjectRow extends RowDataPacket {
  subject: string | null;
}

interface EmployeeIdRow extends RowDataPacket {
  id: string;
}

interface DispatchLogTotalRow extends RowDataPacket {
  total: number;
}

interface DispatchCountRow extends RowDataPacket {
  c: number;
}

interface DeliveryWindowRow extends RowDataPacket {
  t: number;
  d?: number | null;
  o?: number | null;
}

interface ChannelCountRow extends RowDataPacket {
  channel: Channel;
  c: number;
}

interface RetryLogRow extends RowDataPacket {
  channel: Channel;
  recipient_contact: string;
  body_preview: string | null;
}

/**
 * How much of a rendered message dispatch_log keeps. It is a preview for the admin history screen,
 * not the message — retry() checks against this same constant so the writer and the guard cannot
 * drift apart and quietly re-enable sending truncated messages.
 */
const BODY_PREVIEW_LIMIT = 500;

class DispatchService {
  private humanizeTemplateName(name: string): string {
    return name
      .split('/').pop()!
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, char => char.toUpperCase());
  }

  /** Channels already reported as unconfigured — one log line each, not one per message. */
  private readonly unconfiguredWarned = new Set<Channel>();

  /**
   * True when this channel's provider says it has no credentials.
   *
   * Fails to FALSE (i.e. attempt the send) on any error, and for any provider
   * that does not implement isConfigured. A misjudgement here must degrade to
   * today's behaviour — one failed row — never to silence.
   */
  private async channelUnconfigured(channel: Channel): Promise<boolean> {
    try {
      const dbConfig = await providerConfigService.loadActiveConfig(channel);
      const provider = await providerFactory.getProviderAsync(channel, dbConfig);
      if (typeof provider.isConfigured !== 'function') return false;
      if (provider.isConfigured()) return false;

      if (!this.unconfiguredWarned.has(channel)) {
        this.unconfiguredWarned.add(channel);
        console.warn(
          `[dispatch] ${channel} provider (${provider.getName()}) has no credentials — ` +
            `skipping this channel instead of logging a guaranteed failure per message. ` +
            `Configure it in communication_provider_config or the matching env vars.`,
        );
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Log an attempt that could not be made because the recipient has no address.
   *
   * Written as `failed` with an explicit reason so it lands in the same place
   * every other delivery outcome does — getDispatchStats already counts
   * status='failed', and the undeliverable-recipients report can now be answered
   * from the ledger rather than by re-deriving it from the employees table.
   *
   * recipient_contact is NOT NULL, so it carries a marker rather than a fake
   * address: an empty string would read as "we tried to send to nobody", and a
   * placeholder that looks like a contact could be retried. This value can never
   * be mistaken for a destination.
   *
   * Best-effort by design. This is the audit trail for a send that already
   * failed; if writing it also fails, that must not turn one unreachable
   * recipient into a thrown exception that abandons everybody after them in the
   * loop.
   */
  private async recordUndeliverable(
    dto: SendMessageDTO,
    emp: EmployeeRecipientRow,
    channel: Channel,
    templateName: string,
    subject: string | undefined,
  ): Promise<void> {
    const reason = channel === 'email'
      ? 'No deliverable email address on the employee record'
      : 'No mobile number on the employee record';
    try {
      await db.execute(
        `INSERT INTO dispatch_log
         (id, template_id, template_name, recipient_employee_id, recipient_contact,
          channel, status, subject, body_preview, error_message, is_critical, retention_category)
         VALUES (?, ?, ?, ?, '(no address)', ?, 'failed', ?, NULL, ?, ?, ?)`,
        [
          randomUUID(),
          dto.template_id ?? null,
          templateName,
          emp.id,
          channel,
          // subject is varchar(200) and STRICT_TRANS_TABLES is on, so an
          // over-long title would throw — on the path whose whole job is to make
          // a failure visible.
          (subject ?? this.humanizeTemplateName(templateName)).slice(0, 200),
          reason,
          dto.is_critical ? 1 : 0,
          dto.is_critical ? 'critical' : 'standard',
        ],
      );
    } catch (err) {
      console.error(`[dispatch] could not record undeliverable ${channel} for ${emp.id}:`, err);
    }
  }

  private plainText(value: string): string {
    return value
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async send(dto: SendMessageDTO): Promise<DispatchResult> {
    const placeholders = dto.recipient_employee_ids.map(() => '?').join(',');
    const [employees] = await db.execute<EmployeeRecipientRow[]>(
      `SELECT id, user_id, full_name, email, official_email, mobile AS phone FROM employees WHERE id IN (${placeholders})`,
      dto.recipient_employee_ids
    );

    const queued: string[] = [];
    const failed: string[] = [];
    let portalCreated = 0;

    for (const emp of employees) {
      try {
        // Get template category and name for preference routing
        let category = 'announcements';
        let resolvedTemplateName = dto.template_name ?? 'custom';
        if (dto.template_id) {
          const t = await templateService.getTemplateById(dto.template_id);
          if (t) { category = t.category; resolvedTemplateName = t.name; }
        }

        const context = {
          ...dto.data,
          employee: { ...(dto.data.employee ?? {}), name: emp.full_name, id: emp.id },
          company: { name: 'Mas Callnet India Pvt Ltd', ...(dto.data.company ?? {}) },
        };
        const portalRendered = await templateService.renderTemplate({
          template_id:   dto.template_id,
          template_name: dto.template_name,
          data: context,
        });

        if (dto.portal !== false && emp.user_id) {
          const portal = dto.portal ?? {};
          await inboxService.createItem({
            user_id: emp.user_id,
            type: portal.type ?? category,
            title: portal.title ?? portalRendered.subject ?? this.humanizeTemplateName(resolvedTemplateName),
            description: portal.message ?? this.plainText(portalRendered.text ?? portalRendered.html).slice(0, 1200),
            entity_type: portal.entity_type ?? category,
            entity_id: portal.entity_id,
            action_url: portal.action_url ?? '/notifications',
            priority: portal.priority ?? (dto.is_critical ? 'urgent' : 'normal'),
          });
          portalCreated += 1;
        }

        const preference = await notificationPreferencesService.getDeliveryPreference(emp.id, category);
        const preferredChannel = dto.channel ?? preference.channel;
        let channels = !preference.enabled && !dto.is_critical
          ? []
          : Array.from(new Set(dto.channels?.length ? dto.channels : [preferredChannel]));

        // Operator emergency stop. This path had no enable flag of any kind, so
        // the only way to halt a runaway event was `pm2 stop hrms2-workers` —
        // all 45 workers — which is what the 1,863-message eSign storm in
        // August 2026 actually required. `blocked = 1` in
        // notification_dispatch_block now stops it in under 60s, globally or for
        // one event, with no deploy.
        //
        // Outbound only: the portal item above is already written, so stopping
        // the mail does not also erase the record that the event happened. And
        // is_critical does NOT override this — critical is what bypasses the
        // recipient's own channel preference, which is precisely how one worker
        // put 214 SMS on a single number. An operator's explicit stop has to
        // outrank that.
        if (channels.length > 0) {
          const stop = await getDispatchBlock(dto.event_code);
          if (stop.blocked) {
            console.warn(
              `[dispatch] outbound suppressed for ${dto.event_code ?? resolvedTemplateName} ` +
                `— notification_dispatch_block scope='${stop.scope}'` +
                (stop.reason ? `: ${stop.reason}` : ""),
            );
            channels = [];
          }
        }

        for (const channel of channels) {
          // Do not attempt a channel whose provider holds no credentials.
          //
          // All time on production to 2026-08-08: email 907 sent / 4 failed, SMS
          // 0 sent / 901 failed, WhatsApp 0 sent / 903 failed. Neither SMS nor
          // WhatsApp has ever delivered a single message, yet every critical
          // event fanned out to all three, so each notification minted two rows
          // that could only fail. 1,804 of dispatch_log's 2,740 rows — 66% — are
          // that, and a genuine SMS failure would be invisible inside it.
          //
          // Provably lossless: a channel with zero successes in its entire
          // history loses nothing by not being attempted. isConfigured is
          // optional and no email provider implements it, so the channel that
          // actually works cannot be suppressed by this.
          if (await this.channelUnconfigured(channel)) {
            failed.push(`${emp.id}:${channel}`);
            continue;
          }

          const contact: string | null =
            channel === 'email' ? resolveEmailContact(emp, dto.prefer_official_email) : emp.phone;
          if (!contact) {
            failed.push(`${emp.id}:${channel}`);
            // Record the non-delivery instead of dropping it silently.
            //
            // This branch used to `continue` with no dispatch_log row and no log
            // line, so a notification to somebody with no address left NO trace
            // anywhere — "we sent it" and "we had nowhere to send it" were
            // indistinguishable after the fact. 173 of the 1,125 active employees
            // have no usable email (measured 2026-08-09), and the charter
            // requires every state-changing action to be auditable.
            //
            // Deliberately per-RECIPIENT, unlike the unconfigured-channel skip
            // above, which is logged once per process: "this person cannot be
            // reached" is a fact about a person and belongs in the ledger, while
            // "this channel has no credentials" is one fact about the system and
            // would be pure noise repeated per message.
            await this.recordUndeliverable(dto, emp, channel, resolvedTemplateName, portalRendered.subject);
            continue;
          }

          const rendered = await templateService.renderTemplate({
            template_id: dto.template_id,
            template_name: dto.template_name,
            data: context,
            channel,
          });
          const dispatchId = randomUUID();
          await db.execute(
            `INSERT INTO dispatch_log
             (id, template_id, template_name, recipient_employee_id, recipient_contact,
              channel, status, subject, body_preview, is_critical, retention_category)
             VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
            [
              dispatchId,
              dto.template_id ?? null,
              resolvedTemplateName,
              emp.id,
              contact,
              channel,
              rendered.subject ?? portalRendered.subject ?? this.humanizeTemplateName(resolvedTemplateName),
              (channel === 'email' ? rendered.html : rendered.text ?? rendered.html).slice(0, BODY_PREVIEW_LIMIT),
              dto.is_critical ? 1 : 0,
              dto.is_critical ? 'critical' : 'standard',
            ]
          );

          this._deliver(dispatchId, channel, contact, rendered).catch(err =>
            console.error(`[dispatch] delivery failed for ${dispatchId}:`, err)
          );
          queued.push(dispatchId);
        }
      } catch (err) {
        console.error(`[dispatch] queue failed for employee ${emp.id}:`, err);
        failed.push(emp.id);
      }
    }

    return { queued: queued.length, failed: failed.length, dispatch_ids: queued, portal_created: portalCreated };
  }

  private async _deliver(
    dispatchId: string,
    channel: Channel,
    contact: string,
    rendered: { html: string; text?: string; subject?: string }
  ): Promise<void> {
    // Load DB config so admin panel changes take effect immediately
    const dbConfig = await providerConfigService.loadActiveConfig(channel);
    const provider = await providerFactory.getProviderAsync(channel, dbConfig);

    if (!provider.validateRecipient(contact)) {
      await db.execute(
        "UPDATE dispatch_log SET status = 'failed', error_message = 'Invalid recipient format' WHERE id = ?",
        [dispatchId]
      );
      return;
    }

    const [logRows] = await db.execute<SubjectRow[]>(
      'SELECT subject FROM dispatch_log WHERE id = ?', [dispatchId]
    );
    const subject = logRows[0]?.subject ?? '';

    const body = channel === 'email' ? rendered.html : (rendered.text ?? rendered.html);
    const result = await provider.send(contact, subject, body);

    await db.execute(
      `UPDATE dispatch_log SET status = ?, error_message = ?, sent_at = IF(? = 'sent', NOW(), sent_at) WHERE id = ?`,
      [result.success ? 'sent' : 'failed', result.error ?? null, result.success ? 'sent' : '', dispatchId]
    );
  }

  async bulkSend(dto: BulkSendDTO): Promise<DispatchResult> {
    let q = 'SELECT id FROM employees WHERE 1=1';
    const p: unknown[] = [];
    if (dto.recipient_filter.department)  { q += ' AND department = ?';  p.push(dto.recipient_filter.department); }
    if (dto.recipient_filter.process_id)  { q += ' AND process_id = ?';  p.push(dto.recipient_filter.process_id); }
    if (dto.recipient_filter.designation) { q += ' AND designation = ?'; p.push(dto.recipient_filter.designation); }
    if (dto.recipient_filter.status)      { q += ' AND status = ?';      p.push(dto.recipient_filter.status); }
    const [rows] = await db.execute<EmployeeIdRow[]>(q, p);
    return this.send({
      template_id:            dto.template_id,
      template_name:          dto.template_name,
      recipient_employee_ids: rows.map(r => r.id),
      data:                   dto.data,
      channel:                dto.channel,
      channels:               dto.channels,
      portal:                 dto.portal,
    });
  }

  async retry(dispatchId: string): Promise<void> {
    const [rows] = await db.execute<RetryLogRow[]>(
      'SELECT channel, recipient_contact, body_preview FROM dispatch_log WHERE id = ?',
      [dispatchId]
    );
    if (!rows[0]) {
      throw Object.assign(new Error('Dispatch not found'), {
        statusCode: 404,
        code: 'DISPATCH_NOT_FOUND',
      });
    }
    const log = rows[0];

    // body_preview is a PREVIEW. It is written as .slice(0, BODY_PREVIEW_LIMIT), so replaying it
    // as the message body sends the first 500 characters and drops the rest.
    //
    // This is not a rare edge. Measured live 2026-08-16: all 947 email rows in dispatch_log are
    // at the limit — every one, because a rendered HTML mail always exceeds 500 characters. So on
    // the only channel that has ever delivered anything, this button always sent a truncated
    // message, reported success, and set status='sent'. Nothing downstream could tell that the
    // employee received half an email.
    //
    // A faithful re-render is not possible from the log: renderTemplate needs the original
    // dto.data context, and only template_id, template_name and the recipient are stored. So the
    // honest answer is to refuse rather than to send something mangled — the sender is told to
    // re-trigger the source event, which renders the message properly.
    //
    // SMS and WhatsApp bodies are all well under the limit (0 of 1,823 truncated), so retry stays
    // available there and this is not a blanket disablement.
    const body = log.body_preview ?? '';
    if (body.length >= BODY_PREVIEW_LIMIT) {
      throw Object.assign(
        new Error(
          'This message cannot be resent: only a 500-character preview of it was retained, so a ' +
          'retry would deliver a truncated message. Re-trigger the original event to send it in full.',
        ),
        { statusCode: 409, code: 'DISPATCH_BODY_NOT_RETAINED' },
      );
    }

    await db.execute(
      "UPDATE dispatch_log SET status = 'queued', retry_count = retry_count + 1 WHERE id = ?",
      [dispatchId]
    );
    // text as well as html: _deliver picks `text ?? html` for sms/whatsapp, and the stored preview
    // for those channels is already the text rendering, not markup.
    this._deliver(dispatchId, log.channel, log.recipient_contact, { html: body, text: body }).catch(err =>
      console.error(`[dispatch] retry delivery failed for ${dispatchId}:`, err)
    );
  }

  async getLogs(filters: DispatchLogFilters): Promise<PaginatedDispatchLogs> {
    const page  = filters.page  ?? 1;
    const limit = filters.limit ?? 50;
    const offset = (page - 1) * limit;
    let q = 'SELECT * FROM dispatch_log WHERE 1=1';
    const p: unknown[] = [];
    if (filters.employee_id) { q += ' AND recipient_employee_id = ?'; p.push(filters.employee_id); }
    if (filters.channel)     { q += ' AND channel = ?';               p.push(filters.channel); }
    if (filters.status)      { q += ' AND status = ?';                p.push(filters.status); }
    if (filters.date_from)   { q += ' AND sent_at >= ?';              p.push(filters.date_from); }
    if (filters.date_to)     { q += ' AND sent_at <= ?';              p.push(filters.date_to); }

    const countQ = q.replace('SELECT *', 'SELECT COUNT(*) AS total');
    const [countRows] = await db.execute<DispatchLogTotalRow[]>(countQ, p);

    q += ` ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
    const [rows] = await db.execute<RowDataPacket[]>(q, p);

    return {
      logs:  rows as DispatchLog[],
      total: countRows[0]?.total ?? 0,
      page,
      limit,
    };
  }

  async getStats(): Promise<DispatchStats> {
    const [todayRows]  = await db.execute<DispatchCountRow[]>("SELECT COUNT(*) c FROM dispatch_log WHERE DATE(sent_at) = CURDATE()");
    const [delivRows]  = await db.execute<DeliveryWindowRow[]>("SELECT COUNT(*) t, SUM(status = 'sent') d FROM dispatch_log WHERE sent_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)");
    // `AND retry_count < 3` removed 2026-08-17. It asserted a three-attempt cap that NOTHING
    // implements: retry() increments retry_count with no ceiling, no backoff and no cooldown, and
    // there is no drainer or worker on this table at all. retry_count is 0 on all 2,770 rows, so
    // the clause matched every failed row anyway — inert, and wrong about the system.
    //
    // It is removed rather than made real because the ceiling is an owner decision, not a
    // constant to guess. Left in place it is worse than useless: it is exactly the predicate
    // someone writing the first drainer would copy as "the existing rule", and doing so would
    // sweep up all 1,854 historic failures on the first tick — 919 SMS and 904 WhatsApp across
    // 7 contacts each. Any real cap belongs next to a cutover floor, not inferred from a stat.
    const [failedRows] = await db.execute<DispatchCountRow[]>("SELECT COUNT(*) c FROM dispatch_log WHERE status = 'failed'");
    const [retryRows]  = await db.execute<DispatchCountRow[]>("SELECT COUNT(*) c FROM dispatch_log WHERE retry_count > 0 AND sent_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)");
    const [bounceRows] = await db.execute<DispatchCountRow[]>("SELECT COUNT(*) c FROM dispatch_log WHERE status = 'bounced' AND sent_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)");
    const [chRows]     = await db.execute<ChannelCountRow[]>("SELECT channel, COUNT(*) c FROM dispatch_log WHERE DATE(sent_at) = CURDATE() GROUP BY channel");
    const by_channel = { email: 0, sms: 0, whatsapp: 0 };
    for (const r of chRows) {
      by_channel[r.channel as keyof typeof by_channel] = Number(r.c);
    }
    return {
      total_sent_today: Number(todayRows[0]?.c ?? 0),
      delivery_rate: Number(delivRows[0]?.t ?? 0) > 0 ? (Number(delivRows[0]?.d ?? 0) / Number(delivRows[0]?.t ?? 0)) * 100 : 0,
      failed_count: Number(failedRows[0]?.c ?? 0),
      retried_count: Number(retryRows[0]?.c ?? 0),
      bounced_count: Number(bounceRows[0]?.c ?? 0),
      by_channel,
    };
  }
}

export const dispatchService = new DispatchService();
