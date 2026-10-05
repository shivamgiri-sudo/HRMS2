import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { COSEC_DEFAULT_FULL_DAY_MINUTES, resolveHalfDayFloorMinutes } from './attendance-engine.service.js';

/**
 * The day thresholds the engine really applies. attendance_rule_config's full/half minutes are
 * NOT among them: processDay() overwrites them for APR (480 / net-login floor) and grades COSEC
 * with classifyCosecMinutes (540 default, per-employee exception buckets, biometric floor), so
 * the rules table's numbers do not reach a day's status. Only grace_minutes (late marks on
 * biometric days) is read from a rule. This is what the Rules Master shows as "in force".
 */
export async function getDayThresholdsInForce(): Promise<{
  apr: { full_day_minutes: number; half_day_floor_minutes: number; full_day_configurable: boolean };
  cosec: { full_day_minutes: number; half_day_floor_minutes: number; per_employee_overrides: number };
}> {
  const [aprFloor, cosecFloor] = await Promise.all([
    resolveHalfDayFloorMinutes('netlogin_half_day_floor_minutes'),
    resolveHalfDayFloorMinutes('biometric_half_day_floor_minutes'),
  ]);
  let overrides = 0;
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM employee_attendance_exception_bucket WHERE active_status = 1`);
    overrides = Number((rows as any[])[0]?.n ?? 0);
  } catch { /* table absent on an older schema: report none */ }
  return {
    apr: { full_day_minutes: 480, half_day_floor_minutes: aprFloor, full_day_configurable: false },
    cosec: { full_day_minutes: COSEC_DEFAULT_FULL_DAY_MINUTES, half_day_floor_minutes: cosecFloor, per_employee_overrides: overrides },
  };
}
