/**
 * Process Payroll Readiness Routes
 * Mounted at: /api/payroll/process-readiness
 *
 * Endpoints (fixed paths MUST be registered before /:branchId/:processId):
 *   GET  /grouped-summary?month=          — HO: all branches with their processes
 *   GET  /export?month=&format=csv        — CSV: one row per process across all branches
 *   GET  /branch/:branchId?month=         — Branch Head: all processes for one branch
 *   GET  /:branchId/:processId?month=     — Single process detail
 *   POST /:branchId/:processId/checklist  — WFM/PM: toggle attendance_data_ready / custom_deductions / overtime
 *   POST /:branchId/:processId/signoff    — Process Manager sign-off
 *   POST /:branchId/:processId/ho-override — HO force-ready
 *   POST /:branchId/:processId/request-freeze — WFM/PM: notify payroll_head to freeze attendance
 *   GET  /:branchId/:processId/projection?month= — Salary projection for this process
 */

import { Router } from "express";
import type { Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { payrollBranchReadinessService } from "./payroll-branch-readiness.service.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import {
  triggerPayrollProcessFreezeRequest,
} from "../work-inbox/work-inbox.triggers.js";

export const payrollProcessReadinessRouter = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveMonth(raw: unknown): string {
  if (typeof raw === "string" && /^\d{4}-\d{2}$/.test(raw.trim())) {
    return raw.trim();
  }
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// GET /grouped-summary?month=YYYY-MM
// HO view: all branches each with their processes grouped
// Roles: payroll_head, super_admin, payroll, admin
// ---------------------------------------------------------------------------

payrollProcessReadinessRouter.get(
  "/grouped-summary",
  requireAuth,
  requireRole("payroll_head", "super_admin", "payroll", "admin"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const month = resolveMonth(req.query.month);
      const data = await payrollBranchReadinessService.getHOSummaryGrouped(month);

      const totalProcesses = data.reduce((s, b) => s + b.stats.total, 0);
      const readyProcesses  = data.reduce((s, b) => s + b.stats.ready, 0);
      const avgScore = totalProcesses > 0
        ? Math.round(data.reduce((s, b) => s + b.stats.avg_score * b.stats.total, 0) / totalProcesses)
        : 0;

      return res.json({
        success: true,
        month,
        data,
        summary: { totalBranches: data.length, totalProcesses, readyProcesses, avgScore },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[ProcessReadiness] GET /grouped-summary error:", msg);
      return res.status(500).json({ success: false, message: "Failed to fetch grouped summary" });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /export?month=YYYY-MM&format=csv
// CSV export — one row per process
// Roles: payroll_head, super_admin, admin
// ---------------------------------------------------------------------------

payrollProcessReadinessRouter.get(
  "/export",
  requireAuth,
  requireRole("payroll_head", "super_admin", "admin"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const month = resolveMonth(req.query.month);
      if ((req.query.format ?? "csv") !== "csv") {
        return res.status(400).json({ success: false, message: "Only 'csv' format is supported" });
      }

      const groups = await payrollBranchReadinessService.getHOSummaryGrouped(month);

      const csvRows = [
        "Branch Name,Process Name,Employee Count,Attendance Data Ready,Attendance Frozen,Incentives Status," +
        "Custom Deductions,Overtime Entered,Bank Details %,UAN Complete %,NOC Resolved,Holiday Work Approved," +
        "Process Manager Signoff,Readiness Score,Readiness Status,Projected Gross,Projected Net,HO Override",
      ];

      for (const branch of groups) {
        for (const proc of branch.processes) {
          const row = [
            branch.branch_name ?? "—",
            proc.process_name ?? "—",
            proc.employee_count,
            proc.attendance_data_ready ? "Yes" : "No",
            proc.attendance_frozen ? "Yes" : "No",
            proc.incentives_status.replace("_", " "),
            proc.custom_deductions_uploaded ? "Yes" : "No",
            proc.overtime_entered ? "Yes" : "No",
            `${proc.bank_details_pct}%`,
            `${proc.uan_complete_pct}%`,
            proc.noc_resolved ? "Yes" : "No",
            proc.holiday_work_approved ? "Yes" : "No",
            proc.process_manager_signoff ? "Yes" : "No",
            proc.readiness_score,
            proc.readiness_status.replace("_", " "),
            proc.projected_gross != null ? proc.projected_gross.toFixed(2) : "—",
            proc.projected_net != null ? proc.projected_net.toFixed(2) : "—",
            proc.ho_override_ready ? "Yes" : "No",
          ];
          csvRows.push(row.join(","));
        }
      }

      const csv = csvRows.join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="process-readiness-${month}.csv"`);
      return res.send(csv);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[ProcessReadiness] GET /export error:", msg);
      return res.status(500).json({ success: false, message: "Failed to generate CSV export" });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /branch/:branchId?month=YYYY-MM
// Branch Head: all processes for their branch
// Roles: branch_head, payroll_branch, payroll_head, super_admin, payroll, wfm, process_manager
// ---------------------------------------------------------------------------

payrollProcessReadinessRouter.get(
  "/branch/:branchId",
  requireAuth,
  requireRole("branch_head", "payroll_branch", "payroll_head", "super_admin", "payroll", "wfm", "process_manager"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { branchId } = req.params;
      const month = resolveMonth(req.query.month);
      const data = await payrollBranchReadinessService.getSummaryForBranch(month, branchId);

      const total = data.length;
      const ready = data.filter(p => p.readiness_status === "ready").length;
      const in_progress = data.filter(p => p.readiness_status === "in_progress").length;
      const blocked = data.filter(p => p.readiness_status === "blocked").length;
      const avg_score = total > 0
        ? Math.round(data.reduce((s, p) => s + p.readiness_score, 0) / total)
        : 0;

      return res.json({
        success: true,
        month,
        branch_id: branchId,
        data,
        summary: { total, ready, in_progress, blocked, avg_score },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[ProcessReadiness] GET /branch/:branchId error:", msg);
      return res.status(500).json({ success: false, message: "Failed to fetch branch process summary" });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /:branchId/:processId?month=YYYY-MM
// Single process detail
// Roles: all payroll-related + wfm + process_manager
// ---------------------------------------------------------------------------

payrollProcessReadinessRouter.get(
  "/:branchId/:processId",
  requireAuth,
  requireRole(
    "branch_head", "payroll_branch", "payroll_head", "super_admin",
    "payroll", "wfm", "process_manager", "admin", "hr"
  ),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { branchId, processId } = req.params;
      const month = resolveMonth(req.query.month);
      const data = await payrollBranchReadinessService.getOrRefresh(month, branchId, processId);
      return res.json({ success: true, month, branch_id: branchId, process_id: processId, data });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[ProcessReadiness] GET /:branchId/:processId error:", msg);
      return res.status(500).json({ success: false, message: "Failed to fetch process readiness" });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /:branchId/:processId/checklist
// Toggle a manual checklist item: attendance_data_ready | custom_deductions_uploaded | overtime_entered
// Roles: wfm (attendance_data_ready only), process_manager, branch_head, payroll_branch
// ---------------------------------------------------------------------------

const ALLOWED_PROCESS_CHECKLIST_ITEMS = [
  "attendance_data_ready",
  "custom_deductions_uploaded",
  "overtime_entered",
] as const;
type ProcessChecklistItem = (typeof ALLOWED_PROCESS_CHECKLIST_ITEMS)[number];

const CONFIRMED_AT_MAP: Record<ProcessChecklistItem, string> = {
  attendance_data_ready:       "attendance_data_ready_at",
  custom_deductions_uploaded:  "custom_deductions_confirmed_at",
  overtime_entered:            "overtime_confirmed_at",
};
const CONFIRMED_BY_MAP: Record<ProcessChecklistItem, string | null> = {
  attendance_data_ready:       "attendance_data_ready_by",
  custom_deductions_uploaded:  null,
  overtime_entered:            null,
};

payrollProcessReadinessRouter.post(
  "/:branchId/:processId/checklist",
  requireAuth,
  requireRole("wfm", "process_manager", "branch_head", "payroll_branch"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { branchId, processId } = req.params;
      const month = resolveMonth(req.query.month ?? req.body?.month);
      const { item, value } = req.body as { item?: string; value?: unknown };
      const userId = req.authUser!.id;

      if (!item || !(ALLOWED_PROCESS_CHECKLIST_ITEMS as readonly string[]).includes(item)) {
        return res.status(400).json({
          success: false,
          message: `'item' must be one of: ${ALLOWED_PROCESS_CHECKLIST_ITEMS.join(", ")}`,
        });
      }

      if (value !== 0 && value !== 1) {
        return res.status(400).json({ success: false, message: "'value' must be 0 or 1" });
      }

      const safeItem = item as ProcessChecklistItem;
      const confirmedAtCol = CONFIRMED_AT_MAP[safeItem];
      const confirmedByCol = CONFIRMED_BY_MAP[safeItem];

      const setCols = [
        `${safeItem} = ?`,
        `${confirmedAtCol} = ${value === 1 ? "NOW()" : "NULL"}`,
      ];
      const params: unknown[] = [value];

      if (confirmedByCol) {
        setCols.push(`${confirmedByCol} = ${value === 1 ? "?" : "NULL"}`);
        if (value === 1) params.push(userId);
      }

      try {
        await db.execute(
          `UPDATE payroll_branch_readiness
              SET ${setCols.join(", ")}
            WHERE process_month = ? AND branch_id = ? AND process_id = ?`,
          [...params, month, branchId, processId]
        );
      } catch (dbErr: unknown) {
        const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
        console.warn(`[ProcessReadiness] checklist UPDATE failed — ${msg}`);
      }

      const updated = await payrollBranchReadinessService.getOrRefresh(month, branchId, processId);
      return res.json({ success: true, message: `${safeItem} updated to ${value}`, data: updated });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[ProcessReadiness] POST checklist error:", msg);
      return res.status(500).json({ success: false, message: "Failed to update checklist item" });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /:branchId/:processId/signoff
// Process Manager sign-off { remarks }
// Roles: process_manager, branch_head
// ---------------------------------------------------------------------------

payrollProcessReadinessRouter.post(
  "/:branchId/:processId/signoff",
  requireAuth,
  requireRole("process_manager", "branch_head"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { branchId, processId } = req.params;
      const month = resolveMonth(req.query.month ?? req.body?.month);
      const userId = req.authUser!.id;
      const { remarks } = req.body as { remarks?: string };

      if (!remarks?.trim()) {
        return res.status(400).json({ success: false, message: "Sign-off remarks are required" });
      }

      await payrollBranchReadinessService.processManagerSignOff(
        month, branchId, processId, userId, remarks.trim()
      );

      const updated = await payrollBranchReadinessService.getOrRefresh(month, branchId, processId);
      return res.json({ success: true, message: "Process sign-off recorded", data: updated });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[ProcessReadiness] POST signoff error:", msg);
      return res.status(500).json({ success: false, message: "Failed to record sign-off" });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /:branchId/:processId/ho-override
// HO force-ready override { reason }
// Roles: payroll_head, super_admin
// ---------------------------------------------------------------------------

payrollProcessReadinessRouter.post(
  "/:branchId/:processId/ho-override",
  requireAuth,
  requireRole("payroll_head", "super_admin"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { branchId, processId } = req.params;
      const month = resolveMonth(req.query.month ?? req.body?.month);
      const userId = req.authUser!.id;
      const { reason } = req.body as { reason?: string };

      if (!reason?.trim()) {
        return res.status(400).json({ success: false, message: "Override reason is required" });
      }

      await payrollBranchReadinessService.hoOverride(
        month, branchId, userId, reason.trim(), processId
      );

      const updated = await payrollBranchReadinessService.getOrRefresh(month, branchId, processId);
      return res.json({ success: true, message: "HO override applied — process marked as ready", data: updated });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[ProcessReadiness] POST ho-override error:", msg);
      return res.status(500).json({ success: false, message: "Failed to apply HO override" });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /:branchId/:processId/request-freeze
// WFM/PM signals attendance data is complete, requests payroll_head to freeze
// Roles: wfm, process_manager, branch_head, payroll_branch
// ---------------------------------------------------------------------------

payrollProcessReadinessRouter.post(
  "/:branchId/:processId/request-freeze",
  requireAuth,
  requireRole("wfm", "process_manager", "branch_head", "payroll_branch"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { branchId, processId } = req.params;
      const month = resolveMonth(req.query.month ?? req.body?.month);

      let processName = processId;
      let branchName  = branchId;
      try {
        const [rows] = await db.execute<RowDataPacket[]>(
          `SELECT pm.process_name, bm.branch_name
             FROM process_master pm
             JOIN branch_master bm ON bm.id = pm.branch_id
            WHERE pm.id = ? LIMIT 1`,
          [processId]
        );
        processName = (rows[0] as any)?.process_name ?? processId;
        branchName  = (rows[0] as any)?.branch_name  ?? branchId;
      } catch { /* non-critical */ }

      await triggerPayrollProcessFreezeRequest(branchId, processId, processName, branchName, month);

      return res.json({ success: true, message: "Attendance freeze request sent to Payroll Head" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[ProcessReadiness] POST request-freeze error:", msg);
      return res.status(500).json({ success: false, message: "Failed to send freeze request" });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /:branchId/:processId/projection?month=YYYY-MM
// Salary projection for this process
// Roles: all payroll-related + process_manager + wfm
// ---------------------------------------------------------------------------

payrollProcessReadinessRouter.get(
  "/:branchId/:processId/projection",
  requireAuth,
  requireRole(
    "branch_head", "payroll_branch", "payroll_head", "super_admin",
    "payroll", "wfm", "process_manager"
  ),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { branchId, processId } = req.params;
      const month = resolveMonth(req.query.month);

      await payrollBranchReadinessService.refreshProjection(month, branchId, processId);
      const rec = await payrollBranchReadinessService.getOrRefresh(month, branchId, processId);

      return res.json({
        success: true,
        month,
        branch_id: branchId,
        process_id: processId,
        process_name: rec.process_name,
        employee_count: rec.employee_count,
        projected_gross: rec.projected_gross,
        projected_net: rec.projected_net,
        projection_computed_at: rec.projection_computed_at,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[ProcessReadiness] GET projection error:", msg);
      return res.status(500).json({ success: false, message: "Failed to fetch projection" });
    }
  }
);
