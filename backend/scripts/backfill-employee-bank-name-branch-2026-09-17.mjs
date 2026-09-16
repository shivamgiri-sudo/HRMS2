/**
 * One-off backfill, 2026-09-17. Companion to the address/education/experience backfills.
 *
 * The penny-drop INSERT in employee-creation-orchestrator.service.ts wrote account_number
 * and ifsc_code into employee_bank_detail, but never bank_name or bank_branch, even though
 * the real values were sitting in candidate_onboarding_bank_detail. Verified live on
 * MAS63547/63548/63553: real account_number + ifsc_code, bank_name/bank_branch both NULL.
 *
 * Matched by candidate_id, not candidate_bank_verification.bank_detail_id -- that FK is
 * NULL on every 'verified' row in production, so it never resolves the row that matters.
 *
 * Additive only: only fills bd.bank_name/bank_branch when currently blank, never overwrites.
 *
 * Usage: node backfill-employee-bank-name-branch-2026-09-17.mjs           (dry run)
 *        node backfill-employee-bank-name-branch-2026-09-17.mjs --write   (apply)
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
  SELECT bd.id AS bank_detail_id, e.employee_code, best.bank_name, best.branch_name
    FROM employees e
    JOIN employee_bank_detail bd ON bd.employee_id = e.id AND bd.is_primary = 1 AND bd.active_status = 1
    JOIN (
      SELECT cbd.*, ROW_NUMBER() OVER (
               PARTITION BY candidate_id ORDER BY created_at DESC
             ) AS rn
        FROM candidate_onboarding_bank_detail cbd
    ) best ON best.candidate_id = e.candidate_id AND best.rn = 1
   WHERE e.active_status = 1
     AND (bd.bank_name IS NULL OR bd.bank_name = '')
     AND best.bank_name <> ''
`);

// Sanity filter: a purely-numeric "bank name" is a mis-entered account/other number on the
// onboarding form, not a real bank name (found live: MAS63544 -> '925010058674878'). Skipped
// rather than propagated -- copying real data is the goal, not copying a data-entry mistake.
const numericBankName = (v) => /^\d+$/.test(String(v ?? "").trim());
const suspect = rows.filter((r) => numericBankName(r.bank_name));
const clean = rows.filter((r) => !numericBankName(r.bank_name));

console.log(`\n=== employee_bank_detail: ${clean.length} employee(s) recoverable ===`);
console.table(clean.map(r => ({ code: r.employee_code, bank_name: r.bank_name, branch: r.branch_name })));
if (suspect.length) {
  console.log(`\nSkipped ${suspect.length} row(s) with a purely-numeric "bank name" (data-entry error, not backfilled):`);
  console.table(suspect.map(r => ({ code: r.employee_code, bank_name: r.bank_name })));
}
const rowsToWrite = clean;

if (WRITE) {
  for (const r of rowsToWrite) {
    await conn.query(
      `UPDATE employee_bank_detail SET bank_name = ?, bank_branch = ? WHERE id = ?`,
      [r.bank_name, r.branch_name, r.bank_detail_id]
    );
  }
  console.log(`Updated ${rowsToWrite.length} row(s).`);
} else {
  console.log(`\nDRY RUN — would update ${rowsToWrite.length} row(s). Re-run with --write to apply.`);
}

await conn.end();
