/**
 * Hiring Engine: leads never contacted by the engine (no outbound WhatsApp/email message, no bot call) -- read-only.
 *   node scripts/he-uncontacted-export.mjs
 * SELECTs only, READ ONLY session. Prints counts then CSV between BEGIN_CSV / END_CSV.
 * Eligible = not opted out / joined / dead, not in followup_person opt-out, not an ex-employee flagged here,
 * valid 10-digit mobile. Recruiter-call history is reported as a column, not used to exclude.
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
const BASE = `
  FROM he_lead l
  LEFT JOIN he_ex_employee x ON x.mobile10 = l.mobile10
 WHERE l.status NOT IN ('opted_out','joined','dead')
   AND l.mobile10 REGEXP '^[6-9][0-9]{9}$'
   AND NOT EXISTS (SELECT 1 FROM he_message m WHERE m.mobile10 = l.mobile10 AND m.direction = 'out')
   AND NOT EXISTS (SELECT 1 FROM he_call c WHERE c.lead_id = l.id)
   AND NOT EXISTS (SELECT 1 FROM followup_person fp WHERE fp.mobile10 = l.mobile10 AND fp.opted_out_at IS NOT NULL)`;
try {
  await conn.query("SET SESSION TRANSACTION READ ONLY");
  const [t] = await conn.query("SELECT COUNT(*) total, SUM(status NOT IN ('opted_out','joined','dead')) live FROM he_lead");
  console.log("he_lead:", JSON.stringify(t[0]));
  const [n] = await conn.query(`SELECT COUNT(*) n, SUM(x.mobile10 IS NOT NULL) ex_employee ${BASE}`);
  console.log("never contacted + eligible:", JSON.stringify(n[0]));
  const [bs] = await conn.query(`SELECT l.primary_source, l.status, COUNT(*) n ${BASE} GROUP BY 1,2 ORDER BY n DESC`);
  console.log("by source/status:", JSON.stringify(bs));
  const [rows] = await conn.query(
    `SELECT l.mobile10, l.full_name, l.email, l.primary_source, l.status, l.age, l.education_rank, l.experience_years,
            l.night_shift_ok, l.pincode, l.locality, l.created_at,
            (x.mobile10 IS NOT NULL) ex_employee,
            (SELECT COUNT(*) FROM ats_recruiter_hiring_activity a WHERE a.mobile10 = l.mobile10) recruiter_calls
       ${BASE} ORDER BY l.created_at DESC`);
  console.log(`rows: ${rows.length}`);
  console.log("BEGIN_CSV");
  if (rows.length) {
    const cols = Object.keys(rows[0]);
    console.log(cols.join(","));
    for (const r of rows) console.log(cols.map((k) => esc(r[k])).join(","));
  }
  console.log("END_CSV");
} finally { await conn.end(); }
