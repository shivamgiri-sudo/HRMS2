import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { communicationController as c } from './communication.controller.js';

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// Templates — HR/Admin only for write, all authenticated for read
router.get('/templates',           h(c.listTemplates));
router.post('/templates/render',   h(c.renderTemplate));
router.get('/templates/:id',       h(c.getTemplate));
router.post('/templates',          requireRole('admin', 'hr'), h(c.createTemplate));
router.patch('/templates/:id',     requireRole('admin', 'hr'), h(c.updateTemplate));
router.delete('/templates/:id',    requireRole('admin', 'hr'), h(c.deleteTemplate));

// Dispatch
router.post('/dispatch/send',      requireRole('admin', 'hr', 'process_manager', 'assistant_manager', 'team_leader'), h(c.send));
router.post('/dispatch/bulk',      requireRole('admin', 'hr'), h(c.bulkSend));
router.post('/dispatch/retry/:id', requireRole('admin', 'hr'), h(c.retryDispatch));
router.get('/dispatch/logs',       requireRole('admin', 'hr'), h(c.getLogs));
router.get('/dispatch/stats',      requireRole('admin', 'hr'), h(c.getStats));

// Preferences — any authenticated user
router.get('/preferences',         h(c.getPreferences));
router.patch('/preferences',       h(c.updatePreference));

export { router as communicationRouter };
