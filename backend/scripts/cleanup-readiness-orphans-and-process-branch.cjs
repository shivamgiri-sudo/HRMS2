/**
 * Two leftovers from the payroll-readiness branch-scope work.
 *
 *   FIX 1  17 orphan payroll_branch_readiness rows (6 in 2026-08, 11 in 2026-07)
 *          carry a process_id but an empty branch_id. They were seeded by
 *          my-pending-count calling getOrRefresh(month, uas.branch_id, processId)
 *          back when every scope_type='process' row had a NULL branch_id. That
 *          source is fixed, so no new ones can appear.
 *
 *          Every one of them is provably empty: readiness_score 0.00,
 *          readiness_status 'not_started', employee_count 0. Four of the six
 *          2026-08 rows also duplicate a properly-branched twin for the same
 *          (month, process). They hold no sign-off, no projection, no checklist
 *          state — deleting them loses nothing, and the guard below re-asserts
 *          that per row rather than trusting this comment.
 *
 *   FIX 2  process_master.branch_id is NULL on 94 of 132 rows (25 of 54 active).
 *          NULL is the NORM in this table, not a defect — a process legitimately
 *          spans branches, and the branch of record lives on the employee. So
 *          this does NOT bulk-fill the column.
 *
 *          It fills only the unambiguous case: an ACTIVE process whose active
 *          staff sit in exactly ONE branch. BACK OFFICE and BSS-OTHERS are
 *          deliberately skipped — 4 branches each, so any single branch_id would
 *          be wrong. Processes with zero staff are skipped: nothing to derive.
 *
 *          Only two queries join on this column
 *          (org.service.ts:324, reporting.service.ts:31 —
 *          `LEFT JOIN process_master p ON p.branch_id = b.id AND p.active_status = 1`),
 *          both counting processes per branch, and both currently under-report.
 *
 * READ-ONLY by default. --apply to write, --only=orphans / --only=process to
 * split them.
 */
const mysql = require("mysql2/promise");
const fs = require("fs");
require("dotenv").config();

const APPLY = process.argv.includes("--apply");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1] || "";
const DO_ORPHANS = !ONLY || ONLY === "orphans";
const DO_PROCESS = !ONLY || ONLY === "process";
const ROLLBACK = process.argv.find((a) => a.startsWith("--rollback-out="))?.split("=")[1];

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
  });
  const q = async (sql, p = []) => (await c.execute(sql, p))[0];

  console.log(`\n=== Readiness orphans + process branch — ${APPLY ? "APPLY" : "DRY RUN"} ===`);
  console.log(`    db: ${process.env.DB_NAME} @ ${process.env.DB_HOST}\n`);

  // ── FIX 1: orphan readiness rows ─────────────────────────────────────────
  // The WHERE clause is the safety guard, not a filter: it will not match a row
  // that carries any state, so a row that gained a score or a sign-off since the
  // dry run simply falls out of scope instead of being deleted.
  const ORPHAN_PREDICATE = `
       (branch_id IS NULL OR branch_id = '')
   AND process_id <> ''
   AND COALESCE(readiness_score, 0) = 0
   AND readiness_status = 'not_started'
   AND COALESCE(employee_count, 0) = 0
   AND COALESCE(branch_head_signoff, 0) = 0
   AND COALESCE(process_manager_signoff, 0) = 0
   AND COALESCE(ho_override_ready, 0) = 0
   AND projected_gross IS NULL
   AND projected_net IS NULL`;

  const orphans = await q(
    `SELECT id, process_month, process_id FROM payroll_branch_readiness WHERE ${ORPHAN_PREDICATE}`
  );
  const anyOrphanShaped = await q(
    `SELECT COUNT(*) n FROM payroll_branch_readiness
      WHERE (branch_id IS NULL OR branch_id = '') AND process_id <> ''`
  );
  console.log(`FIX 1 — orphan readiness rows: ${anyOrphanShaped[0].n} total, ${orphans.length} provably empty and deletable`);
  if (anyOrphanShaped[0].n !== orphans.length) {
    console.log(`    !! ${anyOrphanShaped[0].n - orphans.length} orphan-shaped row(s) carry state — NOT deleting those, inspect by hand`);
  }

  // ── FIX 2: unambiguous process_master.branch_id ──────────────────────────
  const procFix = await q(
    `SELECT pm.id, pm.process_name, MIN(e.branch_id) AS derived_branch,
            MIN(b.branch_name) AS branch_name, COUNT(e.id) AS active_emp
       FROM process_master pm
       JOIN employees e
         ON CONVERT(e.process_id USING utf8mb4) = CONVERT(pm.id USING utf8mb4)
        AND e.active_status = 1 AND e.branch_id IS NOT NULL AND e.branch_id <> ''
       LEFT JOIN branch_master b
         ON CONVERT(b.id USING utf8mb4) = CONVERT(e.branch_id USING utf8mb4)
      WHERE (pm.branch_id IS NULL OR pm.branch_id = '')
        AND pm.active_status = 1
      GROUP BY pm.id, pm.process_name
     HAVING COUNT(DISTINCT e.branch_id) = 1
      ORDER BY pm.process_name`
  );
  console.log(`\nFIX 2 — active processes with staff in exactly one branch: ${procFix.length}`);
  for (const r of procFix) {
    console.log(`    ${String(r.process_name).padEnd(32)} -> ${r.branch_name}  (${r.active_emp} staff)`);
  }

  const skipped = await q(
    `SELECT pm.process_name, COUNT(DISTINCT e.branch_id) n_branches
       FROM process_master pm
       JOIN employees e
         ON CONVERT(e.process_id USING utf8mb4) = CONVERT(pm.id USING utf8mb4)
        AND e.active_status = 1 AND e.branch_id IS NOT NULL AND e.branch_id <> ''
      WHERE (pm.branch_id IS NULL OR pm.branch_id = '') AND pm.active_status = 1
      GROUP BY pm.id, pm.process_name HAVING COUNT(DISTINCT e.branch_id) > 1`
  );
  console.log(`\n    deliberately SKIPPED (genuinely multi-branch, no single correct value):`);
  for (const r of skipped) console.log(`    ${r.process_name} — ${r.n_branches} branches`);
  console.log(`    also skipped: active processes with zero staff (nothing to derive) and all inactive rows\n`);

  if (!APPLY) {
    console.log("DRY RUN — nothing written. To write:");
    console.log(`  · --apply --only=orphans  → DELETE ${orphans.length} empty readiness rows`);
    console.log(`  · --apply --only=process  → UPDATE ${procFix.length} process_master.branch_id`);
    await c.end();
    return;
  }

  // Rollback file is written BEFORE the transaction so a crash still leaves it.
  if (ROLLBACK) {
    const lines = [`-- Rollback, ${new Date().toISOString()}`];
    if (DO_ORPHANS && orphans.length) {
      const full = await q(
        `SELECT * FROM payroll_branch_readiness WHERE ${ORPHAN_PREDICATE}`
      );
      lines.push(`-- ${full.length} deleted payroll_branch_readiness rows, as INSERTs:`);
      for (const row of full) {
        const cols = Object.keys(row);
        const vals = cols.map((k) => (row[k] === null ? "NULL" : `'${String(row[k]).replace(/'/g, "''")}'`));
        lines.push(`INSERT INTO payroll_branch_readiness (${cols.join(",")}) VALUES (${vals.join(",")});`);
      }
    }
    if (DO_PROCESS && procFix.length) {
      lines.push(`-- restore process_master.branch_id to NULL:`);
      lines.push(`UPDATE process_master SET branch_id = NULL WHERE id IN (${procFix.map((r) => `'${r.id}'`).join(",")});`);
    }
    fs.writeFileSync(ROLLBACK, lines.join("\n") + "\n");
    console.log(`rollback written: ${ROLLBACK}`);
  }

  await c.beginTransaction();
  try {
    let deleted = 0;
    if (DO_ORPHANS) {
      // Re-runs the guard as part of the DELETE — never deletes by id alone.
      const [res] = await c.execute(`DELETE FROM payroll_branch_readiness WHERE ${ORPHAN_PREDICATE}`);
      deleted = res.affectedRows;
    }

    let updated = 0;
    if (DO_PROCESS) {
      for (const r of procFix) {
        const [res] = await c.execute(
          `UPDATE process_master SET branch_id = ? WHERE id = ? AND (branch_id IS NULL OR branch_id = '')`,
          [r.derived_branch, r.id]
        );
        updated += res.affectedRows;
      }
    }

    await c.commit();
    console.log(`\nAPPLIED — deleted ${deleted} orphan readiness rows, set branch_id on ${updated} processes.`);
  } catch (e) {
    await c.rollback();
    console.error("ROLLED BACK —", e.message);
    process.exitCode = 1;
  }

  await c.end();
})();
