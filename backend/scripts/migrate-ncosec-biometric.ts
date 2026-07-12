/**
 * migrate-ncosec-biometric.ts
 *
 * One-shot ETL: Matrix Cosec NCOSEC (<NCOSEC_DB_HOST>) → HRMS MySQL
 *
 * Logic:
 *   1. Connect to NCOSEC MSSQL
 *   2. Query Mx_ATDEventTrn JOIN Mx_UserMst — MIN(lDateTime) as first_punch_in,
 *      MAX(lDateTime) as last_punch_out, grouped by UserID + calendar day
 *   3. Map Cosec UserID → HRMS employee_id via employee_biometric_enrollment
 *      OR fallback: assume UserID == employee_code
 *   4. Upsert biometric_attendance_log
 *   5. Upsert attendance_daily_record (clock_in_time, clock_out_time, raw_minutes, status)
 *   6. Link biometric_attendance_log.attendance_record_id to the ADR row
 *   7. Auto-create employee_biometric_enrollment rows for matched employees
 *   8. Print summary
 *
 * Run: cd backend && npx tsx scripts/migrate-ncosec-biometric.ts
 * Safe to re-run: ON DUPLICATE KEY UPDATE ensures idempotency
 */

import 'dotenv/config';
import sql from 'mssql';
import { randomUUID } from 'crypto';
import { getNcosecPool, closeNcosecPool, testNcosecConnection } from '../src/db/ncosecDb.js';
import { db } from '../src/db/mysql.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

const IST_TIME_ZONE = 'Asia/Kolkata';

interface NcosecRow {
  UserID:          string;   // nvarchar — employee name/code in Cosec
  Name:            string;   // from Mx_UserMst (may be same as UserID)
  punch_date:      Date | string;
  first_punch_in:  Date;     // IDateTime (actual datetime, not Unix timestamp)
  last_punch_out:  Date;     // IDateTime
}

interface EmployeeMap {
  [cosecUserId: string]: { employeeId: string; employeeCode: string };
}

type EnrolledRow = RowDataPacket & { cosec_user_id: string; employee_id: string; cosec_user_name: string };
type EmployeeRow = RowDataPacket & { id: string; employee_code: string };
type BiometricLogRow = RowDataPacket & { id?: string };
type EmployeeInfoRow = RowDataPacket & { branch_id?: string | number | null; process_id?: string | number | null };
type AttendanceRow = RowDataPacket & { id?: string };

interface Summary {
  total_ncosec_rows:     number;
  attendance_inserted:   number;
  attendance_updated:    number;
  employees_not_found:   string[];
  errors:                Array<{ userId: string; date: string; error: string }>;
}

/**
 * Fetch one single day's punch data from NCOSEC.
 * Querying day-by-day avoids timeout on the 3M-row table.
 * Each day query touches ~8,000 rows and completes in <1s.
 */
async function fetchNcosecPunchesForDay(
  pool: sql.ConnectionPool,
  dateStr: string  // 'YYYY-MM-DD'
): Promise<NcosecRow[]> {
  const result = await pool.request()
    .input('d', sql.VarChar(10), dateStr)
    .query<NcosecRow>(`
      SELECT
          e.UserID,
          e.UserID                    AS Name,
          CAST(e.Edatetime AS DATE)   AS punch_date,
          MIN(e.IDateTime)            AS first_punch_in,
          MAX(e.IDateTime)            AS last_punch_out
      FROM Mx_ATDEventTrn e WITH (NOLOCK)
      WHERE CAST(e.Edatetime AS DATE) = CONVERT(date, @d, 23)
        AND e.IDateTime IS NOT NULL
        AND e.UserID    IS NOT NULL
        AND LEN(LTRIM(RTRIM(e.UserID))) > 0
      GROUP BY e.UserID, CAST(e.Edatetime AS DATE)
      HAVING COUNT(*) >= 1
    `);
  return result.recordset;
}

function formatDateParts(date: Date): { year: string; month: string; day: string; hour: string; minute: string; second: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? '00';
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

function formatISTDate(date: Date): string {
  const { year, month, day } = formatDateParts(date);
  return `${year}-${month}-${day}`;
}

function formatISTDateTime(date: Date): string {
  const { year, month, day, hour, minute, second } = formatDateParts(date);
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function todayIST(): string {
  return formatISTDate(new Date());
}

/** Generate array of date strings YYYY-MM-DD from startDate to today (inclusive) */
function dateRange(startDate: Date): string[] {
  const dates: string[] = [];
  const cur = new Date(startDate);
  cur.setHours(0, 0, 0, 0);
  const today = todayIST();
  while (formatISTDate(cur) <= today) {
    dates.push(formatISTDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

async function buildEmployeeMap(): Promise<EmployeeMap> {
  console.log('[HRMS] Building UserID → employee_id map...');
  // Check existing enrollments first
  const [enrolled] = await db.execute<EnrolledRow[]>(
    `SELECT cosec_user_id, employee_id, cosec_user_name FROM employee_biometric_enrollment WHERE is_active = 1`
  );
  const map: EmployeeMap = {};
  if (enrolled.length > 0) {
    for (const r of enrolled) map[r.cosec_user_id] = { employeeId: r.employee_id, employeeCode: r.cosec_user_id };
    console.log(`[HRMS] Loaded ${enrolled.length} existing enrollment mappings`);
  }
  // Fill in remaining via employee_code match (UserID often == employee_code in Cosec)
  const [employees] = await db.execute<EmployeeRow[]>(
    `SELECT id, employee_code FROM employees WHERE active_status = 1`
  );
  for (const emp of employees) {
    if (!map[emp.employee_code]) {
      map[emp.employee_code] = { employeeId: emp.id, employeeCode: emp.employee_code };
    }
  }
  console.log(`[HRMS] Total mappable employees: ${Object.keys(map).length}`);
  return map;
}

async function ensureEnrollment(employeeId: string, cosecUserId: string, name: string): Promise<void> {
  await db.execute(`
    INSERT IGNORE INTO employee_biometric_enrollment
      (id, employee_id, cosec_user_id, cosec_user_name, is_active, last_sync_at)
    VALUES (UUID(), ?, ?, ?, 1, NOW())
  `, [employeeId, cosecUserId, name]);
}

async function upsertBiometricLog(
  employeeId: string, cosecUserId: string,
  punchDate: string, punchIn: Date, punchOut: Date,
  rawMinutes: number
): Promise<string> {
  const punchInText = formatISTDateTime(punchIn);
  const punchOutText = formatISTDateTime(punchOut);

  await db.execute(`
    INSERT INTO biometric_attendance_log
      (id, employee_id, cosec_user_id, punch_date, first_punch_in, last_punch_out, raw_minutes, source_system)
    VALUES (UUID(), ?, ?, ?, ?, ?, ?, 'ncosec')
    ON DUPLICATE KEY UPDATE
      first_punch_in = VALUES(first_punch_in),
      last_punch_out = VALUES(last_punch_out),
      raw_minutes    = VALUES(raw_minutes),
      migrated_at    = NOW()
  `, [employeeId, cosecUserId, punchDate, punchInText, punchOutText, rawMinutes]);

  const [rows] = await db.execute<BiometricLogRow[]>(
    `SELECT id FROM biometric_attendance_log WHERE employee_id = ? AND punch_date = ? LIMIT 1`,
    [employeeId, punchDate]
  );
  return rows[0]?.id ?? '';
}

async function upsertAttendanceDailyRecord(
  employeeId: string, punchDate: string,
  punchIn: Date, punchOut: Date, rawMinutes: number,
  bioLogId: string
): Promise<'inserted' | 'updated'> {
  const status = rawMinutes >= 360 ? 'present' : rawMinutes >= 180 ? 'half_day' : 'absent';
  const punchInText = formatISTDateTime(punchIn);
  const punchOutText = formatISTDateTime(punchOut);

  const [empInfo] = await db.execute<EmployeeInfoRow[]>(
    `SELECT branch_id, process_id FROM employees WHERE id = ? LIMIT 1`, [employeeId]
  );
  const emp = empInfo[0] ?? {};

  const [res] = await db.execute<ResultSetHeader>(`
    INSERT INTO attendance_daily_record
      (id, employee_id, record_date, clock_in_time, clock_out_time, raw_minutes,
       attendance_status, attendance_source, branch_id, process_id, created_by)
    VALUES (UUID(), ?, ?, ?, ?, ?, ?, 'biometric', ?, ?, 'ncosec_migration')
    ON DUPLICATE KEY UPDATE
      clock_in_time     = VALUES(clock_in_time),
      clock_out_time    = VALUES(clock_out_time),
      raw_minutes       = VALUES(raw_minutes),
      attendance_status = VALUES(attendance_status),
      attendance_source = 'biometric',
      created_by        = 'ncosec_migration'
  `, [employeeId, punchDate, punchInText, punchOutText, rawMinutes, status,
      emp.branch_id ?? null, emp.process_id ?? null]);

  const wasInsert = res.affectedRows === 1;

  // Link biometric log → attendance record
  if (bioLogId) {
    const [adrRow] = await db.execute<AttendanceRow[]>(
      `SELECT id FROM attendance_daily_record WHERE employee_id = ? AND record_date = ? LIMIT 1`,
      [employeeId, punchDate]
    );
    if (adrRow[0]?.id) {
      await db.execute(
        `UPDATE biometric_attendance_log SET attendance_record_id = ? WHERE id = ?`,
        [adrRow[0].id, bioLogId]
      );
    }
  }
  return wasInsert ? 'inserted' : 'updated';
}

export async function runNcosecBiometricSync(): Promise<Summary> {
  console.log('\n=================================================');
  console.log('  NCOSEC → HRMS Biometric Sync');
  console.log('  NCOSEC Server: <NCOSEC_DB_HOST>');
  console.log('=================================================\n');

  console.log('[1/5] Testing NCOSEC connection...');
  const test = await testNcosecConnection();
  if (!test.ok) {
    throw new Error(`Cannot connect to NCOSEC: ${test.error}`);
  }
  console.log('   ✓ NCOSEC connected\n');

  const summary: Summary = {
    total_ncosec_rows: 0, attendance_inserted: 0,
    attendance_updated: 0, employees_not_found: [], errors: [],
  };

  try {
    console.log('[2/5] Connecting to NCOSEC...');
    const ncPool = await getNcosecPool();

    // Generate list of dates: last 3 months → today
    const lookbackDays = Math.max(1, Number(process.env.NCOSEC_LEGACY_SYNC_LOOKBACK_DAYS ?? 90) || 90);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (lookbackDays - 1));
    const dates = dateRange(startDate);
    console.log(`[NCOSEC] Will process ${dates.length} days (${dates[0]} → ${dates[dates.length - 1]})`);

    console.log('[3/5] Building employee map...');
    const empMap = await buildEmployeeMap();

    console.log('[4/5] Importing records day-by-day...');
    let processed = 0;
    let skippedDays = 0;
    const notFound = new Set<string>();

    for (const dateStr of dates) {
      let dayRows: NcosecRow[];
      try {
        dayRows = await fetchNcosecPunchesForDay(ncPool, dateStr);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`  [WARN] Failed to fetch ${dateStr}: ${message}`);
        skippedDays++;
        continue;
      }

      if (dayRows.length === 0) continue;
      summary.total_ncosec_rows += dayRows.length;

      for (const row of dayRows) {
      try {
        const cosecId = String(row.UserID).trim();
        const match = empMap[cosecId];
        if (!match) { notFound.add(cosecId); continue; }

        // IDateTime is already a JS Date from mssql (datetime column)
        const punchIn  = new Date(row.first_punch_in);
        const punchOut = new Date(row.last_punch_out);

        // Convert punch_date to YYYY-MM-DD string
        const pd = row.punch_date;
        const punchDate = pd instanceof Date
          ? formatISTDate(pd)
          : String(pd).slice(0, 10);

        // Skip single-scan days (same punch = can't distinguish in vs out)
        if (punchIn.getTime() === punchOut.getTime()) continue;

        const rawMinutes = Math.max(0, Math.floor((punchOut.getTime() - punchIn.getTime()) / 60000));

        await ensureEnrollment(match.employeeId, cosecId, row.Name);
        const bioLogId = await upsertBiometricLog(match.employeeId, cosecId, punchDate, punchIn, punchOut, rawMinutes);
        const action = await upsertAttendanceDailyRecord(match.employeeId, punchDate, punchIn, punchOut, rawMinutes, bioLogId);

        if (action === 'inserted') summary.attendance_inserted++;
        else summary.attendance_updated++;

        processed++;

      } catch (error: unknown) {
        summary.errors.push({
          userId: String(row.UserID),
          date:   String(row.punch_date).slice(0, 10),
          error:  error instanceof Error ? error.message : String(error),
        });
      }
      } // end inner for (row of dayRows)

      // Progress per day
      process.stdout.write(`   [${dateStr}] ${dayRows.length} users → ${processed} imported\r`);
    } // end for (dateStr of dates)
    summary.employees_not_found = Array.from(notFound);

  } finally {
    await closeNcosecPool();
  }

  console.log('\n[5/5] Done.\n');
  console.log('=================================================');
  console.log('  SYNC SUMMARY');
  console.log('=================================================');
  console.log(`  NCOSEC rows read       : ${summary.total_ncosec_rows}`);
  console.log(`  Attendance inserted    : ${summary.attendance_inserted}`);
  console.log(`  Attendance updated     : ${summary.attendance_updated}`);
  console.log(`  Errors                 : ${summary.errors.length}`);
  if (summary.employees_not_found.length > 0) {
    console.log(`\n  ⚠  ${summary.employees_not_found.length} Cosec UserID(s) not matched to HRMS:`);
    summary.employees_not_found.slice(0, 20).forEach(id => console.log(`     UserID: ${id}`));
    if (summary.employees_not_found.length > 20)
      console.log(`     ... and ${summary.employees_not_found.length - 20} more`);
    console.log('\n  Fix: Ensure HRMS employee_code matches Cosec UserID,');
    console.log('       OR add manual rows to employee_biometric_enrollment table.');
  }
  if (summary.errors.length > 0) {
    console.log('\n  Errors (first 10):');
    summary.errors.slice(0, 10).forEach(e => console.log(`    UserID ${e.userId} / ${e.date}: ${e.error}`));
  }
  console.log('=================================================\n');

  return summary;
}

// Standalone run support
if (import.meta.url === `file://${process.argv[1]}`) {
  runNcosecBiometricSync()
    .then(summary => process.exit(summary.errors.length > 0 ? 1 : 0))
    .catch(err => { console.error('Fatal:', err); process.exit(1); });
}
