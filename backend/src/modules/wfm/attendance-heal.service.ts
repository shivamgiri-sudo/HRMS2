import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { nowIST } from "../../shared/timezone.js";
import { attendanceEngineService } from "./attendance-engine.service.js";
import { regradeStaleDays, type StaleRegradeResult } from "./attendance-stale-regrade.service.js";
import {
  MAX_PERSON_DAYS_PER_RUN, addDays, autoHealWindow, summariseMissing, type MissingDay,
} from "./attendance-heal.logic.js";

/** The calendar of candidate days, 0..30 days after the window start (the gap query's 31-day reach). */
const CALENDAR_SQL = `(
  SELECT DATE_ADD(?, INTERVAL n DAY) AS record_date
    FROM (
      SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
      UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9
      UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12 UNION ALL SELECT 13 UNION ALL SELECT 14
      UNION ALL SELECT 15 UNION ALL SELECT 16 UNION ALL SELECT 17 UNION ALL SELECT 18 UNION ALL SELECT 19
      UNION ALL SELECT 20 UNION ALL SELECT 21 UNION ALL SELECT 22 UNION ALL SELECT 23 UNION ALL SELECT 24
      UNION ALL SELECT 25 UNION ALL SELECT 26 UNION ALL SELECT 27 UNION ALL SELECT 28 UNION ALL SELECT 29
      UNION ALL SELECT 30
    ) days
   WHERE n <= DATEDIFF(?, ?)
) cal`;

/**
 * Person-days with NO attendance record. Same population as the reconciliation's "missing attendance
 * record" check: active staff, between their start (salary start / joining) and their end (exit / leaving
 * / resignation) date. Leavers are not included.
 */
export async function findMissingPersonDays(opts: {
  from: string; to: string; branchId?: string | null; limit?: number;
}): Promise<{ rows: MissingDay[]; truncated: boolean }> {
  const cap = Math.max(1, Math.min(opts.limit ?? MAX_PERSON_DAYS_PER_RUN, MAX_PERSON_DAYS_PER_RUN));
  const params: unknown[] = [opts.from, opts.to, opts.from, opts.from, opts.to];
  let branchSql = "";
  if (opts.branchId) { branchSql = " AND e.branch_id = ?"; params.push(opts.branchId); }
  params.push(cap + 1);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id AS employee_id, e.employee_code, e.branch_id, DATE_FORMAT(cal.record_date, '%Y-%m-%d') AS record_date
       FROM ${CALENDAR_SQL}
       JOIN employees e
         ON e.active_status = 1
        AND LOWER(COALESCE(e.employment_status, 'active')) = 'active'
        AND cal.record_date BETWEEN COALESCE(e.salary_start_date, e.date_of_joining, ?)
                                AND COALESCE(e.date_of_exit, e.date_of_leaving, e.resignation_date, ?)${branchSql}
      WHERE NOT EXISTS (
        SELECT 1 FROM attendance_daily_record adr
         WHERE adr.employee_id = e.id AND adr.record_date = cal.record_date
      )
      ORDER BY cal.record_date ASC, e.id ASC
      LIMIT ?`,
    params,
  );
  const all = (rows as RowDataPacket[]).map((r) => ({
    employeeId: String(r.employee_id),
    employeeCode: String(r.employee_code ?? ""),
    branchId: r.branch_id ? String(r.branch_id) : null,
    date: String(r.record_date),
  }));
  return { rows: all.slice(0, cap), truncated: all.length > cap };
}

export interface HealResult {
  found: number;
  truncated: boolean;
  processed: number;
  failed: number;
  byBranch: Record<string, number>;
  byDate: Record<string, number>;
  errors: string[];
  dryRun: boolean;
}

const CHUNK = 25;

/**
 * Creates the missing records using the same engine the nightly run uses (so a healed day is computed exactly
 * as it would have been: roster, shift, leave, holiday, biometric, APR). It only ever INSERTS a missing row:
 * upsertDailyRecord is guarded by is_locked, and a missing row cannot be locked.
 */
export async function healMissingAttendance(opts: {
  from: string; to: string; branchId?: string | null; limit?: number; dryRun?: boolean; actor?: string;
}): Promise<HealResult> {
  const { rows, truncated } = await findMissingPersonDays(opts);
  const summary = summariseMissing(rows);
  const base: HealResult = { found: rows.length, truncated, processed: 0, failed: 0, byBranch: summary.byBranch, byDate: summary.byDate, errors: [], dryRun: !!opts.dryRun };
  if (opts.dryRun || rows.length === 0) return base;

  const bucketMap = await attendanceEngineService.getExceptionBucketMap();
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const results = await Promise.allSettled(chunk.map(async (r) => {
      const result = await attendanceEngineService.processEmployee(r.employeeId, r.date, bucketMap.get(r.employeeId) ?? null);
      await attendanceEngineService.upsertDailyRecord(result, opts.actor ?? "system:attendance-heal");
    }));
    results.forEach((res, idx) => {
      if (res.status === "fulfilled") base.processed++;
      else {
        base.failed++;
        if (base.errors.length < 20) base.errors.push(`${chunk[idx]!.employeeCode}/${chunk[idx]!.date}: ${(res.reason as Error)?.message ?? String(res.reason)}`);
      }
    });
  }
  await resolveFilledGaps().catch((err) => logger.warn({ err: (err as Error).message }, "[attendance-heal] closing filled gap items failed"));
  return base;
}

/**
 * Closes "missing attendance record" items whose record now exists, of ANY age. The nightly audit only
 * rechecks the last 7 days, so an item older than that could never clear itself even after it was fixed.
 */
export async function resolveFilledGaps(): Promise<number> {
  const [res] = await db.execute<{ affectedRows?: number } & RowDataPacket[]>(
    `UPDATE attendance_reconciliation_issue ari
       JOIN attendance_daily_record adr
         ON adr.employee_id = ari.employee_id AND adr.record_date = ari.issue_date
        SET ari.resolved_at = NOW(),
            ari.auto_fix_status = 'fixed',
            ari.auto_fix_reason = 'Attendance record now exists'
      WHERE ari.resolved_at IS NULL AND ari.issue_type = 'missing_adr'`,
  );
  return Number((res as { affectedRows?: number })?.affectedRows ?? 0);
}

/** What the nightly job, the restart job and the heal worker run: last 7 complete days, capped. */
export async function runAutomaticHeal(): Promise<HealResult & { stale?: StaleRegradeResult }> {
  const today = nowIST().split("T")[0]!;
  const { from, to } = autoHealWindow(today);
  const result: HealResult & { stale?: StaleRegradeResult } =
    await healMissingAttendance({ from, to, limit: MAX_PERSON_DAYS_PER_RUN, actor: "system:attendance-heal" });
  // Days that exist but were graded before their punches / dialler minutes arrived (attendance-stale-regrade.service.ts).
  try {
    result.stale = await regradeStaleDays(from, to);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "[attendance-heal] stale-day re-grade failed");
  }
  // healMissingAttendance returns early when nothing is missing, but records can also appear from elsewhere
  // (the COSEC sync, a correction), leaving old "missing record" items open. Close those on every pass.
  if (result.found === 0) {
    await resolveFilledGaps().catch((err) => logger.warn({ err: (err as Error).message }, "[attendance-heal] closing filled gap items failed"));
  }
  return result;
}

export { addDays };
