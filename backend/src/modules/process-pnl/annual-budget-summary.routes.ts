import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { annualBudgetSummaryService } from "./annual-budget-summary.service.js";

/**
 * Self-contained router, deliberately NOT yet mounted in app.ts. Another concurrent session
 * has uncommitted, in-progress changes to app.ts and process-pnl.routes.ts as of 2026-08-21
 * (confirmed via `git status`) — editing either right now risks either losing their work or
 * sweeping their uncommitted lines into this session's commit (the exact failure mode
 * CLAUDE.md's Concurrent Agent Rule warns about). Mount with, in app.ts, once that file is
 * clean again:
 *   import { annualBudgetSummaryRouter } from "./modules/process-pnl/annual-budget-summary.routes.js";
 *   app.use("/api/finance/annual-budget-summary", annualBudgetSummaryRouter);
 */
const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: (e?: unknown) => void) => fn(req, res).catch(next);

router.use(requireAuth);

// Narrower than FINANCE_REPORT_ROLES (grn-report.service.ts) on purpose — an all-branches
// rollup is more exposure than any single-branch screen, per the open question flagged in
// docs/superpowers/specs/2026-08-21-annual-budget-summary-and-historical-pnl.md §7.
const ALLOWED_ROLES = ["super_admin", "admin", "finance_head", "accounts_head"];

router.get(
  "/",
  requireRole(...ALLOWED_ROLES),
  h(async (req, res) => {
    const financialYear = String(req.query.financialYear || "");
    if (!/^\d{4}-\d{2}$/.test(financialYear)) {
      return res.status(400).json({ error: "financialYear must be YYYY-YY, e.g. 2026-27" });
    }
    const branchIdsParam = req.query.branchIds;
    const branchIds = typeof branchIdsParam === "string" && branchIdsParam.trim()
      ? branchIdsParam.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;

    const data = await annualBudgetSummaryService.getAnnualBudgetSummary(financialYear, branchIds);
    res.json({ success: true, data });
  })
);

export { router as annualBudgetSummaryRouter };
