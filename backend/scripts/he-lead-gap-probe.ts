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
  await db.end?.();
})();
