import { randomUUID } from 'crypto';
import { db } from '../../db/mysql.js';
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
  phone: string | null;
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

class DispatchService {
  private humanizeTemplateName(name: string): string {
    return name
      .split('/').pop()!
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, char => char.toUpperCase());
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
      `SELECT id, user_id, full_name, email, mobile AS phone FROM employees WHERE id IN (${placeholders})`,
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
        const channels = !preference.enabled && !dto.is_critical
          ? []
          : Array.from(new Set(dto.channels?.length ? dto.channels : [preferredChannel]));

        for (const channel of channels) {
          const contact: string | null = channel === 'email' ? emp.email : emp.phone;
          if (!contact) { failed.push(`${emp.id}:${channel}`); continue; }

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
              (channel === 'email' ? rendered.html : rendered.text ?? rendered.html).slice(0, 500),
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
    if (!rows[0]) throw new Error('Dispatch not found');
    const log = rows[0];
    await db.execute(
      "UPDATE dispatch_log SET status = 'queued', retry_count = retry_count + 1 WHERE id = ?",
      [dispatchId]
    );
    this._deliver(dispatchId, log.channel, log.recipient_contact, { html: log.body_preview ?? "" }).catch(err =>
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
    const [openedRows] = await db.execute<DeliveryWindowRow[]>("SELECT COUNT(*) t, SUM(status = 'opened') o FROM dispatch_log WHERE channel = 'email' AND sent_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)");
    const [failedRows] = await db.execute<DispatchCountRow[]>("SELECT COUNT(*) c FROM dispatch_log WHERE status = 'failed' AND retry_count < 3");
    const [chRows]     = await db.execute<ChannelCountRow[]>("SELECT channel, COUNT(*) c FROM dispatch_log WHERE DATE(sent_at) = CURDATE() GROUP BY channel");
    const by_channel = { email: 0, sms: 0, whatsapp: 0 };
    for (const r of chRows) {
      by_channel[r.channel as keyof typeof by_channel] = Number(r.c);
    }
    return {
      total_sent_today: Number(todayRows[0]?.c ?? 0),
      delivery_rate: Number(delivRows[0]?.t ?? 0) > 0 ? (Number(delivRows[0]?.d ?? 0) / Number(delivRows[0]?.t ?? 0)) * 100 : 0,
      open_rate: Number(openedRows[0]?.t ?? 0) > 0 ? (Number(openedRows[0]?.o ?? 0) / Number(openedRows[0]?.t ?? 0)) * 100 : 0,
      failed_count: Number(failedRows[0]?.c ?? 0),
      by_channel,
    };
  }
}

export const dispatchService = new DispatchService();
