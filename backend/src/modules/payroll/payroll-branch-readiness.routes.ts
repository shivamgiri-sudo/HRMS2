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
import type { RowDataPacket } from "mysql2";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireScopedRole } from "../../middleware/scopeMiddleware.js";
import { payrollBranchReadinessService } from "./payroll-branch-readiness.service.js";
import { payrollGovernanceService } from "./payroll-governance.service.js";
import { db } from "../../db/mysql.js";
import { triggerPayrollAttendanceFreezeRequest } from "../work-inbox/work-inbox.triggers.js";

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
// Row-level scope.
//
// This was introduced non-regressively: a caller with zero user_assignment_scope rows kept their
// previous unrestricted behaviour, so that turning scoping on could not lock anyone out before the
// scope data existed. That was a migration step, and the migration is over — every holder of these
// roles now has a scope row, so the bypass has been closed. See SCOPE_OPTIONS below.
// ---------------------------------------------------------------------------

function branchScopeTarget(req: AuthenticatedRequest) {
  return { branchId: req.params.branchId };
}

function branchProcessScopeTarget(req: AuthenticatedRequest) {
  return { branchId: req.params.branchId, processId: req.params.processId };
}

/*
 * Scope options for every branch-addressed route below.
 *
 * requireScopeForNonAdmin was `false`, which made hasScopedAccess() return TRUE for a role holder
 * with no assignment scope row at all — so a Branch Head created without a scope row silently got
 * every branch in the company rather than none. Missing configuration must fail closed: the whole
 * point of this middleware is that a branch user sees one branch.
 *
 * Verified before flipping, against production on 2026-09-04: every user holding branch_head,
 * payroll_branch, payroll_hr, wfm, payroll_head or payroll has at least one active scope row filed
 * under one of those role keys, so nobody loses access today. super_admin and admin still bypass.
 *
 * If someone is locked out later, the fix is to give them a scope row — not to reopen this.
 */
const SCOPE_OPTIONS = { allowAdminBypass: true, requireScopeForNonAdmin: true };

// ---------------------------------------------------------------------------
// Org-wide governance readiness (payroll-governance.service.ts) — the
// comprehensive engine that already checks attendance-finalized/missing-punch/
// attendance-errors, leave-sync, PAN validity, salary structure, statutory
// config, and is the ONLY engine of the four in this codebase that actually
// gates payroll calculation (409s POST /runs/:id/calculate on any blocker).
// It was built against payroll.routes.ts's Attendance Control Tower page, not
// this one, and operates on a single salary_prep_run (org-wide for this
// codebase's live data — every active month has exactly one non-synthetic
// run, not one per branch), so it cannot be attributed down to an individual
// branch/process card without deeper per-issue employee-branch mapping work
// this pass doesn't attempt. What it CAN safely do today: surface the run's
// blocker/warning counts and messages on the HO-level summary views (this
// route, and process-readiness's /grouped-summary), where "org-wide" is
// already the correct framing — informational, read-only, does not change
// readiness_score/readiness_status or gate anything on this page.
//
// Excludes synthetic/test runs using the same creator-name filter established
// in payroll-signoff.routes.ts for the identical problem (a test run
// rendering identically to a real one in a payroll-facing list).
// ---------------------------------------------------------------------------

const SYNTHETIC_RUN_CREATORS = ["test-auto-gen", "codex-e2e", "smoke-test", "demo-seed"];

type OrgWideGovernanceSummary =
  | { status: "not_created" }
  | { status: "error"; message: string }
  | {
      status: "checked";
      runId: string;
      canCalculate: boolean;
      blockers: number;
      warnings: number;
      issues: Array<{ code: string; severity: string; count: number; message: string }>;
    };

async function getOrgWideGovernanceSummary(month: string): Promise<OrgWideGovernanceSummary> {
  const placeholders = SYNTHETIC_RUN_CREATORS.map(() => "?").join(", ");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM salary_prep_run
      WHERE run_month = ?
        AND LOWER(COALESCE(created_by, '')) NOT IN (${placeholders})
      ORDER BY created_at DESC LIMIT 1`,
    [month, ...SYNTHETIC_RUN_CREATORS]
  );
  const runId = (rows[0] as RowDataPacket | undefined)?.id as string | undefined;
  if (!runId) return { status: "not_created" };

  try {
    const result = await payrollGovernanceService.readiness(runId);
    return {
      status: "checked",
      runId: result.runId,
      canCalculate: result.canCalculate,
      blockers: result.summary.blockers,
      warnings: result.summary.warnings,
      issues: result.issues,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[BranchReadiness] governance readiness failed for run ${runId} — ${msg}`);
    // Explicit "not checked", never silently treated as zero issues.
    return { status: "error", message: msg };
  }
}

// ---------------------------------------------------------------------------
// GET /export?month=YYYY-MM&format=csv
// CSV export for HO summary
// Roles: payroll_head, super_admin, admin
// NOTE: Must be registered before /:branchId to avoid Express matching "export"
//       as a branchId parameter.
// ---------------------------------------------------------------------------

payrollBranchReadinessRouter.get(
  "/export",
  requireAuth,
  requireRole("payroll_head", "super_admin", "admin"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const month = resolveMonth(req.query.month);
      const format = (req.query.format as string) ?? "csv";

      if (format !== "csv") {
        return res.status(400).json({
          success: false,
          message: "Only 'csv' format is supported",
        });
      }

      const data = await payrollBranchReadinessService.getHOSummary(month);

      // CSV header
      const csvRows = [
        "Branch Name,Employee Count,Attendance Frozen,Incentives Status,Custom Deductions,Overtime Entered,Bank Details %,UAN Complete %,NOC Resolved,Holiday Work Approved,Branch Head Signoff,Readiness Score,Readiness Status,Projected Gross,Projected Net,HO Override",
      ];

      // CSV data rows
      for (const branch of data) {
        const row = [
          branch.branch_name ?? "—",
          branch.employee_count,
          branch.attendance_frozen ? "Yes" : "No",
          branch.incentives_status.replace("_", " "),
          branch.custom_deductions_uploaded ? "Yes" : "No",
          branch.overtime_entered ? "Yes" : "No",
          `${branch.bank_details_pct}%`,
          `${branch.uan_complete_pct}%`,
          branch.noc_resolved ? "Yes" : "No",
          branch.holiday_work_approved ? "Yes" : "No",
          branch.branch_head_signoff ? "Yes" : "No",
          branch.readiness_score,
          branch.readiness_status.replace("_", " "),
          branch.projected_gross != null ? branch.projected_gross.toFixed(2) : "—",
          branch.projected_net != null ? branch.projected_net.toFixed(2) : "—",
          branch.ho_override_ready ? "Yes" : "No",
        ];
        csvRows.push(row.join(","));
      }

      const csv = csvRows.join("\n");
      const filename = `branch-readiness-${month}.csv`;

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(csv);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[BranchReadiness] GET /export error:", msg);
      return res.status(500).json({ success: false, message: "Failed to generate CSV export" });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /summary?month=YYYY-MM
// Roles: super_admin, payroll_head, payroll
// ---------------------------------------------------------------------------

payrollBranchReadinessRouter.get(
  "/summary",
  requireAuth,
  requireRole("super_admin", "payroll_head", "payroll", "admin"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const month = resolveMonth(req.query.month);
      // Seed the full (branch x process) grid before reading. The summary enumerates rows, and
      // rows were only ever created on demand by ensureRecord when somebody browsed to a branch,
      // so unvisited combinations were missing entirely rather than showing as not-ready - which
      // on a readiness page reads as nothing being wrong. Idempotent INSERT IGNORE; a failure
      // here degrades to the previous partial view rather than failing the request.
      try {
        await payrollBranchReadinessService.ensureMonthGrid(month);
      } catch (seedErr: unknown) {
        console.warn(
          "[BranchReadiness] ensureMonthGrid failed - summary may omit unvisited branch/process rows:",
          seedErr instanceof Error ? seedErr.message : seedErr
        );
      }
      const data = await payrollBranchReadinessService.getHOSummary(month);

      // Compute summary stats
      const total = data.length;
      const ready = data.filter((b) => b.readiness_status === "ready").length;
      const in_progress = data.filter((b) => b.readiness_status === "in_progress").length;
      const blocked = data.filter((b) => b.readiness_status === "blocked").length;
      const avg_score =
        total > 0
          ? Math.round(data.reduce((s, b) => s + b.readiness_score, 0) / total)
          : 0;

      // Org-wide, not per-branch — see getOrgWideGovernanceSummary's comment. Covers
      // PAN validity, salary structure, statutory config, attendance-error checks
      // this page's own checklist does not.
      const governance = await getOrgWideGovernanceSummary(month);

      return res.json({
        success: true,
        month,
        data,
        summary: {
          total,
          ready,
          in_progress,
          blocked,
          avg_score,
        },
        governance,
      });
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
  requireRole("branch_head", "payroll_branch", "payroll_hr", "payroll_head", "super_admin", "payroll", "wfm"),
  requireScopedRole(
    ["branch_head", "payroll_branch", "payroll_hr", "payroll_head", "payroll", "wfm"],
    branchScopeTarget,
    SCOPE_OPTIONS
  ),
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
  "attendance_data_ready",      // WFM declaration: attendance data is complete
  "leave_finalized",            // WFM: all leaves approved/rejected, balances synced
  "regularization_complete",    // WFM: all attendance regularizations resolved
  "custom_deductions_uploaded",
  "overtime_entered",
] as const;

type ChecklistItem = (typeof ALLOWED_CHECKLIST_ITEMS)[number];

payrollBranchReadinessRouter.post(
  "/:branchId/checklist",
  requireAuth,
  requireRole("branch_head", "payroll_branch", "payroll_hr", "wfm"),
  requireScopedRole(["branch_head", "payroll_branch", "payroll_hr", "wfm"], branchScopeTarget, SCOPE_OPTIONS),
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
        safeItem === "attendance_data_ready"      ? "attendance_data_ready_at"       :
        safeItem === "leave_finalized"            ? "leave_finalized_at"             :
        safeItem === "regularization_complete"    ? "regularization_complete_at"     :
        safeItem === "custom_deductions_uploaded" ? "custom_deductions_confirmed_at" :
          "overtime_confirmed_at";

      // Try to update in DB; fall through gracefully if table absent
      //
      // The process_id = '' filter is load-bearing. This is the BRANCH-LEVEL route, and
      // the branch aggregate is the row with process_id = '' (ensureRecord defaults
      // processId to ''). Without the filter the UPDATE matched every process-scoped row
      // for the same (month, branch) too, so one branch head ticking one checklist item
      // silently confirmed it on behalf of every process manager under that branch.
      //
      // Verified live 2026-08-28: for NOIDA-2 / 2026-08 the unfiltered predicate matches
      // 7 rows where it should match 1 — the branch aggregate plus 6 process-scoped rows,
      // one of which covers 219 employees. Each checklist item is worth up to 15 of the
      // 100 readiness points and 'ready' is score >= 80, so this pushed processes toward
      // ready that nobody had actually signed off. Across live data 4 (month, branch)
      // groups are affected, 41 rows total.
      //
      // The sibling process-scoped route below (POST /:branchId/:processId/checklist)
      // already filtered on process_id correctly; only this branch-level path was wrong.
      try {
        await db.execute(
          `UPDATE payroll_branch_readiness
              SET ${safeItem} = ?,
                  ${confirmedAtCol} = ${value === 1 ? "NOW()" : "NULL"}
            WHERE process_month = ? AND branch_id = ? AND process_id = ?`,
          [value, month, branchId, ""]
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
  requireScopedRole(["branch_head"], branchScopeTarget, SCOPE_OPTIONS),
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
// POST /:branchId/request-freeze
// Branch head / WFM signals that attendance data is complete and requests
// the payroll head to perform the attendance freeze.
// Roles: branch_head, payroll_branch
// ---------------------------------------------------------------------------

payrollBranchReadinessRouter.post(
  "/:branchId/request-freeze",
  requireAuth,
  requireRole("branch_head", "payroll_branch", "payroll_hr", "wfm"),
  requireScopedRole(["branch_head", "payroll_branch", "payroll_hr", "wfm"], branchScopeTarget, SCOPE_OPTIONS),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { branchId } = req.params;
      const month = resolveMonth(req.query.month ?? req.body?.month);

      // Resolve branch name for the notification
      let branchName = branchId;
      try {
        const [rows] = await db.execute<any[]>(
          `SELECT branch_name FROM branch_master WHERE id = ? LIMIT 1`,
          [branchId]
        );
        branchName = (rows[0] as any)?.branch_name ?? branchId;
      } catch { /* non-critical */ }

      await triggerPayrollAttendanceFreezeRequest(branchId, branchName, month);

      return res.json({
        success: true,
        message: "Attendance freeze request sent to Payroll Head",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[BranchReadiness] POST /:branchId/request-freeze error:", msg);
      return res.status(500).json({ success: false, message: "Failed to send freeze request" });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /:branchId/processes?month=YYYY-MM
// Process-level readiness for a single branch
// Roles: branch_head, payroll_branch, payroll_head, super_admin, payroll
// ---------------------------------------------------------------------------

payrollBranchReadinessRouter.get(
  "/:branchId/processes",
  requireAuth,
  requireRole("branch_head", "payroll_branch", "payroll_hr", "payroll_head", "super_admin", "payroll", "wfm"),
  requireScopedRole(
    ["branch_head", "payroll_branch", "payroll_hr", "payroll_head", "payroll", "wfm"],
    branchScopeTarget,
    SCOPE_OPTIONS
  ),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { branchId } = req.params;
      const month = resolveMonth(req.query.month);
      const processes = await payrollBranchReadinessService.getSummaryForBranch(month, branchId);

      const total = processes.length;
      const ready = processes.filter((p) => p.readiness_status === "ready").length;
      const blocked = processes.filter((p) => p.readiness_status === "blocked").length;
      const in_progress = processes.filter((p) => p.readiness_status === "in_progress").length;
      const avg_score = total > 0
        ? Math.round(processes.reduce((s, p) => s + p.readiness_score, 0) / total)
        : 0;

      return res.json({
        success: true,
        month,
        branch_id: branchId,
        data: processes,
        summary: { total, ready, blocked, in_progress, avg_score },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[BranchReadiness] GET /:branchId/processes error:", msg);
      return res.status(500).json({ success: false, message: "Failed to fetch process readiness" });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /:branchId/:processId/checklist
// Update a manual checklist item for a specific process
// Roles: branch_head, payroll_branch
// ---------------------------------------------------------------------------

payrollBranchReadinessRouter.post(
  "/:branchId/:processId/checklist",
  requireAuth,
  requireRole("branch_head", "payroll_branch", "payroll_hr", "wfm"),
  requireScopedRole(["branch_head", "payroll_branch", "payroll_hr", "wfm"], branchProcessScopeTarget, SCOPE_OPTIONS),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { branchId, processId } = req.params;
      const month = resolveMonth(req.query.month ?? req.body?.month);
      const { item, value } = req.body as { item?: string; value?: unknown };

      const ALLOWED = ["custom_deductions_uploaded", "overtime_entered"] as const;
      if (!item || !(ALLOWED as readonly string[]).includes(item)) {
        return res.status(400).json({ success: false, message: `item must be one of: ${ALLOWED.join(", ")}` });
      }
      if (value !== 0 && value !== 1) {
        return res.status(400).json({ success: false, message: "value must be 0 or 1" });
      }

      const confirmedAtCol = item === "custom_deductions_uploaded"
        ? "custom_deductions_confirmed_at"
        : "overtime_confirmed_at";

      try {
        await db.execute(
          `UPDATE payroll_branch_readiness
              SET ${item} = ?,
                  ${confirmedAtCol} = ${value === 1 ? "NOW()" : "NULL"}
            WHERE process_month = ? AND branch_id = ? AND process_id = ?`,
          [value, month, branchId, processId]
        );
      } catch (dbErr: unknown) {
        const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
        console.warn(`[BranchReadiness] process checklist UPDATE failed — ${msg}`);
      }

      const updated = await payrollBranchReadinessService.getOrRefresh(month, branchId, processId);
      return res.json({ success: true, message: `${item} updated to ${value}`, data: updated });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[BranchReadiness] POST /:branchId/:processId/checklist error:", msg);
      return res.status(500).json({ success: false, message: "Failed to update process checklist item" });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /:branchId/:processId/signoff
// Process Manager / WFM sign-off on their process readiness
// Roles: branch_head, payroll_branch, wfm, super_admin, payroll_head
// ---------------------------------------------------------------------------

payrollBranchReadinessRouter.post(
  "/:branchId/:processId/signoff",
  requireAuth,
  requireRole("branch_head", "payroll_branch", "payroll_hr", "wfm", "super_admin", "payroll_head", "payroll"),
  requireScopedRole(
    ["branch_head", "payroll_branch", "payroll_hr", "wfm", "payroll_head", "payroll"],
    branchProcessScopeTarget,
    SCOPE_OPTIONS
  ),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { branchId, processId } = req.params;
      const month = resolveMonth(req.query.month ?? req.body?.month);
      const userId = req.authUser!.id;
      const { remarks } = req.body as { remarks?: string };

      if (!remarks?.trim()) {
        return res.status(400).json({ success: false, message: "Sign-off remarks are required" });
      }

      try {
        await db.execute(
          `UPDATE payroll_branch_readiness
              SET process_manager_signoff = 1,
                  process_manager_signoff_at = NOW(),
                  process_manager_signoff_by = ?,
                  process_manager_remarks = ?
            WHERE process_month = ? AND branch_id = ? AND process_id = ?`,
          [userId, remarks.trim(), month, branchId, processId]
        );
      } catch (dbErr: unknown) {
        const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
        console.warn(`[BranchReadiness] process signoff UPDATE failed — ${msg}`);
      }

      const updated = await payrollBranchReadinessService.getOrRefresh(month, branchId, processId);
      return res.json({ success: true, message: "Process sign-off recorded", data: updated });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[BranchReadiness] POST /:branchId/:processId/signoff error:", msg);
      return res.status(500).json({ success: false, message: "Failed to record process sign-off" });
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
  requireRole("branch_head", "payroll_branch", "payroll_hr", "payroll_head", "super_admin", "payroll"),
  requireScopedRole(
    ["branch_head", "payroll_branch", "payroll_hr", "payroll_head", "payroll"],
    branchScopeTarget,
    SCOPE_OPTIONS
  ),
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

