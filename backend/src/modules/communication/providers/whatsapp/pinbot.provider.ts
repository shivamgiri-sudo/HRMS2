import axios from "axios";
import type { CommunicationProvider } from "../provider.interface.js";
import type {
  ProviderResponse,
  DeliveryStatus,
} from "../../communication.types.js";

// PINBOT_BASE_URL only for a staging/sandbox endpoint; production uses the Pinbot partner API.
const pinbotBase = () => (process.env.PINBOT_BASE_URL?.trim() || "https://partnersv1.pinbot.ai/v3").replace(/\/$/, "");
const SEND_TIMEOUT_MS = 15000;

interface PinbotSendResponse {
  messages?: Array<{ id?: string }>;
  error?: { message?: string } | string;
  message?: string;
}

/**
 * Meta rejects a template parameter that contains a newline or tab, or 4+ consecutive spaces, with
 * (#132018) "issue with the parameters in your template". A branch address stored on several lines
 * made every interview invitation fail that way, so line breaks become ", " and whitespace runs one
 * space. A value that is empty after cleaning becomes "-" (Meta also rejects an empty parameter).
 */
export function sanitizeTemplateParam(value: string): string {
  const cleaned = String(value ?? "")
    .replace(/[ \t]*[\r\n]+[ \t]*/g, ", ")
    .replace(/[ \t]+/g, " ")
    .replace(/(,\s*){2,}/g, ", ")
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .slice(0, 1024);
  return cleaned || "-";
}

/**
 * WhatsApp Business API through Pinbot (SmartPing WABA reseller; panel engage.dialdesk.in).
 *
 * Pinbot is a Meta Cloud API wrapper: same payload shape, but the URL is partnersv1.pinbot.ai and
 * auth is an `apikey` header. Business-initiated messages (interview invites to candidates who have
 * not messaged us in 24h) MUST be approved templates, so the useful call is {@link sendTemplate};
 * {@link send} sends free text and only delivers inside an open 24h customer window.
 *
 * Credentials are read lazily so an unset env never produces a request to ".../undefined/messages".
 */
export class PinbotWhatsAppProvider implements CommunicationProvider {
  private get apiKey(): string {
    return process.env.PINBOT_API_KEY ?? "";
  }

  private get phoneNumberId(): string {
    return process.env.PINBOT_PHONE_NUMBER_ID ?? "";
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.phoneNumberId);
  }

  async send(
    recipient: string,
    _subject: string,
    body: string,
  ): Promise<ProviderResponse> {
    return this.post({
      to: toMsisdn(recipient),
      type: "text",
      text: { preview_url: false, body },
    });
  }

  /** Send an approved template whose body placeholders {{1}}..{{n}} map to `bodyParams` in order. */
  async sendTemplate(
    recipient: string,
    templateName: string,
    bodyParams: readonly string[],
    languageCode = "en",
    /** Dynamic URL-button suffix (button index 0), for templates whose button URL ends in {{1}}. */
    urlButtonSuffix?: string,
  ): Promise<ProviderResponse> {
    const components: Array<Record<string, unknown>> = [
      {
        type: "body",
        parameters: bodyParams.map((text) => ({ type: "text", text: sanitizeTemplateParam(text) })),
      },
    ];
    if (urlButtonSuffix) {
      components.push({
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [{ type: "text", text: urlButtonSuffix }],
      });
    }
    const build = (c: Array<Record<string, unknown>>) => ({
      to: toMsisdn(recipient),
      type: "template",
      template: { name: templateName, language: { code: languageCode }, components: c },
    });
    const first = await this.post(build(components));
    // A URL button whose approved URL is static takes no parameter, and Meta answers a parameter it did not expect with #132018 / #132000:
    // retry once without the button so the message still goes out.
    if (!first.success && urlButtonSuffix && /132018|132000|parameter/i.test(String(first.error ?? ""))) {
      const second = await this.post(build(components.slice(0, 1)));
      if (second.success) return second;
    }
    return first;
  }

  private async post(
    message: Record<string, unknown>,
  ): Promise<ProviderResponse> {
    if (!this.isConfigured()) {
      return {
        success: false,
        error:
          "PINBOT_API_KEY or PINBOT_PHONE_NUMBER_ID is not configured; WhatsApp send skipped",
      };
    }
    try {
      const res = await axios.post<PinbotSendResponse>(
        `${pinbotBase()}/${encodeURIComponent(this.phoneNumberId)}/messages`,
        {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          ...message,
        },
        {
          headers: {
            "Content-Type": "application/json",
            apikey: this.apiKey,
          },
          timeout: SEND_TIMEOUT_MS,
          validateStatus: (s) => s < 500,
        },
      );
      const data = res.data ?? {};
      const messageId = data.messages?.[0]?.id;
      if (res.status >= 400 || !messageId) {
        const err =
          typeof data.error === "string"
            ? data.error
            : (data.error?.message ?? data.message ?? `HTTP ${res.status}`);
        return { success: false, error: err };
      }
      return { success: true, message_id: messageId };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async getDeliveryStatus(_messageId: string): Promise<DeliveryStatus> {
    // Delivery receipts are webhook-push only, as with Meta Cloud API.
    return { status: "sent" };
  }

  validateRecipient(contact: string): boolean {
    return /^[1-9]\d{6,14}$/.test(toMsisdn(contact));
  }

  getName(): string {
    return "pinbot";
  }
}

/** Pinbot wants digits only with country code; bare 10-digit Indian numbers get 91 prefixed. */
export function toMsisdn(contact: string): string {
  const digits = contact.replace("whatsapp:", "").replace(/\D/g, "");
  return digits.length === 10 ? `91${digits}` : digits;
}
