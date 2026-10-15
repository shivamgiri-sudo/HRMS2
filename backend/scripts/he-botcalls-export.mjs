/**
 * Hiring Engine bot-call export -- read-only production read (last 30 days).
 *   node scripts/he-botcalls-export.mjs
 * SELECTs only, READ ONLY session. Prints a summary then CSV between BEGIN_CSV / END_CSV markers.
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
  const [tot] = await conn.query("SELECT COUNT(*) n, MIN(created_at) first_at, MAX(created_at) last_at FROM he_call");
  console.log("he_call all-time:", JSON.stringify(tot[0]));
  const [byOutcome] = await conn.query(
    "SELECT COALESCE(outcome,'(none)') outcome, COUNT(*) n FROM he_call WHERE created_at >= NOW() - INTERVAL 30 DAY GROUP BY 1 ORDER BY n DESC");
  console.log("last 30d by outcome:", JSON.stringify(byOutcome));
  const [rows] = await conn.query(
    `SELECT c.created_at, c.started_at, c.duration_s, c.attempt_no, l.mobile10, l.full_name, l.primary_source, l.status lead_status,
            c.outcome, c.decline_reason, c.sentiment, c.identity_confirmed, c.language_used, c.email_received, c.assessment_done,
            c.original_slot_answer, c.offered_slot_at, c.offered_slot_answer, c.handoff_reason, c.summary, c.provider_call_id
       FROM he_call c JOIN he_lead l ON l.id = c.lead_id
      WHERE c.created_at >= NOW() - INTERVAL 30 DAY ORDER BY c.created_at`);
  console.log(`rows: ${rows.length}`);
  console.log("BEGIN_CSV");
  if (rows.length) {
    const cols = Object.keys(rows[0]);
    console.log(cols.join(","));
    for (const r of rows) console.log(cols.map((k) => esc(r[k])).join(","));
  }
  console.log("END_CSV");
} finally { await conn.end(); }
