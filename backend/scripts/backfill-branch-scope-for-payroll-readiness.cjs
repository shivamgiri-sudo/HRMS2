/**
 * Backfill the branch scope that payroll readiness needs.
 *
 * /payroll/readiness?scope=branch resolves the caller's branch from
 * user_assignment_scope. Two gaps stop branch-side roles from ever reaching
 * their own branch:
 *
 *   GAP A  scope_type='process' rows carry branch_id = NULL (all 20 of them).
 *          payroll-process-readiness.routes.ts my-pending-count reads that NULL
 *          straight into getOrRefresh(month, null, processId), which is what
 *          creates the orphan payroll_branch_readiness rows with an empty
 *          branch_id (6 in 2026-08, 11 in 2026-07).
 *
 *   GAP B  wfm / branch_head / process_manager / payroll_branch users with no
 *          branch-bearing scope row at all. They land on "No branch is assigned
 *          to your account" and cannot tick anything.
 *
 * Both are derivable from mas_hrms alone. Precedence for a process row is the
 * process's own branch (process_master.branch_id) and then the user's employee
 * branch; a new branch scope row always comes from the user's employee branch.
 *
 * THE TWO GAPS CARRY DIFFERENT RISK — that is why --only exists:
 *
 *   GAP B is strictly additive. hasScopedAccess ORs over the caller's scope rows
 *   and returns on the first match (scope_type='all' short-circuits true), so an
 *   extra branch row can only ever grant, never revoke.
 *
 *   GAP A NARROWS. A process row matches when
 *     (!scope.branch_id || !target.branchId || scope.branch_id === target.branchId)
 *   so today's NULL branch_id makes that clause pass for EVERY target branch.
 *   Filling it in pins the user to one branch. That is what a process scope is
 *   supposed to mean and it closes the orphan-row bug, but for the genuinely
 *   multi-branch processes (BACK OFFICE, DIALDESK, PRE TO POST CONVERSION,
 *   CUSTOMER ACQUISITION — all four have a NULL process_master.branch_id, which
 *   is exactly why their rows resolve "from employee") it can deny a
 *   cross-branch target the user reaches today. Decide that one deliberately.
 *
 * READ-ONLY by default. Pass --apply plus --only to write.
 *
 *   node scripts/backfill-branch-scope-for-payroll-readiness.cjs
 *   node scripts/backfill-branch-scope-for-payroll-readiness.cjs --apply --only=b
 */
const mysql = require("mysql2/promise");
require("dotenv").config();

const APPLY = process.argv.includes("--apply");
// --only=a / --only=b. The two gaps are NOT equally safe (see header), so an
// apply run must name the one it means.
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1] || "";
const DO_A = !ONLY || ONLY === "a";
const DO_B = !ONLY || ONLY === "b";
const BRANCH_SIDE_ROLES = ["wfm", "branch_head", "process_manager", "payroll_branch"];

function table(rows, cols) {
  if (!rows.length) return "    (none)";
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)));
  const line = (vals) => "    " + vals.map((v, i) => String(v ?? "").padEnd(w[i])).join("  ");
  return [line(cols), line(w.map((n) => "-".repeat(n))), ...rows.map((r) => line(cols.map((c) => r[c])))].join("\n");
}

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
  });
  const q = async (sql, p = []) => (await c.execute(sql, p))[0];

  console.log(`\n=== Branch scope backfill for payroll readiness — ${APPLY ? "APPLY" : "DRY RUN"} ===`);
  console.log(`    db: ${process.env.DB_NAME} @ ${process.env.DB_HOST}\n`);

  const roleList = BRANCH_SIDE_ROLES.map(() => "?").join(",");

  // ── GAP A ────────────────────────────────────────────────────────────────
  // employees carries two candidate links to auth_user; both are populated on
  // the same 1,478 rows, so either resolves — join on both to be safe.
  const gapA = await q(
    `SELECT uas.id, au.email, uas.role_key, pr.process_name,
            pr.branch_id                         AS process_branch,
            emp.branch_id                        AS employee_branch,
            COALESCE(NULLIF(pr.branch_id,''), NULLIF(emp.branch_id,'')) AS resolved_branch,
            bm.branch_name                       AS resolved_branch_name,
            CASE
              WHEN pr.branch_id IS NULL AND emp.branch_id IS NULL THEN 'UNRESOLVED'
              WHEN pr.branch_id IS NOT NULL AND emp.branch_id IS NOT NULL
               AND CONVERT(pr.branch_id USING utf8mb4) <> CONVERT(emp.branch_id USING utf8mb4) THEN 'CONFLICT'
              WHEN pr.branch_id IS NOT NULL THEN 'from process'
              ELSE 'from employee'
            END AS source
       FROM user_assignment_scope uas
       JOIN auth_user au        ON au.id = uas.user_id
       LEFT JOIN process_master pr ON CONVERT(pr.id USING utf8mb4) = CONVERT(uas.process_id USING utf8mb4)
       LEFT JOIN employees emp  ON emp.auth_user_id = uas.user_id OR emp.user_id = uas.user_id
       LEFT JOIN branch_master bm
              ON CONVERT(bm.id USING utf8mb4)
               = CONVERT(COALESCE(NULLIF(pr.branch_id,''), NULLIF(emp.branch_id,'')) USING utf8mb4)
      WHERE uas.active_status = 1
        AND uas.scope_type IN ('process','branch_process')
        AND (uas.branch_id IS NULL OR uas.branch_id = '')
      ORDER BY source, au.email`
  );

  console.log(`GAP A — process scopes missing branch_id: ${gapA.length}`);
  console.log(table(gapA, ["email", "role_key", "process_name", "source", "resolved_branch_name"]));
  const aFix = gapA.filter((r) => r.resolved_branch);
  const aStuck = gapA.filter((r) => !r.resolved_branch);
  console.log(`\n    resolvable: ${aFix.length}   unresolved: ${aStuck.length}` +
              `   conflicts: ${gapA.filter((r) => r.source === "CONFLICT").length}\n`);

  // ── GAP B ────────────────────────────────────────────────────────────────
  const gapB = await q(
    `SELECT ur.user_id, au.email, ur.role_key, emp.employee_code,
            emp.branch_id AS resolved_branch, bm.branch_name AS resolved_branch_name,
            (SELECT GROUP_CONCAT(DISTINCT s.scope_type) FROM user_assignment_scope s
              WHERE s.user_id = ur.user_id AND s.active_status = 1) AS current_scopes
       FROM user_roles ur
       JOIN auth_user au       ON au.id = ur.user_id
       LEFT JOIN employees emp ON emp.auth_user_id = ur.user_id OR emp.user_id = ur.user_id
       LEFT JOIN branch_master bm
              ON CONVERT(bm.id USING utf8mb4) = CONVERT(emp.branch_id USING utf8mb4)
      WHERE ur.active_status = 1
        AND ur.role_key IN (${roleList})
        AND NOT EXISTS (
              SELECT 1 FROM user_assignment_scope s
               WHERE s.user_id = ur.user_id AND s.active_status = 1
                 AND s.branch_id IS NOT NULL AND s.branch_id <> '')
      ORDER BY ur.role_key, au.email`,
    BRANCH_SIDE_ROLES
  );

  console.log(`GAP B — branch-side users with no branch scope: ${gapB.length}`);
  console.log(table(gapB, ["email", "role_key", "employee_code", "current_scopes", "resolved_branch_name"]));
  const bFix = gapB.filter((r) => r.resolved_branch);
  const bStuck = gapB.filter((r) => !r.resolved_branch);
  console.log(`\n    resolvable: ${bFix.length}   unresolved: ${bStuck.length}\n`);

  if (!APPLY) {
    console.log("DRY RUN — nothing written. To write:");
    console.log(`  · --apply --only=b  → INSERT ${bFix.length} scope_type='branch' rows   (additive, safe)`);
    console.log(`  · --apply --only=a  → UPDATE ${aFix.length} process rows branch_id      (NARROWS access — read the header)`);
    console.log("");
    await c.end();
    return;
  }

  await c.beginTransaction();
  try {
    let updated = 0;
    for (const r of (DO_A ? aFix : [])) {
      const [res] = await c.execute(
        `UPDATE user_assignment_scope SET branch_id = ? WHERE id = ? AND (branch_id IS NULL OR branch_id = '')`,
        [r.resolved_branch, r.id]
      );
      updated += res.affectedRows;
    }

    let inserted = 0;
    for (const r of (DO_B ? bFix : [])) {
      // Additive only: a new branch row never removes the 'all' scope some of
      // these users already hold, so nobody loses access — they gain a branch
      // the readiness page can default to.
      const [res] = await c.execute(
        `INSERT INTO user_assignment_scope (id, user_id, role_key, scope_type, branch_id, active_status, created_at)
         SELECT UUID(), ?, ?, 'branch', ?, 1, NOW()
          WHERE NOT EXISTS (
            SELECT 1 FROM (SELECT * FROM user_assignment_scope) s
             WHERE s.user_id = ? AND s.role_key = ? AND s.scope_type = 'branch'
               AND CONVERT(s.branch_id USING utf8mb4) = CONVERT(? USING utf8mb4))`,
        [r.user_id, r.role_key, r.resolved_branch, r.user_id, r.role_key, r.resolved_branch]
      );
      inserted += res.affectedRows;
    }

    await c.commit();
    console.log(`APPLIED — updated ${updated} scope rows, inserted ${inserted} branch scope rows.`);
    if (aStuck.length || bStuck.length) {
      console.log(`SKIPPED — ${aStuck.length + bStuck.length} rows had no derivable branch; listed above.`);
    }
  } catch (e) {
    await c.rollback();
    console.error("ROLLED BACK —", e.message);
    process.exitCode = 1;
  }

  await c.end();
})();
