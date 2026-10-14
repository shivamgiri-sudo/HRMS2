/**
 * bank-penny-drop-stats.mjs — READ-ONLY. Counts, with no names or account data:
 *  - bank_penny_drop_log outcomes by day and status (last 7 days),
 *  - employee_bank_detail rows by verified flag and whether the plain account_number is filled,
 *  - bank-related error lines in the live backend error log (digits masked, 200 chars).
 */
import mysql from "mysql2/promise";
import fs from "fs";
import "dotenv/config";

const c = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
});
const [log] = await c.query(`SELECT DATE(initiated_at) d, penny_drop_status s, COUNT(*) n
  FROM bank_penny_drop_log WHERE initiated_at >= NOW() - INTERVAL 7 DAY GROUP BY 1,2 ORDER BY 1 DESC, 2`);
console.log("== bank_penny_drop_log, last 7 days"); console.table(log);
const [recent] = await c.query(`SELECT penny_drop_status s, name_match_tier t, COUNT(*) n FROM bank_penny_drop_log
  WHERE initiated_at >= NOW() - INTERVAL 1 DAY GROUP BY 1,2 ORDER BY n DESC`);
console.log("== last 24h by status / match tier"); console.table(recent);
const [bank] = await c.query(`SELECT verified v, (account_number IS NOT NULL AND LENGTH(account_number) > 0) plain_filled,
  (account_number_enc IS NOT NULL) enc_filled, COUNT(*) n FROM employee_bank_detail WHERE active_status = 1 GROUP BY 1,2,3`);
console.log("== employee_bank_detail (active)"); console.table(bank);
await c.end();

for (const f of ["/home/masadmin/.pm2/logs/hrms2-backend-error.log"]) {
  try {
    const lines = fs.readFileSync(f, "utf8").split("\n").filter(l => /bank-details|employee-bank-penny-drop|employee_bank_detail|bank-penny-drop/i.test(l)).slice(-40);
    console.log(`== ${f}: ${lines.length} bank lines (last 40)`);
    for (const l of lines) console.log(l.replace(/\d{9,}/g, "#########").slice(0, 200));
  } catch (e) { console.log(`== ${f}: ${e.code ?? e.message}`); }
}
