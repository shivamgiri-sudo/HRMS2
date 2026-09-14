import axios from 'axios';
import type { CommunicationProvider, Attachment } from '../provider.interface.js';
import type { ProviderResponse, DeliveryStatus } from '../../communication.types.js';

interface MailgunErrorResponse {
  message?: string;
  id?: string;
}

interface MailgunEvent {
  event: string;
  timestamp?: number;
}

interface MailgunEventsResponse {
  items?: MailgunEvent[];
}

export class MailgunProvider implements CommunicationProvider {
  private readonly baseUrl: string;

  constructor(
    private readonly apiKey: string,
    private readonly domain: string,
    private readonly from: string,
    region: 'us' | 'eu' = 'us',
  ) {
    this.baseUrl = region === 'eu'
      ? `https://api.eu.mailgun.net/v3/${domain}`
      : `https://api.mailgun.net/v3/${domain}`;
  }

  async send(recipient: string, subject: string, body: string, attachments?: Attachment[]): Promise<ProviderResponse> {
    try {
      const params = new URLSearchParams();
      params.append('from', this.from);
      params.append('to', recipient);
      params.append('subject', subject);
      params.append('html', body);
      // Note: URLSearchParams cannot handle binary file attachments.
      // For attachments, Mailgun requires multipart/form-data.
      // If attachments are provided, log a warning and send without them.
      if (attachments?.length) {
        console.warn(`[MailgunProvider] ${attachments.length} attachment(s) provided but Mailgun provider does not support attachments via URL-encoded form. Use SendGrid for attachment support.`);
      }

      const res = await axios.post(`${this.baseUrl}/messages`, params, {
        auth: { username: 'api', password: this.apiKey },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus: s => s < 500,
      });
      if (res.status >= 400) {
        const payload = res.data as MailgunErrorResponse;
        return { success: false, error: payload.message ?? `HTTP ${res.status}` };
      }
      const payload = res.data as MailgunErrorResponse;
      return { success: true, message_id: payload.id };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async getDeliveryStatus(messageId: string): Promise<DeliveryStatus> {
    try {
      const res = await axios.get(`${this.baseUrl}/events?message-id=${encodeURIComponent(messageId)}`, {
        auth: { username: 'api', password: this.apiKey },
      });
      const payload = res.data as MailgunEventsResponse;
      const events = payload.items ?? [];
      const latest = events[0];
      if (!latest) return { status: 'sent' };
      const map: Record<string, DeliveryStatus['status']> = { delivered: 'delivered', failed: 'failed', bounced: 'bounced', opened: 'opened', clicked: 'clicked' };
      return {
        status: map[latest.event] ?? 'sent',
        delivered_at: latest.timestamp ? new Date(latest.timestamp * 1000).toISOString() : undefined,
      };
    } catch (e) {
      return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
    }
  }

  validateRecipient(contact: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
  }

  getName(): string { return 'mailgun'; }
}
