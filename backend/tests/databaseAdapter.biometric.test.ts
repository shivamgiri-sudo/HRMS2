import { describe, expect, it } from 'vitest';
import { buildBiometricAggregateQuery } from '../src/modules/integration-hub/adapters/databaseAdapter.js';

describe('biometric database adapter', () => {
  it('builds an MSSQL daily punch aggregation from a single event timestamp', () => {
    const sql = buildBiometricAggregateQuery('dbo.AttendanceEvents', {
      dialect: 'mssql',
      employeeCodeCol: 'EmployeeCode',
      dateCol: 'EventTime',
      punchTimeCol: 'EventTime',
      fromDate: '2026-06-01',
      toDate: '2026-06-14',
    });

    expect(sql).toContain('[dbo].[AttendanceEvents]');
    expect(sql).toContain('MIN([EventTime]) AS first_punch');
    expect(sql).toContain('MAX([EventTime]) AS last_punch');
    expect(sql).toContain('DATEDIFF(MINUTE');
    expect(sql).toContain("CAST([EventTime] AS date) >= '2026-06-01'");
  });

  it('uses a mapped daily duration when the source already calculates minutes', () => {
    const sql = buildBiometricAggregateQuery('daily_attendance', {
      dialect: 'mysql',
      employeeCodeCol: 'employee_code',
      dateCol: 'attendance_date',
      firstPunchCol: 'in_time',
      lastPunchCol: 'out_time',
      minutesCol: 'net_minutes',
    });

    expect(sql).toContain('MAX(COALESCE(`net_minutes`, 0))');
    expect(sql).toContain('MIN(`in_time`) AS first_punch');
    expect(sql).toContain('MAX(`out_time`) AS last_punch');
  });
});
