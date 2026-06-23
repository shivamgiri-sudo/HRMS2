/**
 * @deprecated Use /api/lms/* canonical endpoints instead.
 * This router will be removed in a future release.
 */
import { Router } from "express";
import type { Response, Request } from "express";

const router = Router();

router.all("/learner-progress/:employee_id", (req: Request, res: Response) => {
  res.redirect(308, `/api/lms/learner-progress/${req.params.employee_id}`);
});

router.all("/batch-progress/:batch_no", (req: Request, res: Response) => {
  res.redirect(308, `/api/lms/batch-progress/${req.params.batch_no}`);
});

router.all("/assessment-history/:employee_id", (req: Request, res: Response) => {
  res.redirect(308, `/api/lms/assessment-history/${req.params.employee_id}`);
});

router.all("/sync-status", (_req: Request, res: Response) => {
  res.redirect(308, "/api/lms/sync-status");
});

export const lmsDashboardRouter = router;
