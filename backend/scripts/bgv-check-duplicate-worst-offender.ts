/**
 * Read-only: show the row-level timeline for the worst duplicate offenders per
 * check_type, to see whether duplication looks historical (one-time event, safe
 * to clean up) or still actively happening (root cause unfixed, cleanup would
 * just refill).
 */
import { db } from "../src/db/mysql.js";

async function main() {
  const [worst] = await db.execute(
    `SELECT candidate_id, check_type, COUNT(*) AS cnt
       FROM candidate_bgv_check
      GROUP BY candidate_id, check_type
     HAVING COUNT(*) > 1
      ORDER BY cnt DESC
      LIMIT 6`
  );

  for (const row of worst as any[]) {
    console.log(`\n=== candidate=${row.candidate_id} check_type=${row.check_type} (${row.cnt} rows) ===`);
    const [detail] = await db.execute(
      `SELECT id, status, provider_key, created_at, updated_at
         FROM candidate_bgv_check
        WHERE candidate_id = ? AND check_type = ?
        ORDER BY created_at ASC`,
      [row.candidate_id, row.check_type]
    );
    for (const d of detail as any[]) {
      console.log(`  ${d.id}  status=${d.status}  provider=${d.provider_key}  created=${d.created_at}  updated=${d.updated_at}`);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Query failed:", err);
  process.exit(1);
});
