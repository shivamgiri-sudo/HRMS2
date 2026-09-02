/**
 * APR (dialler) attendance source.
 *
 * `mas_hrms.apr` is populated hourly from ViciDial by apr-vicidial-sync.worker.ts
 * and is the source of truth for dialler/Operations-Executive attendance, in the
 * same way COSEC/NCOSEC is for biometric employees.
 *
 * IMPORTANT — column types: Login_Time, Logout_Time, Net_Login and every break
 * column are MySQL TIME, returned by mysql2 as bare "HH:MM:SS" strings with no
 * date part. Never pass one to `new Date()` — it yields Invalid Date, which is
 * what caused login/logout to render blank on the attendance lookup page.
 * TIME may legitimately exceed 24h on night shifts (e.g. "27:30:00").
 */
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { classifyOperationsNetLogin, resolveHalfDayFloorMinutes } from './attendance-engine.service.js';

/** Employee identity columns that may carry the ViciDial agent id (`apr.UserID`). */
export interface AprEmployeeKeys {
  employee_code?: string | null;
  call_centre_code?: string | null;
  biometric_code?: string | null;
}

export interface AprDailyRecord {
  record_date: string;          // YYYY-MM-DD
  login_time: string | null;    // raw TIME "HH:MM:SS"
  logout_time: string | null;   // raw TIME "HH:MM:SS"
  login_at: string | null;      // IST-tagged datetime, safe for `new Date()`
  logout_at: string | null;     // IST-tagged datetime, safe for `new Date()`
  net_login: string | null;     // raw TIME duration
  net_minutes: number;
  calls: number;
  break_bio: string | null;
  break_lunch: string | null;
  break_qa: string | null;
  break_training: string | null;
  break_dismx: string | null;
  campaigns: string | null;
  attendance_status: 'present' | 'half_day' | 'absent';
  lwp_value: number;
  attendance_source: 'dialler';
  source_system: 'apr';
}

/**
 * Convert a MySQL TIME string ("HH:MM:SS", possibly >= 24h) to whole minutes.
 * Returns 0 for null/blank/malformed input so callers can sum safely.
 */
export function parseSqlTimeToMinutes(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const m = /^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?$/.exec(String(value).trim());
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]) + Math.round(Number(m[3] ?? 0) / 60);
}

/** True when the string is a well-formed MySQL TIME value. */
export function isSqlTime(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return /^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?$/.test(String(value).trim());
}

/**
 * Compose an IST-tagged datetime from a date and a bare TIME so the frontend can
 * parse it with `new Date()` without needing TIME-aware logic. TIME values >= 24h
 * roll the date forward, which is exactly the night-shift semantics we want.
 */
export function composeIstDateTime(date: string | null, time: unknown): string | null {
  if (!date || !isSqlTime(time)) return null;
  const m = /^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?$/.exec(String(time).trim())!;
  const hours = Number(m[1]);
  const dayOffset = Math.floor(hours / 24);
  // Calendar arithmetic only — deliberately done in UTC so the result cannot depend on
  // the host's timezone. The previous form built the instant as +05:30 and then read it
  // back with LOCAL getters: on any host west of +05:30 (UTC runners and servers included)
  // 2026-07-29T00:00+05:30 is 2026-07-28T18:30Z, so getDate() returned the 28th and the
  // function emitted "2026-07-28T09:15:00+05:30" for an input date of 2026-07-29 — every
  // APR datetime tagged one day early. A dev machine in Asia/Kolkata hides this entirely,
  // which is why it survived: the two failing cases pass in IST and fail under TZ=UTC.
  const base = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return null;
  base.setUTCDate(base.getUTCDate() + dayOffset);
  const y = base.getUTCFullYear();
  const mo = String(base.getUTCMonth() + 1).padStart(2, '0');
  const d = String(base.getUTCDate()).padStart(2, '0');
  const hh = String(hours % 24).padStart(2, '0');
  return `${y}-${mo}-${d}T${hh}:${m[2]}:${m[3] ?? '00'}+05:30`;
}

/**
 * Candidate ViciDial agent ids for an employee.
 *
 * The repo historically joined `apr.UserID` on three different columns:
 *   - apr-vicidial-sync.worker.ts enriches on `call_centre_code`
 *   - attendance-engine.service.ts passes `employee_code`
 *   - reporting.service.ts joins `biometric_code`
 * Rather than guess, match on any non-empty candidate. The sync worker writes
 * rows keyed on call_centre_code, so that is tried first.
 */
export function resolveAprUserIds(emp: AprEmployeeKeys): string[] {
  const candidates = [emp.call_centre_code, emp.employee_code, emp.biometric_code];
  const seen = new Set<string>();
  for (const c of candidates) {
    const v = String(c ?? '').trim();
    if (v) seen.add(v);
  }
  return Array.from(seen);
}

/**
 * Per-day APR attendance for one employee over a date range.
 * Aggregates across campaigns — an agent can span several campaigns in a day.
 */
export async function getAprMonthly(
  emp: AprEmployeeKeys,
  fromDate: string,
  toDate: string,
): Promise<AprDailyRecord[]> {
  const userIds = resolveAprUserIds(emp);
  if (userIds.length === 0) {
    console.warn(`[APR] No UserID candidates found for employee: call_centre_code=${emp.call_centre_code}, employee_code=${emp.employee_code}, biometric_code=${emp.biometric_code}`);
    return [];
  }

  const placeholders = userIds.map(() => '?').join(', ');
  // Sargable range predicate on ReportDate (leading column of the apr primary key).
  // Do NOT use DATE_FORMAT(ReportDate, '%Y-%m') — that defeats the index.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(a.ReportDate, '%Y-%m-%d')       AS record_date,
            MIN(NULLIF(a.Login_Time,  '00:00:00'))      AS login_time,
            MAX(NULLIF(a.Logout_Time, '00:00:00'))      AS logout_time,
            SEC_TO_TIME(SUM(TIME_TO_SEC(a.Net_Login)))  AS net_login,
            SUM(TIME_TO_SEC(a.Net_Login))               AS net_seconds,
            SUM(COALESCE(a.Calls, 0))                   AS calls,
            SEC_TO_TIME(SUM(TIME_TO_SEC(a.BIO)))        AS break_bio,
            SEC_TO_TIME(SUM(TIME_TO_SEC(a.LUNCH)))      AS break_lunch,
            SEC_TO_TIME(SUM(TIME_TO_SEC(a.QA)))         AS break_qa,
            SEC_TO_TIME(SUM(TIME_TO_SEC(a.TRAINING)))   AS break_training,
            SEC_TO_TIME(SUM(TIME_TO_SEC(a.DISMX)))      AS break_dismx,
            GROUP_CONCAT(DISTINCT a.campaign_id)        AS campaigns
       FROM apr a
      WHERE a.UserID IN (${placeholders})
        AND a.ReportDate >= ?
        AND a.ReportDate < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY a.ReportDate
      ORDER BY a.ReportDate ASC`,
    [...userIds, fromDate, toDate],
  );

  // Resolved once, before the map — this is a database read, and the classifier
  // is synchronous precisely so it can run per row without a query each time.
  const netLoginHalfDayFloor = await resolveHalfDayFloorMinutes('netlogin_half_day_floor_minutes');

  return (rows as any[]).map((r) => {
    const netMinutes = Math.round(Number(r.net_seconds ?? 0) / 60);
    const { status, lwpValue } = classifyOperationsNetLogin(netMinutes, netLoginHalfDayFloor);
    return {
      record_date: String(r.record_date),
      login_time: r.login_time ?? null,
      logout_time: r.logout_time ?? null,
      login_at: composeIstDateTime(r.record_date, r.login_time),
      logout_at: composeIstDateTime(r.record_date, r.logout_time),
      net_login: r.net_login ?? null,
      net_minutes: netMinutes,
      calls: Number(r.calls ?? 0),
      break_bio: r.break_bio ?? null,
      break_lunch: r.break_lunch ?? null,
      break_qa: r.break_qa ?? null,
      break_training: r.break_training ?? null,
      break_dismx: r.break_dismx ?? null,
      campaigns: r.campaigns ?? null,
      attendance_status: status,
      lwp_value: lwpValue,
      attendance_source: 'dialler' as const,
      source_system: 'apr' as const,
    };
  });
}

/** Raw per-campaign APR rows for a single date — used by the day-detail drawer. */
export async function getAprDayCampaigns(
  emp: AprEmployeeKeys,
  date: string,
): Promise<Array<Record<string, unknown>>> {
  const userIds = resolveAprUserIds(emp);
  if (userIds.length === 0) return [];
  const placeholders = userIds.map(() => '?').join(', ');
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT a.campaign_id, a.UserID AS user_id,
            a.Login_Time  AS login_time,
            a.Logout_Time AS logout_time,
            a.Net_Login   AS net_login,
            a.Calls       AS calls,
            a.AHT         AS aht,
            a.TALK_TIME   AS talk_time,
            a.WAIT_TIME   AS wait_time,
            a.DISPO_TIME  AS dispo_time,
            a.PAUSE_TIME  AS pause_time,
            a.BIO AS bio, a.LUNCH AS lunch, a.QA AS qa,
            a.TRAINING AS training, a.DISMX AS dismx
       FROM apr a
      WHERE a.UserID IN (${placeholders}) AND a.ReportDate = ?
      ORDER BY a.campaign_id ASC`,
    [...userIds, date],
  );
  return rows as any[];
}
