/**
 * Read-only JSON API for the branch recruitment activity report — the in-app twin of the
 * daily email (scheduler.ts). Same facts, same buildReport() core, no email sent.
 * Backs the ATS Command Centre "Branch Activity" tab.
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../../middleware/authMiddleware.js";
import { requireRole } from "../../../middleware/requireRole.js";
import { getCurrentDateIST } from "../../../shared/istDate.js";
import { getBranchActivityReportData } from "./index.js";

export const branchActivityReportRouter = Router();

// Same roster as the command-centre analytics: view-only for every management/supervisory role.
branchActivityReportRouter.use(requireAuth);
branchActivityReportRouter.use(requireRole(
  "super_admin", "admin", "ceo", "coo",
  "hr", "hr_admin", "manager", "process_manager", "branch_head",
  "recruiter", "tl", "team_leader",
));

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

// ── GET / — combined report for a date, every branch with activity broken out ──────────────
branchActivityReportRouter.get("/", async (req: Request, res: Response) => {
  const date = typeof req.query.date === "string" ? req.query.date : undefined;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ success: false, message: "date must be YYYY-MM-DD" });
  }
  try {
    const data = await getBranchActivityReportData(date || getCurrentDateIST());
    return res.json({ success: true, data });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});
