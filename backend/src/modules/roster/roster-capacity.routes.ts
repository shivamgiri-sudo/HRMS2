import { Router } from 'express';
import { rosterCapacityController } from './roster-capacity.controller.js';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

// All routes require authentication
router.use(requireAuth);

// ========== Capacity Config (WFM/Admin only) ==========
// All configured days for a process in one call (the config page used to fire
// seven per-day requests, each 404ing for an unconfigured day).
router.get(
  '/config/:processId',
  requireRole('wfm', 'admin'),
  h(rosterCapacityController.listCapacityConfigs)
);

router.get(
  '/config/:processId/:dayOfWeek',
  requireRole('wfm', 'admin'),
  h(rosterCapacityController.getCapacityConfig)
);

router.patch(
  '/config/:processId/:dayOfWeek',
  requireRole('wfm', 'admin'),
  h(rosterCapacityController.updateCapacityConfig)
);

// ========== Capacity Checking (Manager/WFM/Admin) ==========
router.get(
  '/capacity/:processId',
  requireRole('process_manager', 'wfm', 'admin'),
  h(rosterCapacityController.checkCapacity)
);

// ========== Allocation Management (WFM/Admin) ==========
router.post(
  '/allocate',
  requireRole('wfm', 'admin'),
  h(rosterCapacityController.allocateWeekOff)
);

router.get(
  '/allocations',
  requireRole('process_manager', 'wfm', 'admin'),
  h(rosterCapacityController.getAllocations)
);

// ========== Notifications (Employee can view own; manager/admin can view any) ==========
router.get(
  '/notifications/:employeeId',
  requireRole('employee', 'process_manager', 'wfm', 'admin', 'super_admin', 'branch_head'),
  h(rosterCapacityController.getNotifications)
);

router.patch(
  '/notifications/:notificationId/read',
  requireRole('employee', 'process_manager', 'wfm', 'admin', 'super_admin', 'branch_head'),
  h(rosterCapacityController.markNotificationRead)
);

// ========== Week-Off Preference (Employee submit) ==========
router.post(
  '/preference/submit',
  h(rosterCapacityController.submitWeekOffPreference)
);

export default router;
