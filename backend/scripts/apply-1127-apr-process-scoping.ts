/**
 * Applies backend/sql/1127_scope_apr_eligibility_by_process.sql inside one transaction,
 * verifies the counts its header specifies, and commits only if every check passes.
 *
 * WHY A SCRIPT RATHER THAN PIPING THE FILE INTO mysql
 *
 * 1127 is deliberately absent from MIGRATION_MANIFEST, so `npm run migrate` will not
 * apply it — registering it is the go-live action and needs sign-off. Piping the file
 * into a mysql client would apply it with no verification and no way back if the counts
 * come out wrong. This runs the same statements, checks the result, and rolls back
 * rather than leaving the config half-changed.
 *
 * WHAT IT CHANGES
 *
 * apr_eligibility_config's four active rules pin a designation and department but leave
 * process_id NULL, and isAprEligible() returns true on ANY match, so they reach every
 * process in the company. Measured on mas_hrms 2026-08-11: of 828 active employees
 * classified as dialler agents, 15 processes carry real APR adoption and 15 others have
 * zero APR history ever — 472 employees, not one of whom has ever had a row in `apr`,
 * while the feed itself is healthy. Those 472 are judged against a feed they never
 * appear in, which resolves to missing_punch, which pays zero.
 *
 * This replaces the four unscoped rules with 60 process-scoped ones. It does not touch
 * the ruling that Operations Executives are judged on APR alone — that governs HOW a
 * dialler agent is judged; this changes only WHO is one. No engine, payroll or threshold
 * logic is altered, and existing attendance rows are NOT rewritten: it changes future
 * processing only. Re-process afterwards to materialise the effect.
 *
 * SAFETY
 *
 * Dry run by default — runs the statements, prints the verification, then ROLLS BACK.
 * Pass --apply to commit. Either way the checks are the same:
 *   60 active process-scoped rules, 0 active unscoped rules, the nine known
 *   process-less dialler agents still eligible.
 * Any mismatch rolls back and nothing changes.
 *
 *   npx tsx scripts/apply-1127-apr-process-scoping.ts            # dry run
 *   npx tsx scripts/apply-1127-apr-process-scoping.ts --apply    # commit
 *
 * Rollback after a commit is in the SQL file's own header.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../src/db/mysql.js";

const APPLY = process.argv.includes("--apply");
const SQL_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "sql",
  "1127_scope_apr_eligibility_by_process.sql",
);

/** Employees the live config would treat as dialler agents. */
const ELIGIBLE_SQL = `
  SELECT COUNT(*) AS n FROM employees e
   WHERE LOWER(e.employment_status) = 'active'
     AND EXISTS (
       SELECT 1 FROM apr_eligibility_config c
        WHERE c.active_status = 1
          AND (c.designation_id = e.designation_id OR c.designation_id IS NULL)
          AND (c.department_id  = e.department_id  OR c.department_id  IS NULL)
          AND (c.process_id     = e.process_id     OR c.process_id     IS NULL))`;

/** The nine that had no process until 2026-08-11; all must stay eligible. */
const NINE = [
  "MAS62901", "MAS62903", "MAS62905", "MAS62906", "MAS62907",
  "MAS62908", "MAS62909", "MAS62910", "MAS62913",
];

function statementsFrom(file: string): string[] {
  // Strip full-line -- comments first: the header's rollback notes contain semicolons
  // and would otherwise split into bogus statements.
  const stripped = fs.readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  return stripped.split(";").map((s) => s.trim()).filter(Boolean);
}

(async () => {
  const conn = await db.getConnection();
  const count = async (sql: string, params: unknown[] = []): Promise<number> => {
    const [rows]: any = await conn.query(sql, params);
    return Number(Object.values(rows[0])[0]);
  };

  try {
    const before = await count(ELIGIBLE_SQL);
    console.log(`mode                    : ${APPLY ? "APPLY" : "DRY RUN (will roll back)"}`);
    console.log(`BEFORE apr-eligible     : ${before}`);

    const stmts = statementsFrom(SQL_FILE);
    console.log(`statements in 1127      : ${stmts.length}`);

    await conn.beginTransaction();
    for (const [i, s] of stmts.entries()) {
      const [r]: any = await conn.query(s);
      console.log(`  statement ${i + 1}: affectedRows=${r?.affectedRows ?? 0}`);
    }

    const scoped = await count(
      "SELECT COUNT(*) n FROM apr_eligibility_config WHERE active_status=1 AND process_id IS NOT NULL");
    const unscoped = await count(
      "SELECT COUNT(*) n FROM apr_eligibility_config WHERE active_status=1 AND process_id IS NULL");
    const after = await count(ELIGIBLE_SQL);
    const nine = await count(
      `SELECT COUNT(*) n FROM employees e
        WHERE e.employee_code IN (${NINE.map(() => "?").join(",")})
          AND EXISTS (SELECT 1 FROM apr_eligibility_config c
                       WHERE c.active_status=1
                         AND (c.designation_id=e.designation_id OR c.designation_id IS NULL)
                         AND (c.department_id =e.department_id  OR c.department_id  IS NULL)
                         AND (c.process_id    =e.process_id     OR c.process_id     IS NULL))`,
      NINE,
    );

    const ok = scoped === 60 && unscoped === 0 && nine === 9;
    console.log("\n--- verification (inside transaction) ---");
    console.log(`  scoped active rules   : ${scoped}   ${scoped === 60 ? "OK" : "FAIL"} (expect 60)`);
    console.log(`  unscoped active rules : ${unscoped}   ${unscoped === 0 ? "OK" : "FAIL"} (expect 0)`);
    console.log(`  the nine still eligible: ${nine}   ${nine === 9 ? "OK" : "FAIL"} (expect 9)`);
    console.log(`  apr-eligible after    : ${after}  (was ${before}; moved off = ${before - after})`);

    if (ok && APPLY) {
      await conn.commit();
      console.log("\n*** COMMITTED ***");
      console.log("Existing attendance rows are unchanged. Re-process to materialise:");
      console.log("  npx tsx scripts/cosec-sync-backfill.ts <from> <to>");
    } else {
      await conn.rollback();
      console.log(ok
        ? "\nDRY RUN — rolled back. Re-run with --apply to commit."
        : "\n*** ROLLED BACK — a check failed, nothing changed ***");
    }
  } catch (e: any) {
    await conn.rollback();
    console.error("ERROR -> ROLLED BACK:", e?.message ?? e);
    process.exitCode = 1;
  } finally {
    conn.release();
    await db.end();
  }
})();
