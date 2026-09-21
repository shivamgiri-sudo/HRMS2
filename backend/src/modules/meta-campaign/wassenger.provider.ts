/**
 * Wassenger WhatsApp Provider
 *
 * Hosted WhatsApp gateway — no self-hosting, no QR code on server.
 * REST API at https://api.wassenger.com/v1
 *
 * Setup:
 *   1. Sign up at https://app.wassenger.com
 *   2. Connect your WhatsApp number (scan QR once in their dashboard)
 *   3. Get API token from Settings > API
 *   4. Set WASSENGER_API_TOKEN and WASSENGER_DEVICE_ID in .env
 *   5. Add webhook URL in Wassenger dashboard:
 *      https://mcnhrms.teammas.in/api/meta/wassenger-webhook
 *
 * Incoming reply flow:
 *   Candidate replies "1" → Wassenger webhook → /api/meta/wassenger-webhook
 *   → mark candidate walk-in confirmed in ATS
 */

import axios from 'axios';

const WASSENGER_BASE = 'https://api.wassenger.com/v1';

export function isWassengerConfigured(): boolean {
  return Boolean(process.env.WASSENGER_API_TOKEN && process.env.WASSENGER_DEVICE_ID);
}

function headers() {
  return {
    'Content-Type': 'application/json',
    Token: process.env.WASSENGER_API_TOKEN ?? '',
  };
}

/** Format Indian mobile to WhatsApp ID: 919876543210 */
function toWaPhone(phone: string): string {
  let p = phone.replace(/\D/g, '');
  if (p.length === 10) p = `91${p}`;
  else if (p.startsWith('0')) p = `91${p.slice(1)}`;
  return p;
}

export interface WassengerSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send a shortlist notification with walk-in confirmation options.
 *
 * Message asks candidate to confirm walk-in by replying 1/2/3.
 * The webhook handler updates the ATS stage on receipt.
 */
export async function sendShortlistMessage(
  phone: string,
  name: string,
  designation: string | null,
  branch: string | null,
  referenceId: string
): Promise<WassengerSendResult> {
  if (!isWassengerConfigured()) {
    return { success: false, error: 'WASSENGER_API_TOKEN or WASSENGER_DEVICE_ID not set' };
  }

  const role = designation ?? 'Customer Service Executive';
  const place = branch ? ` - ${branch}` : '';
  const waPhone = toWaPhone(phone);

  const message =
    `नमस्ते *${name}* ji! 🙏\n\n` +
    `*MAS Callnet* में *${role}${place}* के लिए आपका application *shortlist* हो गया है! 🎉\n\n` +
    `Interview के लिए office आएं:\n` +
    `📄 Aadhaar, PAN, Education proof लाएं\n` +
    `⏰ Timing: 10 AM – 5 PM\n\n` +
    `─────────────────\n\n` +
    `Hello *${name}*!\n\n` +
    `Your application for *${role}${place}* at *MAS Callnet* has been *shortlisted*! 🎉\n\n` +
    `Please visit our office for interview:\n` +
    `📄 Bring Aadhaar, PAN & Education proof\n` +
    `⏰ Timing: 10 AM – 5 PM\n\n` +
    `*Please confirm your walk-in:*\n` +
    `Reply *1* ✅ – हाँ, मैं आऊँगा/आऊँगी\n` +
    `Reply *2* 🔄 – Mujhe reschedule chahiye\n` +
    `Reply *3* ❌ – Interested nahi hoon\n\n` +
    `Ref: ${referenceId}`;

  try {
    const { data } = await axios.post(
      `${WASSENGER_BASE}/messages`,
      {
        phone: waPhone,
        message,
        device: process.env.WASSENGER_DEVICE_ID,
      },
      { headers: headers(), timeout: 15000 }
    );

    return {
      success: true,
      messageId: data?.id ?? data?.data?.id ?? 'sent',
    };
  } catch (err) {
    const msg = axios.isAxiosError(err)
      ? err.response?.data?.message ?? err.response?.data?.error ?? err.message
      : err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

/**
 * Parse an incoming Wassenger webhook payload.
 *
 * Wassenger sends a webhook for every incoming message.
 * We look for replies of "1", "2", or "3" which are the candidate's
 * walk-in confirmation responses.
 */
export interface WassengerWebhookPayload {
  event: string;
  data?: {
    id?: string;
    phone?: string;
    fromMe?: boolean;
    type?: string;
    body?: string;
    timestamp?: number;
  };
}

export type WalkInReply = 'confirmed' | 'reschedule' | 'not_interested' | 'unknown';

export function parseWassengerWebhook(payload: WassengerWebhookPayload): {
  isIncoming: boolean;
  phone: string | null;
  reply: WalkInReply;
  rawBody: string | null;
} {
  // Only process incoming (not fromMe) message events
  if (payload.event !== 'message:in:new' && payload.event !== 'message:received') {
    return { isIncoming: false, phone: null, reply: 'unknown', rawBody: null };
  }

  const msg = payload.data;
  if (!msg || msg.fromMe || msg.type !== 'chat') {
    return { isIncoming: false, phone: null, reply: 'unknown', rawBody: null };
  }

  const body = (msg.body ?? '').trim();
  const phone = msg.phone ?? null;

  let reply: WalkInReply = 'unknown';
  if (body === '1' || body.toLowerCase().startsWith('haan') || body.toLowerCase().includes('aaunga') || body.toLowerCase().includes('aaungi')) {
    reply = 'confirmed';
  } else if (body === '2' || body.toLowerCase().includes('reschedule') || body.toLowerCase().includes('baad')) {
    reply = 'reschedule';
  } else if (body === '3' || body.toLowerCase().includes('nahi') || body.toLowerCase().includes('interested nahi')) {
    reply = 'not_interested';
  }

  return { isIncoming: true, phone, reply, rawBody: body };
}

/**
 * Send a follow-up confirmation message after candidate replies.
 */
export async function sendConfirmationAck(
  phone: string,
  reply: WalkInReply,
  name: string
): Promise<void> {
  if (!isWassengerConfigured()) return;

  const waPhone = toWaPhone(phone);
  let message = '';

  if (reply === 'confirmed') {
    message =
      `✅ *Confirmed!*\n\n` +
      `${name} ji, aapka walk-in *confirm* ho gaya hai.\n` +
      `Appointment number note kar lijiye aur documents ready rakhein.\n\n` +
      `All the best! 🍀 MAS Callnet Team`;
  } else if (reply === 'reschedule') {
    message =
      `🔄 Noted!\n\n` +
      `${name} ji, hamare recruiter aapko jald hi call karenge reschedule ke liye.\n\n` +
      `MAS Callnet Team`;
  } else if (reply === 'not_interested') {
    message =
      `Understood, ${name} ji.\n\n` +
      `Koi baat nahi. Agar future mein interest ho toh dobara apply karein.\n` +
      `Thank you! MAS Callnet Team`;
  }

  if (!message) return;

  await axios
    .post(
      `${WASSENGER_BASE}/messages`,
      { phone: waPhone, message, device: process.env.WASSENGER_DEVICE_ID },
      { headers: headers(), timeout: 10000 }
    )
    .catch((e: unknown) =>
      console.warn('[wassenger] ack send failed:', e instanceof Error ? e.message : e)
    );
}
