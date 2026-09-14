/**
 * Reprocess APR-scoped employees whose Aug attendance was written via biometric fallback.
 * With the 2026-09-03 rule: no APR record on a date = absent for this population.
 *
 * Targets:
 *   - APR-eligible employees (apr_eligibility_config.attendance_logic = 'apr', process_id scoped)
 *   - attendance_source = 'biometric', status IN (present, half_day, missing_punch)
 *   - is_locked = 0
 *   - No APR feed coverage (not enrolled in apr feed at all in the month)
 *
 * Usage:
 *   npx tsx backend/scripts/fix-apr-absent-no-record.ts [--dry-run] [--month 2026-08]
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

  // Find attendance rows for APR-scoped employees (process_id-mapped) who
  // have biometric-source records but zero APR feed coverage in the month.
  const [rows] = await db.execute<any[]>(
    `SELECT adr.id, adr.employee_id, adr.record_date, adr.attendance_status, e.employee_code
     FROM attendance_daily_record adr
     JOIN employees e ON e.id = adr.employee_id
     WHERE adr.record_date BETWEEN ? AND ?
       AND adr.attendance_source = 'biometric'
       AND adr.attendance_status IN ('present','half_day','missing_punch')
       AND adr.is_locked = 0
       AND EXISTS (
         SELECT 1 FROM apr_eligibility_config aec
         WHERE aec.active_status = 1
           AND aec.attendance_logic = 'apr'
           AND aec.process_id IS NOT NULL
           AND aec.process_id = e.process_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM apr a
         WHERE a.UserID = e.employee_code
           AND a.ReportDate BETWEEN DATE_SUB(?, INTERVAL 30 DAY) AND ?
       )
     ORDER BY adr.record_date, adr.employee_id`,
    [startDate, endDate, endDate, endDate]
  );

  console.log(`APR biometric-fallback rows to reprocess: ${rows.length}`);

  if (isDryRun) {
    console.log("\nDRY RUN — not writing to DB.");
    const byEmp: Record<string, number> = {};
    for (const r of rows) byEmp[r.employee_code] = (byEmp[r.employee_code] ?? 0) + 1;
    for (const [code, cnt] of Object.entries(byEmp).sort()) {
      console.log(`  ${code}: ${cnt} day(s)`);
    }
    await db.end();
    return;
  }

  const results = { fixed: 0, unchanged: 0, failed: 0, errors: [] as string[] };

  await runConcurrent(rows, async (row) => {
    try {
      const result = await attendanceEngineService.processEmployee(row.employee_id, row.record_date);
      await attendanceEngineService.upsertDailyRecord(result, 'system:apr-absent-fix');
      const wasSame = result.status === row.attendance_status;
      if (!wasSame) {
        results.fixed++;
        console.log(`  FIXED  ${row.record_date}  ${row.employee_code}  ${row.attendance_status} → ${result.status}`);
      } else {
        results.unchanged++;
        console.log(`  KEPT   ${row.record_date}  ${row.employee_code}  → ${result.status}`);
      }
    } catch (e: any) {
      results.failed++;
      results.errors.push(`${row.record_date}/${row.employee_code}: ${e?.message}`);
      console.error(`  FAIL   ${row.record_date}  ${row.employee_code}  ${e?.message}`);
    }
  });

  console.log("\n══ Summary ══");
  console.log(`  Fixed:     ${results.fixed}`);
  console.log(`  Unchanged: ${results.unchanged}`);
  console.log(`  Failed:    ${results.failed}`);
  if (results.errors.length) console.log("  Errors:", results.errors.slice(0, 10).join("\n  "));

  await db.end();
})().catch(async (e) => {
  console.error("FATAL", e?.message ?? e);
  try { await db.end(); } catch { }
  process.exit(1);
});
