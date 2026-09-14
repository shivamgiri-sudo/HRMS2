import axios from 'axios';
import type { CommunicationProvider, Attachment } from '../provider.interface.js';
import type { ProviderResponse, DeliveryStatus } from '../../communication.types.js';

export class LocalSMSProvider implements CommunicationProvider {
  private endpoint = process.env.LOCAL_SMS_API_URL!;
  private key = process.env.LOCAL_SMS_API_KEY!;
  private senderId = process.env.LOCAL_SMS_SENDER_ID!;

  async send(recipient: string, _subject: string, body: string): Promise<ProviderResponse> {
    try {
      const truncated = body.length > 160 ? body.slice(0, 157) + '...' : body;
      const res = await axios.post(`${this.endpoint}/send`,
        { to: recipient, message: truncated, sender_id: this.senderId },
        { headers: { Authorization: `Bearer ${this.key}` } });
      return { success: true, message_id: res.data.message_id };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async getDeliveryStatus(messageId: string): Promise<DeliveryStatus> {
    try {
      const res = await axios.get(`${this.endpoint}/status/${messageId}`, { headers: { Authorization: `Bearer ${this.key}` } });
      return { status: res.data.status, delivered_at: res.data.delivered_at };
    } catch (e) {
      return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
    }
  }

  validateRecipient(contact: string): boolean {
    return /^\+?[1-9]\d{1,14}$/.test(contact);
  }

  getName(): string { return 'local-sms-tool'; }
}
