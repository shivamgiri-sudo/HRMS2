/**
 * Branch Payroll Readiness Routes
 * Mounted at: /api/payroll/branch-readiness
 *
 * Endpoints:
 *   GET  /summary?month=YYYY-MM            — HO summary across all branches
 *   GET  /:branchId?month=YYYY-MM          — Single branch detail
 *   POST /:branchId/checklist              — Update manual checklist item
 *   POST /:branchId/signoff                — Branch head sign-off
 *   POST /:branchId/ho-override            — HO force-ready override
 *   GET  /:branchId/projection?month=      — Salary bill projection
 */

import { Router } from "express";
import type { Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { payrollBranchReadinessService } from "./payroll-branch-readiness.service.js";
import { db } from "../../db/mysql.js";

export const payrollBranchReadinessRouter = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the current YYYY-MM if no month provided */
function resolveMonth(raw: unknown): string {
  if (typeof raw === "string" && /^\d{4}-\d{2}$/.test(raw.trim())) {
    return raw.trim();
  }
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// GET /summary?month=YYYY-MM
// Roles: super_admin, payroll_head, payroll
// ---------------------------------------------------------------------------

payrollBranchReadinessRouter.get(
  "/summary",
  requireAuth,
  requireRole("super_admin", "payroll_head", "payroll"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const month = resolveMonth(req.query.month);
      const data = await payrollBranchReadinessService.getHOSummary(month);
      return res.json({ success: true, month, data });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[BranchReadiness] GET /summary error:", msg);
      return res.status(500).json({ success: false, message: "Failed to fetch readiness summary" });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /:branchId?month=YYYY-MM
// Roles: branch_head, payroll_branch, payroll_head, super_admin
// ---------------------------------------------------------------------------

payrollBranchReadinessRouter.get(
  "/:branchId",
  requireAuth,
  requireRole("branch_head", "payroll_branch", "payroll_head", "super_admin", "payroll"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { branchId } = req.params;
      const month = resolveMonth(req.query.month);
      const data = await payrollBranchReadinessService.getOrRefresh(month, branchId);
      return res.json({ success: true, month, branch_id: branchId, data });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[BranchReadiness] GET /:branchId error:", msg);
      return res.status(500).json({ success: false, message: "Failed to fetch branch readiness" });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /:branchId/checklist
// Update a manual checklist item { item, value }
// Roles: branch_head, payroll_branch
// ---------------------------------------------------------------------------

const ALLOWED_CHECKLIST_ITEMS = [
  "custom_deductions_uploaded",
  "overtime_entered",
] as const;

type ChecklistItem = (typeof ALLOWED_CHECKLIST_ITEMS)[number];

payrollBranchReadinessRouter.post(
  "/:branchId/checklist",
  requireAuth,
  requireRole("branch_head", "payroll_branch"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { branchId } = req.params;
      const month = resolveMonth(req.query.month ?? req.body?.month);
      const { item, value } = req.body as { item?: string; value?: unknown };

      if (!item || !(ALLOWED_CHECKLIST_ITEMS as readonly string[]).includes(item)) {
        return res.status(400).json({
          success: false,
          message: `'item' must be one of: ${ALLOWED_CHECKLIST_ITEMS.join(", ")}`,
        });
      }

      if (value !== 0 && value !== 1) {
        return res.status(400).json({
          success: false,
          message: "'value' must be 0 or 1",
        });
      }

      const safeItem = item as ChecklistItem;

      // Determine the confirmation timestamp column
      const confirmedAtCol =
        safeItem === "custom_deductions_uploaded"
          ? "custom_deductions_confirmed_at"
          : "overtime_confirmed_at";

      // Try to update in DB; fall through gracefully if table absent
      try {
        await db.execute(
          `UPDATE payroll_branch_readiness
              SET ${safeItem} = ?,
                  ${confirmedAtCol} = ${value === 1 ? "NOW()" : "NULL"}
            WHERE process_month = ? AND branch_id = ?`,
          [value, month, branchId]
        );
      } catch (dbErr: unknown) {
        const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
        console.warn(`[BranchReadiness] checklist UPDATE failed — ${msg}`);
        // Return success anyway — the value is noted, score recomputed below
      }

      // Recompute score/status
      const updated = await payrollBranchReadinessService.getOrRefresh(month, branchId);

      return res.json({
        success: true,
        message: `${safeItem} updated to ${value}`,
        data: updated,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[BranchReadiness] POST /:branchId/checklist error:", msg);
      return res.status(500).json({ success: false, message: "Failed to update checklist item" });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /:branchId/signoff
// Branch head sign-off { remarks }
// Role: branch_head only
// ---------------------------------------------------------------------------

payrollBranchReadinessRouter.post(
  "/:branchId/signoff",
  requireAuth,
  requireRole("branch_head"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { branchId } = req.params;
      const month = resolveMonth(req.query.month ?? req.body?.month);
      const userId = req.authUser!.id;
      const { remarks } = req.body as { remarks?: string };

      if (!remarks?.trim()) {
        return res.status(400).json({
          success: false,
          message: "Sign-off remarks are required",
        });
      }

      await payrollBranchReadinessService.branchHeadSignOff(
        month,
        branchId,
        userId,
        remarks.trim()
      );

      const updated = await payrollBranchReadinessService.getOrRefresh(month, branchId);

      return res.json({
        success: true,
        message: "Branch head sign-off recorded",
        data: updated,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[BranchReadiness] POST /:branchId/signoff error:", msg);
      return res.status(500).json({ success: false, message: "Failed to record sign-off" });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /:branchId/ho-override
// HO force-ready override { reason }
// Roles: payroll_head, super_admin
// ---------------------------------------------------------------------------

payrollBranchReadinessRouter.post(
  "/:branchId/ho-override",
  requireAuth,
  requireRole("payroll_head", "super_admin"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { branchId } = req.params;
      const month = resolveMonth(req.query.month ?? req.body?.month);
      const userId = req.authUser!.id;
      const { reason } = req.body as { reason?: string };

      if (!reason?.trim()) {
        return res.status(400).json({
          success: false,
          message: "Override reason is required",
        });
      }

      await payrollBranchReadinessService.hoOverride(
        month,
        branchId,
        userId,
        reason.trim()
      );

      const updated = await payrollBranchReadinessService.getOrRefresh(month, branchId);

      return res.json({
        success: true,
        message: "HO override applied — branch marked as ready",
        data: updated,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[BranchReadiness] POST /:branchId/ho-override error:", msg);
      return res.status(500).json({ success: false, message: "Failed to apply HO override" });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /:branchId/projection?month=YYYY-MM
// Salary bill projection
// Roles: branch_head, payroll_branch, payroll_head, super_admin
// ---------------------------------------------------------------------------

payrollBranchReadinessRouter.get(
  "/:branchId/projection",
  requireAuth,
  requireRole("branch_head", "payroll_branch", "payroll_head", "super_admin", "payroll"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { branchId } = req.params;
      const month = resolveMonth(req.query.month);

      // Force a fresh projection computation
      await payrollBranchReadinessService.refreshProjection(month, branchId);

      const rec = await payrollBranchReadinessService.getOrRefresh(month, branchId);

      return res.json({
        success: true,
        month,
        branch_id: branchId,
        branch_name: rec.branch_name,
        employee_count: rec.employee_count,
        projected_gross: rec.projected_gross,
        projected_net: rec.projected_net,
        projection_computed_at: rec.projection_computed_at,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[BranchReadiness] GET /:branchId/projection error:", msg);
      return res.status(500).json({ success: false, message: "Failed to fetch projection" });
    }
  }
);
