// Runs the nightly attendance engine sweep for one date, on demand.
//
// This is exactly what attendance-engine.cron.ts fires at 23:00 for the previous day
// (runAttendanceSweep -> processDateBatch). Use it to close a day early, or to rebuild
// one the sweep missed, without waiting for the cron.
//
//     npx tsx scripts/attendance-sweep-day.ts 2026-08-05
//
// The engine decides the source per employee, unchanged by this script: Operations
// Executive designations resolve to APR/dialler net login, everyone else to biometric.
// is_locked=1 rows are protected at SQL level and are not rewritten.
import { db } from "../src/db/mysql.js";
import { attendanceEngineService } from "../src/modules/wfm/attendance-engine.service.js";

const DATE = process.argv[2];
if (!DATE || !/^\d{4}-\d{2}-\d{2}$/.test(DATE)) {
  console.error("usage: tsx scripts/attendance-sweep-day.ts YYYY-MM-DD");
  process.exit(1);
}

async function snapshot(label: string) {
  const [rows] = await db.execute<any[]>(
    `SELECT attendance_source, attendance_status, COUNT(*) n, SUM(lwp_value) lwp
       FROM attendance_daily_record WHERE record_date = ?
      GROUP BY attendance_source, attendance_status
      ORDER BY attendance_source, n DESC`, [DATE]);
  const [tot] = await db.execute<any[]>(
    `SELECT COUNT(*) rows_, SUM(is_locked) locked FROM attendance_daily_record WHERE record_date = ?`, [DATE]);
  console.log(`\n──── ${label} (${DATE}) ────`);
  console.table(rows);
  console.log("totals:", JSON.stringify(tot[0]));
}

(async () => {
  await snapshot("BEFORE");
  const t = Date.now();
  const result = await attendanceEngineService.processDateBatch(DATE, 50);
  console.log(`\nsweep finished in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  console.log(`  processed = ${result.processed}`);
  console.log(`  skipped   = ${result.skipped}`);
  console.log(`  failed    = ${result.failed}`);
  if (result.errors?.length) console.log("  first errors:", JSON.stringify(result.errors.slice(0, 5)));
  await snapshot("AFTER");
  await db.end();
})().catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end(); } catch { } process.exit(1); });
