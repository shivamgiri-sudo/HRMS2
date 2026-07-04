import twilio from 'twilio';
import type { CommunicationProvider, Attachment } from '../provider.interface.js';
import type { ProviderResponse, DeliveryStatus } from '../../communication.types.js';

export class TwilioSMSProvider implements CommunicationProvider {
  private client: ReturnType<typeof twilio>;
  private sid: string;

  constructor(accountSid?: string, authToken?: string, messagingServiceSid?: string) {
    const sid = accountSid ?? process.env.TWILIO_ACCOUNT_SID ?? '';
    const tok = authToken  ?? process.env.TWILIO_AUTH_TOKEN  ?? '';
    this.sid = messagingServiceSid ?? process.env.TWILIO_MESSAGING_SERVICE_SID ?? '';
    this.client = twilio(sid, tok);
  }

  async send(recipient: string, _subject: string, body: string): Promise<ProviderResponse> {
    try {
      const truncated = body.length > 160 ? body.slice(0, 157) + '...' : body;
      const msg = await this.client.messages.create({ messagingServiceSid: this.sid, to: recipient, body: truncated });
      return { success: true, message_id: msg.sid };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async getDeliveryStatus(messageId: string): Promise<DeliveryStatus> {
      try {
      const msg = await this.client.messages(messageId).fetch();
      const map: Record<string, DeliveryStatus['status']> = { queued:'queued', sent:'sent', delivered:'delivered', failed:'failed', undelivered:'failed' };
      return { status: map[msg.status] ?? 'failed', delivered_at: msg.dateUpdated?.toISOString(), error: msg.errorMessage ?? undefined };
    } catch (e) {
      return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
    }
  }

  validateRecipient(contact: string): boolean {
    return /^\+?[1-9]\d{1,14}$/.test(contact);
  }

  getName(): string { return 'twilio-sms'; }
}
