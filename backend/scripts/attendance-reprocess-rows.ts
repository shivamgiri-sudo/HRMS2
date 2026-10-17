// Re-runs the attendance engine for specific (employee, date) pairs and writes the result
// through the normal engine write path (upsertDailyRecord, which never touches is_locked = 1 rows).
// Use it to repair a handful of known-bad rows without sweeping a whole day for every employee.
//
//   npx tsx scripts/attendance-reprocess-rows.ts MAS57822:2026-10-02,MAS54920:2026-10-05            # dry run
//   npx tsx scripts/attendance-reprocess-rows.ts MAS57822:2026-10-02,MAS54920:2026-10-05 --apply
//
// Dry run (default) only reads: it prints the stored row next to what the engine computes now.
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { attendanceEngineService } from "../src/modules/wfm/attendance-engine.service.js";

const APPLY = process.argv.includes("--apply");
const PAIR = /^[A-Za-z0-9_-]+:\d{4}-\d{2}-\d{2}$/;
const pairs = (process.argv[2] ?? "").split(",").map((p) => p.trim()).filter(Boolean);
if (!pairs.length || pairs.some((p) => !PAIR.test(p))) {
  console.error("usage: attendance-reprocess-rows.ts CODE:YYYY-MM-DD[,CODE:YYYY-MM-DD...] [--apply]");
  process.exit(1);
}

async function storedRow(employeeId: string, date: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT raw_minutes, biometric_minutes, attendance_status, lwp_value, is_locked
       FROM attendance_daily_record WHERE employee_id = ? AND record_date = ? LIMIT 1`,
    [employeeId, date],
  );
  return (rows as RowDataPacket[])[0] ?? null;
}

(async () => {
  const report: Record<string, unknown>[] = [];
  let failed = 0;
  for (const pair of pairs) {
    const [code, date] = pair.split(":");
    try {
      const [emp] = await db.execute<RowDataPacket[]>(`SELECT id FROM employees WHERE employee_code = ? LIMIT 1`, [code]);
      const employeeId = (emp as RowDataPacket[])[0]?.id as string | undefined;
      if (!employeeId) { report.push({ code, date, note: "employee not found" }); failed++; continue; }
      const before = await storedRow(employeeId, date);
      const computed = await attendanceEngineService.processEmployee(employeeId, date);
      let note = APPLY ? "written" : "dry run";
      if (before?.is_locked) note = "locked - not rewritten";
      else if (APPLY) await attendanceEngineService.upsertDailyRecord(computed, "attendance_reprocess_rows");
      const after = APPLY ? await storedRow(employeeId, date) : null;
      report.push({
        code, date,
        old_minutes: before?.raw_minutes ?? null, old_status: before?.attendance_status ?? null, old_lwp: before?.lwp_value ?? null,
        new_minutes: computed.rawMinutes, new_status: computed.status, new_lwp: computed.lwpValue,
        stored_now: after ? `${after.raw_minutes}/${after.attendance_status}` : "-",
        note,
      });
    } catch (err: any) {
      failed++;
      report.push({ code, date, note: `failed: ${String(err?.message ?? err).slice(0, 160)}` });
    }
  }
  console.table(report);
  console.log(APPLY ? "mode: APPLY" : "mode: dry-run, nothing written.");
  await db.end();
  process.exit(failed ? 3 : 0);
})().catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end(); } catch { /* closing */ } process.exit(1); });
