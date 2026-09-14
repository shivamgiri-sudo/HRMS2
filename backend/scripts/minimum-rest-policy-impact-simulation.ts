#!/usr/bin/env tsx
/**
 * Read-only minimum-rest policy impact simulation — required by the
 * 2026-08-13 production-control incident's resolution path before any
 * org-level wfm_rest_policy row is inserted (see
 * docs/incidents/2026-08-13-rest-policy-tables-out-of-band.md).
 *
 * wfm_rest_policy and wfm_rest_override_log already exist in production
 * (created out of band, 0 rows) — see that incident doc. The currently
 * running backend predates rest-policy enforcement entirely, so nothing is
 * blocking today. But the moment any build containing rest-policy.service.ts
 * is deployed, the table's mere existence makes REST_POLICY_MISSING live for
 * every employee until a policy is configured, and whatever value is then
 * configured immediately starts producing REST_GAP blocks of its own. A
 * policy value is therefore a decision with real operational consequences,
 * not a default to pick casually — this script exists to make those
 * consequences visible BEFORE anyone approves a number.
 *
 * Every statement here is a SELECT. Nothing is written — not to
 * wfm_rest_policy, not to wfm_rest_override_log, not anywhere.
 *
 * What it measures: for every candidate minimum-rest value you pass in, how
 * many already-published roster shift-pairs (in the existing
 * wfm_roster_assignment history) have an actual rest gap below that
 * candidate — using the EXACT SAME gap arithmetic as
 * rest-policy.service.ts's restGapMinutes()/findAdjacentShifts() (plain
 * date+time construction per shift, no overnight-rollover inference — this
 * intentionally mirrors production logic rather than "fixing" it here).
 *
 * Caveat, stated plainly: there is no future-dated roster data to simulate
 * against (the latest published roster_date in production is 2026-07-18,
 * against today 2026-08-13 — WFM generation has been paused through this
 * program's closure work). This therefore measures retrospective friction
 * against the full historical roster ("if this value had been enforced all
 * along, how often would it have blocked"), which is the best available
 * proxy for real-world friction until fresh generation resumes under UAT.
 * The report says this explicitly rather than implying it covers future
 * assignments it cannot see.
 *
 * Usage (from backend/):
 *   npx tsx scripts/minimum-rest-policy-impact-simulation.ts <minutes> [minutes2] [minutes3] ...
 *   e.g. npx tsx scripts/minimum-rest-policy-impact-simulation.ts 480 660 720
 *   (simulates multiple candidate values in one pass, so WFM/Ops can compare
 *   options side by side instead of re-running per value)
 */

import mysql from "mysql2/promise";
import "dotenv/config";

async function main() {
  const candidateMinutesArgs = process.argv.slice(2).map(Number);
  if (candidateMinutesArgs.length === 0 || candidateMinutesArgs.some((n) => !Number.isFinite(n) || n <= 0)) {
    console.error("Usage: npx tsx scripts/minimum-rest-policy-impact-simulation.ts <minutes> [minutes2] ...");
    console.error("Example: npx tsx scripts/minimum-rest-policy-impact-simulation.ts 480 660 720");
    process.exit(2);
  }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    const [[activeCount]] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM employees WHERE active_status = 1`
    );
    const [[dataWindow]] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT MIN(roster_date) AS mn, MAX(roster_date) AS mx, COUNT(*) AS c
         FROM wfm_roster_assignment WHERE is_week_off = 0`
    );

    console.log(`Active employees today: ${activeCount.c}`);
    console.log(
      `Historical roster data evaluated: ${dataWindow.c} worked shift-rows, ${String(dataWindow.mn).slice(0, 10)} .. ${String(dataWindow.mx).slice(0, 10)}`
    );
    console.log(
      "NOTE: no future-dated roster rows exist (latest published roster_date is in the past relative to today) —"
    );
    console.log("this simulation is retrospective ('if this value had always applied'), not a forecast of pending work.");
    console.log("");

    // Consecutive worked shift-pairs per employee, gap computed with the exact
    // same date+time construction as rest-policy.service.ts's
    // restGapMinutes() — plain TIMESTAMP(date, time) per side, no
    // overnight-rollover inference, matching production's own model exactly.
    const [gapRows] = await conn.execute<mysql.RowDataPacket[]>(
      `WITH ordered AS (
         SELECT employee_id, roster_date, shift_start_time, branch_name, process_name,
                LAG(roster_date) OVER (PARTITION BY employee_id ORDER BY roster_date) AS prev_date,
                LAG(shift_end_time) OVER (PARTITION BY employee_id ORDER BY roster_date) AS prev_end_time
           FROM wfm_roster_assignment
          WHERE is_week_off = 0 AND shift_start_time IS NOT NULL AND shift_end_time IS NOT NULL
       )
       SELECT employee_id, roster_date, branch_name, process_name,
              TIMESTAMPDIFF(MINUTE, TIMESTAMP(prev_date, prev_end_time), TIMESTAMP(roster_date, shift_start_time)) AS gap_minutes
         FROM ordered
        WHERE prev_date IS NOT NULL`
    );
    console.log(`Consecutive worked shift-pairs evaluated: ${gapRows.length}`);
    console.log("─".repeat(72));

    for (const minutes of candidateMinutesArgs) {
      const violations = gapRows.filter((r) => Number(r.gap_minutes) < minutes);
      const affectedEmployees = new Set(violations.map((r) => String(r.employee_id)));

      console.log(`\nCandidate minimum_rest_minutes = ${minutes} (${(minutes / 60).toFixed(1)}h)`);
      console.log(
        `  Violating shift-pairs: ${violations.length} / ${gapRows.length} (${((violations.length / gapRows.length) * 100).toFixed(2)}%)`
      );
      console.log(
        `  Distinct employees with >=1 violation: ${affectedEmployees.size} / ${activeCount.c} active employees`
      );

      if (violations.length > 0) {
        const byProcess = new Map<string, number>();
        const byBranch = new Map<string, number>();
        for (const v of violations) {
          const p = String(v.process_name ?? "(none)");
          const b = String(v.branch_name ?? "(none)");
          byProcess.set(p, (byProcess.get(p) ?? 0) + 1);
          byBranch.set(b, (byBranch.get(b) ?? 0) + 1);
        }
        const topProcess = [...byProcess.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
        const topBranch = [...byBranch.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

        console.log(`  Top processes by violation count:`);
        for (const [name, count] of topProcess) console.log(`    ${name.padEnd(40)} ${String(count).padStart(6)}`);
        console.log(`  Top branches by violation count:`);
        for (const [name, count] of topBranch) console.log(`    ${name.padEnd(40)} ${String(count).padStart(6)}`);

        const worst = [...violations].sort((a, b) => Number(a.gap_minutes) - Number(b.gap_minutes))[0];
        console.log(
          `  Worst observed gap: ${worst.gap_minutes} minute(s) (employee ${worst.employee_id}, ${String(worst.roster_date).slice(0, 10)})`
        );
        console.log(
          `  With allows_emergency_override=false, every one of these ${violations.length} pairs would have been a hard, unpublishable block.`
        );
        console.log(
          `  With allows_emergency_override=true, each still requires an individual reason + approver at publish time — not a silent pass.`
        );
      } else {
        console.log(`  ✓ No historical violations at this threshold.`);
      }
    }
    console.log("\n" + "─".repeat(72));
    console.log("Read-only simulation complete. No wfm_rest_policy or wfm_rest_override_log row was written.");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("Simulation failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
