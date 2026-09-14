import type { Request, Response } from 'express';
import { AgentStatusSync } from '../../workers/domains/agent-status-sync.js';
import { CallDataSync } from '../../workers/domains/call-data-sync.js';

const agentStatusSync = new AgentStatusSync();
const callDataSync = new CallDataSync();

/**
 * Get current agent status
 * GET /api/dialer/agent-status/:employeeCode
 */
export async function getAgentStatus(req: Request, res: Response) {
  try {
    const { employeeCode } = req.params;

    const status = await agentStatusSync.getCurrentAgentStatus(employeeCode);

    if (!status) {
      return res.status(404).json({
        success: false,
        message: 'No activity found for agent',
      });
    }

    return res.json({
      success: true,
      data: status,
    });
  } catch (error: any) {
    console.error('[DIALER] Error getting agent status:', error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

/**
 * Get all active agents
 * GET /api/dialer/active-agents
 */
export async function getActiveAgents(req: Request, res: Response) {
  try {
    const agents = await agentStatusSync.getActiveAgents();

    return res.json({
      success: true,
      data: agents,
      count: agents.length,
    });
  } catch (error: any) {
    console.error('[DIALER] Error getting active agents:', error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

/**
 * Get agent activity for date range
 * GET /api/dialer/agent-activity/:employeeCode?start=YYYY-MM-DD&end=YYYY-MM-DD
 */
export async function getAgentActivity(req: Request, res: Response) {
  try {
    const { employeeCode } = req.params;
    const { start, end } = req.query;

    if (!start || !end) {
      return res.status(400).json({
        success: false,
        message: 'start and end dates are required',
      });
    }

    const activity = await agentStatusSync.getAgentActivity(
      employeeCode,
      start as string,
      end as string
    );

    return res.json({
      success: true,
      data: activity,
      count: activity.length,
    });
  } catch (error: any) {
    console.error('[DIALER] Error getting agent activity:', error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

/**
 * Get agent daily summary
 * GET /api/dialer/agent-summary/:employeeCode/:date
 */
export async function getAgentSummary(req: Request, res: Response) {
  try {
    const { employeeCode, date } = req.params;

    const [agentActivity, callSummary] = await Promise.all([
      agentStatusSync.getDailySummary(employeeCode, date),
      callDataSync.getDailySummary(employeeCode, date),
    ]);

    return res.json({
      success: true,
      data: {
        employee_code: employeeCode,
        date,
        agent_activity: agentActivity,
        calls: callSummary,
      },
    });
  } catch (error: any) {
    console.error('[DIALER] Error getting agent summary:', error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

/**
 * Get inbound calls for agent
 * GET /api/dialer/calls/inbound/:employeeCode/:date
 */
export async function getInboundCalls(req: Request, res: Response) {
  try {
    const { employeeCode, date } = req.params;

    const calls = await callDataSync.getInboundCalls(employeeCode, date);

    return res.json({
      success: true,
      data: calls,
      count: calls.length,
    });
  } catch (error: any) {
    console.error('[DIALER] Error getting inbound calls:', error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

/**
 * Get outbound calls for agent
 * GET /api/dialer/calls/outbound/:employeeCode/:date
 */
export async function getOutboundCalls(req: Request, res: Response) {
  try {
    const { employeeCode, date } = req.params;

    const calls = await callDataSync.getOutboundCalls(employeeCode, date);

    return res.json({
      success: true,
      data: calls,
      count: calls.length,
    });
  } catch (error: any) {
    console.error('[DIALER] Error getting outbound calls:', error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

/**
 * Get call volume by hour
 * GET /api/dialer/calls/hourly/:employeeCode/:date
 */
export async function getCallVolumeByHour(req: Request, res: Response) {
  try {
    const { employeeCode, date } = req.params;

    const volume = await callDataSync.getCallVolumeByHour(employeeCode, date);

    return res.json({
      success: true,
      data: volume,
    });
  } catch (error: any) {
    console.error('[DIALER] Error getting call volume:', error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

/**
 * Get disposition breakdown
 * GET /api/dialer/calls/dispositions/:employeeCode/:date
 */
export async function getDispositionBreakdown(req: Request, res: Response) {
  try {
    const { employeeCode, date } = req.params;

    const dispositions = await callDataSync.getDispositionBreakdown(employeeCode, date);

    return res.json({
      success: true,
      data: dispositions,
    });
  } catch (error: any) {
    console.error('[DIALER] Error getting dispositions:', error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

/**
 * Check if agent is active
 * GET /api/dialer/is-active/:employeeCode
 */
export async function checkAgentActive(req: Request, res: Response) {
  try {
    const { employeeCode } = req.params;

    const isActive = await agentStatusSync.isAgentActive(employeeCode);

    return res.json({
      success: true,
      data: {
        employee_code: employeeCode,
        is_active: isActive,
      },
    });
  } catch (error: any) {
    console.error('[DIALER] Error checking agent active:', error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
}

/**
 * Health check for dialer connection
 * GET /api/dialer/health
 */
export async function healthCheck(req: Request, res: Response) {
  try {
    const { testDialerConnection } = await import('../../db/dialerDb.js');
    const result = await testDialerConnection();

    if (result.ok) {
      return res.json({
        success: true,
        message: 'Dialer DB connection healthy',
      });
    } else {
      return res.status(503).json({
        success: false,
        message: 'Dialer DB connection failed',
        error: result.error,
      });
    }
  } catch (error: any) {
    return res.status(503).json({
      success: false,
      message: error.message,
    });
  }
}
