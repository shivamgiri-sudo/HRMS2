/**
 * "WhatsApp me a sample of every template": sends the 11 approved templates, with sample values, to the signed-in user's OWN mobile
 * (the number on their employee profile, never one passed in). It is also the first real round trip to Pinbot/Meta, so every
 * rejection reason comes back per template. Nothing is written to the candidate message log.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { PinbotWhatsAppProvider } from "../communication/providers/whatsapp/pinbot.provider.js";
import { normalizeMobile10 } from "./he-phone.js";
import { sampleContext } from "./he-samples.service.js";
import { HE_TEMPLATES, buildParams, getTemplate } from "./he-template-catalog.js";

export interface WaSampleResult { key: string; name: string; ok: boolean; error?: string }
const mask = (m: string) => `${m.slice(0, 2)}xxxxxx${m.slice(-2)}`;
const lastRun = new Map<string, number>();

export async function ownMobile(userId: string): Promise<string | null> {
  const [r] = await db.execute<RowDataPacket[]>("SELECT mobile FROM employees WHERE user_id = ? AND active_status = 1 AND mobile IS NOT NULL AND mobile <> '' LIMIT 1", [userId]);
  return normalizeMobile10(r[0]?.mobile);
}

export async function previewWhatsAppSamples(userId: string): Promise<{ configured: boolean; to: string | null; templates: number }> {
  const [t] = await db.execute<RowDataPacket[]>("SELECT COUNT(*) AS n FROM he_template WHERE template_key LIKE '%:en' AND approval_state = 'approved' AND pinbot_name IS NOT NULL");
  const m = await ownMobile(userId);
  return { configured: new PinbotWhatsAppProvider().isConfigured(), to: m ? mask(m) : null, templates: Number(t[0].n) };
}

export async function sendWhatsAppSamples(userId: string): Promise<{ to: string; results: WaSampleResult[] }> {
  const mobile = await ownMobile(userId);
  if (!mobile) throw Object.assign(new Error("There is no mobile number on your employee profile, so a sample cannot be sent to you."), { statusCode: 400 });
  const last = lastRun.get(userId) ?? 0;
  if (Date.now() - last < 5 * 60_000) throw Object.assign(new Error("A sample was sent a moment ago. Please wait a few minutes before sending again."), { statusCode: 429 });
  lastRun.set(userId, Date.now());
  const pinbot = new PinbotWhatsAppProvider();
  if (!pinbot.isConfigured()) throw Object.assign(new Error("WhatsApp (Pinbot) is not configured on the server."), { statusCode: 409 });
  const [rows] = await db.execute<RowDataPacket[]>("SELECT template_key, pinbot_name, language FROM he_template WHERE template_key LIKE '%:en' AND approval_state = 'approved' AND pinbot_name IS NOT NULL");
  const byKey = new Map(rows.map((r) => [String(r.template_key).replace(/:en$/, ""), r]));
  const { ctx } = sampleContext();
  const results: WaSampleResult[] = [];
  for (const t of HE_TEMPLATES) {
    const row = byKey.get(t.key);
    if (!row) { results.push({ key: t.key, name: t.metaName.en ?? t.key, ok: false, error: "not approved in the Templates tab" }); continue; }
    try {
      const params = buildParams(t.key, "en", ctx);
      const hasUrl = getTemplate(t.key).buttons.en.some((b) => b.startsWith("URL:"));
      const r = await pinbot.sendTemplate(mobile, String(row.pinbot_name), params, String(row.language), hasUrl ? String(ctx.location_token) : undefined);
      results.push({ key: t.key, name: String(row.pinbot_name), ok: Boolean(r.success), ...(r.success ? {} : { error: String(r.error ?? "rejected").slice(0, 220) }) });
    } catch (e) { results.push({ key: t.key, name: String(row.pinbot_name), ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 220) }); }
    await new Promise((res) => setTimeout(res, 1200)); // keep the order on the phone
  }
  return { to: mask(mobile), results };
}
