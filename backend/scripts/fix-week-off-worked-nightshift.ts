/**
 * Targeted reprocess of all Aug 2026 attendance_daily_record rows that have
 * attendance_status = 'week_off_worked' and are not locked.
 *
 * The night-shift cross-midnight guard was added to G12 in attendance-engine.service.ts.
 * This script finds every affected employee+date and reprocesses only those rows so the
 * fix takes effect without running a full month sweep (~8+ hours).
 *
 * Usage:
 *   npx tsx scripts/fix-week-off-worked-nightshift.ts [--dry-run]
 *   npx tsx scripts/fix-week-off-worked-nightshift.ts --month 2026-08
 */
import { db } from "../src/db/mysql.js";
import { attendanceEngineService } from "../src/modules/wfm/attendance-engine.service.js";

const isDryRun = process.argv.includes("--dry-run");
const monthArg = (() => {
  const i = process.argv.indexOf("--month");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : "2026-08";
})();

const CONCURRENCY = 4; // parallel slots — keep DB load moderate

async function runConcurrent<T>(items: T[], fn: (item: T) => Promise<void>) {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor++];
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

(async () => {
  const startDate = `${monthArg}-01`;
  const endDate   = `${monthArg}-31`;

  const [rows] = await db.execute<any[]>(
    `SELECT adr.id, adr.employee_id, adr.record_date, adr.attendance_status, adr.is_locked
     FROM attendance_daily_record adr
     WHERE adr.record_date BETWEEN ? AND ?
       AND adr.attendance_status = 'week_off_worked'
       AND adr.is_locked = 0
     ORDER BY adr.record_date, adr.employee_id`,
    [startDate, endDate]
  );

  console.log(`Found ${rows.length} unlocked week_off_worked records for ${monthArg}.`);
  if (isDryRun) {
    console.log("DRY RUN — printing affected records, not reprocessing.");
    for (const r of rows) {
      console.log(`  ${r.record_date}  employee_id=${r.employee_id}`);
    }
    await db.end();
    return;
  }

  const results = { fixed: 0, unchanged: 0, failed: 0, errors: [] as string[] };

  await runConcurrent(rows, async (row) => {
    try {
      const result = await attendanceEngineService.processEmployee(
        row.employee_id,
        row.record_date
      );
      if (result.status !== "week_off_worked") {
        results.fixed++;
        console.log(`  FIXED  ${row.record_date}  ${row.employee_id}  → ${result.status}  (was week_off_worked)`);
      } else {
        results.unchanged++;
        // Still week_off_worked — may be genuinely worked day
        console.log(`  KEPT   ${row.record_date}  ${row.employee_id}  → week_off_worked (genuine)`);
      }
    } catch (e: any) {
      results.failed++;
      results.errors.push(`${row.record_date}/${row.employee_id}: ${e?.message}`);
      console.error(`  FAIL   ${row.record_date}  ${row.employee_id}  ${e?.message}`);
    }
  });

  console.log("\n══ Summary ══");
  console.log(`  Fixed (reclassified away from week_off_worked): ${results.fixed}`);
  console.log(`  Kept  (genuinely worked on week-off):           ${results.unchanged}`);
  console.log(`  Failed:                                         ${results.failed}`);
  if (results.errors.length) {
    console.log("  First errors:", results.errors.slice(0, 5).join("\n  "));
  }

  await db.end();
})().catch(async (e) => {
  console.error("FATAL", e?.message ?? e);
  try { await db.end(); } catch { }
  process.exit(1);
});
