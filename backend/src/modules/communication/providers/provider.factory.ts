import type { CommunicationProvider } from './provider.interface.js';
import type { Channel } from '../communication.types.js';
import { NodemailerProvider } from './email/nodemailer.provider.js';
import { LocalEmailProvider } from './email/local-email.provider.js';
import { SendGridProvider } from './email/sendgrid.provider.js';
import { MailgunProvider } from './email/mailgun.provider.js';
import { TwilioSMSProvider } from './sms/twilio-sms.provider.js';
import { LocalSMSProvider } from './sms/local-sms.provider.js';
import { MSG91Provider } from './sms/msg91.provider.js';
import { TwilioWhatsAppProvider } from './whatsapp/twilio-whatsapp.provider.js';
import { LocalWhatsAppProvider } from './whatsapp/local-whatsapp.provider.js';
import { MetaWhatsAppProvider } from './whatsapp/meta.provider.js';

type DbConfig = { provider_type: string; config: Record<string, unknown>; secrets: Record<string, string> };

class ProviderFactory {
  private cache = new Map<Channel, CommunicationProvider>();

  /**
   * DB-first provider resolution. Pass dbConfig from providerConfigService.loadActiveConfig().
   * Falls back to env vars if dbConfig is null/undefined.
   */
  async getProviderAsync(channel: Channel, dbConfig?: DbConfig | null): Promise<CommunicationProvider> {
    if (this.cache.has(channel)) return this.cache.get(channel)!;
    const provider = dbConfig ? this.buildFromDb(channel, dbConfig) : this.buildFromEnv(channel);
    this.cache.set(channel, provider);
    return provider;
  }

  /** Synchronous fallback — always uses env vars */
  getProvider(channel: Channel): CommunicationProvider {
    if (!this.cache.has(channel)) {
      this.cache.set(channel, this.buildFromEnv(channel));
    }
    return this.cache.get(channel)!;
  }

  private buildFromDb(channel: Channel, { provider_type, config, secrets }: DbConfig): CommunicationProvider {
    if (channel === 'email') {
      if (provider_type === 'sendgrid')
        return new SendGridProvider(
          secrets.sendgrid_api_key ?? '',
          (config.sendgrid_from as string) ?? '',
          (config.sendgrid_from_name as string) ?? 'MAS Callnet HRMS',
        );
      if (provider_type === 'mailgun')
        return new MailgunProvider(
          secrets.mailgun_api_key ?? '',
          (config.mailgun_domain as string) ?? '',
          (config.mailgun_from as string) ?? '',
          (config.mailgun_region as 'us' | 'eu') ?? 'us',
        );
      if (provider_type === 'local-email-tool') return new LocalEmailProvider();
      // default: nodemailer
      return new NodemailerProvider(
        config.smtp_host as string | undefined,
        config.smtp_port as number | undefined,
        config.smtp_secure as boolean | undefined,
        secrets.smtp_user,
        secrets.smtp_pass,
        config.smtp_from as string | undefined,
      );
    }

    if (channel === 'sms') {
      if (provider_type === 'msg91')
        return new MSG91Provider(
          secrets.msg91_auth_key ?? '',
          (config.msg91_sender_id as string) ?? '',
          (config.msg91_template_id as string) ?? '',
        );
      if (provider_type === 'local-sms-tool') return new LocalSMSProvider();
      // default: twilio
      return new TwilioSMSProvider(
        secrets.twilio_account_sid,
        secrets.twilio_auth_token,
        config.twilio_messaging_service_sid as string | undefined,
      );
    }

    if (channel === 'whatsapp') {
      if (provider_type === 'meta')
        return new MetaWhatsAppProvider(
          secrets.meta_access_token ?? '',
          (config.meta_phone_number_id as string) ?? '',
        );
      if (provider_type === 'local-whatsapp-tool') return new LocalWhatsAppProvider();
      // default: twilio
      return new TwilioWhatsAppProvider(
        secrets.twilio_account_sid,
        secrets.twilio_auth_token,
        config.twilio_whatsapp_number as string | undefined,
      );
    }

    throw new Error(`Unknown channel: ${channel}`);
  }

  private buildFromEnv(channel: Channel): CommunicationProvider {
    if (channel === 'email') {
      const type = process.env.EMAIL_PROVIDER ?? 'nodemailer';
      if (type === 'sendgrid')
        return new SendGridProvider(
          process.env.SENDGRID_API_KEY ?? '',
          process.env.SENDGRID_FROM ?? '',
          process.env.SENDGRID_FROM_NAME,
        );
      if (type === 'mailgun')
        return new MailgunProvider(
          process.env.MAILGUN_API_KEY ?? '',
          process.env.MAILGUN_DOMAIN ?? '',
          process.env.MAILGUN_FROM ?? '',
          (process.env.MAILGUN_REGION as 'us' | 'eu') ?? 'us',
        );
      if (type === 'local-email-tool') return new LocalEmailProvider();
      return new NodemailerProvider();
    }

    if (channel === 'sms') {
      const type = process.env.SMS_PROVIDER ?? 'twilio';
      if (type === 'msg91')
        return new MSG91Provider(
          process.env.MSG91_AUTH_KEY ?? '',
          process.env.MSG91_SENDER_ID ?? '',
          process.env.MSG91_TEMPLATE_ID ?? '',
        );
      if (type === 'local-sms-tool') return new LocalSMSProvider();
      return new TwilioSMSProvider();
    }

    if (channel === 'whatsapp') {
      const type = process.env.WHATSAPP_PROVIDER ?? 'twilio';
      if (type === 'meta')
        return new MetaWhatsAppProvider(
          process.env.META_WA_ACCESS_TOKEN ?? '',
          process.env.META_WA_PHONE_NUMBER_ID ?? '',
        );
      if (type === 'local-whatsapp-tool') return new LocalWhatsAppProvider();
      return new TwilioWhatsAppProvider();
    }

    throw new Error(`Unknown channel: ${channel}`);
  }

  clearCache(): void { this.cache.clear(); }
}

export const providerFactory = new ProviderFactory();
