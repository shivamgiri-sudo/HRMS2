/**
 * Encrypted integration settings for the Hiring Engine, kept in he_secret (encrypted with utils/encryption.ts, which refuses to run without a key and
 * survives key rotation). Environment variables, when set, win, so a server-level setting can still override the screen.
 *   webhook token      shared secret in the URL the providers call (Pinbot WhatsApp replies and receipts, Superbot call feedback)
 *   Superbot           API key, Superbot id, campaign id, base URL and language for the voice bot
 * Nothing here is ever returned in full to the browser: the key is shown as its last four characters; the token only to an admin on request.
 */
import type { RowDataPacket } from "mysql2";
import { randomBytes } from "node:crypto";
import { db } from "../../db/mysql.js";
import { decrypt, encrypt } from "../../utils/encryption.js";

const KEYS = { webhookToken: "webhook_token", sbKey: "superbot_api_key", sbId: "superbot_id", sbCampaign: "superbot_campaign", sbBase: "superbot_base", sbLang: "superbot_lang" } as const;
const cache = new Map<string, { v: string | null; at: number }>();
const TTL_MS = 15_000;

export async function getSecret(name: string): Promise<string | null> {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.v;
  const [r] = await db.execute<RowDataPacket[]>("SELECT value_enc FROM he_secret WHERE secret_key = ? LIMIT 1", [name]);
  let v: string | null = null;
  if (r[0]) { try { v = decrypt(String(r[0].value_enc)); } catch { v = null; } }
  cache.set(name, { v, at: Date.now() });
  return v;
}
export async function setSecret(name: string, value: string, userId: string | null): Promise<void> {
  await db.execute("INSERT INTO he_secret (secret_key, value_enc, updated_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE value_enc = VALUES(value_enc), updated_by = VALUES(updated_by)", [name, encrypt(value), userId]);
  cache.delete(name);
}
export const clearSecretCache = () => cache.clear();

/** The token the providers must present: the environment variable if set, else the one generated on the screen. */
export async function webhookToken(): Promise<{ token: string | null; source: "env" | "screen" | "none" }> {
  const env = process.env.HE_WEBHOOK_TOKEN?.trim();
  if (env) return { token: env, source: "env" };
  const s = await getSecret(KEYS.webhookToken);
  return s ? { token: s, source: "screen" } : { token: null, source: "none" };
}
export async function generateWebhookToken(userId: string | null): Promise<string> {
  const t = randomBytes(24).toString("hex");
  await setSecret(KEYS.webhookToken, t, userId);
  return t;
}

export interface SuperbotConfig { apiKey: string; superbotId: string; campaignId: string; baseUrl: string; lang: string }
export async function superbotConfig(): Promise<SuperbotConfig | null> {
  const apiKey = process.env.SUPERBOT_API_KEY?.trim() || (await getSecret(KEYS.sbKey));
  const superbotId = process.env.SUPERBOT_ID?.trim() || (await getSecret(KEYS.sbId));
  const campaignId = process.env.SUPERBOT_CAMPAIGN_ID?.trim() || (await getSecret(KEYS.sbCampaign));
  if (!apiKey || !superbotId || !campaignId) return null;
  const baseUrl = (process.env.SUPERBOT_BASE_URL?.trim() || (await getSecret(KEYS.sbBase)) || "https://api.superbot.one/tel/v2").replace(/\/$/, "");
  return { apiKey, superbotId, campaignId, baseUrl, lang: (await getSecret(KEYS.sbLang)) || "en-IN" };
}
export async function saveSuperbot(input: { apiKey?: string; superbotId?: string; campaignId?: string; baseUrl?: string; lang?: string }, userId: string | null): Promise<void> {
  const clean = (v: string | undefined, re: RegExp) => { const t = String(v ?? "").trim(); return t && re.test(t) ? t : null; };
  const key = clean(input.apiKey, /^[A-Za-z0-9._-]{16,128}$/), id = clean(input.superbotId, /^[A-Za-z0-9_-]{4,40}$/), camp = clean(input.campaignId, /^[0-9]{1,12}$/);
  if (input.apiKey?.trim() && !key) throw Object.assign(new Error("That API key does not look right (letters and digits, 16 to 128 characters)."), { statusCode: 400 });
  if (input.superbotId?.trim() && !id) throw Object.assign(new Error("The Superbot id should be letters and digits, for example O3nqdwL8r2Z8."), { statusCode: 400 });
  if (input.campaignId?.trim() && !camp) throw Object.assign(new Error("The campaign id should be a number, for example 27425."), { statusCode: 400 });
  const base = clean(input.baseUrl, /^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9._\/-]*)?$/);
  if (input.baseUrl?.trim() && !base) throw Object.assign(new Error("The base URL must start with https://."), { statusCode: 400 });
  const lang = clean(input.lang, /^[a-z]{2}-[A-Z]{2}$/);
  if (input.lang?.trim() && !lang) throw Object.assign(new Error("The language should look like en-IN."), { statusCode: 400 });
  if (key) await setSecret(KEYS.sbKey, key, userId);
  if (id) await setSecret(KEYS.sbId, id, userId);
  if (camp) await setSecret(KEYS.sbCampaign, camp, userId);
  if (base) await setSecret(KEYS.sbBase, base, userId);
  if (lang) await setSecret(KEYS.sbLang, lang, userId);
}
export const last4 = (v: string | null | undefined) => (v ? `••••${v.slice(-4)}` : null);
export { KEYS as SECRET_KEYS };
