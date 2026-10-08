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
 * STEP 2 IS NOW "FILL MISSING PERSON-DAYS", NOT A WHOLE-DAY SWEEP. The engine's per-day sweep (processDateBatch) covers every
 * currently-active employee and does not skip dates before they joined, so over a past date it creates records for
 * people who had not joined yet (found on production 2026-10-03: ~210 extra rows per day). Filling only the person-days
 * that are genuinely missing (active staff between their start and end dates) cannot do that.
 *
 * CLEANUP MODE:  --report-prejoin [--delete-prejoin --apply]
 *   Finds rows created TODAY by the system, still unlocked, for a date before the employee's date of joining (or after
 *   their exit). --report-prejoin only counts them; --delete-prejoin --apply removes exactly those rows.
 *
 * AFTER AN APPLY: a payroll run that is still processing may already hold a snapshot of attendance. The payroll
 * head should re-prepare that run so it picks the repaired records up.
 *
 *   npx tsx scripts/attendance-repair-range.ts 2026-08-03 2026-08-03            # dry run
 *   npx tsx scripts/attendance-repair-range.ts 2026-08-03 2026-08-03 --apply
 *   npx tsx scripts/attendance-repair-range.ts 2026-09-20 2026-09-20 --apply --skip-sync   # engine sweep + re-check only
 *
 * --skip-sync leaves out the biometric pull (step 1). Use it for days where the biometric data is already in HRMS
 * and only the engine failed to write the records ("no attendance record"); the pull is the slow step.
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { nowIST } from "../src/shared/timezone.js";
import { cosecSyncService } from "../src/modules/wfm/cosec-sync.service.js";
import { attendanceEngineService } from "../src/modules/wfm/attendance-engine.service.js";
import { attendanceReconciliationService } from "../src/modules/wfm/attendance-reconciliation.service.js";
import { enumerateDates, validateBackfillRange, validateRepairRange } from "../src/modules/wfm/attendance-heal.logic.js";
import { findMissingPersonDays, healMissingAttendance } from "../src/modules/wfm/attendance-heal.service.js";

const dates = process.argv.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const APPLY = process.argv.includes("--apply");
const SKIP_SYNC = process.argv.includes("--skip-sync");
const REPORT_PREJOIN = process.argv.includes("--report-prejoin");
const DELETE_PREJOIN = process.argv.includes("--delete-prejoin");
const FROM = dates[0];
const TO = dates[1] ?? dates[0];
const today = nowIST().split("T")[0]!;

const check = REPORT_PREJOIN || DELETE_PREJOIN ? validateBackfillRange(FROM, TO, today) : validateRepairRange(FROM, TO, today);
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

/** Rows this tool's earlier whole-day sweeps created today for dates the employee was not yet employed. */
async function prejoinRows(from: string, to: string) {
  const startOfToday = `${today} 00:00:00`;
  const [rows] = await db.execute<any[]>(
    `SELECT adr.id, adr.record_date d, adr.attendance_status st, adr.lwp_value lwp
       FROM attendance_daily_record adr JOIN employees e ON e.id = adr.employee_id
      WHERE adr.record_date BETWEEN ? AND ?
        AND adr.is_locked = 0
        AND adr.created_at >= ?
        AND adr.created_by IN ('system', 'system:attendance-repair', 'system:attendance-heal')
        AND ((e.date_of_joining IS NOT NULL AND adr.record_date < e.date_of_joining)
          OR (COALESCE(e.date_of_exit, e.date_of_leaving) IS NOT NULL AND adr.record_date > COALESCE(e.date_of_exit, e.date_of_leaving)))`,
    [from, to, startOfToday],
  );
  return rows as Array<{ id: string; d: string; st: string; lwp: number }>;
}

if (REPORT_PREJOIN || DELETE_PREJOIN) {
  (async () => {
    const rows = await prejoinRows(FROM!, TO!);
    const byStatus: Record<string, number> = {};
    const byDate: Record<string, number> = {};
    let lwp = 0;
    for (const r of rows) {
      byStatus[r.st] = (byStatus[r.st] ?? 0) + 1;
      const d = String(r.d).slice(0, 10);
      byDate[d] = (byDate[d] ?? 0) + 1;
      lwp += Number(r.lwp ?? 0);
    }
    console.log(`${DELETE_PREJOIN && APPLY ? "DELETE" : "REPORT"}: rows created today for dates outside the employee's employment, ${FROM} .. ${TO}`);
    console.log(`  rows: ${rows.length}   by status: ${JSON.stringify(byStatus)}   total lwp_value: ${lwp}`);
    console.log(`  by date: ${JSON.stringify(byDate)}`);
    if (DELETE_PREJOIN && APPLY && rows.length > 0) {
      let removed = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const ids = rows.slice(i, i + 500).map((r) => r.id);
        // re-check the same conditions in the DELETE itself, so a row locked in the meantime is never removed
        const [res] = await db.execute<any>(`DELETE FROM attendance_daily_record WHERE is_locked = 0 AND id IN (${ids.map(() => "?").join(",")})`, ids);
        removed += Number(res.affectedRows ?? 0);
      }
      console.log(`  deleted: ${removed}`);
    } else if (DELETE_PREJOIN) {
      console.log("  (dry run: nothing deleted; add --apply)");
    }
    await db.end();
    process.exit(0);
  })().catch((e) => { console.error("ERR", e?.message ?? e); process.exit(1); });
} else
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
    if (SKIP_SYNC) console.log("   1/3 biometric sync : skipped (--skip-sync)");
    else await timed("1/3 biometric sync ", async () => {
      const r = await cosecSyncService.sync({ from: date, to: date });
      return `migrated=${r.migratedDays} unchanged=${r.skippedUnchanged} pulled=${r.pulledEvents} unmapped=${r.unmappedUsers.length} failed=${r.failed.length}`;
    });
    await timed("2/3 fill missing    ", async () => {
      const r = await healMissingAttendance({ from: date, to: date, actor: "system:attendance-repair" });
      return `found=${r.found} created=${r.processed} failed=${r.failed}${r.errors?.length ? ` first=${r.errors[0]}` : ""}`;
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
  // Exit explicitly: the biometric step leaves its connection to the punch server open, which would otherwise keep
  // the process (and the workflow job) alive for hours after all the work is done.
  process.exit(failed > 0 ? 1 : 0);
})().catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end(); } catch { /* ignore */ } process.exit(1); });
