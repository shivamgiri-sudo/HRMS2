import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { unlinkedGrnReviewService } from "./unlinked-grn-review.service.js";

/** Mounted in app.ts at /api/finance/unlinked-grn-review. See migration 1548. */
const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: (e?: unknown) => void) => fn(req, res).catch(next);

router.use(requireAuth);

// Same narrow set as FINANCE_ANNUAL_BUDGET_SUMMARY (annual-budget-summary.routes.ts) — this is
// the same class of all-branches financial exposure view.
const ALLOWED_ROLES = ["super_admin", "admin", "finance_head", "accounts_head"];

router.get(
  "/",
  requireRole(...ALLOWED_ROLES),
  h(async (req, res) => {
    const branchId = typeof req.query.branchId === "string" && req.query.branchId.trim()
      ? req.query.branchId.trim()
      : undefined;
    const includeFutureDeferred = req.query.includeFutureDeferred === "true";
    const data = await unlinkedGrnReviewService.getUnlinkedGrnReview({ branchId, includeFutureDeferred });
    res.json({ success: true, data });
  })
);

export { router as unlinkedGrnReviewRouter };
