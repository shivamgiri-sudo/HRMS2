/**
 * Targeted reprocess of attendance records that are misclassified because of the
 * night-shift cross-midnight carryover bug in G12.
 *
 * Two categories are swept:
 *   1. week_off_worked — may be night-shift carryover, should be week_off
 *   2. Any status (half_day/present/absent/missing_punch) where roster says is_week_off=1
 *      but attendance is not week_off/week_off_worked — G12 never fired or wrote stale data
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

const CONCURRENCY = 4;

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

  // Category 1: week_off_worked — may be night-shift carryover
  const [wowRows] = await db.execute<any[]>(
    `SELECT adr.id, adr.employee_id, adr.record_date, adr.attendance_status
     FROM attendance_daily_record adr
     WHERE adr.record_date BETWEEN ? AND ?
       AND adr.attendance_status = 'week_off_worked'
       AND adr.is_locked = 0
     ORDER BY adr.record_date, adr.employee_id`,
    [startDate, endDate]
  );

  // Category 2: roster=week_off but status is something else (half_day/present/absent/missing_punch)
  const [rosterMismatch] = await db.execute<any[]>(
    `SELECT adr.id, adr.employee_id, adr.record_date, adr.attendance_status
     FROM attendance_daily_record adr
     JOIN wfm_roster_assignment wra ON wra.employee_id = adr.employee_id
       AND wra.roster_date = adr.record_date
       AND wra.is_week_off = 1
     WHERE adr.record_date BETWEEN ? AND ?
       AND adr.attendance_status NOT IN ('week_off','week_off_worked')
       AND adr.is_locked = 0
     ORDER BY adr.record_date, adr.employee_id`,
    [startDate, endDate]
  );

  // Deduplicate in case a row appears in both (shouldn't, but safe)
  const seen = new Set<string>();
  const allRows: any[] = [];
  for (const r of [...wowRows, ...rosterMismatch]) {
    const key = `${r.employee_id}|${r.record_date}`;
    if (!seen.has(key)) { seen.add(key); allRows.push(r); }
  }

  console.log(`Category 1 (week_off_worked):           ${wowRows.length}`);
  console.log(`Category 2 (roster=week_off, wrong status): ${rosterMismatch.length}`);
  console.log(`Total unique rows to reprocess:         ${allRows.length}`);

  if (isDryRun) {
    console.log("\nDRY RUN — not writing to DB.");
    for (const r of allRows) console.log(`  ${r.record_date}  ${r.employee_id}  was=${r.attendance_status}`);
    await db.end();
    return;
  }

  const results = { fixed: 0, unchanged: 0, failed: 0, errors: [] as string[] };

  await runConcurrent(allRows, async (row) => {
    try {
      const result = await attendanceEngineService.processEmployee(row.employee_id, row.record_date);
      await attendanceEngineService.upsertDailyRecord(result, 'system:nightshift-fix');
      const wasSame = result.status === row.attendance_status;
      if (!wasSame) {
        results.fixed++;
        console.log(`  FIXED  ${row.record_date}  ${row.employee_id}  ${row.attendance_status} → ${result.status}`);
      } else {
        results.unchanged++;
        console.log(`  KEPT   ${row.record_date}  ${row.employee_id}  → ${result.status}`);
      }
    } catch (e: any) {
      results.failed++;
      results.errors.push(`${row.record_date}/${row.employee_id}: ${e?.message}`);
      console.error(`  FAIL   ${row.record_date}  ${row.employee_id}  ${e?.message}`);
    }
  });

  console.log("\n══ Summary ══");
  console.log(`  Fixed:     ${results.fixed}`);
  console.log(`  Unchanged: ${results.unchanged}`);
  console.log(`  Failed:    ${results.failed}`);
  if (results.errors.length) console.log("  Errors:", results.errors.slice(0, 5).join("\n  "));

  await db.end();
})().catch(async (e) => {
  console.error("FATAL", e?.message ?? e);
  try { await db.end(); } catch { }
  process.exit(1);
});
