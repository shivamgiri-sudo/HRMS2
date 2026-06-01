// backend/src/modules/communication/providers/whatsapp/twilio-whatsapp.provider.ts
import twilio from 'twilio';
import { CommunicationProvider, Attachment } from '../provider.interface';
import { ProviderResponse, DeliveryStatus } from '../../communication.types';

export class TwilioWhatsAppProvider implements CommunicationProvider {
  private client: twilio.Twilio;
  private whatsappNumber: string;

  constructor() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    this.whatsappNumber = process.env.TWILIO_WHATSAPP_NUMBER || '';

    if (!accountSid || !authToken || !this.whatsappNumber) {
      throw new Error('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER required');
    }

    this.client = twilio(accountSid, authToken);
  }

  async send(
    recipient: string,
    subject: string,
    body: string,
    attachments?: Attachment[]
  ): Promise<ProviderResponse> {
    try {
      // WhatsApp via Twilio requires whatsapp: prefix
      const whatsappRecipient = recipient.startsWith('whatsapp:') ? recipient : `whatsapp:${recipient}`;

      const message = await this.client.messages.create({
        from: this.whatsappNumber,
        to: whatsappRecipient,
        body
      });

      return {
        success: true,
        message_id: message.sid
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async getDeliveryStatus(messageId: string): Promise<DeliveryStatus> {
    try {
      const message = await this.client.messages(messageId).fetch();

      const statusMap: Record<string, any> = {
        'queued': 'queued',
        'sent': 'sent',
        'delivered': 'delivered',
        'read': 'opened',
        'failed': 'failed',
        'undelivered': 'failed'
      };

      return {
        status: statusMap[message.status] || 'failed',
        delivered_at: message.dateUpdated?.toISOString(),
        error: message.errorMessage || undefined
      };
    } catch (error) {
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  validateRecipient(contact: string): boolean {
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    return phoneRegex.test(contact.replace('whatsapp:', ''));
  }

  getName(): string {
    return 'twilio-whatsapp';
  }
}
