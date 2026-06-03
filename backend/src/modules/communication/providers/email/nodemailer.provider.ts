import nodemailer from 'nodemailer';
import type { CommunicationProvider, Attachment } from '../provider.interface.js';
import type { ProviderResponse, DeliveryStatus } from '../../communication.types.js';

export class NodemailerProvider implements CommunicationProvider {
  private transporter: nodemailer.Transporter;
  private _from: string | undefined;

  constructor(host?: string, port?: number, secure?: boolean, user?: string, pass?: string, from?: string) {
    this.transporter = nodemailer.createTransport({
      host:   host   ?? process.env.SMTP_HOST,
      port:   port   ?? parseInt(process.env.SMTP_PORT ?? '587'),
      secure: secure ?? process.env.SMTP_SECURE === 'true',
      auth: {
        user: user ?? process.env.SMTP_USER,
        pass: pass ?? process.env.SMTP_PASS,
      },
    });
    this._from = from ?? process.env.SMTP_FROM ?? process.env.SMTP_USER;
  }

  async send(recipient: string, subject: string, body: string, attachments?: Attachment[]): Promise<ProviderResponse> {
    try {
      const result = await this.transporter.sendMail({
        from: this._from,
        to: recipient, subject, html: body,
        attachments: attachments?.map(a => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
      });
      return { success: true, message_id: result.messageId };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async getDeliveryStatus(_messageId: string): Promise<DeliveryStatus> {
    // Nodemailer has no delivery tracking API; status is assumed sent
    return { status: 'sent' };
  }

  validateRecipient(contact: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
  }

  getName(): string { return 'nodemailer'; }
}
