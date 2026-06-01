import type { ProviderResponse, DeliveryStatus } from '../communication.types.js';

export interface Attachment {
  filename: string;
  content: Buffer | string;
  contentType: string;
}

export interface CommunicationProvider {
  send(recipient: string, subject: string, body: string, attachments?: Attachment[]): Promise<ProviderResponse>;
  getDeliveryStatus(messageId: string): Promise<DeliveryStatus>;
  validateRecipient(contact: string): boolean;
  getName(): string;
}
