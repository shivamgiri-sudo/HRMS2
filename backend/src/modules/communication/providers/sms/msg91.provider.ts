import axios from 'axios';
import type { CommunicationProvider } from '../provider.interface.js';
import type { ProviderResponse, DeliveryStatus } from '../../communication.types.js';

export class MSG91Provider implements CommunicationProvider {
  constructor(
    private readonly authKey: string,
    private readonly senderId: string,
    private readonly templateId: string = '',
  ) {}

  async send(recipient: string, _subject: string, body: string): Promise<ProviderResponse> {
    try {
      const mobile = recipient.replace(/^\+?91/, '').replace(/\D/g, '');
      if (mobile.length !== 10) {
        return { success: false, error: `Invalid Indian mobile number: ${recipient}` };
      }
      const truncated = body.length > 160 ? body.slice(0, 157) + '...' : body;
      const res = await axios.post(
        'https://api.msg91.com/api/v5/flow/',
        {
          template_id: this.templateId,
          short_url: '0',
          realTimeResponse: '1',
          sender: this.senderId,
          mobiles: `91${mobile}`,
          VAR1: truncated,
        },
        {
          headers: { authkey: this.authKey, 'Content-Type': 'application/json' },
          validateStatus: s => s < 500,
        },
      );
      if ((res.data as any)?.type === 'error') {
        return { success: false, error: (res.data as any).message ?? 'MSG91 error' };
      }
      return { success: true, message_id: (res.data as any)?.request_id };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async getDeliveryStatus(messageId: string): Promise<DeliveryStatus> {
    try {
      const res = await axios.get(`https://api.msg91.com/api/v5/report/?request_id=${messageId}`, {
        headers: { authkey: this.authKey },
      });
      const status: string = (res.data as any)?.data?.[0]?.status ?? 'sent';
      return { status: status === 'Delivered' ? 'delivered' : status === 'Failed' ? 'failed' : 'sent' };
    } catch (e) {
      return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
    }
  }

  validateRecipient(contact: string): boolean {
    const mobile = contact.replace(/^\+?91/, '').replace(/\D/g, '');
    return mobile.length === 10;
  }

  getName(): string { return 'msg91'; }
}
