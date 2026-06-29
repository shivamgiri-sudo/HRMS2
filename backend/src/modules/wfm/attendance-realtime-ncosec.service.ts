/**
 * Real-time NCOSEC Attendance Display Service
 *
 * Purpose: Direct read-only queries to NCOSEC for real-time punch display
 * Scope: DISPLAY ONLY - does not affect payroll calculations
 *
 * This service bypasses the sync process for immediate visibility.
 * Payroll/WFM calculations continue using the validated sync pipeline:
 *   NCOSEC → integration_biometric_daily → biometric_attendance_log → attendance_daily_record
 */

import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { getNcosecPool } from '../../db/ncosecDb.js';
import { env } from '../../config/env.js';

interface RealTimePunch {
  punch_date: string;
  first_punch_in: string | null;   // already IST-tagged: "YYYY-MM-DDTHH:mm:ss+05:30"
  last_punch_out: string | null;   // already IST-tagged: "YYYY-MM-DDTHH:mm:ss+05:30"
  total_punches: number;
  raw_minutes: number;
  source: 'ncosec_realtime';
}

/**
 * NCOSEC stores IST times (wall-clock). We query with CONVERT(CHAR) to get
 * string values directly from MSSQL with NO driver conversion.
 * Result: "2026-06-27 15:38:29" (exact IST time from NCOSEC)
 * We just replace space with T and tag +05:30 - NO arithmetic, NO offset.
 */

interface EmployeeCosecMapping {
  employee_id: string;
  employee_code: string;
  cosec_user_id: string;
}

/**
 * Get employee's COSEC UserID mapping from HRMS database
 */
async function getEmployeeCosecMapping(employeeId: string): Promise<EmployeeCosecMapping | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id as employee_id, e.employee_code,
            COALESCE(em.external_id, e.employee_code) as cosec_user_id
     FROM employees e
     LEFT JOIN employee_external_mapping em ON em.employee_id = e.id AND em.system_name = 'ncosec' AND em.is_active = 1
     WHERE e.id = ?
     LIMIT 1`,
    [employeeId]
  );

  if (rows.length === 0) return null;

  return {
    employee_id: rows[0].employee_id as string,
    employee_code: rows[0].employee_code as string,
    cosec_user_id: rows[0].cosec_user_id as string,
  };
}

/**
 * Query NCOSEC directly for today's punch events
 * READ-ONLY: Does not modify NCOSEC or HRMS data
 */
export async function getRealTimePunchesToday(employeeId: string): Promise<RealTimePunch | null> {
  // Get COSEC mapping
  const mapping = await getEmployeeCosecMapping(employeeId);
  if (!mapping) {
    console.warn(`[realtime-ncosec] No COSEC mapping found for employee ${employeeId}`);
    return null;
  }

  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  try {
    const pool = await getNcosecPool();
    const result = await pool.request()
      .input('userId', mapping.cosec_user_id)
      .input('dateStart', `${todayStr} 00:00:00`)
      .input('dateEnd', `${todayStr} 23:59:59`)
      .query(`
        SELECT
          UserID,
          CONVERT(CHAR(19), MIN(Edatetime), 120) as first_punch,
          CONVERT(CHAR(19), MAX(Edatetime), 120) as last_punch,
          COUNT(*) as total_punches,
          DATEDIFF(MINUTE, MIN(Edatetime), MAX(Edatetime)) as raw_minutes
        FROM ${env.NCOSEC_EVENT_TABLE || 'dbo.Mx_ATDEventTrn'}
        WHERE UserID = @userId
          AND Edatetime >= @dateStart
          AND Edatetime <= @dateEnd
        GROUP BY UserID
      `);

    if (result.recordset.length === 0) {
      return null;
    }

    const row = result.recordset[0];

    // NCOSEC stores IST times. Query returns them as strings via CONVERT(CHAR).
    // Just tag with +05:30, no conversion needed.
    const tagIST = (str: string | null) => str ? str.replace(' ', 'T') + '+05:30' : null;

    return {
      punch_date: todayStr,
      first_punch_in: tagIST(row.first_punch),
      last_punch_out: row.total_punches > 1 ? tagIST(row.last_punch) : null,
      total_punches: row.total_punches || 0,
      raw_minutes: row.raw_minutes || 0,
      source: 'ncosec_realtime',
    };
  } catch (error) {
    console.error('[realtime-ncosec] Query failed:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * Get real-time punch data for a date range (max 7 days for performance)
 */
export async function getRealTimePunchesRange(
  employeeId: string,
  fromDate: string,
  toDate: string
): Promise<RealTimePunch[]> {
  const mapping = await getEmployeeCosecMapping(employeeId);
  if (!mapping) {
    return [];
  }

  // Cap at 7 days for performance
  const from = new Date(fromDate);
  const to = new Date(toDate);
  const daysDiff = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));

  if (daysDiff > 7) {
    throw new Error('Date range limited to 7 days for real-time queries');
  }

  try {
    const pool = await getNcosecPool();
    const result = await pool.request()
      .input('userId', mapping.cosec_user_id)
      .input('dateStart', `${fromDate} 00:00:00`)
      .input('dateEnd', `${toDate} 23:59:59`)
      .query(`
        SELECT
          CONVERT(CHAR(10), CAST(Edatetime AS DATE), 23) as punch_date,
          CONVERT(CHAR(19), MIN(Edatetime), 120) as first_punch,
          CONVERT(CHAR(19), MAX(Edatetime), 120) as last_punch,
          COUNT(*) as total_punches,
          DATEDIFF(MINUTE, MIN(Edatetime), MAX(Edatetime)) as raw_minutes
        FROM ${env.NCOSEC_EVENT_TABLE || 'dbo.Mx_ATDEventTrn'}
        WHERE UserID = @userId
          AND Edatetime >= @dateStart
          AND Edatetime <= @dateEnd
        GROUP BY CAST(Edatetime AS DATE)
        ORDER BY CAST(Edatetime AS DATE) DESC
      `);

    const tagIST = (str: string | null) => str ? str.replace(' ', 'T') + '+05:30' : null;

    return result.recordset.map(row => ({
      punch_date: String(row.punch_date),
      first_punch_in: tagIST(row.first_punch),
      last_punch_out: row.total_punches > 1 ? tagIST(row.last_punch) : null,
      total_punches: row.total_punches || 0,
      raw_minutes: row.raw_minutes || 0,
      source: 'ncosec_realtime',
    }));
  } catch (error) {
    console.error('[realtime-ncosec] Range query failed:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}
