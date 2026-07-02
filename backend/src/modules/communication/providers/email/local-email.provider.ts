import axios from 'axios';
import type { CommunicationProvider, Attachment } from '../provider.interface.js';
import type { ProviderResponse, DeliveryStatus } from '../../communication.types.js';

export class LocalEmailProvider implements CommunicationProvider {
  private endpoint = process.env.LOCAL_EMAIL_API_URL!;
  private key = process.env.LOCAL_EMAIL_API_KEY!;

  async send(recipient: string, subject: string, body: string, attachments?: Attachment[]): Promise<ProviderResponse> {
    try {
      const res = await axios.post(`${this.endpoint}/send`,
        { to: recipient, subject, html: body,
          attachments: attachments?.map(a => ({ filename: a.filename, content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : a.content, contentType: a.contentType })) },
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
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
  }

  getName(): string { return 'local-email-tool'; }
}
