/**
 * Read-only scan: how many (candidate_id, check_type) groups in candidate_bgv_check
 * hold more than one row, broken down by check_type.
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

  console.log("check_type            candidates_with_dupes   total_rows_across_those_groups   extra_rows_to_remove");
  let totalExtra = 0;
  for (const r of rows) {
    const extra = Number(r.total_dupe_rows) - Number(r.candidates_with_dupes); // keep 1 per group
    totalExtra += extra;
    console.log(
      `${String(r.check_type).padEnd(22)} ${String(r.candidates_with_dupes).padEnd(23)} ${String(r.total_dupe_rows).padEnd(32)} ${extra}`
    );
  }
  console.log(`\nTotal extra rows a cleanup would remove (keeping the most-recently-updated row per group): ${totalExtra}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Query failed:", err);
  process.exit(1);
});
