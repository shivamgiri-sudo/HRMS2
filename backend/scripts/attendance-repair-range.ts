/**
 * Repairs attendance for a past date range, one day at a time, using the production code paths:
 *
 *   1. COSEC sync for the day  - pulls the biometric punches and writes biometric minutes / attendance rows
 *                                (fixes "swiped but HRMS shows 0 minutes", "missing punch", "summary not received")
 *   2. Engine sweep for the day - the same call the 23:00 cron makes; creates records that do not exist
 *                                (fixes "no attendance record") and recomputes unlocked ones from the evidence
 *   3. Reconciliation audit for the day - re-checks the day and closes the items that are now fixed
 *
 * SAFETY
 *   - DRY RUN is the default and only reads. It prints, per day, the open items by type, missing person-days
 *     and locked rows.
 *   - Rows with is_locked = 1 (payroll-finalised) are protected in SQL inside every write path used here.
 *   - Writes are idempotent upserts, so a run cut short can simply be run again.
 *   - One day at a time (no concurrency), to keep the live database calm.
 *   - A step that fails is reported and the next day still runs; the exit code is non-zero if anything failed.
 *
 * AFTER AN APPLY: a payroll run that is still processing may already hold a snapshot of attendance. The payroll
 * head should re-prepare that run so it picks the repaired records up.
 *
 *   npx tsx scripts/attendance-repair-range.ts 2026-08-03 2026-08-03            # dry run
 *   npx tsx scripts/attendance-repair-range.ts 2026-08-03 2026-08-03 --apply
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { nowIST } from "../src/shared/timezone.js";
import { cosecSyncService } from "../src/modules/wfm/cosec-sync.service.js";
import { attendanceEngineService } from "../src/modules/wfm/attendance-engine.service.js";
import { attendanceReconciliationService } from "../src/modules/wfm/attendance-reconciliation.service.js";
import { enumerateDates, validateRepairRange } from "../src/modules/wfm/attendance-heal.logic.js";
import { findMissingPersonDays } from "../src/modules/wfm/attendance-heal.service.js";

const dates = process.argv.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const APPLY = process.argv.includes("--apply");
const FROM = dates[0];
const TO = dates[1] ?? dates[0];
const today = nowIST().split("T")[0]!;

const check = validateRepairRange(FROM, TO, today);
if (!check.ok) {
  console.error(`usage: tsx scripts/attendance-repair-range.ts YYYY-MM-DD [YYYY-MM-DD] [--apply]\n${check.message}`);
  process.exit(1);
}

interface DayState { open: Record<string, number>; openTotal: number; records: number; locked: number; missing: number }

async function state(date: string): Promise<DayState> {
  const [issues] = await db.execute<any[]>(
    `SELECT ari.issue_type t, COUNT(*) n
       FROM attendance_reconciliation_issue ari JOIN employees e ON e.id = ari.employee_id
      WHERE ari.issue_date = ? AND ari.resolved_at IS NULL AND e.active_status = 1
      GROUP BY ari.issue_type`, [date]);
  const [tot] = await db.execute<any[]>(
    `SELECT COUNT(*) records, COALESCE(SUM(is_locked), 0) locked FROM attendance_daily_record WHERE record_date = ?`, [date]);
  const { rows } = await findMissingPersonDays({ from: date, to: date, limit: 5000 });
  const open: Record<string, number> = {};
  let openTotal = 0;
  for (const r of issues) { open[String(r.t)] = Number(r.n); openTotal += Number(r.n); }
  return { open, openTotal, records: Number(tot[0]?.records ?? 0), locked: Number(tot[0]?.locked ?? 0), missing: rows.length };
}

const fmt = (s: DayState) => `open=${s.openTotal} ${JSON.stringify(s.open)} | records=${s.records} (locked ${s.locked}) | missing person-days=${s.missing}`;

(async () => {
  const days = enumerateDates(FROM!, TO!);
  console.log(`${APPLY ? "APPLY" : "DRY RUN"}: ${days.length} day(s), ${FROM} .. ${TO}\n`);
  const summary: Array<{ date: string; before: number; after: number | null; missingBefore: number; missingAfter: number | null; ok: boolean }> = [];
  let failed = 0;

  for (const date of days) {
    const before = await state(date);
    console.log(`── ${date}\n   BEFORE  ${fmt(before)}`);
    if (!APPLY) { summary.push({ date, before: before.openTotal, after: null, missingBefore: before.missing, missingAfter: null, ok: true }); continue; }

    let ok = true;
    const timed = async (label: string, fn: () => Promise<string>) => {
      const t = Date.now();
      try { console.log(`   ${label}: ${await fn()} (${((Date.now() - t) / 1000).toFixed(0)}s)`); }
      catch (e) { ok = false; failed++; console.error(`   ${label}: FAILED - ${e instanceof Error ? e.message : String(e)}`); }
    };
    await timed("1/3 biometric sync ", async () => {
      const r = await cosecSyncService.sync({ from: date, to: date });
      return `migrated=${r.migratedDays} unchanged=${r.skippedUnchanged} pulled=${r.pulledEvents} unmapped=${r.unmappedUsers.length} failed=${r.failed.length}`;
    });
    await timed("2/3 engine sweep    ", async () => {
      const r = await attendanceEngineService.processDateBatch(date, 50);
      return `processed=${r.processed} skipped(locked)=${r.skipped} failed=${r.failed}${r.errors?.length ? ` first=${r.errors[0]}` : ""}`;
    });
    await timed("3/3 re-check issues ", async () => {
      const r = await attendanceReconciliationService.audit({ from: date, to: date, autoFix: false });
      return `detected=${r.detectedIssues} closed=${r.resolvedIssues}`;
    });
    const after = await state(date);
    console.log(`   AFTER   ${fmt(after)}`);
    summary.push({ date, before: before.openTotal, after: after.openTotal, missingBefore: before.missing, missingAfter: after.missing, ok });
  }

  console.log("\n──── SUMMARY ────");
  console.table(summary);
  if (APPLY) {
    const b = summary.reduce((n, s) => n + s.before, 0);
    const a = summary.reduce((n, s) => n + (s.after ?? 0), 0);
    console.log(`open items: ${b} -> ${a} (closed ${b - a}); days with a failed step: ${summary.filter((s) => !s.ok).length}`);
  } else {
    console.log("Dry run only: nothing was written. Add --apply to repair.");
  }
  await db.end();
  if (failed > 0) process.exit(1);
})().catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end(); } catch { /* ignore */ } process.exit(1); });
