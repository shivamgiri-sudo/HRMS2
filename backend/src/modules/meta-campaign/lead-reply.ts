/**
 * Free-text WhatsApp reply from the HR inbox to a Meta lead.
 *
 * Pinbot (WhatsApp Business API) is the live channel; the inbox used to call Wassenger only, so with
 * no Wassenger device linked every reply failed. Pinbot is tried first and Wassenger stays as a
 * fallback. A Pinbot free-text message only delivers inside the 24-hour window after the candidate
 * last wrote to us — outside it WhatsApp accepts approved templates only, and the error says so.
 */
import { PinbotWhatsAppProvider } from '../communication/providers/whatsapp/pinbot.provider.js';
import { isWassengerConfigured, sendCustomMessage } from './wassenger.provider.js';

export interface LeadReplyResult {
  success: boolean;
  provider: 'pinbot' | 'wassenger' | null;
  messageId?: string | null;
  error?: string;
}

interface Deps {
  pinbot: { isConfigured(): boolean; send(to: string, subject: string, body: string): Promise<{ success: boolean; message_id?: string; error?: string }> };
  wassenger: { isConfigured(): boolean; send(phone: string, text: string): Promise<{ success: boolean; messageId?: string; error?: string }> };
}

const defaultDeps: Deps = {
  pinbot: new PinbotWhatsAppProvider(),
  wassenger: { isConfigured: isWassengerConfigured, send: sendCustomMessage },
};

/** Meta's re-engagement refusal (code 131047) — the 24h customer-service window has closed. */
function explainPinbotError(error: string): string {
  return /131047|re-?engagement|24 ?h|24-hour|customer service window/i.test(error)
    ? "The candidate has not messaged in the last 24 hours, so WhatsApp only allows an approved template now — free-text replies are blocked."
    : error;
}

export function anyReplyProviderConfigured(deps: Deps = defaultDeps): boolean {
  return deps.pinbot.isConfigured() || deps.wassenger.isConfigured();
}

export async function sendLeadReply(phone: string, text: string, deps: Deps = defaultDeps): Promise<LeadReplyResult> {
  const errors: string[] = [];
  if (deps.pinbot.isConfigured()) {
    const res = await deps.pinbot.send(phone, '', text);
    if (res.success) return { success: true, provider: 'pinbot', messageId: res.message_id ?? null };
    errors.push(`Pinbot: ${explainPinbotError(res.error ?? 'unknown error')}`);
  }
  if (deps.wassenger.isConfigured()) {
    const res = await deps.wassenger.send(phone, text);
    if (res.success) return { success: true, provider: 'wassenger', messageId: res.messageId ?? null };
    errors.push(`Wassenger: ${res.error ?? 'unknown error'}`);
  }
  if (!errors.length) return { success: false, provider: null, error: 'No WhatsApp provider is configured (Pinbot or Wassenger)' };
  return { success: false, provider: null, error: errors.join(' | ') };
}
