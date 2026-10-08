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

  /**
   * Whether this provider actually holds the credentials it needs to send.
   *
   * Measured on production 2026-08-08, all time: email 907 sent / 4 failed, SMS
   * 0 sent / 901 failed, WhatsApp 0 sent / 903 failed. Neither SMS nor WhatsApp
   * has EVER delivered a message — the credentials were never supplied, so each
   * notification produced two guaranteed-failed rows. 1,804 of dispatch_log's
   * 2,740 rows, 66%, are that. Real failures are invisible inside it.
   *
   * OPTIONAL on purpose. A provider that does not implement it is treated as
   * configured, so this can only ever suppress a channel that opts in to being
   * checked. No email provider implements it, which makes it impossible for this
   * mechanism to interrupt the one channel that works.
   *
   * Note the provider is chosen by communication_provider_config.is_enabled,
   * which does NOT mean "channel is on": loadActiveConfig returns null when it is
   * 0, and the factory then builds from env. All three channels are is_enabled=0
   * today, and email works precisely because of that env fallback — so treating
   * that flag as an on/off switch would silence the working channel.
   */
  isConfigured?(): boolean;
}
