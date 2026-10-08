/**
 * One-off backfill, 2026-09-16.
 *
 * employee-creation-orchestrator.service.ts's employee_address INSERT required
 * present_address_line1/permanent_address_line1 to be non-empty as part of its gate,
 * alongside city/state/pincode. Verified live: of 32,983 candidate_onboarding_profile
 * rows ever submitted, zero have address_line1 filled — the onboarding form never
 * collects it, only city/state/pincode via a picker. So the gate never fired for a
 * single employee since it shipped 2026-09-12, and every new hire's employee_address
 * came out empty despite real city/state/pincode sitting in candidate_onboarding_profile.
 *
 * Code fix (this same commit) relaxes the gate for future hires. This script backfills
 * employees already created under the broken gate: additive only, never touches a row
 * that already exists (WHERE NOT EXISTS), address_line1 stored as '' when the candidate
 * never provided a street line (never fabricated).
 *
 * Usage: node backfill-employee-address-from-onboarding-2026-09-16.mjs           (dry run)
 *        node backfill-employee-address-from-onboarding-2026-09-16.mjs --write   (apply)
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

async function backfill(addressType, prefix) {
  const [rows] = await conn.query(
    `SELECT e.id AS employee_id, e.employee_code,
            cop.${prefix}_address_line1 AS line1, cop.${prefix}_address_line2 AS line2,
            cop.${prefix}_city AS city, cop.${prefix}_state AS state, cop.${prefix}_pincode AS pincode
       FROM employees e
       JOIN candidate_onboarding_profile cop ON cop.candidate_id = e.candidate_id
      WHERE NOT EXISTS (
              SELECT 1 FROM employee_address ea
               WHERE ea.employee_id = e.id AND ea.address_type = ?
            )
        AND cop.${prefix}_city <> '' AND cop.${prefix}_state <> '' AND cop.${prefix}_pincode <> ''`,
    [addressType]
  );

  console.log(`\n=== ${addressType} address: ${rows.length} employee(s) recoverable ===`);
  console.table(rows.slice(0, 10).map(r => ({ code: r.employee_code, line1: r.line1 || "(none)", city: r.city, state: r.state, pincode: r.pincode })));

  if (!WRITE) return rows.length;

  let written = 0;
  for (const r of rows) {
    await conn.query(
      `INSERT INTO employee_address (id, employee_id, address_type, address_line1, address_line2, city, state, pincode, country)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, 'India')`,
      [r.employee_id, addressType, (r.line1 || "").trim(), r.line2 || null, r.city, r.state, r.pincode]
    );
    written++;
  }
  console.log(`Wrote ${written} ${addressType} address row(s).`);
  return written;
}

const currentCount = await backfill("current", "present");
const permanentCount = await backfill("permanent", "permanent");

if (!WRITE) {
  console.log(`\nDRY RUN — would write ${currentCount} current + ${permanentCount} permanent address rows. Re-run with --write to apply.`);
}

await conn.end();
