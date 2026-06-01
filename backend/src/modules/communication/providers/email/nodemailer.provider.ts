// backend/src/modules/communication/providers/email/nodemailer.provider.ts
import nodemailer, { Transporter } from 'nodemailer';
import { CommunicationProvider, Attachment } from '../provider.interface';
import { ProviderResponse, DeliveryStatus } from '../../communication.types';

export class NodemailerProvider implements CommunicationProvider {
  private transporter: Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }

  async send(
    recipient: string,
    subject: string,
    body: string,
    attachments?: Attachment[]
  ): Promise<ProviderResponse> {
    try {
      const result = await this.transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: recipient,
        subject,
        html: body,
        attachments: attachments?.map(att => ({
          filename: att.filename,
          content: att.content,
          contentType: att.contentType
        }))
      });

      return {
        success: true,
        message_id: result.messageId
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async getDeliveryStatus(messageId: string): Promise<DeliveryStatus> {
    // Nodemailer doesn't provide delivery tracking out of box
    // Would need to implement via SMTP provider webhooks
    return {
      status: 'sent'
    };
  }

  validateRecipient(contact: string): boolean {
    // Basic email regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(contact);
  }

  getName(): string {
    return 'nodemailer';
  }
}
