import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { rosterMasterController as c } from './roster-master.controller.js';

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// ========== Templates (WFM/Admin only) ==========
router.get('/templates', requireRole('admin', 'hr', 'wfm'), h(c.listTemplates));
router.post('/templates', requireRole('admin', 'wfm'), h(c.createTemplate));
router.get('/templates/:id', requireRole('admin', 'hr', 'wfm'), h(c.getTemplate));
router.patch('/templates/:id', requireRole('admin', 'wfm'), h(c.updateTemplate));
router.delete('/templates/:id', requireRole('admin'), h(c.deleteTemplate));

// ========== Week-Off Preferences (Employee self-service + Manager approval) ==========
router.post('/week-off-preferences', h(c.createWeekOffPreference));
router.get('/week-off-preferences/me', h(c.getMyWeekOffPreference));
router.get(
  '/week-off-preferences',
  requireRole('admin', 'hr', 'wfm', 'process_manager'),
  h(c.listWeekOffPreferences)
);
router.post(
  '/week-off-preferences/:employee_id/approve',
  requireRole('admin', 'hr', 'wfm', 'process_manager'),
  h(c.approveWeekOffPreference)
);

// ========== Auto-Roster Generation (WFM/Process Manager) ==========
router.post(
  '/generate',
  requireRole('admin', 'wfm', 'process_manager'),
  h(c.generateRoster)
);

// ========== Validation ==========
router.get(
  '/validate-support-ratio',
  requireRole('admin', 'hr', 'wfm', 'process_manager'),
  h(c.validateSupportRatio)
);

export { router as rosterMasterRouter };
