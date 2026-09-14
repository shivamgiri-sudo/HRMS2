/**
 * READ-ONLY preview of what reprocessing would change for employees affected by migration
 * 1127 (APR eligibility now scoped by process). Employees on one of the 15 processes with
 * zero APR history ever just lost APR eligibility and fall back to biometric judging; their
 * EXISTING attendance_daily_record rows still reflect the old (wrong) classification until
 * reprocessed — 1127 itself only changes config, not stored rows.
 *
 * SAFETY: exactly the same technique as attendance-gap-reprocess-dry-run.ts — this calls the
 * real, live attendanceEngineService.processEmployee(employeeId, date) directly. That
 * function is provably read-only (verified by scanning it for INSERT/UPDATE/DELETE — there
 * are none; all writes live in the separate upsertDailyRecord, which this never calls). Now
 * that migration 1127 is committed, calling it fresh returns the corrected classification
 * because isAprEligible()/resolveRule() read the live config table. No punch data needs
 * staging — these employees already have biometric history, unlike the brand-new-joiner
 * cohort from the earlier attendance-gap fix.
 *
 * Usage:
 *   npx tsx scripts/apr-rescope-reprocess-dry-run.ts [from] [to]
 *   defaults to the current month to date
 */
import { db } from "../src/db/mysql.js";
import { attendanceEngineService } from "../src/modules/wfm/attendance-engine.service.js";

const FROM = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? "2026-08-01";
const TO = process.argv.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a))[1] ?? "2026-08-11";

const KEEP_PROCESS_IDS = [
  "b0afc80e-6969-11f1-adb1-00155d0ab410", // IDAM Natural Wellness
  "05150ba3-67ba-11f1-adb1-00155d0ab410", // Neemans
  "b0b5eb22-6969-11f1-adb1-00155d0ab410", // Guardian Healthcare
  "b0b6e055-6969-11f1-adb1-00155d0ab410", // BTM Ventures
  "050b7ba8-67ba-11f1-adb1-00155d0ab410", // Bella-Vita Organic
  "050de032-67ba-11f1-adb1-00155d0ab410", // Clovia
  "05168f65-67ba-11f1-adb1-00155d0ab410", // BirlaNu
  "b0b7dfb8-6969-11f1-adb1-00155d0ab410", // Captureatrip
  "05061340-67ba-11f1-adb1-00155d0ab410", // Dalmia Cement
  "050a0fa0-67ba-11f1-adb1-00155d0ab410", // Exicom
  "0518068a-67ba-11f1-adb1-00155d0ab410", // VST
  "0508d1cd-67ba-11f1-adb1-00155d0ab410", // Viega
  "05191bc1-67ba-11f1-adb1-00155d0ab410", // Housing.com
  "050cc297-67ba-11f1-adb1-00155d0ab410", // DU Digital
  "0510ca4d-67ba-11f1-adb1-00155d0ab410", // Appriciate Wealth
];

(async () => {
  console.log(`DRY RUN — NO WRITES. window ${FROM} .. ${TO}`);

  const keepPh = KEEP_PROCESS_IDS.map(() => "?").join(",");
  // Employees the OLD unscoped rule treated as dialler agents (EXECUTIVE variants, OPERATIONS
  // dept), whose process is NOT one of the 15 kept on APR — the population 1127 moved off.
  const [affected] = await db.query<any[]>(
    `SELECT e.id, e.employee_code, e.process_id, p.process_name, e.designation_id, e.branch_id
       FROM employees e
       LEFT JOIN process_master p ON p.id = e.process_id
      WHERE LOWER(e.employment_status) = 'active'
        AND e.process_id IS NOT NULL
        AND e.process_id NOT IN (${keepPh})
        AND e.designation_id IN (
          '79271db7-5e88-11f1-adb1-00155d0ab410',
          '7993fbc1-5e88-11f1-adb1-00155d0ab410',
          '7957720b-5e88-11f1-adb1-00155d0ab410',
          '7975e39c-5e88-11f1-adb1-00155d0ab410'
        )
        AND e.department_id = '7782964a-5e88-11f1-adb1-00155d0ab410'`,
    KEEP_PROCESS_IDS,
  );
  console.log(`affected employees (moved off APR by 1127): ${affected.length}`);

  const ids = affected.map((e) => e.id);
  if (!ids.length) { console.log("nothing to do"); await db.end(); return; }
  const ph = ids.map(() => "?").join(",");

  // Existing rows in the window that were judged via APR — these are stale post-1127.
  const [existing] = await db.query<any[]>(
    `SELECT employee_id, record_date, attendance_status, source_system, lwp_value
       FROM attendance_daily_record
      WHERE employee_id IN (${ph}) AND record_date >= ? AND record_date < DATE_ADD(?, INTERVAL 1 DAY)
        AND (source_system LIKE '%apr%' OR apr_status IS NOT NULL)`,
    [...ids, FROM, TO],
  );
  console.log(`existing APR-judged ADR rows in window: ${existing.length}`);
  if (!existing.length) { console.log("nothing stale in this window"); await db.end(); return; }

  const empById = new Map(affected.map((e) => [e.id, e]));
  const transitions: Record<string, number> = {};
  let lwpBefore = 0, lwpAfter = 0;
  let sampled = 0;
  const samples: any[] = [];

  for (const row of existing) {
    const date = row.record_date.toISOString?.().slice(0, 10) ?? row.record_date;
    const fresh = await attendanceEngineService.processEmployee(row.employee_id, date);
    const key = `${row.attendance_status} -> ${fresh.status}`;
    transitions[key] = (transitions[key] ?? 0) + 1;
    lwpBefore += Number(row.lwp_value ?? 0);
    lwpAfter += Number(fresh.lwpValue ?? 0);
    sampled++;
    if (samples.length < 15 && row.attendance_status !== fresh.status) {
      const emp = empById.get(row.employee_id);
      samples.push({
        code: emp?.employee_code, process: emp?.process_name, date,
        before: row.attendance_status, after: fresh.status,
        beforeLwp: row.lwp_value, afterLwp: fresh.lwpValue,
      });
    }
  }

  console.log(`\nrows evaluated: ${sampled}`);
  console.log(`transitions (before -> after):`, JSON.stringify(transitions, null, 2));
  console.log(`LWP total: before=${lwpBefore.toFixed(1)} after=${lwpAfter.toFixed(1)} delta=${(lwpAfter - lwpBefore).toFixed(1)}`);
  console.log(`\nsample of changed rows:`, JSON.stringify(samples, null, 2));
  console.log(`\nDRY RUN COMPLETE — nothing written.`);
  await db.end();
})().catch(async (e) => {
  console.error("ERR", e?.message ?? e);
  try { await db.end(); } catch { /* ignore */ }
  process.exit(1);
});
