/** Polls the Pinbot phone-number quality rating (cached 30 min). A failed or unconfigured poll is null (unknown), never GREEN. */
import axios from "axios";
import { pinbotBaseUrl } from "../communication/providers/whatsapp/pinbot.provider.js";
import { normaliseQuality, type PinbotQuality } from "./qualified-followup.rules.js";

const TIMEOUT_MS = 8_000;
const TTL_MS = 30 * 60_000;

let cache: { at: number; value: PinbotQuality | null } | null = null;

/** Never throws and never logs: an axios error carries the apikey header, so nothing from it is kept. */
export async function fetchPinbotQuality(): Promise<PinbotQuality | null> {
  const apiKey = process.env.PINBOT_API_KEY ?? "";
  const phoneNumberId = process.env.PINBOT_PHONE_NUMBER_ID ?? "";
  if (!apiKey || !phoneNumberId) return null;
  try {
    const res = await axios.get(`${pinbotBaseUrl()}/${encodeURIComponent(phoneNumberId)}`, {
      headers: { apikey: apiKey }, timeout: TIMEOUT_MS,
    });
    return normaliseQuality((res.data as { quality_rating?: unknown } | undefined)?.quality_rating);
  } catch {
    return null;
  }
}

export async function getPinbotQuality(): Promise<PinbotQuality | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const value = await fetchPinbotQuality();
  cache = { at: Date.now(), value };
  return value;
}

export function resetPinbotQualityCache(): void { cache = null; }
