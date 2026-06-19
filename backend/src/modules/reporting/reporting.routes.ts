import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { reportingService } from './reporting.service.js';
import { reportingAnalyticsV2Service } from './reporting.analytics-v2.service.js';
import { reportSuiteHighRiskRouter } from "./report-suite-highrisk.routes.js";
import { reportSuiteRouter } from "./report-suite.routes.js";

const router = Router();
router.use("/suite", reportSuiteHighRiskRouter);
router.use("/suite", reportSuiteRouter);
const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<void>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

// All authenticated roles may list and run reports — branch scope is enforced in the service.
router.get('/', requireAuth, h(async (req, res) => {
  const reports = await reportingService.listReports(req.authUser!.id);
  res.json({ data: reports });
}));

router.get('/analytics-overview', requireAuth, h(async (req, res) => {
  const year = Number(req.query.year ?? new Date().getFullYear());
  const data = await reportingAnalyticsV2Service.analyticsOverview(year, req.authUser!.id);
  res.json({ success: true, data });
}));

router.get('/leave-balances', requireAuth, h(async (req, res) => {
  const year = Number(req.query.year ?? new Date().getFullYear());
  const filters = {
    branchId:  req.query.branchId  as string | undefined,
    processId: req.query.processId as string | undefined,
  };
  const data = await reportingService.leaveBalanceOverview(year, req.authUser!.id, filters);
  res.json({ success: true, data });
}));

router.post('/:code/run', requireAuth, h(async (req, res) => {
  const filters = req.body.filters || {};
  const result = await reportingService.runReport(req.params.code, filters, req.authUser!.id);
  res.json({ data: result });
}));

export { router as reportingRouter };
