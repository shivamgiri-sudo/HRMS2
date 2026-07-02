import { db } from '../../db/mysql.js';
import { getAprPool } from '../../db/aprDb.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

const APR_TABLES = [
  'vicidial_agent_log_10_25',
  'vicidial_agent_log_10_4',
  'vicidial_agent_log_11_4',
  'vicidial_agent_log_11_5',
  'vicidial_agent_log_247',
  'vicidial_agent_log_249',
  'vicidial_agent_log_250',
  'vicidial_agent_log_9',
];

// Fetch metric IDs from kpi_metric_master by code
async function getMetricIds(codes: string[]): Promise<Map<string, string>> {
  const placeholders = codes.map(() => '?').join(',');
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, metric_code FROM kpi_metric_master WHERE metric_code IN (${placeholders})`,
    codes
  );
  const map = new Map<string, string>();
  for (const row of rows as any[]) map.set(row.metric_code, row.id);
  return map;
}

// UPSERT a daily actual value
async function upsertDailyActual(
  employeeId: string,
  metricId: string,
  date: string,
  value: number,
  source: 'apr' | 'attendance' | 'quality' | 'manual' | 'calculated'
) {
  await db.execute<ResultSetHeader>(
    `INSERT INTO kpi_daily_actual (employee_id, metric_id, score_date, actual_value, source)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE actual_value = VALUES(actual_value), source = VALUES(source)`,
    [employeeId, metricId, date, value, source]
  );
}

// ─── Sync Integration Hub call aggregates ────────────────────────────────────

export async function syncIntegrationCallMetrics(date: string): Promise<{ synced: number; skipped: number }> {
  const metricIds = await getMetricIds(['TALK_TIME', 'DIALS']);
  if (!metricIds.size) return { synced: 0, skipped: 0 };

  await db.execute(
    `UPDATE employees e
     JOIN (
       SELECT icd.employee_code, MIN(ipa.process_id) AS process_id
       FROM integration_call_daily icd
       JOIN integration_process_alias ipa
         ON ipa.source_value = UPPER(TRIM(icd.process_name))
        AND ipa.active_status = 1
       WHERE icd.activity_date = ?
       GROUP BY icd.employee_code
       HAVING COUNT(DISTINCT ipa.process_id) = 1
     ) mapped
       ON UPPER(TRIM(mapped.employee_code)) = UPPER(TRIM(e.employee_code))
     SET e.process_id = mapped.process_id
     WHERE e.active_status = 1 AND e.process_id IS NULL`,
    [date]
  );

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       e.id AS employee_id,
       SUM(icd.total_calls) AS total_calls,
       SUM(icd.talk_minutes) AS talk_minutes
     FROM integration_call_daily icd
     JOIN employees e
       ON UPPER(TRIM(e.employee_code)) = UPPER(TRIM(icd.employee_code))
      AND e.active_status = 1
     WHERE icd.activity_date = ?
     GROUP BY e.id`,
    [date]
  );

  let synced = 0;
  for (const row of rows as any[]) {
    const totalCalls = Number(row.total_calls ?? 0);
    const talkMinutes = Number(row.talk_minutes ?? 0);
    if (metricIds.has('DIALS')) {
      await upsertDailyActual(row.employee_id, metricIds.get('DIALS')!, date, totalCalls, 'apr');
    }
    if (metricIds.has('TALK_TIME') && totalCalls > 0) {
      const averageTalkSeconds = (talkMinutes * 60) / totalCalls;
      await upsertDailyActual(
        row.employee_id,
        metricIds.get('TALK_TIME')!,
        date,
        Math.round(averageTalkSeconds * 10) / 10,
        'apr'
      );
    }
    synced++;
  }

  return { synced, skipped: 0 };
}

// ─── Sync APR metrics (AHT, TALK_TIME, DIALS, ACW) ────────────────────────────

export async function syncAprMetrics(date: string): Promise<{ synced: number; skipped: number }> {
  let pool: Awaited<ReturnType<typeof getAprPool>> | null = null;
  try {
    pool = await getAprPool();
  } catch {
    return { synced: 0, skipped: 0 };
  }

  const metricIds = await getMetricIds(['AHT', 'TALK_TIME', 'DIALS', 'ACW']);
  if (!metricIds.size) return { synced: 0, skipped: 0 };

  // Build UNION query across all dialer tables
  const unionParts = APR_TABLES.map(t => `SELECT agent_user, talk_time, dispo_time, calls FROM \`${t}\``);
  const unionSql = unionParts.join(' UNION ALL ');

  const aprSql = `
    SELECT
      agent_user,
      SUM(talk_time)  AS total_talk,
      SUM(dispo_time) AS total_dispo,
      SUM(calls)      AS total_calls,
      CASE WHEN SUM(calls) > 0
        THEN ROUND((SUM(talk_time) + SUM(dispo_time)) / SUM(calls), 1)
        ELSE 0
      END AS aht_seconds,
      CASE WHEN SUM(calls) > 0
        THEN ROUND(SUM(dispo_time) / SUM(calls), 1)
        ELSE 0
      END AS acw_seconds
    FROM (${unionSql}) AS combined
    WHERE DATE(event_time) = ?
    GROUP BY agent_user
  `;

  let aprRows: any[] = [];
  try {
    const [rows] = await pool.execute(aprSql, [date]);
    aprRows = rows as any[];
  } catch {
    // APR DB not available — return silently
    return { synced: 0, skipped: 0 };
  }

  if (!aprRows.length) return { synced: 0, skipped: 0 };

  // Map agent_user (employee_code) → employee UUID
  const agentCodes = aprRows.map(r => r.agent_user).filter(Boolean);
  if (!agentCodes.length) return { synced: 0, skipped: 0 };

  const placeholders = agentCodes.map(() => '?').join(',');
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_code FROM employees WHERE employee_code IN (${placeholders}) AND active_status = 1`,
    agentCodes
  );
  const codeToId = new Map<string, string>();
  for (const r of empRows as any[]) codeToId.set(r.employee_code, r.id);

  let synced = 0;
  let skipped = 0;

  for (const row of aprRows) {
    const empId = codeToId.get(row.agent_user);
    if (!empId) { skipped++; continue; }

    if (metricIds.has('AHT') && row.aht_seconds >= 0) {
      await upsertDailyActual(empId, metricIds.get('AHT')!, date, Number(row.aht_seconds), 'apr');
    }
    if (metricIds.has('TALK_TIME') && row.total_calls > 0) {
      const avgTalk = Number(row.total_talk) / Number(row.total_calls);
      await upsertDailyActual(empId, metricIds.get('TALK_TIME')!, date, Math.round(avgTalk * 10) / 10, 'apr');
    }
    if (metricIds.has('DIALS')) {
      await upsertDailyActual(empId, metricIds.get('DIALS')!, date, Number(row.total_calls), 'apr');
    }
    if (metricIds.has('ACW') && row.acw_seconds >= 0) {
      await upsertDailyActual(empId, metricIds.get('ACW')!, date, Number(row.acw_seconds), 'apr');
    }
    synced++;
  }

  return { synced, skipped };
}

// ─── Sync Attendance metrics (ATTENDANCE_PCT) ─────────────────────────────────

export async function syncAttendanceMetrics(date: string): Promise<{ synced: number; skipped: number }> {
  const metricIds = await getMetricIds(['ATTENDANCE_PCT']);
  const attMetricId = metricIds.get('ATTENDANCE_PCT');
  if (!attMetricId) return { synced: 0, skipped: 0 };

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_id, attendance_status
     FROM attendance_daily_record
     WHERE record_date = ?`,
    [date]
  );

  const records = rows as any[];
  let synced = 0;

  for (const rec of records) {
    const status = String(rec.attendance_status).toUpperCase();
    const value = ['P', 'PRESENT'].includes(status)
      ? 100
      : ['H', 'HALF_DAY'].includes(status)
        ? 50
        : 0;
    await upsertDailyActual(rec.employee_id, attMetricId, date, value, 'attendance');
    synced++;
  }

  return { synced, skipped: 0 };
}

// ─── Sync Quality metrics (QUALITY_SCORE, FATAL_RATE) ─────────────────────────

export async function syncQualityMetrics(yearMonth: string): Promise<{ synced: number; skipped: number }> {
  const metricIds = await getMetricIds(['QUALITY_SCORE', 'FATAL_RATE']);
  if (!metricIds.size) return { synced: 0, skipped: 0 };

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       employee_id,
       AVG(score) AS avg_score,
       SUM(CASE WHEN score = 0 THEN 1 ELSE 0 END) AS fatal_count,
       COUNT(*) AS total_audits,
       DATE(MAX(audit_date)) AS last_audit_date
     FROM quality_audit_response
     WHERE DATE_FORMAT(audit_date, '%Y-%m') = ?
     GROUP BY employee_id`,
    [yearMonth]
  );

  const records = rows as any[];
  let synced = 0;

  for (const rec of records) {
    const auditDate = rec.last_audit_date instanceof Date
      ? rec.last_audit_date.toISOString().split('T')[0]
      : String(rec.last_audit_date).split('T')[0];

    if (metricIds.has('QUALITY_SCORE')) {
      await upsertDailyActual(rec.employee_id, metricIds.get('QUALITY_SCORE')!, auditDate, Number(rec.avg_score), 'quality');
    }
    if (metricIds.has('FATAL_RATE') && rec.total_audits > 0) {
      const fatalRate = (Number(rec.fatal_count) / Number(rec.total_audits)) * 100;
      await upsertDailyActual(rec.employee_id, metricIds.get('FATAL_RATE')!, auditDate, Math.round(fatalRate * 100) / 100, 'quality');
    }
    synced++;
  }

  return { synced, skipped: 0 };
}
