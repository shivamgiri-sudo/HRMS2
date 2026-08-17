/**
 * Read-only scan: how many (candidate_id, check_type) groups in candidate_bgv_check
 * hold more than one row, broken down by check_type AND by candidate — answers
 * "is this one employee or many" before any cleanup runs.
 *
 * No writes. Run before bgv-check-duplicate-cleanup.ts to see the real scope.
 */
import { db } from "../src/db/mysql.js";

async function main() {
  const [groupCounts] = await db.execute(
    `SELECT check_type, COUNT(*) AS candidates_with_dupes, SUM(cnt) AS total_dupe_rows
       FROM (
         SELECT candidate_id, check_type, COUNT(*) AS cnt
           FROM candidate_bgv_check
          GROUP BY candidate_id, check_type
         HAVING COUNT(*) > 1
       ) t
      GROUP BY check_type
      ORDER BY total_dupe_rows DESC`
  );

  const rows = groupCounts as any[];
  if (!rows.length) {
    console.log("No duplicate (candidate_id, check_type) groups found. Nothing to clean up.");
    process.exit(0);
  }

  console.log("=== By check_type ===");
  console.log("check_type            candidates_with_dupes   total_rows_across_those_groups   extra_rows_to_remove");
  let totalExtra = 0;
  for (const r of rows) {
    const extra = Number(r.total_dupe_rows) - Number(r.candidates_with_dupes);
    totalExtra += extra;
    console.log(
      `${String(r.check_type).padEnd(22)} ${String(r.candidates_with_dupes).padEnd(23)} ${String(r.total_dupe_rows).padEnd(32)} ${extra}`
    );
  }
  console.log(`\nTotal extra rows a cleanup would remove (keeping the most-recently-updated row per group): ${totalExtra}`);

  console.log("\n=== By candidate ===");
  const [byCandidate] = await db.execute(
    `SELECT candidate_id, GROUP_CONCAT(check_type ORDER BY check_type) AS types,
            SUM(cnt) AS total_rows, SUM(cnt) - COUNT(*) AS extra_rows
       FROM (
         SELECT candidate_id, check_type, COUNT(*) AS cnt
           FROM candidate_bgv_check
          GROUP BY candidate_id, check_type
         HAVING COUNT(*) > 1
       ) t
      GROUP BY candidate_id
      ORDER BY extra_rows DESC`
  );
  const candRows = byCandidate as any[];
  const ids = candRows.map((r) => r.candidate_id);
  const placeholders = ids.map(() => "?").join(",");
  const [names] = ids.length
    ? await db.execute(
        `SELECT id, candidate_code, full_name FROM ats_candidate WHERE id IN (${placeholders})`,
        ids
      )
    : [[]];
  const nameById = new Map((names as any[]).map((n) => [n.id, n]));

  console.log(`Distinct candidates affected: ${candRows.length}`);
  for (const r of candRows) {
    const n = nameById.get(r.candidate_id);
    console.log(
      `  ${r.candidate_id}  ${n?.candidate_code ?? "?"}  ${n?.full_name ?? "?"}  ` +
      `check_types=[${r.types}]  extra_rows=${r.extra_rows}`
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Query failed:", err);
  process.exit(1);
});
