/** Why do some Meta fills have no he_lead? Counts by phone-shape. STRICTLY READ-ONLY. */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
const P = "RIGHT(REGEXP_REPLACE(m.parsed_phone,'[^0-9]',''),10)";
(async () => {
  const run = async (label: string, sql: string) => { try { const [r] = await db.execute<RowDataPacket[]>(sql); console.log(`== ${label}`); r.slice(0, 20).forEach((x) => console.log(JSON.stringify(x))); } catch (e) { console.log(`== ${label} FAILED ${(e as Error).message.slice(0, 200)}`); } };
  await run("fills 3d with no he_lead, by phone shape", `SELECT (${P} REGEXP '^[6-9][0-9]{9}$') valid_phone, LENGTH(REGEXP_REPLACE(m.parsed_phone,'[^0-9]','')) digits, COUNT(*) n
     FROM meta_lead_raw m WHERE m.created_at >= DATE_SUB(NOW(), INTERVAL 3 DAY)
       AND NOT EXISTS (SELECT 1 FROM he_lead l WHERE l.mobile10 = ${P} COLLATE utf8mb4_unicode_ci) GROUP BY valid_phone, digits`);
  await run("he_lead created per IST day (7d)", `SELECT DATE(DATE_ADD(created_at, INTERVAL 330 MINUTE)) d, primary_source, COUNT(*) n FROM he_lead WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY d, primary_source ORDER BY d DESC`);
  await run("he_lead columns without default", "SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_lead' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT IS NULL");
  // Dry run of the sync's INSERT inside a transaction that is always rolled back: shows the error, if any, and how many rows it would add.
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const M = (c: string) => `RIGHT(REGEXP_REPLACE(${c}, '[^0-9]', ''), 10)`;
    const [r] = await conn.execute(
      `INSERT INTO he_lead (mobile10, full_name, email, age, primary_source, sources_json, meta_lead_id)
       SELECT mob, name, email, age, 'meta', JSON_ARRAY('meta'), lid FROM (
         SELECT ${M("parsed_phone")} AS mob, MAX(parsed_name) AS name, MAX(parsed_email) AS email, MAX(parsed_age) AS age, MAX(id) AS lid
           FROM meta_lead_raw WHERE ${M("parsed_phone")} REGEXP '^[6-9][0-9]{9}$' AND created_at >= DATE_SUB(NOW(), INTERVAL 72 HOUR) GROUP BY ${M("parsed_phone")}) t
       ON DUPLICATE KEY UPDATE meta_lead_id = COALESCE(he_lead.meta_lead_id, VALUES(meta_lead_id))`);
    console.log("== dry-run insert affectedRows", (r as { affectedRows: number }).affectedRows);
  } catch (e) { console.log("== dry-run insert FAILED", (e as Error).message.slice(0, 300)); }
  finally { await conn.rollback(); conn.release(); }
  await db.end?.();
})();
