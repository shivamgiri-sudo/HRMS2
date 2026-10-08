import { dialerQuery } from '../../db/dialerDb.js';
import { db } from '../../db/mysql.js';

/**
 * Dialer KPI Sync Worker
 *
 * Automatically sync call center metrics from dialer_db to KPI scores
 * Process-wise aggregation for operations metrics
 */

export interface DialerKpiMetrics {
  employee_code: string;
  date: string;

  // Call metrics
  total_calls: number;
  inbound_calls: number;
  outbound_calls: number;

  // Time metrics (seconds)
  aht: number;           // Average Handle Time
  acw: number;           // After Call Work
  talk_time: number;
  hold_time: number;
  wait_time: number;

  // Quality metrics
  fcr_count: number;     // First Call Resolution
  callbacks: number;
}

export interface ProcessKpiConfig {
  process_id: string;
  process_name: string;
  metric_code: string;
  metric_id: string;
  target_value: number;
}

export class DialerKpiSync {
  /**
   * Get call center metrics for employee on specific date
   */
  async getEmployeeMetrics(employeeCode: string, date: string): Promise<DialerKpiMetrics | null> {
    // Get inbound call summary
    const [inboundSummary] = await dialerQuery(`
      SELECT
        COUNT(*) as inbound_calls,
        SUM(CAST(COALESCE(CallDurationSecond, 0) AS UNSIGNED)) as total_duration,
        SUM(CAST(COALESCE(Talkduration, 0) AS UNSIGNED)) as total_talk,
        SUM(CAST(COALESCE(Acwduration, 0) AS UNSIGNED)) as total_acw,
        SUM(CAST(COALESCE(HoldTime, 0) AS UNSIGNED)) as total_hold,
        SUM(CAST(COALESCE(QueueDuration, 0) AS UNSIGNED)) as total_wait,
        SUM(CASE WHEN Disposition = 'SALE' OR Disposition = 'RESOLVED' THEN 1 ELSE 0 END) as fcr_count,
        SUM(CASE WHEN Disposition = 'CALLBACK' THEN 1 ELSE 0 END) as callbacks
      FROM vw_inbound_cdr
      WHERE AgentId = ?
        AND CallDate = DATE(?)
        AND CallDate >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
    `, [employeeCode, date]);

    // Get outbound call summary
    const [outboundSummary] = await dialerQuery(`
      SELECT
        COUNT(*) as outbound_calls,
        SUM(CAST(COALESCE(CallDuration, 0) AS UNSIGNED)) as total_duration,
        SUM(CAST(COALESCE(talk_sec, 0) AS UNSIGNED)) as total_talk,
        SUM(CAST(COALESCE(DispoSec, 0) AS UNSIGNED)) as total_dispo,
        SUM(CAST(COALESCE(WaitSec, 0) AS UNSIGNED)) as total_wait
      FROM vw_outbound_cdr
      WHERE Agent = ?
        AND CallDate = DATE(?)
        AND CallDate >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
    `, [employeeCode, date]);

    const inbound = inboundSummary || {
      inbound_calls: 0, total_duration: 0, total_talk: 0,
      total_acw: 0, total_hold: 0, total_wait: 0,
      fcr_count: 0, callbacks: 0
    };

    const outbound = outboundSummary || {
      outbound_calls: 0, total_duration: 0, total_talk: 0,
      total_dispo: 0, total_wait: 0
    };

    const totalCalls = Number(inbound.inbound_calls) + Number(outbound.outbound_calls);

    if (totalCalls === 0) {
      return null; // No activity
    }

    const totalTalk = Number(inbound.total_talk) + Number(outbound.total_talk);
    const totalAcw = Number(inbound.total_acw) + Number(outbound.total_dispo);
    const totalHold = Number(inbound.total_hold);
    const totalWait = Number(inbound.total_wait) + Number(outbound.total_wait);

    // Calculate AHT = (Talk Time + Hold Time + ACW) / Total Calls
    const aht = totalCalls > 0 ? Math.round((totalTalk + totalHold + totalAcw) / totalCalls) : 0;

    return {
      employee_code: employeeCode,
      date,
      total_calls: totalCalls,
      inbound_calls: Number(inbound.inbound_calls),
      outbound_calls: Number(outbound.outbound_calls),
      aht,
      acw: totalCalls > 0 ? Math.round(totalAcw / totalCalls) : 0,
      talk_time: totalCalls > 0 ? Math.round(totalTalk / totalCalls) : 0,
      hold_time: totalCalls > 0 ? Math.round(totalHold / totalCalls) : 0,
      wait_time: totalCalls > 0 ? Math.round(totalWait / totalCalls) : 0,
      fcr_count: Number(inbound.fcr_count),
      callbacks: Number(inbound.callbacks),
    };
  }

  /**
   * Get process-wise KPI metrics aggregation
   */
  async getProcessMetrics(processId: string, date: string): Promise<DialerKpiMetrics[]> {
    // Get all employees in this process
    const [employees] = await db.execute<any[]>(
      `SELECT employee_code FROM employees WHERE process_id = ? AND active_status = 1`,
      [processId]
    );

    if (!employees.length) {
      return [];
    }

    const employeeCodes = employees.map((e: any) => e.employee_code);
    const metrics: DialerKpiMetrics[] = [];

    // Fetch metrics for each employee
    for (const code of employeeCodes) {
      const empMetrics = await this.getEmployeeMetrics(code, date);
      if (empMetrics) {
        metrics.push(empMetrics);
      }
    }

    return metrics;
  }

  /**
   * Sync dialer metrics to KPI scores
   */
  async syncToKpiScores(employeeCode: string, date: string): Promise<number> {
    // Get employee ID from employee_code
    const [empRows] = await db.execute<any[]>(
      `SELECT id, process_id FROM employees WHERE employee_code = ? LIMIT 1`,
      [employeeCode]
    );

    if (!empRows.length) {
      console.log(`[DialerKpiSync] Employee not found: ${employeeCode}`);
      return 0;
    }

    const employee = empRows[0];
    const metrics = await this.getEmployeeMetrics(employeeCode, date);

    if (!metrics) {
      console.log(`[DialerKpiSync] No dialer data for ${employeeCode} on ${date}`);
      return 0;
    }

    // Map metrics to KPI codes
    const metricMapping: Record<string, number> = {
      'AHT': metrics.aht,
      'ACW': metrics.acw,
      'TALK_TIME': metrics.talk_time,
      'HOLD_TIME': metrics.hold_time,
      'CALLS_HANDLED': metrics.total_calls,
    };

    let synced = 0;

    // Sync each metric
    for (const [metricCode, actualValue] of Object.entries(metricMapping)) {
      // Get metric_id from metric_code
      const [metricRows] = await db.execute<any[]>(
        `SELECT id FROM kpi_metric WHERE metric_code = ? LIMIT 1`,
        [metricCode]
      );

      if (!metricRows.length) {
        continue; // Metric not configured
      }

      const metricId = metricRows[0].id;

      // Insert/update KPI score
      await db.execute(
        `INSERT INTO kpi_score (id, employee_id, metric_id, period, actual_value, source, created_at, updated_at)
         VALUES (UUID(), ?, ?, ?, ?, 'dialer', NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           actual_value = VALUES(actual_value),
           source = 'dialer',
           updated_at = NOW()`,
        [employee.id, metricId, date, actualValue]
      );

      synced++;
    }

    console.log(`[DialerKpiSync] Synced ${synced} metrics for ${employeeCode} on ${date}`);
    return synced;
  }

  /**
   * Bulk sync for entire process
   */
  async syncProcessKpis(processId: string, date: string): Promise<{ synced: number; skipped: number }> {
    const metrics = await this.getProcessMetrics(processId, date);

    let synced = 0;
    let skipped = 0;

    for (const empMetrics of metrics) {
      const count = await this.syncToKpiScores(empMetrics.employee_code, date);
      if (count > 0) {
        synced += count;
      } else {
        skipped++;
      }
    }

    console.log(`[DialerKpiSync] Process ${processId} on ${date}: ${synced} synced, ${skipped} skipped`);
    return { synced, skipped };
  }

  /**
   * Get process KPI configuration
   */
  async getProcessKpiConfig(processId: string): Promise<ProcessKpiConfig[]> {
    const [configs] = await db.execute<any[]>(
      `SELECT
         pc.process_id,
         pm.process_name,
         km.metric_code,
         km.id as metric_id,
         pc.target_value
       FROM kpi_process_config pc
       JOIN process_master pm ON pm.id = pc.process_id
       JOIN kpi_metric km ON km.id = pc.metric_id
       WHERE pc.process_id = ?
         AND km.metric_code IN ('AHT', 'ACW', 'TALK_TIME', 'HOLD_TIME', 'CALLS_HANDLED')
       ORDER BY km.metric_code`,
      [processId]
    );

    return configs.map((row: any) => ({
      process_id: row.process_id,
      process_name: row.process_name,
      metric_code: row.metric_code,
      metric_id: row.metric_id,
      target_value: Number(row.target_value),
    }));
  }

  /**
   * Get process-wise leaderboard for date
   */
  async getProcessLeaderboard(processId: string, date: string): Promise<any[]> {
    const metrics = await this.getProcessMetrics(processId, date);

    // Calculate scores based on targets
    const configs = await this.getProcessKpiConfig(processId);
    const targetMap = new Map(configs.map(c => [c.metric_code, c.target_value]));

    const scored = metrics.map(m => {
      const ahtTarget = targetMap.get('AHT') || 300; // Default 5 min
      const acwTarget = targetMap.get('ACW') || 60;  // Default 1 min

      // Lower is better for time metrics
      const ahtScore = m.aht > 0 ? Math.min(100, (ahtTarget / m.aht) * 100) : 0;
      const acwScore = m.acw > 0 ? Math.min(100, (acwTarget / m.acw) * 100) : 0;

      const overallScore = (ahtScore + acwScore) / 2;

      return {
        employee_code: m.employee_code,
        total_calls: m.total_calls,
        aht: m.aht,
        acw: m.acw,
        aht_score: Math.round(ahtScore * 10) / 10,
        acw_score: Math.round(acwScore * 10) / 10,
        overall_score: Math.round(overallScore * 10) / 10,
      };
    });

    // Sort by overall_score descending
    return scored.sort((a, b) => b.overall_score - a.overall_score);
  }
}
