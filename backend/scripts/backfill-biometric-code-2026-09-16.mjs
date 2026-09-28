/**
 * One-off backfill, 2026-09-16. Owner decision: no separate biometric enrollment ID is in use
 * for current hires, so biometric_code should equal employee_code when not otherwise set.
 *
 * IMPORTANT: 27,056 employees already carry a real, distinct legacy biometric device ID
 * (e.g. 'AHMH2854', 'HYD009') that has nothing to do with their employee_code -- these are
 * genuine historical device enrollment IDs that cosec-sync.service.ts matches attendance
 * punches against. This script only fills employees where biometric_code is currently NULL
 * or '' -- it never overwrites an existing distinct value. Scoped to active employees, same
 * as the address/education backfills earlier this session.
 *
 * Usage: node backfill-biometric-code-2026-09-16.mjs           (dry run)
 *        node backfill-biometric-code-2026-09-16.mjs --write   (apply)
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const WRITE = process.argv.includes("--write");

const rawConn = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
});
const conn = {
  query: async (...args) => {
    for (let a = 1; a <= 6; a++) {
      try { return await rawConn.query(...args); }
      catch (err) {
        if ((err.code === "ER_LOCK_DEADLOCK" || err.code === "ER_LOCK_WAIT_TIMEOUT") && a < 6) {
          await new Promise((r) => setTimeout(r, 1000 * a)); continue;
        }
        throw err;
      }
    }
  },
  end: () => rawConn.end(),
};

const [rows] = await conn.query(`
  SELECT id, employee_code FROM employees
   WHERE active_status = 1 AND (biometric_code IS NULL OR biometric_code = '')
`);
console.log(`\n=== ${rows.length} active employee(s) with blank biometric_code -> would set to employee_code ===`);
console.table(rows.slice(0, 10).map(r => ({ code: r.employee_code })));

if (WRITE) {
  const [result] = await conn.query(
    `UPDATE employees SET biometric_code = employee_code
      WHERE active_status = 1 AND (biometric_code IS NULL OR biometric_code = '')`
  );
  console.log(`Updated ${result.affectedRows} row(s).`);
} else {
  console.log(`\nDRY RUN — would update ${rows.length} row(s). Re-run with --write to apply.`);
}

await conn.end();
