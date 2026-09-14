import { Router, type NextFunction, type Response } from 'express';
import { requireAuth, type AuthenticatedRequest, requireWriteAccess } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { reconcileEmployeeCodeDrift } from './employee-code-reconciliation.service.js';

const router = Router();
type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;

const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

// POST /api/ats/employee-code/reconcile
// Finds and repairs stale ats_candidate.employee_code drift (rename/merge artifacts) and flags
// any genuine unfinished conversion (a real orphan) with the same work item /generate would have
// created. See employee-code-reconciliation.service.ts for why this exists. Safe to run
// repeatedly — both checks are idempotent (a repaired row no longer matches Check 1's WHERE, and
// upsertOpenWorkItem refreshes rather than duplicates an already-open item).
router.post(
  '/reconcile',
  requireAuth,
  requireWriteAccess,
  requireRole('admin', 'hr', 'payroll_hr'),
  h(async (_req, res) => {
    const result = await reconcileEmployeeCodeDrift();
    return res.json({ success: true, ...result });
  }),
);

export const employeeCodeReconciliationRouter = router;
