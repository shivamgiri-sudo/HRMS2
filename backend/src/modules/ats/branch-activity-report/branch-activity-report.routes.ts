/**
 * Read-only JSON API for the branch recruitment activity report — the in-app twin of the
 * daily email (scheduler.ts). Same facts, same buildReport() core, no email sent.
 * Backs the ATS Command Centre "Branch Activity" tab.
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../../middleware/authMiddleware.js";
import { requireRole } from "../../../middleware/requireRole.js";
import { getCurrentDateIST } from "../../../shared/istDate.js";
import type { AuthenticatedRequest } from "../../../middleware/authMiddleware.js";
import { branchInScope, resolveAtsBranchScope, OUT_OF_BRANCH_MESSAGE } from "../ats-branch-scope.js";
import {
  getBranchActivityReportData,
  getBranchActivityReportDataForBranches,
  getBranchActivityExportData,
} from "./index.js";

export const branchActivityReportRouter = Router();

// Same roster as the command-centre analytics: view-only for every management/supervisory role.
branchActivityReportRouter.use(requireAuth);
branchActivityReportRouter.use(
  requireRole(
    "super_admin",
    "admin",
    "ceo",
    "coo",
    "hr",
    "hr_admin",
    "manager",
    "process_manager",
    "branch_head",
    "recruiter",
    "tl",
    "team_leader",
  ),
);

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

// ── GET / — combined report for a date, every branch with activity broken out ──────────────
branchActivityReportRouter.get("/", async (req: Request, res: Response) => {
  const date = typeof req.query.date === "string" ? req.query.date : undefined;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res
      .status(400)
      .json({ success: false, message: "date must be YYYY-MM-DD" });
  }
  try {
    // Owner ruling 2026-10-01: only org-wide roles see every branch; everyone else gets their own branch only.
    const scope = await resolveAtsBranchScope((req as AuthenticatedRequest).authUser!.id);
    const data = scope.orgWide
      ? await getBranchActivityReportData(date || getCurrentDateIST())
      : await getBranchActivityReportDataForBranches(date || getCurrentDateIST(), scope.branchSpellings);
    return res.json({ success: true, data });
  } catch (error: unknown) {
    return res
      .status(500)
      .json({ success: false, message: getErrorMessage(error) });
  }
});

// ── GET /export — downloadable CSV with complete candidate details ─────────────────────────
branchActivityReportRouter.get(
  "/export",
  async (req: Request, res: Response) => {
    const date =
      typeof req.query.date === "string" ? req.query.date : undefined;
    const branch =
      typeof req.query.branch === "string" ? req.query.branch : undefined;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res
        .status(400)
        .json({ success: false, message: "date must be YYYY-MM-DD" });
    }
    try {
      const reportDate = date || getCurrentDateIST();
      // ?branch= may only narrow the caller's own branch scope; a foreign branch is refused.
      const scope = await resolveAtsBranchScope((req as AuthenticatedRequest).authUser!.id);
      if (!scope.orgWide && branch && !branchInScope(scope, branch)) {
        return res.status(403).json({ success: false, message: OUT_OF_BRANCH_MESSAGE });
      }
      const { rows, csv } = await getBranchActivityExportData(
        reportDate,
        branch,
        scope.orgWide ? undefined : scope.branchSpellings,
      );
      const filename = branch
        ? `recruitment-activity-${branch}-${reportDate}.csv`
        : `recruitment-activity-all-branches-${reportDate}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      return res.send(csv);
    } catch (error: unknown) {
      return res
        .status(500)
        .json({ success: false, message: getErrorMessage(error) });
    }
  },
);
