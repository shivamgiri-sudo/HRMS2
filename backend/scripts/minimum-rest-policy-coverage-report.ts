#!/usr/bin/env tsx
/**
 * Read-only minimum-rest policy coverage report — closure item #3 of the
 * 2026-08-13 roster enterprise-controls program.
 *
 * Every statement in this file is a SELECT. Nothing here writes, migrates,
 * or mutates production data — it exists specifically to give WFM/HR the
 * chance to configure policy BEFORE migration 1210_minimum_rest_policy.sql
 * is applied and the feature becomes operationally blocking, per the
 * activation sequence:
 *
 *   code -> migration certified -> migration applied -> **configure** ->
 *   **this report confirms no unexpected REST_POLICY_MISSING population** ->
 *   WFM UAT -> sign-off -> runtime activation.
 *
 * Safe to run at any time, including before migration 1210 exists at all
 * (degrades to a single informational line rather than erroring) and
 * repeatedly after each configuration change, to watch the unresolved count
 * shrink toward zero before flipping the feature live.
 *
 * Usage (from backend/):
 *   npx tsx scripts/minimum-rest-policy-coverage-report.ts
 */

import mysql from "mysql2/promise";
import "dotenv/config";

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    const [tableRows] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_rest_policy' LIMIT 1`
    );
    if (tableRows.length === 0) {
      console.log("wfm_rest_policy does not exist yet — migration 1210_minimum_rest_policy.sql has not been applied.");
      console.log("This is expected pre-activation: the minimum-rest feature is not yet turned on, and no roster");
      console.log("write path is blocking on it (see rest-policy.service.ts's isRestPolicyFeatureActive()).");
      console.log("Nothing further to report until the migration is applied.");
      return;
    }

    const [[activeCount]] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM employees WHERE active_status = 1`
    );
    console.log(`Active employees: ${activeCount.c}`);
    console.log("");

    // Correlated EXISTS subqueries rather than LEFT JOINs — a JOIN against a
    // table with (deliberately, per the schema) more than one historical
    // version per scope can fan out and inflate counts; EXISTS can't.
    const scopeExists = (alias: string, scopeType: string, scopeIdExpr: string) => `
      EXISTS (
        SELECT 1 FROM wfm_rest_policy ${alias}
         WHERE ${alias}.scope_type = '${scopeType}'
           AND ${alias}.scope_id ${scopeType === "organization" ? "IS NULL" : `<=> ${scopeIdExpr}`}
           AND ${alias}.active_status = 1
           AND ${alias}.effective_from <= CURDATE()
           AND (${alias}.effective_to IS NULL OR ${alias}.effective_to >= CURDATE())
      )`;

    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT
         CASE
           WHEN ${scopeExists("ep", "employee", "e.id")} THEN 'employee'
           WHEN ${scopeExists("pp", "process", "e.process_id")} THEN 'process'
           WHEN ${scopeExists("bp", "branch", "e.branch_id")} THEN 'branch'
           WHEN ${scopeExists("op", "organization", "")} THEN 'organization'
           ELSE 'UNRESOLVED'
         END AS resolved_tier,
         COUNT(*) AS employee_count
       FROM employees e
       WHERE e.active_status = 1
       GROUP BY resolved_tier
       ORDER BY FIELD(resolved_tier, 'employee', 'process', 'branch', 'organization', 'UNRESOLVED')`
    );

    console.log("Resolution by tier (employee > process > branch > organization > unresolved):");
    console.log("─".repeat(60));
    const tierOrder = ["employee", "process", "branch", "organization", "UNRESOLVED"];
    const byTier = new Map(rows.map((r) => [String(r.resolved_tier), Number(r.employee_count)]));
    let unresolvedCount = 0;
    for (const tier of tierOrder) {
      const count = byTier.get(tier) ?? 0;
      if (tier === "UNRESOLVED") unresolvedCount = count;
      console.log(`  ${tier.padEnd(14)} ${String(count).padStart(8)}`);
    }
    console.log("─".repeat(60));
    console.log("");

    if (unresolvedCount > 0) {
      console.log(`⚠ ${unresolvedCount} active employee(s) resolve NO minimum-rest policy at any tier.`);
      console.log("  If migration 1210 is applied while this is non-zero, every one of these employees'");
      console.log("  roster writes will hit REST_POLICY_MISSING and be blocked, with no override possible");
      console.log("  (there is no policy to override). Configure at least an organization-level default");
      console.log("  before applying the migration, or expect this count of employees to be blocked.");
    } else {
      console.log("✓ Every active employee resolves a minimum-rest policy at some tier.");
    }
    console.log("");

    // Process/branch populations with NO applicable configuration at all —
    // distinct from "no employee-specific override", this asks "if I only
    // rely on process/branch/org tiers, which processes/branches are still
    // fully dependent on the organization default (or worse, unresolved)?"
    const [processGaps] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT p.id, p.process_name, COUNT(e.id) AS active_employees
         FROM process_master p
         JOIN employees e ON e.process_id = p.id AND e.active_status = 1
        WHERE NOT ${scopeExists("pp2", "process", "p.id")}
        GROUP BY p.id, p.process_name
        ORDER BY active_employees DESC
        LIMIT 20`
    );
    if (processGaps.length > 0) {
      console.log(`Processes with no process-level policy configured (falling through to branch/org — top ${processGaps.length}):`);
      for (const row of processGaps) {
        console.log(`  ${String(row.process_name ?? row.id).padEnd(40)} ${String(row.active_employees).padStart(6)} active employees`);
      }
      console.log("");
    }

    // Expired-policy employees: had SOMETHING once, but its effective_to has
    // passed and nothing replaced it — a silent regression, not a
    // never-configured gap, and easy to miss in the tier-count summary above
    // since these employees show up as UNRESOLVED there too.
    const [[expiredCount]] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT COUNT(DISTINCT e.id) AS c
         FROM employees e
         JOIN wfm_rest_policy p
           ON (p.scope_type = 'employee' AND p.scope_id = e.id)
           OR (p.scope_type = 'process'  AND p.scope_id = e.process_id)
           OR (p.scope_type = 'branch'   AND p.scope_id = e.branch_id)
           OR (p.scope_type = 'organization' AND p.scope_id IS NULL)
        WHERE e.active_status = 1
          AND p.effective_to IS NOT NULL AND p.effective_to < CURDATE()
          AND NOT EXISTS (
            SELECT 1 FROM wfm_rest_policy p2
             WHERE p2.scope_type = p.scope_type AND p2.scope_id <=> p.scope_id
               AND p2.active_status = 1
               AND p2.effective_from <= CURDATE()
               AND (p2.effective_to IS NULL OR p2.effective_to >= CURDATE())
          )`
    );
    if (Number(expiredCount.c) > 0) {
      console.log(`⚠ ${expiredCount.c} employee(s) touch a scope whose ONLY policy row has already expired`);
      console.log("  (effective_to in the past, nothing configured to replace it) — a silent regression");
      console.log("  risk distinct from never having been configured at all.");
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("Report failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
