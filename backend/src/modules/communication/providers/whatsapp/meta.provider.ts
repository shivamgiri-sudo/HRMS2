import axios from 'axios';
import type { CommunicationProvider } from '../provider.interface.js';
import type { ProviderResponse, DeliveryStatus } from '../../communication.types.js';

const META_API_VERSION = 'v19.0';

interface MetaSendResponse {
  error?: { message?: string };
  messages?: Array<{ id?: string }>;
}

export class MetaWhatsAppProvider implements CommunicationProvider {
  constructor(
    private readonly accessToken: string,
    private readonly phoneNumberId: string,
  ) {}

  async send(recipient: string, _subject: string, body: string): Promise<ProviderResponse> {
    try {
      const to = recipient.replace(/^\+/, '').replace(/\D/g, '');
      const url = `https://graph.facebook.com/${META_API_VERSION}/${this.phoneNumberId}/messages`;
      const res = await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { preview_url: false, body },
        },
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          validateStatus: s => s < 500,
        },
      );
      if (res.status >= 400) {
        const payload = res.data as MetaSendResponse;
        const err = payload.error?.message ?? `HTTP ${res.status}`;
        return { success: false, error: err };
      }
      const payload = res.data as MetaSendResponse;
      const msgId = payload.messages?.[0]?.id;
      return { success: true, message_id: msgId };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async getDeliveryStatus(_messageId: string): Promise<DeliveryStatus> {
    // Meta delivery status is webhook-push only
    return { status: 'sent' };
  }

  validateRecipient(contact: string): boolean {
    return /^\+?[1-9]\d{6,14}$/.test(contact.replace(/\s/g, ''));
  }

  getName(): string { return 'meta'; }
}
