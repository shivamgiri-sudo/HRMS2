/**
 * Attendance diagnostics — pinpoint why HRMS shows Present but APR says Absent.
 *
 * Common causes:
 * 1. Employee not in ViciDial — no APR record at all
 * 2. call_centre_code or employee_code mismatch — APR UserID doesn't match employee
 * 3. Zero net login — APR has record but Net_Login is NULL or 0 mins
 * 4. attendance_source mismatch — record set to biometric but should be dialler
 */

import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { getAprMonthly } from './apr-attendance.service.js';
import { classifyOperationsNetLogin } from './attendance-engine.service.js';

export interface AttendanceDiagnostic {
  employee_code: string;
  employee_name: string;
  record_date: string;
  hrms_status: string;
  hrms_source: string;
  apr_found: boolean;
  apr_net_minutes: number | null;
  apr_status: string | null;
  apr_net_login: string | null;
  issue: string | null;
  call_centre_code: string | null;
  employee_id: string;
}

export async function diagnoseAttendanceMismatch(
  empCode: string,
  recordDate: string,
): Promise<AttendanceDiagnostic | null> {
  // Fetch employee
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, emp_code, first_name, last_name, call_centre_code,
            biometric_code, employee_code FROM employees WHERE emp_code = ? LIMIT 1`,
    [empCode],
  );
  if (empRows.length === 0) return null;

  const emp = empRows[0]!;
  const empId = String(emp.id);
  const empName = `${emp.first_name} ${emp.last_name || ''}`.trim();

  // Fetch HRMS attendance record for that day
  const [hrmRows] = await db.execute<RowDataPacket[]>(
    `SELECT attendance_status, attendance_source, raw_minutes FROM attendance_daily_record
      WHERE employee_id = ? AND record_date = ? LIMIT 1`,
    [empId, recordDate],
  );
  const hrmRecord = hrmRows[0];

  // Fetch APR data
  const aprRecords = await getAprMonthly(
    {
      call_centre_code: emp.call_centre_code || undefined,
      employee_code: emp.employee_code || undefined,
      biometric_code: emp.biometric_code || undefined,
    },
    recordDate,
    recordDate,
  );

  const aprRecord = aprRecords.find((r) => r.record_date === recordDate);

  let issue: string | null = null;

  if (!hrmRecord) {
    issue = 'No HRMS attendance record found for this date';
  } else if (hrmRecord.attendance_source === 'biometric' && !aprRecord) {
    issue = 'HRMS source=biometric but employee has no APR records (not in ViciDial)';
  } else if (aprRecord && aprRecord.net_minutes === 0) {
    issue = `APR found but zero net login (${aprRecord.net_login || '0:00:00'}). HRMS shows ${hrmRecord.attendance_status} from ${hrmRecord.attendance_source} instead.`;
  } else if (aprRecord && hrmRecord.attendance_status !== aprRecord.attendance_status) {
    issue = `Status mismatch: HRMS=${hrmRecord.attendance_status}, APR=${aprRecord.attendance_status}. Check if record was manually overridden.`;
  }

  return {
    employee_code: empCode,
    employee_name: empName,
    record_date: recordDate,
    hrms_status: hrmRecord?.attendance_status ?? 'no_record',
    hrms_source: hrmRecord?.attendance_source ?? 'unknown',
    apr_found: !!aprRecord,
    apr_net_minutes: aprRecord?.net_minutes ?? null,
    apr_status: aprRecord?.attendance_status ?? null,
    apr_net_login: aprRecord?.net_login ?? null,
    issue,
    call_centre_code: emp.call_centre_code || null,
    employee_id: empId,
  };
}

export async function batchDiagnose(
  empCodes: string[],
  dateFrom: string,
  dateTo: string,
): Promise<AttendanceDiagnostic[]> {
  const results: AttendanceDiagnostic[] = [];

  for (const code of empCodes) {
    // Get HRMS records for this employee in date range
    const [hrmRows] = await db.execute<RowDataPacket[]>(
      `SELECT attendance_status, attendance_source, raw_minutes, record_date, id, employee_id
        FROM attendance_daily_record a
        JOIN employees e ON e.id = a.employee_id
       WHERE e.emp_code = ? AND a.record_date BETWEEN ? AND ?
       ORDER BY a.record_date ASC`,
      [code, dateFrom, dateTo],
    );

    // Fetch employee details once
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, emp_code, first_name, last_name, call_centre_code, biometric_code, employee_code
        FROM employees WHERE emp_code = ? LIMIT 1`,
      [code],
    );
    if (empRows.length === 0) continue;

    const emp = empRows[0]!;
    const empName = `${emp.first_name} ${emp.last_name || ''}`.trim();

    // Fetch APR month
    const aprData = await getAprMonthly(
      {
        call_centre_code: emp.call_centre_code || undefined,
        employee_code: emp.employee_code || undefined,
        biometric_code: emp.biometric_code || undefined,
      },
      dateFrom,
      dateTo,
    );

    // Map HRMS records to diagnostics
    for (const hrm of hrmRows) {
      const apr = aprData.find((r) => r.record_date === hrm.record_date);
      let issue: string | null = null;

      if (hrm.attendance_source === 'biometric' && !apr) {
        issue = 'No APR record; using biometric source';
      } else if (apr && apr.net_minutes === 0) {
        issue = `APR zero net login (${apr.net_login || '0:00'}); HRMS shows ${hrm.attendance_status}`;
      } else if (apr && hrm.attendance_status !== apr.attendance_status) {
        issue = `Mismatch: HRMS=${hrm.attendance_status}, APR=${apr.attendance_status}`;
      }

      results.push({
        employee_code: code,
        employee_name: empName,
        record_date: hrm.record_date,
        hrms_status: hrm.attendance_status,
        hrms_source: hrm.attendance_source,
        apr_found: !!apr,
        apr_net_minutes: apr?.net_minutes ?? null,
        apr_status: apr?.attendance_status ?? null,
        apr_net_login: apr?.net_login ?? null,
        issue,
        call_centre_code: emp.call_centre_code || null,
        employee_id: String(emp.id),
      });
    }
  }

  return results;
}
