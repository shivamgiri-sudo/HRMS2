import twilio from 'twilio';
import type { CommunicationProvider, Attachment } from '../provider.interface.js';
import type { ProviderResponse, DeliveryStatus } from '../../communication.types.js';

export class TwilioWhatsAppProvider implements CommunicationProvider {
  private client: ReturnType<typeof twilio>;
  private from: string;

  constructor(accountSid?: string, authToken?: string, whatsappNumber?: string) {
    const sid  = accountSid     ?? process.env.TWILIO_ACCOUNT_SID    ?? '';
    const tok  = authToken      ?? process.env.TWILIO_AUTH_TOKEN     ?? '';
    const num  = whatsappNumber ?? process.env.TWILIO_WHATSAPP_NUMBER ?? '';
    this.from  = num.startsWith('whatsapp:') ? num : `whatsapp:${num}`;
    this.client = twilio(sid, tok);
  }

  async send(recipient: string, _subject: string, body: string): Promise<ProviderResponse> {
    try {
      const to = recipient.startsWith('whatsapp:') ? recipient : `whatsapp:${recipient}`;
      const msg = await this.client.messages.create({ from: this.from, to, body });
      return { success: true, message_id: msg.sid };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async getDeliveryStatus(messageId: string): Promise<DeliveryStatus> {
    try {
      const msg = await this.client.messages(messageId).fetch();
      const map: Record<string, any> = { queued:'queued', sent:'sent', delivered:'delivered', read:'opened', failed:'failed', undelivered:'failed' };
      return { status: map[msg.status] ?? 'failed', delivered_at: msg.dateUpdated?.toISOString(), error: msg.errorMessage ?? undefined };
    } catch (e) {
      return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
    }
  }

  validateRecipient(contact: string): boolean {
    return /^\+?[1-9]\d{1,14}$/.test(contact.replace('whatsapp:', ''));
  }

  getName(): string { return 'twilio-whatsapp'; }
}
