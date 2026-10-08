import type { Request, Response } from 'express';
import { DialerKpiSync } from '../../workers/domains/dialer-kpi-sync.js';

const dialerKpiSync = new DialerKpiSync();

/**
 * Get dialer metrics for employee
 * GET /api/dialer/kpi/employee/:employeeCode/:date
 */
export async function getEmployeeKpiMetrics(req: Request, res: Response) {
  try {
    const { employeeCode, date } = req.params;

    const metrics = await dialerKpiSync.getEmployeeMetrics(employeeCode, date);

    if (!metrics) {
      return res.status(404).json({
        success: false,
        message: 'No dialer data found for employee on this date',
      });
    }

    return res.json({
      success: true,
      data: metrics,
    });
  } catch (error: any) {
    console.error('[DIALER-KPI] Error getting employee metrics:', error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

/**
 * Get process-wise metrics aggregation
 * GET /api/dialer/kpi/process/:processId/:date
 */
export async function getProcessKpiMetrics(req: Request, res: Response) {
  try {
    const { processId, date } = req.params;

    const metrics = await dialerKpiSync.getProcessMetrics(processId, date);

    return res.json({
      success: true,
      data: metrics,
      count: metrics.length,
    });
  } catch (error: any) {
    console.error('[DIALER-KPI] Error getting process metrics:', error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

/**
 * Get process leaderboard for date
 * GET /api/dialer/kpi/leaderboard/:processId/:date
 */
export async function getProcessLeaderboard(req: Request, res: Response) {
  try {
    const { processId, date } = req.params;

    const leaderboard = await dialerKpiSync.getProcessLeaderboard(processId, date);

    return res.json({
      success: true,
      data: leaderboard,
      count: leaderboard.length,
    });
  } catch (error: any) {
    console.error('[DIALER-KPI] Error getting leaderboard:', error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

/**
 * Get process KPI configuration (targets)
 * GET /api/dialer/kpi/config/:processId
 */
export async function getProcessKpiConfig(req: Request, res: Response) {
  try {
    const { processId } = req.params;

    const config = await dialerKpiSync.getProcessKpiConfig(processId);

    return res.json({
      success: true,
      data: config,
    });
  } catch (error: any) {
    console.error('[DIALER-KPI] Error getting config:', error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

/**
 * Sync dialer metrics to KPI scores for employee
 * POST /api/dialer/kpi/sync/employee
 * Body: { employeeCode, date }
 */
export async function syncEmployeeKpi(req: Request, res: Response) {
  try {
    const { employeeCode, date } = req.body;

    if (!employeeCode || !date) {
      return res.status(400).json({
        success: false,
        message: 'employeeCode and date are required',
      });
    }

    const synced = await dialerKpiSync.syncToKpiScores(employeeCode, date);

    return res.json({
      success: true,
      message: `Synced ${synced} metrics`,
      data: { synced },
    });
  } catch (error: any) {
    console.error('[DIALER-KPI] Error syncing employee KPI:', error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

/**
 * Bulk sync process KPIs
 * POST /api/dialer/kpi/sync/process
 * Body: { processId, date }
 */
export async function syncProcessKpi(req: Request, res: Response) {
  try {
    const { processId, date } = req.body;

    if (!processId || !date) {
      return res.status(400).json({
        success: false,
        message: 'processId and date are required',
      });
    }

    const result = await dialerKpiSync.syncProcessKpis(processId, date);

    return res.json({
      success: true,
      message: `Synced ${result.synced} metrics, skipped ${result.skipped}`,
      data: result,
    });
  } catch (error: any) {
    console.error('[DIALER-KPI] Error syncing process KPI:', error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}
