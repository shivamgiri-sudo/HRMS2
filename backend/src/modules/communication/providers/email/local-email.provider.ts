// backend/src/modules/communication/providers/email/local-email.provider.ts
import axios from 'axios';
import { CommunicationProvider, Attachment } from '../provider.interface';
import { ProviderResponse, DeliveryStatus } from '../../communication.types';

export class LocalEmailProvider implements CommunicationProvider {
  private apiEndpoint: string;
  private apiKey: string;

  constructor() {
    this.apiEndpoint = process.env.LOCAL_EMAIL_API_URL || '';
    this.apiKey = process.env.LOCAL_EMAIL_API_KEY || '';

    if (!this.apiEndpoint || !this.apiKey) {
      throw new Error('LOCAL_EMAIL_API_URL and LOCAL_EMAIL_API_KEY required');
    }
  }

  async send(
    recipient: string,
    subject: string,
    body: string,
    attachments?: Attachment[]
  ): Promise<ProviderResponse> {
    try {
      const response = await axios.post(
        `${this.apiEndpoint}/send`,
        {
          to: recipient,
          subject,
          html: body,
          attachments: attachments?.map(att => ({
            filename: att.filename,
            content: att.content.toString('base64'),
            contentType: att.contentType
          }))
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        success: true,
        message_id: response.data.message_id
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
      const response = await axios.get(
        `${this.apiEndpoint}/status/${messageId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`
          }
        }
      );

      return {
        status: response.data.status,
        delivered_at: response.data.delivered_at,
        error: response.data.error
      };
    } catch (error) {
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  validateRecipient(contact: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(contact);
  }

  getName(): string {
    return 'local-email-tool';
  }
}
