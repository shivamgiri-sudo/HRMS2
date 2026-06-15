import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { reportingService } from './reporting.service.js';

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<void>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

// All authenticated roles may list and run reports — branch scope is enforced in the service.
router.get('/', requireAuth, h(async (req, res) => {
  const reports = await reportingService.listReports(req.authUser!.id);
  res.json({ data: reports });
}));

router.get('/analytics-overview', requireAuth, h(async (req, res) => {
  const year = Number(req.query.year ?? new Date().getFullYear());
  const data = await reportingService.analyticsOverview(year, req.authUser!.id);
  res.json({ success: true, data });
}));

router.get('/leave-balances', requireAuth, h(async (req, res) => {
  const year = Number(req.query.year ?? new Date().getFullYear());
  const data = await reportingService.leaveBalanceOverview(year, req.authUser!.id);
  res.json({ success: true, data });
}));

router.post('/:code/run', requireAuth, h(async (req, res) => {
  const filters = req.body.filters || {};
  const result = await reportingService.runReport(req.params.code, filters, req.authUser!.id);
  res.json({ data: result });
}));

export { router as reportingRouter };
