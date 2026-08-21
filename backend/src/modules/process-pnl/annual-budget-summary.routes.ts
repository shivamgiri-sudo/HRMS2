import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { annualBudgetSummaryService } from "./annual-budget-summary.service.js";

/**
 * Mounted in app.ts at /api/finance/annual-budget-summary. Its page_catalog/role_page_access
 * grant (migration 1537) existed on disk since 2026-08-21 but was never added to
 * runPendingMigrations.ts's manifest, so the page stayed unreachable end-to-end until both
 * were fixed 2026-08-22 alongside the frontend route/nav wiring — see
 * [[hrms2-grn-cost-allocation-budget-blind-spot]].
 */
const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: (e?: unknown) => void) => fn(req, res).catch(next);

router.use(requireAuth);

// Narrower than FINANCE_REPORT_ROLES (grn-report.service.ts) on purpose — an all-branches
// rollup is more exposure than any single-branch screen, per the open question flagged in
// docs/superpowers/specs/2026-08-21-annual-budget-summary-and-historical-pnl.md §7.
const ALLOWED_ROLES = ["super_admin", "admin", "finance_head", "accounts_head"];

// Backs the page's branch-filter picker (AnnualBudgetSummaryPage.tsx). Must stay ABOVE the
// "/" handler's implicit catch of everything under this mount, and is its own route (not a
// query flag on "/") so the picker can populate before a financialYear has been chosen.
router.get(
  "/branches",
  requireRole(...ALLOWED_ROLES),
  h(async (_req, res) => {
    const data = await annualBudgetSummaryService.getAnnualBudgetSummaryBranches();
    res.json({ success: true, data });
  })
);

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
