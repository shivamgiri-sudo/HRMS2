import { randomUUID } from 'crypto';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { providerFactory } from './providers/provider.factory.js';
import { templateService } from './template.service.js';
import { notificationPreferencesService } from './notification-preferences.service.js';
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

class DispatchService {
  async send(dto: SendMessageDTO): Promise<DispatchResult> {
    const placeholders = dto.recipient_employee_ids.map(() => '?').join(',');
    const [employees] = await db.execute<RowDataPacket[]>(
      `SELECT id, full_name, email, phone FROM employees WHERE id IN (${placeholders})`,
      dto.recipient_employee_ids
    );

    const queued: string[] = [];
    const failed: string[] = [];

    for (const emp of employees as any[]) {
      try {
        // Get template category for preference routing
        let category = 'announcements';
        if (dto.template_id) {
          const t = await templateService.getTemplateById(dto.template_id);
          if (t) category = t.category;
        }

        const channel: Channel = dto.channel
          ?? await notificationPreferencesService.getPreferredChannel(emp.id, category);

        const contact: string | null = channel === 'email' ? emp.email : emp.phone;
        if (!contact) { failed.push(emp.id); continue; }

        const rendered = await templateService.renderTemplate({
          template_id:   dto.template_id,
          template_name: dto.template_name,
          data: { ...dto.data, employee: { name: emp.full_name, id: emp.id } },
        });

        const dispatchId = randomUUID();
        await db.execute(
          `INSERT INTO dispatch_log
           (id, template_id, template_name, recipient_employee_id, recipient_contact,
            channel, status, body_preview, is_critical, retention_category, sent_at)
           VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, NOW())`,
          [
            dispatchId,
            dto.template_id ?? null,
            dto.template_name ?? 'custom',
            emp.id,
            contact,
            channel,
            rendered.html.slice(0, 500),
            dto.is_critical ? 1 : 0,
            dto.is_critical ? 'critical' : 'standard',
          ]
        );

        // Fire and forget — don't block the response
        this._deliver(dispatchId, channel, contact, rendered).catch(err =>
          console.error(`[dispatch] delivery failed for ${dispatchId}:`, err)
        );

        queued.push(dispatchId);
      } catch (err) {
        console.error(`[dispatch] queue failed for employee ${emp.id}:`, err);
        failed.push(emp.id);
      }
    }

    return { queued: queued.length, failed: failed.length, dispatch_ids: queued };
  }

  private async _deliver(
    dispatchId: string,
    channel: Channel,
    contact: string,
    rendered: { html: string; text?: string }
  ): Promise<void> {
    const provider = providerFactory.getProvider(channel);

    if (!provider.validateRecipient(contact)) {
      await db.execute(
        "UPDATE dispatch_log SET status = 'failed', error_message = 'Invalid recipient format' WHERE id = ?",
        [dispatchId]
      );
      return;
    }

    const [logRows] = await db.execute<RowDataPacket[]>(
      'SELECT subject FROM dispatch_log WHERE id = ?', [dispatchId]
    );
    const subject = (logRows[0] as any)?.subject ?? '';

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
    const [rows] = await db.execute<RowDataPacket[]>(q, p);
    return this.send({
      template_id:            dto.template_id,
      template_name:          dto.template_name,
      recipient_employee_ids: (rows as any[]).map(r => r.id),
      data:                   dto.data,
      channel:                dto.channel,
    });
  }

  async retry(dispatchId: string): Promise<void> {
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT channel, recipient_contact, body_preview FROM dispatch_log WHERE id = ?',
      [dispatchId]
    );
    if (!rows[0]) throw new Error('Dispatch not found');
    const log = rows[0] as any;
    await db.execute(
      "UPDATE dispatch_log SET status = 'queued', retry_count = retry_count + 1 WHERE id = ?",
      [dispatchId]
    );
    this._deliver(dispatchId, log.channel, log.recipient_contact, { html: log.body_preview }).catch(err =>
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
    const [countRows] = await db.execute<RowDataPacket[]>(countQ, p);

    q += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    const [rows] = await db.execute<RowDataPacket[]>(q, [...p, limit, offset]);

    return {
      logs:  rows as DispatchLog[],
      total: (countRows[0] as any).total,
      page,
      limit,
    };
  }

  async getStats(): Promise<DispatchStats> {
    const [[today]]   = await db.execute<RowDataPacket[]>("SELECT COUNT(*) c FROM dispatch_log WHERE DATE(sent_at) = CURDATE()");
    const [[deliv]]   = await db.execute<RowDataPacket[]>("SELECT COUNT(*) t, SUM(status = 'sent') d FROM dispatch_log WHERE sent_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)");
    const [[opened]]  = await db.execute<RowDataPacket[]>("SELECT COUNT(*) t, SUM(status = 'opened') o FROM dispatch_log WHERE channel = 'email' AND sent_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)");
    const [[failed]]  = await db.execute<RowDataPacket[]>("SELECT COUNT(*) c FROM dispatch_log WHERE status = 'failed' AND retry_count < 3");
    const [chRows]    = await db.execute<RowDataPacket[]>("SELECT channel, COUNT(*) c FROM dispatch_log WHERE DATE(sent_at) = CURDATE() GROUP BY channel");
    const by_channel = { email: 0, sms: 0, whatsapp: 0 };
    for (const r of chRows as any[]) {
      by_channel[r.channel as keyof typeof by_channel] = Number(r.c);
    }
    const t = today as any;
    const d = deliv as any;
    const op = opened as any;
    const f = failed as any;
    return {
      total_sent_today: Number(t.c),
      delivery_rate: d.t > 0 ? (Number(d.d) / Number(d.t)) * 100 : 0,
      open_rate:     op.t > 0 ? (Number(op.o) / Number(op.t)) * 100 : 0,
      failed_count:  Number(f.c),
      by_channel,
    };
  }
}

export const dispatchService = new DispatchService();
