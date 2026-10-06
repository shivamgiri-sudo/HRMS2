/**
 * Re-grade September 2026 attendance with the corrected engine. Prints COUNTS ONLY.
 *
 * Scope (unlocked rows only - no is_locked, override or approved regularization is touched):
 *   1. every record built from the old night-shift window (source_system ...night_shift_window), which
 *      credited a date with the NEXT date's APR;
 *   2. every record of a dialler-fed employee on 21-29 Sep, the days the APR sync missed (run
 *      apr-resync-dates first so the re-pulled minutes are there).
 * Rows outside the employee's employment window are counted, not re-graded (post-exit cleanup handles them).
 *
 *   npx tsx scripts/sep-attendance-regrade.ts           # dry run: computes, writes nothing
 *   npx tsx scripts/sep-attendance-regrade.ts --apply   # upserts the new grades
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { attendanceEngineService } from "../src/modules/wfm/attendance-engine.service.js";
import { partitionByEmployment } from "../src/shared/employmentWindow.js";

const APPLY = process.argv.includes("--apply");
// --all: every unprotected day in FROM..TO, not only the night-window / APR-gap scope.
const ALL = process.argv.includes("--all");
// Optional: FROM TO GAP_FROM GAP_TO (defaults: September 2026, APR gap 21-29 Sep).
const argDates = process.argv.slice(2).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
const [MONTH_FROM, MONTH_TO, GAP_FROM, GAP_TO] = argDates.length === 4 ? argDates : ["2026-09-01", "2026-09-30", "2026-09-21", "2026-09-29"];
const credit = (s: string) => (s === "present" || s === "leave_approved" || s === "holiday" || s === "week_off" ? 1 : s === "half_day" ? 0.5 : 0);

(async () => {
  console.log(`mode: ${APPLY ? "APPLY" : "dry-run (nothing written)"}${ALL ? "  scope: every unprotected day" : ""}`);
  const [runs] = await db.execute<RowDataPacket[]>(
    `SELECT status, COUNT(*) n FROM salary_prep_run WHERE LEFT(CAST(run_month AS CHAR), 7) = ? GROUP BY status`, [MONTH_FROM.slice(0, 7)]);
  console.log(`${MONTH_FROM}..${MONTH_TO} (APR gap ${GAP_FROM}..${GAP_TO}) payroll runs for the month:`, (runs as any[]).length ? (runs as any[]).map((r) => `${r.status}=${r.n}`).join(", ") : "none");

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT adr.employee_id, DATE_FORMAT(adr.record_date, '%Y-%m-%d') d, adr.attendance_status st,
            COALESCE(adr.source_system, '') src
       FROM attendance_daily_record adr
      WHERE adr.record_date BETWEEN ? AND ?
        AND adr.is_locked = 0 AND adr.override_by IS NULL AND adr.regularization_id IS NULL
        AND (${ALL ? "1 = 1" : "0 = 1"} OR adr.source_system LIKE '%night_shift_window'
             OR (adr.record_date BETWEEN ? AND ?
                 AND EXISTS (SELECT 1 FROM apr a JOIN employees e ON e.employee_code = a.UserID
                              WHERE e.id = adr.employee_id AND a.ReportDate BETWEEN ? AND ?)))`,
    [MONTH_FROM, MONTH_TO, GAP_FROM, GAP_TO, MONTH_FROM, MONTH_TO]);
  const all = rows as any[];
  const { inside, outside } = await partitionByEmployment(all, (r) => String(r.employee_id), (r) => String(r.d));
  console.log(`scope rows=${all.length}  night-shift-window=${all.filter((r) => String(r.src).endsWith("night_shift_window")).length}  outside employment window (left for cleanup)=${outside.length}`);

  const moves: Record<string, number> = {};
  let changed = 0, same = 0, failed = 0, written = 0, oldCredit = 0, newCredit = 0;
  const people = new Set<string>();
  for (const r of inside) {
    try {
      const res = await attendanceEngineService.processEmployee(String(r.employee_id), String(r.d));
      oldCredit += credit(String(r.st)); newCredit += credit(String(res.status));
      if (res.status === r.st) { same++; continue; }
      changed++; people.add(String(r.employee_id));
      const k = `${r.st} -> ${res.status}`; moves[k] = (moves[k] ?? 0) + 1;
      if (APPLY) { await attendanceEngineService.upsertDailyRecord(res, "sep-2026-regrade"); written++; }
    } catch { failed++; }
  }
  console.log(`re-graded: unchanged=${same} changed=${changed} (employees=${people.size}) failed=${failed}${APPLY ? ` written=${written}` : ""}`);
  console.log("status moves:", JSON.stringify(Object.fromEntries(Object.entries(moves).sort((a, b) => b[1] - a[1]))));
  console.log(`paid-day credit on these rows: before=${oldCredit} after=${newCredit} change=${newCredit - oldCredit}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
