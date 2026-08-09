import axios from 'axios';
import type { CommunicationProvider, Attachment } from '../provider.interface.js';
import type { ProviderResponse, DeliveryStatus } from '../../communication.types.js';

const BASE_URL = 'https://pgapi.sparc.smartping.io/fe/api/v1';

interface SmartPingSendResponse {
  messageId?: string;
  message_id?: string;
  status?: string;
  error?: string;
  description?: string;
}

/**
 * SmartPing (Sparc) SMS provider — TRAI DLT compliant, Indian transactional route.
 * Credentials live in env vars; never hardcode or log them.
 */
export class SmartPingProvider implements CommunicationProvider {
  private readonly username: string;
  private readonly password: string;
  private readonly senderId: string;
  private readonly entityId: string;

  constructor(
    username?: string,
    password?: string,
    senderId?: string,
    entityId?: string,
  ) {
    this.username = username ?? process.env.SMARTPING_USERNAME ?? '';
    this.password = password ?? process.env.SMARTPING_PASSWORD ?? '';
    this.senderId = senderId ?? process.env.SMARTPING_SENDER_ID ?? 'Ispark';
    this.entityId = entityId ?? process.env.SMARTPING_ENTITY_ID ?? '1001485540000016211';
  }

  /**
   * Send an SMS via SmartPing.
   * `subject` carries the DLT content ID (reusing the unused field).
   */
  /** SmartPing rejects with "username is required" when these are absent. */
  isConfigured(): boolean {
    return Boolean(this.username && this.password);
  }

  async send(recipient: string, subject: string, body: string, _attachments?: Attachment[]): Promise<ProviderResponse> {
    try {
      const mobile = this.normalizeMobile(recipient);
      if (!mobile) {
        return { success: false, error: `Invalid Indian mobile number: ${recipient}` };
      }

      // subject carries dltContentId when called via sms.helper; fall back to env
      const dltContentId = subject || process.env.SMARTPING_DEFAULT_DLT_CONTENT_ID || '';

      // Refuse anything that is not a registered DLT content id.
      //
      // The second parameter is named `subject` for interface reasons but must be
      // a DLT template id — sms.helper passes one from SMARTPING_DLT_REGISTRY
      // (19-digit, e.g. 1707178351079130369). dispatchService passes
      // dispatch_log.subject instead, so every notification SMS sent a human
      // sentence such as "eSign link expiring — employee non-responsive" in that
      // slot. SmartPing answered HTTP 400 every time: 901 failures, 0 successes,
      // all time.
      //
      // Rejecting here rather than letting it 400 matters for two reasons. The
      // error becomes true — "400" told nobody what was wrong for months — and
      // under India's TRAI DLT rules the content must MATCH its registered
      // template, so firing arbitrary notification text at the gateway is a
      // compliance problem, not merely a failed send. If an event genuinely
      // needs SMS, register a template and route it through buildSMS() like the
      // OTP paths do.
      if (!/^\d{12,25}$/.test(dltContentId)) {
        return {
          success: false,
          error:
            "No registered DLT template for this message. SmartPing requires a numeric " +
            "dltContentId from SMARTPING_DLT_REGISTRY (route via buildSMS), but received " +
            `${dltContentId ? `"${dltContentId.slice(0, 40)}"` : "nothing"}. Not sent.`,
        };
      }

      const params = new URLSearchParams({
        username: this.username,
        password: this.password,
        unicode: 'false',
        from: this.senderId,
        text: body,
        to: `91${mobile}`,
        dltContentId,
        dltPrincipalEntityId: this.entityId,
      });

      const res = await axios.get<SmartPingSendResponse>(`${BASE_URL}/send`, {
        params,
        timeout: 10000,
      });

      const data = res.data;
      const msgId = data?.messageId ?? data?.message_id ?? String(res.status);

      if (res.status === 200 || res.status === 201) {
        return { success: true, message_id: msgId };
      }
      return { success: false, error: data?.error ?? data?.description ?? `HTTP ${res.status}` };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async getDeliveryStatus(messageId: string): Promise<DeliveryStatus> {
    try {
      const params = new URLSearchParams({
        username: this.username,
        password: this.password,
        messageId,
      });
      const res = await axios.get<{ status?: string; delivered_at?: string }>(
        `${BASE_URL}/report`,
        { params, timeout: 8000 },
      );
      const raw = res.data?.status?.toLowerCase() ?? '';
      const status =
        raw === 'delivered' ? 'delivered' :
        raw === 'failed' || raw === 'rejected' ? 'failed' :
        raw === 'sent' || raw === 'submitted' ? 'sent' :
        'sent';
      return { status, delivered_at: res.data?.delivered_at };
    } catch (e) {
      return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
    }
  }

  validateRecipient(contact: string): boolean {
    return !!this.normalizeMobile(contact);
  }

  getName(): string { return 'smartping'; }

  private normalizeMobile(raw: string): string | null {
    // Accept: 10-digit, +91XXXXXXXXXX, 91XXXXXXXXXX
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 10) return digits;
    if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
    return null;
  }
}
