import axios from 'axios';
import type { CommunicationProvider, Attachment } from '../provider.interface.js';
import type { ProviderResponse, DeliveryStatus } from '../../communication.types.js';

/**
 * Self-hosted WhatsApp bridge (the MAS `/wa` server), used until META WA Business API approval.
 *
 * Credentials are read lazily, not captured at construction. The three fields previously used
 * `process.env.X!`, which is a lie the type system cannot catch: on an environment where the vars
 * are unset — which is every environment today, they are commented out in .env.example — `endpoint`
 * became the string "undefined" and every send POSTed to `undefined/send` and failed.
 *
 * That is the exact failure mode `__tests__/unconfigured-channel-skip.contract.test.ts` exists to
 * prevent: per provider.interface.ts, WhatsApp has 0 successful sends and ~903 failures on
 * production, all of them uncredentialed attempts that still minted dispatch_log rows. This
 * provider is now credential-gated like its Twilio and Meta siblings.
 */
export class LocalWhatsAppProvider implements CommunicationProvider {
  private get endpoint(): string {
    return (process.env.LOCAL_WHATSAPP_API_URL ?? '').replace(/\/+$/, '');
  }

  private get key(): string {
    return process.env.LOCAL_WHATSAPP_API_KEY ?? '';
  }

  private get from(): string {
    return process.env.LOCAL_WHATSAPP_BUSINESS_NUMBER ?? '';
  }

  /**
   * An API key is NOT required — a self-hosted bridge on a private network legitimately runs
   * without one — but a base URL is, since without it there is nowhere to send.
   */
  isConfigured(): boolean {
    return Boolean(this.endpoint);
  }

  async send(recipient: string, _subject: string, body: string, attachments?: Attachment[]): Promise<ProviderResponse> {
    if (!this.isConfigured()) {
      return { success: false, error: 'LOCAL_WHATSAPP_API_URL is not configured; WhatsApp send skipped' };
    }
    try {
      const res = await axios.post(
        `${this.endpoint}/send`,
        {
          to: recipient.replace('whatsapp:', ''),
          from: this.from,
          message: body,
          attachments: attachments?.map((a) => ({
            filename: a.filename,
            content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : a.content,
            contentType: a.contentType,
          })),
        },
        {
          headers: this.key ? { Authorization: `Bearer ${this.key}` } : {},
          timeout: 15000,
        },
      );
      return { success: true, message_id: res.data?.message_id ?? res.data?.id };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async getDeliveryStatus(messageId: string): Promise<DeliveryStatus> {
    if (!this.isConfigured()) {
      return { status: 'failed', error: 'LOCAL_WHATSAPP_API_URL is not configured' };
    }
    try {
      const res = await axios.get(`${this.endpoint}/status/${encodeURIComponent(messageId)}`, {
        headers: this.key ? { Authorization: `Bearer ${this.key}` } : {},
        timeout: 10000,
      });
      return { status: res.data.status, delivered_at: res.data.delivered_at };
    } catch (e) {
      return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
    }
  }

  validateRecipient(contact: string): boolean {
    return /^\+?[1-9]\d{1,14}$/.test(contact.replace('whatsapp:', ''));
  }

  getName(): string { return 'local-whatsapp-tool'; }
}
