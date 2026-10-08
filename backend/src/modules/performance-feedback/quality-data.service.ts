/**
 * Quality Data Service
 *
 * Fetches call quality assessment data from external databases
 * (db_audit.call_quality_assessment and Shivamgiri.v_call_master_unified_kpi)
 * for integration into employee performance reviews.
 */

import type { Pool, RowDataPacket } from 'mysql2/promise';
import { getCredentialsForKey, getPoolForKey } from '../external-db/external-db.service.js';

interface QualityMetrics {
  employee_code: string;
  employee_name?: string;
  total_calls: number;
  audited_calls: number;
  avg_quality_score: number;
  quality_band: string;
  period_start: string;
  period_end: string;
  parameter_scores: {
    parameter_name: string;
    pass_rate: number;
    total_checks: number;
  }[];
}

interface QualityTrend {
  date: string;
  calls: number;
  avg_score: number;
  quality_band: string;
}

async function getQualityPool(): Promise<Pool> {
  const credentials = await getCredentialsForKey('shivamgiri_quality');
  if (!credentials) throw new Error('Quality database connector is not configured');
  if (credentials.db_type !== 'mysql') {
    throw new Error('The Shivamgiri quality queries require a MySQL connector');
  }
  return await getPoolForKey('shivamgiri_quality') as Pool;
}

/**
 * Get quality metrics for an employee for a specific period
 */
export async function getEmployeeQualityMetrics(
  employeeCode: string,
  startDate: string,
  endDate: string
): Promise<QualityMetrics | null> {
  try {
    const pool = await getQualityPool();

    // Get aggregate metrics
    const [metrics] = await pool.execute<RowDataPacket[]>(
      `SELECT
        User as employee_code,
        COUNT(*) as total_calls,
        COUNT(CASE WHEN quality_score IS NOT NULL THEN 1 END) as audited_calls,
        AVG(quality_score) * 100 as avg_quality_score,
        CASE
          WHEN AVG(quality_score) >= 0.90 THEN 'Excellent'
          WHEN AVG(quality_score) >= 0.80 THEN 'Good'
          WHEN AVG(quality_score) >= 0.70 THEN 'Average'
          WHEN AVG(quality_score) >= 0.60 THEN 'Below Average'
          ELSE 'Poor'
        END as quality_band
      FROM Shivamgiri.v_call_master_unified_kpi
      WHERE User = ?
        AND CallDate >= ?
        AND CallDate <= ?
      GROUP BY User`,
      [employeeCode, startDate, endDate]
    );

    if (!metrics || metrics.length === 0) {
      return null;
    }

    // Get parameter-wise scores
    const [parameters] = await pool.execute<RowDataPacket[]>(
      `SELECT
        'Call Answered Within 5 Seconds' as parameter_name,
        AVG(call_answered_within_5_seconds) * 100 as pass_rate,
        COUNT(*) as total_checks
      FROM db_audit.call_quality_assessment
      WHERE User = ?
        AND CallDate >= ?
        AND CallDate <= ?
        AND call_answered_within_5_seconds IS NOT NULL
      UNION ALL
      SELECT
        'Customer Concern Acknowledged' as parameter_name,
        AVG(customer_concern_acknowledged) * 100 as pass_rate,
        COUNT(*) as total_checks
      FROM db_audit.call_quality_assessment
      WHERE User = ?
        AND CallDate >= ?
        AND CallDate <= ?
        AND customer_concern_acknowledged IS NOT NULL
      UNION ALL
      SELECT
        'Professionalism Maintained' as parameter_name,
        AVG(professionalism_maintained) * 100 as pass_rate,
        COUNT(*) as total_checks
      FROM db_audit.call_quality_assessment
      WHERE User = ?
        AND CallDate >= ?
        AND CallDate <= ?
        AND professionalism_maintained IS NOT NULL
      UNION ALL
      SELECT
        'Active Listening' as parameter_name,
        AVG(active_listening) * 100 as pass_rate,
        COUNT(*) as total_checks
      FROM db_audit.call_quality_assessment
      WHERE User = ?
        AND CallDate >= ?
        AND CallDate <= ?
        AND active_listening IS NOT NULL
      UNION ALL
      SELECT
        'Proper Grammar' as parameter_name,
        AVG(proper_grammar) * 100 as pass_rate,
        COUNT(*) as total_checks
      FROM db_audit.call_quality_assessment
      WHERE User = ?
        AND CallDate >= ?
        AND CallDate <= ?
        AND proper_grammar IS NOT NULL`,
      [
        employeeCode, startDate, endDate,
        employeeCode, startDate, endDate,
        employeeCode, startDate, endDate,
        employeeCode, startDate, endDate,
        employeeCode, startDate, endDate
      ]
    );

    const metric = metrics[0];

    return {
      employee_code: metric.employee_code,
      total_calls: metric.total_calls,
      audited_calls: metric.audited_calls,
      avg_quality_score: parseFloat(metric.avg_quality_score?.toFixed(2) || '0'),
      quality_band: metric.quality_band,
      period_start: startDate,
      period_end: endDate,
      parameter_scores: (parameters || []).map((p: any) => ({
        parameter_name: p.parameter_name,
        pass_rate: parseFloat(p.pass_rate?.toFixed(2) || '0'),
        total_checks: p.total_checks
      }))
    };
  } catch (error) {
    console.error('Error fetching quality metrics:', error);
    return null;
  }
}

/**
 * Get quality trend for an employee (daily scores)
 */
export async function getEmployeeQualityTrend(
  employeeCode: string,
  startDate: string,
  endDate: string
): Promise<QualityTrend[]> {
  try {
    const pool = await getQualityPool();

    const [trends] = await pool.execute<RowDataPacket[]>(
      `SELECT
        DATE(CallDate) as date,
        COUNT(*) as calls,
        AVG(quality_score) * 100 as avg_score,
        CASE
          WHEN AVG(quality_score) >= 0.90 THEN 'Excellent'
          WHEN AVG(quality_score) >= 0.80 THEN 'Good'
          WHEN AVG(quality_score) >= 0.70 THEN 'Average'
          WHEN AVG(quality_score) >= 0.60 THEN 'Below Average'
          ELSE 'Poor'
        END as quality_band
      FROM Shivamgiri.v_call_master_unified_kpi
      WHERE User = ?
        AND CallDate >= ?
        AND CallDate <= ?
        AND quality_score IS NOT NULL
      GROUP BY DATE(CallDate)
      ORDER BY date ASC`,
      [employeeCode, startDate, endDate]
    );

    return (trends || []).map((t: any) => ({
      date: t.date,
      calls: t.calls,
      avg_score: parseFloat(t.avg_score?.toFixed(2) || '0'),
      quality_band: t.quality_band
    }));
  } catch (error) {
    console.error('Error fetching quality trend:', error);
    return [];
  }
}

/**
 * Get team quality metrics (for managers)
 */
export async function getTeamQualityMetrics(
  employeeCodes: string[],
  startDate: string,
  endDate: string
): Promise<QualityMetrics[]> {
  if (!employeeCodes || employeeCodes.length === 0) {
    return [];
  }

  try {
    const pool = await getQualityPool();

    const placeholders = employeeCodes.map(() => '?').join(',');

    const [metrics] = await pool.execute<RowDataPacket[]>(
      `SELECT
        User as employee_code,
        COUNT(*) as total_calls,
        COUNT(CASE WHEN quality_score IS NOT NULL THEN 1 END) as audited_calls,
        AVG(quality_score) * 100 as avg_quality_score,
        CASE
          WHEN AVG(quality_score) >= 0.90 THEN 'Excellent'
          WHEN AVG(quality_score) >= 0.80 THEN 'Good'
          WHEN AVG(quality_score) >= 0.70 THEN 'Average'
          WHEN AVG(quality_score) >= 0.60 THEN 'Below Average'
          ELSE 'Poor'
        END as quality_band
      FROM Shivamgiri.v_call_master_unified_kpi
      WHERE User IN (${placeholders})
        AND CallDate >= ?
        AND CallDate <= ?
      GROUP BY User
      ORDER BY avg_quality_score DESC`,
      [...employeeCodes, startDate, endDate]
    );

    return (metrics || []).map((m: any) => ({
      employee_code: m.employee_code,
      total_calls: m.total_calls,
      audited_calls: m.audited_calls,
      avg_quality_score: parseFloat(m.avg_quality_score?.toFixed(2) || '0'),
      quality_band: m.quality_band,
      period_start: startDate,
      period_end: endDate,
      parameter_scores: []
    }));
  } catch (error) {
    console.error('Error fetching team quality metrics:', error);
    return [];
  }
}
