/**
 * Materialises what apr-rescope-reprocess-dry-run.ts previewed: re-runs the real
 * attendance engine (processEmployee + upsertDailyRecord) for employees moved off APR by
 * migration 1127, over existing APR-judged ADR rows in the given window.
 *
 * SAFETY
 *
 * upsertDailyRecord is an idempotent UPSERT that guards every column on `is_locked = 0` —
 * it cannot touch a payroll-locked row, so a finalized month is untouched no matter what
 * this script targets. Re-running is safe (upsert, not insert-only).
 *
 * Verified via dry-run before this file was written: July 2026-07-01..07-31, 1,774 rows,
 * zero pay change (both absent and missing_punch pay zero), only the LWP-days figure moves
 * (519 -> 350) because 169 rows move from absent (lwp=1, penalised) to missing_punch
 * (lwp=0, not penalised) on 2026-07-25. August 2026-08-01..08-11, 1,036 rows, transitions
 * to itself throughout - a pure no-op confirmed by the dry run.
 *
 * Usage:
 *   npx tsx scripts/apr-rescope-reprocess.ts [from] [to]          # dry run
 *   npx tsx scripts/apr-rescope-reprocess.ts [from] [to] --apply  # write
 */
import { db } from "../src/db/mysql.js";
import { attendanceEngineService } from "../src/modules/wfm/attendance-engine.service.js";

const APPLY = process.argv.includes("--apply");
const FROM = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? "2026-07-01";
const TO = process.argv.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a))[1] ?? "2026-07-31";

const KEEP_PROCESS_IDS = [
  "b0afc80e-6969-11f1-adb1-00155d0ab410", "05150ba3-67ba-11f1-adb1-00155d0ab410",
  "b0b5eb22-6969-11f1-adb1-00155d0ab410", "b0b6e055-6969-11f1-adb1-00155d0ab410",
  "050b7ba8-67ba-11f1-adb1-00155d0ab410", "050de032-67ba-11f1-adb1-00155d0ab410",
  "05168f65-67ba-11f1-adb1-00155d0ab410", "b0b7dfb8-6969-11f1-adb1-00155d0ab410",
  "05061340-67ba-11f1-adb1-00155d0ab410", "050a0fa0-67ba-11f1-adb1-00155d0ab410",
  "0518068a-67ba-11f1-adb1-00155d0ab410", "0508d1cd-67ba-11f1-adb1-00155d0ab410",
  "05191bc1-67ba-11f1-adb1-00155d0ab410", "050cc297-67ba-11f1-adb1-00155d0ab410",
  "0510ca4d-67ba-11f1-adb1-00155d0ab410",
];

(async () => {
  console.log(`window ${FROM} .. ${TO}   mode=${APPLY ? "APPLY" : "DRY RUN"}`);
  const keepPh = KEEP_PROCESS_IDS.map(() => "?").join(",");
  const [affected] = await db.query<any[]>(
    `SELECT e.id FROM employees e
      WHERE LOWER(e.employment_status) = 'active'
        AND e.process_id IS NOT NULL AND e.process_id NOT IN (${keepPh})
        AND e.designation_id IN ('79271db7-5e88-11f1-adb1-00155d0ab410','7993fbc1-5e88-11f1-adb1-00155d0ab410','7957720b-5e88-11f1-adb1-00155d0ab410','7975e39c-5e88-11f1-adb1-00155d0ab410')
        AND e.department_id = '7782964a-5e88-11f1-adb1-00155d0ab410'`,
    KEEP_PROCESS_IDS,
  );
  const ids = affected.map((e) => e.id);
  console.log(`affected employees: ${ids.length}`);
  if (!ids.length) { await db.end(); return; }
  const ph = ids.map(() => "?").join(",");

  const [existing] = await db.query<any[]>(
    `SELECT employee_id, record_date, attendance_status, lwp_value
       FROM attendance_daily_record
      WHERE employee_id IN (${ph}) AND record_date >= ? AND record_date < DATE_ADD(?, INTERVAL 1 DAY)
        AND (source_system LIKE '%apr%' OR apr_status IS NOT NULL)`,
    [...ids, FROM, TO],
  );
  console.log(`target rows: ${existing.length}`);
  if (!existing.length) { console.log("nothing to do"); await db.end(); return; }

  if (!APPLY) {
    console.log(`DRY RUN — nothing written. Re-run with --apply.`);
    await db.end();
    return;
  }

  let written = 0, unchanged = 0, lwpBefore = 0, lwpAfter = 0;
  const transitions: Record<string, number> = {};
  let i = 0;
  for (const row of existing) {
    i++;
    const date = row.record_date.toISOString?.().slice(0, 10) ?? row.record_date;
    const fresh = await attendanceEngineService.processEmployee(row.employee_id, date);
    lwpBefore += Number(row.lwp_value ?? 0);
    lwpAfter += Number(fresh.lwpValue ?? 0);
    const key = `${row.attendance_status} -> ${fresh.status}`;
    transitions[key] = (transitions[key] ?? 0) + 1;
    if (row.attendance_status === fresh.status) unchanged++;
    await attendanceEngineService.upsertDailyRecord(fresh, "system-apr-rescope-2026-08-12");
    written++;
    if (i % 300 === 0) console.log(`  ...${i}/${existing.length}`);
  }

  console.log(`\nwritten=${written} unchanged_status=${unchanged}`);
  console.log(`transitions:`, JSON.stringify(transitions, null, 2));
  console.log(`LWP total: before=${lwpBefore.toFixed(1)} after=${lwpAfter.toFixed(1)} delta=${(lwpAfter - lwpBefore).toFixed(1)}`);
  await db.end();
})().catch(async (e) => {
  console.error("ERR", e?.message ?? e);
  try { await db.end(); } catch { /* ignore */ }
  process.exit(1);
});
