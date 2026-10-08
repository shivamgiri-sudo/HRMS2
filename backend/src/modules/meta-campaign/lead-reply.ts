/**
 * Free-text WhatsApp reply from the HR inbox to a Meta lead, through Pinbot (WhatsApp Business API), the only WhatsApp provider (owner
 * decision O7). A Pinbot free-text message only delivers inside the 24-hour window after the candidate last wrote to us; outside it
 * WhatsApp accepts approved templates only, and the error says so.
 */
import { PinbotWhatsAppProvider } from '../communication/providers/whatsapp/pinbot.provider.js';

export interface LeadReplyResult {
  success: boolean;
  provider: 'pinbot' | null;
  messageId?: string | null;
  error?: string;
}

interface Deps {
  pinbot: { isConfigured(): boolean; send(to: string, subject: string, body: string): Promise<{ success: boolean; message_id?: string; error?: string }> };
}

const defaultDeps: Deps = { pinbot: new PinbotWhatsAppProvider() };

/** Meta's re-engagement refusal (code 131047) — the 24h customer-service window has closed. */
function explainPinbotError(error: string): string {
  return /131047|re-?engagement|24 ?h|24-hour|customer service window/i.test(error)
    ? "The candidate has not messaged in the last 24 hours, so WhatsApp only allows an approved template now — free-text replies are blocked."
    : error;
}

export function anyReplyProviderConfigured(deps: Deps = defaultDeps): boolean {
  return deps.pinbot.isConfigured();
}

export async function sendLeadReply(phone: string, text: string, deps: Deps = defaultDeps): Promise<LeadReplyResult> {
  if (!deps.pinbot.isConfigured()) return { success: false, provider: null, error: 'Pinbot (WhatsApp) is not configured' };
  const res = await deps.pinbot.send(phone, '', text);
  if (res.success) return { success: true, provider: 'pinbot', messageId: res.message_id ?? null };
  return { success: false, provider: null, error: `Pinbot: ${explainPinbotError(res.error ?? 'unknown error')}` };
}
