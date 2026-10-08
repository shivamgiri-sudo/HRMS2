/**
 * Repair attendance rows that the roster-import recompute (commit 09c94c0f5) graded WITHOUT the
 * employee's exception bucket. Dry-run unless given --apply.
 *
 * Scope, deliberately narrow:
 *   - employees with an ACTIVE employee_attendance_exception_bucket row
 *   - attendance_daily_record rows with created_by = 'roster_import', record_date >= 2026-09-01
 *   - not locked, no override_by, no regularization_id
 *   - re-graded by the engine itself (bucket looked up), and written ONLY when the new grade pays
 *     more (lower lwp_value). A row that would get worse is reported and left alone.
 * The repaired row is stamped created_by = 'bucket_regrade_repair' so it can be found again.
 *
 *   npx tsx scripts/repair-bucket-regrade.ts [--apply]
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { attendanceEngineService } from "../src/modules/wfm/attendance-engine.service.js";
import type { RowDataPacket } from "mysql2";

const APPLY = process.argv.includes("--apply");
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];

(async () => {
  const rows = await q(
    `SELECT adr.employee_id, e.employee_code, DATE_FORMAT(adr.record_date,'%Y-%m-%d') d,
            adr.attendance_status st, adr.lwp_value lwp, adr.raw_minutes raw
       FROM attendance_daily_record adr
       JOIN employee_attendance_exception_bucket b ON b.employee_id = adr.employee_id AND b.active_status = 1
       JOIN employees e ON e.id = adr.employee_id
      WHERE adr.created_by = 'roster_import' AND adr.record_date >= '2026-09-01'
        AND adr.is_locked = 0 AND adr.override_by IS NULL AND adr.regularization_id IS NULL
      ORDER BY e.employee_code, adr.record_date`);
  console.log(`candidate rows (bucketed, written by roster_import): ${rows.length}`);

  const plan: any[] = [];
  for (const r of rows as any[]) {
    const res = await attendanceEngineService.processEmployee(r.employee_id, r.d); // bucket looked up
    const changed = res.status !== r.st || Number(res.lwpValue) !== Number(r.lwp);
    if (!changed) continue;
    const better = Number(res.lwpValue) < Number(r.lwp);
    plan.push({
      code: r.employee_code, date: r.d, raw_old: r.raw, raw_new: res.rawMinutes,
      from: `${r.st}/${r.lwp}`, to: `${res.status}/${res.lwpValue}`,
      action: better ? "REPAIR" : "LEAVE (not better)", res, better, oldLwp: Number(r.lwp),
    });
  }
  console.table(plan.map(({ res, better, oldLwp, ...p }) => p));
  const fix = plan.filter((p) => p.better);
  const emps = new Set(fix.map((p) => p.code));
  const gained = fix.reduce((s, p) => s + (p.oldLwp - Number(p.res.lwpValue)), 0);
  console.log(`would repair ${fix.length} rows, ${emps.size} employees, +${gained} pay-days`);

  if (!APPLY) { console.log("DRY RUN - nothing written."); process.exit(0); }
  for (const p of fix) {
    await attendanceEngineService.upsertDailyRecord(p.res, "bucket_regrade_repair");
    console.log(`repaired ${p.code} ${p.date}: ${p.from} -> ${p.to}`);
  }
  const [chk] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) n FROM attendance_daily_record WHERE created_by = 'bucket_regrade_repair'`);
  console.log(`rows now stamped bucket_regrade_repair: ${(chk as any)[0].n}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
