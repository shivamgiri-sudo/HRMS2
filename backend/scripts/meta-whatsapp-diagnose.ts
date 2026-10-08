/**
 * Why are Meta lead sync, qualified-candidate WhatsApp/email and HRMS WhatsApp not working?
 * STRICTLY READ-ONLY: SELECTs plus GET probes. Prints booleans, status codes and counts — never a
 * token, key or phone number.
 *
 *   npx tsx scripts/meta-whatsapp-diagnose.ts
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
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

/** Presence-only scan of env files next to the live one: which names exist, never any value. */
function scanEnvFiles() {
  const dir = path.resolve(process.cwd());
  const wanted = ["META_MARKETING_ACCESS_TOKEN", "WASSENGER_API_TOKEN", "WASSENGER_DEVICE_ID", "META_PAGE_IDS", "META_LEAD_VERIFY_TOKEN"];
  const seen: string[] = [];
  for (const base of [dir, path.join(dir, ".."), "/var/www/HRMS2/backend", "/var/www/HRMS2"]) {
    let names: string[] = [];
    try { names = fs.readdirSync(base).filter((n) => /^\.env/.test(n) || /env.*(bak|backup|old|orig)/i.test(n)); } catch { continue; }
    for (const n of names) {
      const f = path.join(base, n);
      if (seen.includes(f)) continue;
      seen.push(f);
      try {
        const st = fs.statSync(f);
        if (!st.isFile()) continue;
        const text = fs.readFileSync(f, "utf8");
        const present = wanted.filter((k) => new RegExp(`^\\s*${k}\\s*=\\s*\\S+`, "m").test(text));
        console.log(`ENVFILE ${f} modified=${st.mtime.toISOString()} hasValuesFor=${JSON.stringify(present)}`);
      } catch (e) { console.log(`ENVFILE ${f} unreadable: ${(e as Error).message}`); }
    }
  }
}

/** Per-key state in the live env file and in the running pm2 process: never prints a value. */
function inspectKey() {
  const keys = ["META_MARKETING_ACCESS_TOKEN", "META_PAGE_IDS", "META_PAGE_ID"];
  try {
    const text = fs.readFileSync("/var/www/HRMS2/backend/.env", "utf8").split(/\r?\n/);
    for (const k of keys) {
      const lines = text.filter((l) => l.replace(/^\s*(export\s+)?#?\s*/, "").startsWith(k));
      const states = lines.map((l) => {
        const commented = /^\s*#/.test(l);
        const val = l.split("=").slice(1).join("=").trim().replace(/^['"]|['"]$/g, "");
        return `${commented ? "commented" : "active"}:${val ? "has-value" : "empty"}`;
      });
      console.log(`LIVE_ENV_KEY ${k}: ${states.length ? states.join(", ") : "absent"}`);
    }
  } catch (e) { console.log("LIVE_ENV_KEY read failed:", (e as Error).message); }
  try {
    const list = JSON.parse(execSync("pm2 jlist", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })) as Array<{ name: string; pm2_env: Record<string, unknown> }>;
    for (const p of list.filter((x) => /hrms2/.test(x.name))) {
      console.log(`PM2 ${p.name}: ${keys.map((k) => `${k}=${p.pm2_env[k] ? "set" : "unset"}`).join(" ")}`);
    }
  } catch (e) { console.log("PM2 env read failed:", (e as Error).message.slice(0, 120)); }
  for (const f of ["/var/www/HRMS2/backend/logs/backend-out.log", "/var/www/HRMS2/backend/logs/backend-err.log"]) {
    try {
      const lines = execSync(`grep -a "meta-sync\\|\\[meta" ${f} | tail -n 12`, { encoding: "utf8" }).trim().split("\n");
      for (const l of lines) console.log(`LOG ${path.basename(f)}: ${l.slice(0, 220).replace(/access_token=[^&\s"]+/g, "access_token=***")}`);
    } catch { console.log(`LOG ${path.basename(f)}: no meta lines`); }
  }
}

async function main() {
  scanEnvFiles();
  inspectKey();
  console.log("ENV", JSON.stringify({
    metaConfigured: isMetaConfigured(),
    META_MARKETING_ACCESS_TOKEN: has("META_MARKETING_ACCESS_TOKEN"),
    META_PAGE_IDS: has("META_PAGE_IDS") || has("META_PAGE_ID"),
    WHATSAPP_PROVIDER: process.env.WHATSAPP_PROVIDER ?? null,
    LOCAL_WHATSAPP_API_URL: has("LOCAL_WHATSAPP_API_URL"),
    LOCAL_WHATSAPP_API_KEY: has("LOCAL_WHATSAPP_API_KEY"),
    WASSENGER_API_TOKEN: has("WASSENGER_API_TOKEN"), WASSENGER_DEVICE_ID: has("WASSENGER_DEVICE_ID"),
    META_LEAD_VERIFY_TOKEN: has("META_LEAD_VERIFY_TOKEN"), META_MARKETING_APP_ID: has("META_MARKETING_APP_ID"),
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
  if (has("WASSENGER_API_TOKEN")) await probe("wassenger devices", "https://api.wassenger.com/v1/devices", { headers: { Token: process.env.WASSENGER_API_TOKEN! } });
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
