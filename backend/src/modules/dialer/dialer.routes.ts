import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import * as dialerController from './dialer.controller.js';
import * as dialerKpiController from './dialer-kpi.controller.js';

const router = Router();

// All dialer routes require authentication
router.use(requireAuth);

// Health check
router.get('/health', dialerController.healthCheck);

// Agent status endpoints
router.get('/agent-status/:employeeCode', dialerController.getAgentStatus);
router.get('/active-agents', dialerController.getActiveAgents);
router.get('/agent-activity/:employeeCode', dialerController.getAgentActivity);
router.get('/is-active/:employeeCode', dialerController.checkAgentActive);

// Agent summary endpoint
router.get('/agent-summary/:employeeCode/:date', dialerController.getAgentSummary);

// Call data endpoints
router.get('/calls/inbound/:employeeCode/:date', dialerController.getInboundCalls);
router.get('/calls/outbound/:employeeCode/:date', dialerController.getOutboundCalls);
router.get('/calls/hourly/:employeeCode/:date', dialerController.getCallVolumeByHour);
router.get('/calls/dispositions/:employeeCode/:date', dialerController.getDispositionBreakdown);

// KPI integration endpoints
router.get('/kpi/employee/:employeeCode/:date', dialerKpiController.getEmployeeKpiMetrics);
router.get('/kpi/process/:processId/:date', requireRole('admin', 'hr', 'manager', 'process_manager'), dialerKpiController.getProcessKpiMetrics);
router.get('/kpi/leaderboard/:processId/:date', requireRole('admin', 'hr', 'manager', 'process_manager'), dialerKpiController.getProcessLeaderboard);
router.get('/kpi/config/:processId', requireRole('admin', 'hr', 'manager', 'process_manager'), dialerKpiController.getProcessKpiConfig);
router.post('/kpi/sync/employee', requireRole('admin', 'hr', 'process_manager'), dialerKpiController.syncEmployeeKpi);
router.post('/kpi/sync/process', requireRole('admin', 'hr', 'process_manager'), dialerKpiController.syncProcessKpi);

export default router;
