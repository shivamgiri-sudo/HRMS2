import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';

export type TrendDirection = 'up' | 'down' | 'stable';
export type MetricStatus = 'good' | 'warning' | 'critical' | 'unknown';

export interface TargetResult {
  target: number | null;
  period: string | null;
}

export interface TrendResult {
  previousValue: number | null;
  trend: TrendDirection;
  changePct: number | null;
}

export interface MetricEnrichment extends TargetResult, TrendResult {
  variance: number | null;
  variancePct: number | null;
  status: MetricStatus;
}

/**
 * Resolves the most-specific active target for a metric.
 * Specificity: process > branch > org-wide.
 */
export async function getTargetForMetric(
  metricCode: string,
  period: 'daily' | 'weekly' | 'monthly' | 'annual' = 'monthly',
  branchId?: string | null,
  processId?: string | null,
): Promise<TargetResult> {
  const today = new Date().toISOString().slice(0, 10);

  const candidates: Array<{ branchId?: string | null; processId?: string | null }> = [];

  // Most specific first
  if (processId) candidates.push({ branchId, processId });
  if (branchId)  candidates.push({ branchId, processId: null });
  candidates.push({ branchId: null, processId: null }); // org-wide

  for (const scope of candidates) {
    const whereParts = [
      'metric_code = ?',
      'target_period = ?',
      'effective_from <= ?',
      '(effective_to IS NULL OR effective_to >= ?)',
    ];
    const params: unknown[] = [metricCode, period, today, today];

    if (scope.branchId) {
      whereParts.push('branch_id = ?');
      params.push(scope.branchId);
    } else {
      whereParts.push('branch_id IS NULL');
    }

    if (scope.processId) {
      whereParts.push('process_id = ?');
      params.push(scope.processId);
    } else {
      whereParts.push('process_id IS NULL');
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT target_value, target_period FROM dashboard_metric_target
       WHERE ${whereParts.join(' AND ')}
       ORDER BY effective_from DESC
       LIMIT 1`,
      params
    );

    if ((rows as any[]).length > 0) {
      return {
        target: parseFloat(String((rows as any[])[0].target_value)),
        period: String((rows as any[])[0].target_period),
      };
    }
  }

  return { target: null, period: null };
}

/**
 * Reads trend from dashboard_metric_snapshot — compares current value
 * to the snapshot from ~30 days ago for the same metric + scope.
 */
export async function getMetricTrend(
  metricCode: string,
  currentValue: number,
  branchId?: string | null,
  processId?: string | null,
  lookbackDays = 30,
): Promise<TrendResult> {
  try {
    const whereParts = ['metric_code = ?'];
    const params: unknown[] = [metricCode];

    if (branchId) { whereParts.push('branch_id = ?'); params.push(branchId); }
    else           { whereParts.push('branch_id IS NULL'); }
    if (processId) { whereParts.push('process_id = ?'); params.push(processId); }
    else           { whereParts.push('process_id IS NULL'); }

    whereParts.push(`snapshot_date <= DATE_SUB(CURDATE(), INTERVAL ${lookbackDays} DAY)`);

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT metric_value FROM dashboard_metric_snapshot
       WHERE ${whereParts.join(' AND ')}
       ORDER BY snapshot_date DESC
       LIMIT 1`,
      params
    );

    if (!(rows as any[]).length) {
      return { previousValue: null, trend: 'stable', changePct: null };
    }

    const prev = parseFloat(String((rows as any[])[0].metric_value));
    if (isNaN(prev) || prev === 0) {
      return { previousValue: prev, trend: 'stable', changePct: null };
    }

    const changePct = ((currentValue - prev) / Math.abs(prev)) * 100;
    const trend: TrendDirection = changePct > 0.5 ? 'up' : changePct < -0.5 ? 'down' : 'stable';
    return { previousValue: prev, trend, changePct: parseFloat(changePct.toFixed(2)) };
  } catch {
    return { previousValue: null, trend: 'stable', changePct: null };
  }
}

/**
 * Full enrichment: target + trend + variance + status in one call.
 * `higherIsBetter` = true for metrics like attendance, calls per agent.
 * `higherIsBetter` = false for metrics like LWP days, rejected candidates.
 */
export async function enrichMetric(
  metricCode: string,
  currentValue: number,
  period: 'daily' | 'weekly' | 'monthly' | 'annual' = 'monthly',
  higherIsBetter = true,
  branchId?: string | null,
  processId?: string | null,
): Promise<MetricEnrichment> {
  const [targetResult, trendResult] = await Promise.all([
    getTargetForMetric(metricCode, period, branchId, processId),
    getMetricTrend(metricCode, currentValue, branchId, processId),
  ]);

  const { target } = targetResult;
  const { previousValue, trend, changePct } = trendResult;

  let variance: number | null = null;
  let variancePct: number | null = null;
  let status: MetricStatus = 'unknown';

  if (target !== null) {
    variance = parseFloat((currentValue - target).toFixed(4));
    variancePct = target !== 0 ? parseFloat(((variance / Math.abs(target)) * 100).toFixed(2)) : null;

    const achievementRatio = target !== 0 ? currentValue / target : 1;
    if (higherIsBetter) {
      status = achievementRatio >= 1 ? 'good' : achievementRatio >= 0.9 ? 'warning' : 'critical';
    } else {
      // Lower is better — invert: if current <= target it's good
      status = currentValue <= target ? 'good' : currentValue <= target * 1.1 ? 'warning' : 'critical';
    }
  }

  return { target, period: targetResult.period, previousValue, trend, changePct, variance, variancePct, status };
}
