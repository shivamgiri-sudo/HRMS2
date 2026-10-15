/**
 * Hiring Engine: Meta leads whose bot calling is pending -- read-only.
 *   node scripts/he-meta-pending-export.mjs
 * Pending = Meta lead (meta_lead_raw) with a valid mobile that has NO bot call with a final answer
 * (WALKIN_CONFIRMED_YES / WALKIN_DECLINED_NEEDS_FOLLOWUP), not opted out/joined/dead. Qualified/pending screening,
 * walk-in not confirmed, one row per meta lead. Emails the CSV as an attachment to MAIL_TO via the app's SMTP (.env);
 * prints counts only (no PII in the job log).
 */
import { createRequire } from "node:module";

await import("dotenv/config");
const require = createRequire(import.meta.url);
const mysql = require("mysql2/promise");
const nodemailer = require("nodemailer");
const MAIL_TO = "shivam.giri@teammas.in";
const strip = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "");
const conn = await mysql.createConnection({
  host: strip(process.env.DB_HOST), port: Number(strip(process.env.DB_PORT) || 3306),
  user: strip(process.env.DB_USER), password: strip(process.env.DB_PASSWORD), database: strip(process.env.DB_NAME),
  connectTimeout: 20000, dateStrings: true,
});
const esc = (v) => { const s = String(v ?? "").replace(/\s+/g, " ").trim(); return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
try {
  await conn.query("SET SESSION TRANSACTION READ ONLY");
  const [cols] = await conn.query(
    "SELECT COLUMN_NAME c, DATA_TYPE t FROM information_schema.columns WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meta_lead_raw' ORDER BY ORDINAL_POSITION");
  console.log("meta_lead_raw columns:", cols.map((x) => `${x.c}:${x.t}`).join(","));
  const keep = cols.filter((x) => !/json|text|blob/i.test(x.t)).map((x) => `r.\`${x.c}\``);
  const has = (n) => cols.some((x) => x.c === n);
  const phone = has("parsed_phone") ? "RIGHT(REGEXP_REPLACE(r.parsed_phone, '[^0-9]', ''), 10)" : null;
  if (!phone) throw new Error("parsed_phone missing");
  const FROM = `
    FROM meta_lead_raw r
    LEFT JOIN he_lead l ON l.mobile10 = ${phone}
    LEFT JOIN meta_campaign_requisition mcr ON mcr.campaign_id = r.campaign_id
   WHERE ${phone} REGEXP '^[6-9][0-9]{9}$'
     AND (l.id IS NULL OR l.status NOT IN ('opted_out','joined','dead'))
     AND NOT EXISTS (SELECT 1 FROM he_call c WHERE c.lead_id = l.id AND c.outcome IN ('WALKIN_CONFIRMED_YES','WALKIN_DECLINED_NEEDS_FOLLOWUP'))`;
  const [tot] = await conn.query(`SELECT COUNT(*) total, COUNT(DISTINCT ${phone}) uniq FROM meta_lead_raw r`);
  console.log("meta_lead_raw:", JSON.stringify(tot[0]));
  const sr = has("screening_result") ? "r.screening_result" : "'n/a'";
  const [by] = await conn.query(`SELECT ${sr} screening, (l.id IS NOT NULL) in_he_lead, (SELECT COUNT(*) FROM he_call c WHERE c.lead_id = l.id) calls_made, COUNT(*) n ${FROM} GROUP BY 1,2,3 ORDER BY n DESC LIMIT 40`);
  console.log("pending by screening/in_he_lead/calls:", JSON.stringify(by));
  const [rows] = await conn.query(
    `SELECT ${phone} mobile10, ${keep.join(", ")}, l.status he_status, l.last_contact_at,
            (SELECT COUNT(*) FROM he_call c WHERE c.lead_id = l.id) bot_calls,
            (SELECT c.outcome FROM he_call c WHERE c.lead_id = l.id ORDER BY c.created_at DESC LIMIT 1) last_bot_outcome
       ${FROM} ORDER BY r.id DESC`);
  const seen = new Map();
  for (const r of rows) if (!seen.has(r.id)) seen.set(r.id, r);
  const out = [...seen.values()].filter((r) => ["qualified", "pending"].includes(r.screening_result) && Number(r.walkin_confirmed) !== 1);
  console.log(`rows raw=${rows.length} unique=${seen.size} pending=${out.length} mobiles=${new Set(out.map((r) => r.mobile10)).size}`);
  if (!out.length) throw new Error("no rows");
  const c = Object.keys(out[0]);
  const csv = "\ufeff" + [c.join(","), ...out.map((r) => c.map((k) => esc(r[k])).join(","))].join("\n");
  const t = nodemailer.createTransport({
    host: strip(process.env.SMTP_HOST) || "smtp.gmail.com", port: Number(strip(process.env.SMTP_PORT) || 587), secure: false,
    auth: { user: strip(process.env.SMTP_USER), pass: strip(process.env.SMTP_PASS) },
  });
  const info = await t.sendMail({
    from: `"${strip(process.env.SMTP_FROM_NAME) || "HRMS"}" <${strip(process.env.SMTP_FROM) || strip(process.env.SMTP_USER)}>`,
    to: MAIL_TO, subject: `HE Meta leads - calling pending (${out.length}) - CSV attached`,
    text: `Meta leads with bot calling pending: ${out.length} leads (${new Set(out.map((r) => r.mobile10)).size} unique mobiles). Qualified or screening-pending, no final bot answer, walk-in not confirmed. Contains candidate PII.`,
    attachments: [{ filename: "he_meta_calling_pending.csv", content: csv, contentType: "text/csv; charset=utf-8" }],
  });
  console.log("mail sent:", info.messageId, "accepted:", JSON.stringify(info.accepted));
} finally { await conn.end(); }
