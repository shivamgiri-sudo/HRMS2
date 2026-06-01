import type { CommunicationProvider } from './provider.interface.js';
import type { Channel } from '../communication.types.js';

class ProviderFactory {
  private cache = new Map<string, CommunicationProvider>();

  getProvider(channel: Channel): CommunicationProvider {
    const type = this.resolveType(channel);
    const key = `${channel}-${type}`;
    if (!this.cache.has(key)) {
      this.cache.set(key, this.build(channel, type));
    }
    return this.cache.get(key)!;
  }

  private resolveType(channel: Channel): string {
    const map: Record<Channel, string> = {
      email:    process.env.EMAIL_PROVIDER    ?? 'nodemailer',
      sms:      process.env.SMS_PROVIDER      ?? 'twilio',
      whatsapp: process.env.WHATSAPP_PROVIDER ?? 'twilio',
    };
    return map[channel];
  }

  private build(channel: Channel, type: string): CommunicationProvider {
    if (channel === 'email') {
      if (type === 'nodemailer')      return new (require('./email/nodemailer.provider.js').NodemailerProvider)();
      if (type === 'local-email-tool') return new (require('./email/local-email.provider.js').LocalEmailProvider)();
    }
    if (channel === 'sms') {
      if (type === 'twilio')          return new (require('./sms/twilio-sms.provider.js').TwilioSMSProvider)();
      if (type === 'local-sms-tool')  return new (require('./sms/local-sms.provider.js').LocalSMSProvider)();
    }
    if (channel === 'whatsapp') {
      if (type === 'twilio')               return new (require('./whatsapp/twilio-whatsapp.provider.js').TwilioWhatsAppProvider)();
      if (type === 'local-whatsapp-tool')  return new (require('./whatsapp/local-whatsapp.provider.js').LocalWhatsAppProvider)();
    }
    throw new Error(`Unknown provider: channel=${channel} type=${type}`);
  }

  clearCache(): void { this.cache.clear(); }
}

export const providerFactory = new ProviderFactory();
