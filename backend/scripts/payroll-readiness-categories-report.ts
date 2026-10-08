/**
 * Read-only dry run of the five payroll readiness categories.
 *
 * Prints the layered result for every active payroll month. Writes nothing — it exists so the
 * gate can be exercised against production data before anyone trusts a dashboard built on it.
 *
 *   npx tsx scripts/payroll-readiness-categories-report.ts [YYYY-MM ...]
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import {
  evaluateReadinessCategories,
  isGreen,
} from "../src/modules/payroll/payroll-readiness-categories.service.js";

const SYNTHETIC_RUN_CREATORS = ["test-auto-gen", "codex-e2e", "smoke-test", "demo-seed"];

async function activeMonths(): Promise<string[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT run_month FROM salary_prep_run
      WHERE LOWER(COALESCE(status, '')) IN ('draft', 'processing', 'calculated', 'approved')
      ORDER BY run_month DESC LIMIT 6`,
  );
  return (rows as Array<{ run_month: string }>).map((r) => r.run_month);
}

async function runIdFor(month: string): Promise<string | null> {
  const placeholders = SYNTHETIC_RUN_CREATORS.map(() => "?").join(", ");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM salary_prep_run
      WHERE run_month = ? AND LOWER(COALESCE(created_by, '')) NOT IN (${placeholders})
      ORDER BY created_at DESC LIMIT 1`,
    [month, ...SYNTHETIC_RUN_CREATORS],
  );
  return ((rows[0] as RowDataPacket | undefined)?.id as string | undefined) ?? null;
}

async function main() {
  const requested = process.argv.slice(2).filter((a) => /^\d{4}-\d{2}$/.test(a));
  const months = requested.length > 0 ? requested : await activeMonths();

  for (const month of months) {
    const runId = await runIdFor(month);
    console.log(`\n${"=".repeat(78)}\n${month}  run=${runId ?? "(none)"}\n${"=".repeat(78)}`);
    if (!runId) {
      console.log("  no non-synthetic run for this month");
      continue;
    }
    const result = await evaluateReadinessCategories(runId);
    console.log(
      `  canPay=${result.canPay}  version=${result.governanceVersion}  ` +
        `P0=${result.summary.p0} P1=${result.summary.p1} P2=${result.summary.p2} ` +
        `checkErrors=${result.summary.checkErrors} sourceMissing=${result.summary.sourceMissing}`,
    );
    console.log("\n  LAYERS");
    for (const layer of result.layers) {
      console.log(
        `    ${layer.layer.padEnd(26)} ${layer.state.padEnd(15)} ` +
          `checks=${String(layer.checks).padStart(2)} notGreen=${String(layer.failed).padStart(2)} ` +
          `P0=${layer.p0} P1=${layer.p1} employees=${layer.affectedEmployees}`,
      );
    }
    console.log("\n  CHECKS");
    for (const c of result.checks) {
      const mark = isGreen(c.state) ? " " : "!";
      console.log(`  ${mark} [${c.severity}] ${c.code.padEnd(46)} ${c.state.padEnd(15)} n=${c.affectedEmployees}`);
      if (!isGreen(c.state)) console.log(`      ${c.message}`);
    }
  }

  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
