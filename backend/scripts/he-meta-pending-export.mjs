/**
 * Hiring Engine: Meta leads whose bot calling is pending -- read-only.
 *   node scripts/he-meta-pending-export.mjs
 * Pending = Meta lead (meta_lead_raw) with a valid mobile that has NO bot call with a final answer
 * (WALKIN_CONFIRMED_YES / WALKIN_DECLINED_NEEDS_FOLLOWUP), not opted out/joined/dead. Prints counts + CSV.
 */
import { createRequire } from "node:module";

await import("dotenv/config");
const require = createRequire(import.meta.url);
const mysql = require("mysql2/promise");
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
  console.log(`rows: ${rows.length}`);
  console.log("BEGIN_CSV");
  if (rows.length) {
    const c = Object.keys(rows[0]);
    console.log(c.join(","));
    for (const r of rows) console.log(c.map((k) => esc(r[k])).join(","));
  }
  console.log("END_CSV");
} finally { await conn.end(); }
