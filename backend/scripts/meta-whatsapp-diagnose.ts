/**
 * Why are Meta lead sync, qualified-candidate WhatsApp/email and HRMS WhatsApp not working?
 * STRICTLY READ-ONLY: SELECTs plus GET probes. Prints booleans, status codes and counts — never a
 * token, key or phone number.
 *
 *   npx tsx scripts/meta-whatsapp-diagnose.ts
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { isMetaConfigured } from "../src/modules/meta-campaign/meta-api.client.js";
import { emailService } from "../src/modules/communication/email.service.js";
import { providerConfigService } from "../src/modules/communication/provider-config.service.js";

const has = (k: string) => Boolean((process.env[k] ?? "").trim());

async function probe(label: string, url: string, init: RequestInit = {}) {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
    const body = (await res.text()).slice(0, 220).replace(/access_token=[^&"\s]+/g, "access_token=***");
    console.log(`PROBE ${label}: HTTP ${res.status} ${body}`);
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    console.log(`PROBE ${label}: FAILED ${err.message} ${err.cause?.code ?? ""}`);
  }
}

async function main() {
  console.log("ENV", JSON.stringify({
    metaConfigured: isMetaConfigured(),
    META_MARKETING_ACCESS_TOKEN: has("META_MARKETING_ACCESS_TOKEN"),
    META_PAGE_IDS: has("META_PAGE_IDS") || has("META_PAGE_ID"),
    WHATSAPP_PROVIDER: process.env.WHATSAPP_PROVIDER ?? null,
    LOCAL_WHATSAPP_API_URL: has("LOCAL_WHATSAPP_API_URL"),
    LOCAL_WHATSAPP_API_KEY: has("LOCAL_WHATSAPP_API_KEY"),
    WASSENGER_API_KEY: has("WASSENGER_API_KEY"),
    PINBOT: has("PINBOT_API_KEY"),
    emailConfigured: emailService.isConfigured(),
    SMTP_HOST: has("SMTP_HOST"), RESEND: has("RESEND_API_KEY"),
  }));

  try {
    const cfg = await providerConfigService.loadActiveConfig("whatsapp");
    console.log("DB WHATSAPP CONFIG", cfg ? JSON.stringify({ provider_type: cfg.provider_type, configKeys: Object.keys(cfg.config ?? {}), secretKeysPresent: Object.keys(cfg.secrets ?? {}) }) : "none");
  } catch (e) { console.log("DB WHATSAPP CONFIG error:", (e as Error).message); }

  if (has("META_MARKETING_ACCESS_TOKEN")) {
    await probe("meta /me", `https://graph.facebook.com/v19.0/me?access_token=${encodeURIComponent(process.env.META_MARKETING_ACCESS_TOKEN!)}`);
  }
  const wa = (process.env.LOCAL_WHATSAPP_API_URL ?? "").replace(/\/+$/, "");
  if (wa) await probe("local whatsapp api", wa + "/");
  await probe("outbound internet (graph.facebook.com)", "https://graph.facebook.com/");

  const [byDay] = await db.execute<RowDataPacket[]>(
    `SELECT DATE(created_at) AS d, COUNT(*) AS leads, SUM(notification_sent_at IS NOT NULL) AS notified
       FROM meta_lead_raw WHERE created_at >= DATE_SUB(NOW(), INTERVAL 10 DAY) GROUP BY DATE(created_at) ORDER BY d DESC`);
  console.log("META LEADS PER DAY (last 10)", JSON.stringify(byDay));
  const [latest] = await db.execute<RowDataPacket[]>(`SELECT MAX(created_at) AS latest_lead FROM meta_lead_raw`);
  console.log("LATEST LEAD", JSON.stringify(latest[0]));
  const [pending] = await db.execute<RowDataPacket[]>(
    `SELECT screening_result, COUNT(*) AS n FROM meta_lead_raw
      WHERE created_at >= '2026-09-21' AND notification_sent_at IS NULL GROUP BY screening_result`);
  console.log("NOT NOTIFIED SINCE 21-SEP by screening_result", JSON.stringify(pending));
  const [channels] = await db.execute<RowDataPacket[]>(
    `SELECT notification_channels AS ch, COUNT(*) AS n FROM meta_lead_raw
      WHERE notification_sent_at >= DATE_SUB(NOW(), INTERVAL 10 DAY) GROUP BY notification_channels ORDER BY n DESC LIMIT 8`);
  console.log("RECENT NOTIFICATION CHANNELS", JSON.stringify(channels));
  try {
    const [msgs] = await db.execute<RowDataPacket[]>(
      `SELECT DATE(created_at) AS d, direction, delivery_status, COUNT(*) AS n FROM meta_lead_messages
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY DATE(created_at), direction, delivery_status ORDER BY d DESC LIMIT 24`);
    console.log("META LEAD MESSAGES (7d)", JSON.stringify(msgs));
  } catch (e) { console.log("meta_lead_messages n/a:", (e as Error).message); }
  try {
    const [disp] = await db.execute<RowDataPacket[]>(
      `SELECT channel, status, COUNT(*) AS n, MAX(created_at) AS last_at FROM dispatch_log
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY channel, status ORDER BY last_at DESC LIMIT 12`);
    console.log("DISPATCH LOG (7d)", JSON.stringify(disp));
    const [errs] = await db.execute<RowDataPacket[]>(
      `SELECT channel, LEFT(error_message, 160) AS err, COUNT(*) AS n, MAX(created_at) AS last_at FROM dispatch_log
        WHERE status = 'failed' AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY channel, LEFT(error_message, 160) ORDER BY n DESC LIMIT 8`);
    console.log("DISPATCH FAILURES (7d)", JSON.stringify(errs));
  } catch (e) { console.log("dispatch_log n/a:", (e as Error).message); }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
