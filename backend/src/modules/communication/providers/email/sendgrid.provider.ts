import axios from 'axios';
import type { CommunicationProvider, Attachment } from '../provider.interface.js';
import type { ProviderResponse, DeliveryStatus } from '../../communication.types.js';

interface SendGridErrorResponse {
  errors?: Array<{ message?: string }>;
}

export class SendGridProvider implements CommunicationProvider {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fromName: string = 'MAS Callnet HRMS',
  ) {}

  async send(recipient: string, subject: string, body: string, attachments?: Attachment[]): Promise<ProviderResponse> {
    try {
      const payload: Record<string, unknown> = {
        personalizations: [{ to: [{ email: recipient }] }],
        from: { email: this.from, name: this.fromName },
        subject,
        content: [{ type: 'text/html', value: body }],
      };
      if (attachments?.length) {
        payload.attachments = attachments.map(a => ({
          content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : Buffer.from(a.content).toString('base64'),
          type: a.contentType,
          filename: a.filename,
        }));
      }
      const res = await axios.post('https://api.sendgrid.com/v3/mail/send', payload, {
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        validateStatus: s => s < 500,
      });
      if (res.status >= 400) {
        const payload = res.data as SendGridErrorResponse;
        const msg = payload.errors?.[0]?.message ?? `HTTP ${res.status}`;
        return { success: false, error: msg };
      }
      const msgId = res.headers['x-message-id'] as string | undefined;
      return { success: true, message_id: msgId };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async getDeliveryStatus(_messageId: string): Promise<DeliveryStatus> {
    return { status: 'sent' };
  }

  validateRecipient(contact: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
  }

  getName(): string { return 'sendgrid'; }
}
