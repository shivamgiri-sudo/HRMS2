/**
 * Cost-centre attendance finalization routes
 * Mounted at: /api/payroll/cc-attendance
 *
 *   GET  /:branchId/cost-centres?month=YYYY-MM              — cost centre list + sign-off status
 *   GET  /:branchId/summary?month=YYYY-MM                   — status rollup for the branch header
 *   GET  /:branchId/:costCentreId/employees?month=YYYY-MM   — the employee day grid (live + snapshot)
 *   GET  /:branchId/:costCentreId/history?month=YYYY-MM     — approval timeline
 *   GET  /:branchId/:costCentreId/export?month=YYYY-MM      — CSV of the grid
 *   POST /:branchId/:costCentreId/finalize                  — Branch Payroll HR / Branch WFM
 *   POST /:branchId/:costCentreId/branch-approve            — Branch Head
 *   POST /:branchId/:costCentreId/ho-approve                — HO Payroll Head
 *   POST /:branchId/:costCentreId/send-back                 — Branch Head or Payroll Head, reason required
 *   POST /:branchId/:costCentreId/request-unlock            — after HO approval, reason required
 *   GET  /unlock-requests?month=&branchId=                  — Payroll Head's pending queue
 *   POST /unlock-requests/:requestId/review                 — Payroll Head grants or refuses
 *
 * Authorization is enforced here, at the API, not by the UI: requireRole for the stage and
 * requireScopedRole for the branch row scope, exactly as payroll-branch-readiness.routes.ts does
 * on the parent page. The branch-side stages are additionally branch-scoped so a payroll_hr for
 * one branch cannot finalize another's; the HO stage is deliberately not, because approving every
 * branch is the whole of the Payroll Head's job here.
 */

import { Router } from "express";
import type { NextFunction, Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireScopedRole } from "../../middleware/scopeMiddleware.js";
import { hasAnyRole, hasScopedAccess } from "../../shared/scopeAccess.js";
import {
  payrollCcAttendanceService,
  CcAttendanceError,
  UNASSIGNED_COST_CENTRE,
} from "./payroll-cc-attendance.service.js";
import {
  triggerCcAttendanceFinalized,
  triggerCcAttendanceBranchApproved,
  triggerCcAttendanceUnlockRequested,
} from "../work-inbox/work-inbox.triggers.js";

export const payrollCcAttendanceRouter = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveMonth(raw: unknown): string {
  if (typeof raw === "string" && /^\d{4}-\d{2}$/.test(raw.trim())) return raw.trim();
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function branchScopeTarget(req: AuthenticatedRequest) {
  return { branchId: req.params.branchId };
}

/*
 * Same scope options the sibling readiness routes use — see their comment there.
 *
 * requireScopeForNonAdmin is true: a role holder with no assignment scope row gets nothing, not
 * everything. It read `false`, which meant a Branch Head created without a scope row could finalize
 * and approve attendance for every branch in the company. Verified on production 2026-09-04 that
 * every current holder of these roles has a matching scope row, so tightening it locks nobody out.
 */
const SCOPE_OPTIONS = { allowAdminBypass: true, requireScopeForNonAdmin: true };

/*
 * Roles that may READ this screen — the same set the parent readiness page admits.
 *
 * Note the split between this list and the scope lists on each read route. requireRole decides who
 * may call at all; requireScopedRole decides which branches they see, and hasScopedAccess() refuses
 * outright any caller holding none of the roles IT was given. So a role named here but absent from
 * a route's scope list is admitted and then refused — which is what happened to payroll_head: it
 * was missing from every read scope list, leaving the HO Payroll Head able to approve a branch's
 * attendance (ho-approve is deliberately unscoped) while unable to read the grid being approved.
 * Only their scope rows filed under a listed role_key count, so payroll_head and payroll are both
 * listed now, matching payroll-branch-readiness.routes.ts.
 *
 * hr and finance remain read-only members of this list with no scope entry, so they are refused in
 * practice. That is pre-existing and unchanged here; it is called out so the next reader does not
 * mistake their presence below for working access.
 */
const READ_ROLES = [
  "branch_head", "payroll_branch", "payroll_hr", "payroll_head",
  "super_admin", "admin", "payroll", "wfm", "hr", "finance", "process_manager",
] as const;

/** The branch-side makers: Branch Payroll HR and the Branch WFM person, per the owner's ask. */
const BRANCH_MAKER_ROLES = ["payroll_hr", "wfm", "payroll_branch", "super_admin"] as const;
const BRANCH_APPROVER_ROLES = ["branch_head", "super_admin"] as const;
const HO_APPROVER_ROLES = ["payroll_head", "super_admin"] as const;

function actorOf(req: AuthenticatedRequest) {
  return {
    userId: String(req.authUser?.id ?? ""),
    role: String(req.authUser?.role ?? ""),
    // Maker-checker is checked against every role the caller holds, not just the primary one —
    // see assertNotSelf() in the service.
    roles: req.userRoles ?? req.authUser?.roles ?? [],
  };
}

/**
 * One error shape for every endpoint. A CcAttendanceError carries the status and code the service
 * decided on (409 CC_ATT_MAKER_CHECKER, 409 CC_ATT_WRONG_STAGE, …) so the UI can tell a refusal
 * it should explain from a fault it should report; anything else is a 500 with the detail logged,
 * never echoed.
 */
function fail(res: Response, err: unknown, where: string) {
  if (err instanceof CcAttendanceError) {
    return res.status(err.status).json({ success: false, code: err.code, message: err.message });
  }
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[CcAttendance] ${where} — ${msg}`);
  return res.status(500).json({ success: false, message: "Cost-centre attendance request failed" });
}

/** Guards a path segment that is either a cost_centre_master UUID or the UNASSIGNED sentinel. */
function assertCostCentreId(res: Response, raw: string): string | null {
  const id = String(raw ?? "").trim();
  if (!id) {
    res.status(400).json({ success: false, message: "cost centre id is required" });
    return null;
  }
  if (id !== UNASSIGNED_COST_CENTRE && !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    res.status(400).json({ success: false, message: "cost centre id is not valid" });
    return null;
  }
  return id;
}

// ---------------------------------------------------------------------------
// Payroll Head's unlock queue.
// Registered BEFORE /:branchId so Express does not match "unlock-requests" as a branch id —
// the same ordering trap payroll-branch-readiness.routes.ts documents for its /export route.
// ---------------------------------------------------------------------------

payrollCcAttendanceRouter.get(
  "/unlock-requests",
  requireAuth,
  requireRole(...HO_APPROVER_ROLES, "admin", "payroll"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const month = typeof req.query.month === "string" ? resolveMonth(req.query.month) : undefined;
      const branchId = typeof req.query.branchId === "string" ? req.query.branchId : undefined;
      const requests = await payrollCcAttendanceService.listPendingUnlockRequests(month, branchId);
      return res.json({ success: true, data: requests });
    } catch (err) {
      return fail(res, err, "GET /unlock-requests");
    }
  }
);

payrollCcAttendanceRouter.post(
  "/unlock-requests/:requestId/review",
  requireAuth,
  requireRole(...HO_APPROVER_ROLES),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { decision, notes } = req.body as { decision?: string; notes?: string };
      if (decision !== "approve" && decision !== "reject") {
        return res
          .status(400)
          .json({ success: false, message: "'decision' must be 'approve' or 'reject'" });
      }
      const result = await payrollCcAttendanceService.reviewUnlock(
        req.params.requestId,
        decision,
        actorOf(req),
        notes
      );
      return res.json({ success: true, data: result });
    } catch (err) {
      return fail(res, err, "POST /unlock-requests/:requestId/review");
    }
  }
);

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

payrollCcAttendanceRouter.get(
  "/:branchId/cost-centres",
  requireAuth,
  requireRole(...READ_ROLES),
  requireScopedRole(
    ["branch_head", "payroll_branch", "payroll_hr", "payroll_head", "payroll", "wfm", "process_manager"],
    branchScopeTarget,
    SCOPE_OPTIONS
  ),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const month = resolveMonth(req.query.month);
      const data = await payrollCcAttendanceService.listCostCentres(month, req.params.branchId);
      return res.json({ success: true, month, branch_id: req.params.branchId, data });
    } catch (err) {
      return fail(res, err, "GET /:branchId/cost-centres");
    }
  }
);

payrollCcAttendanceRouter.get(
  "/:branchId/summary",
  requireAuth,
  requireRole(...READ_ROLES),
  requireScopedRole(
    ["branch_head", "payroll_branch", "payroll_hr", "payroll_head", "payroll", "wfm", "process_manager"],
    branchScopeTarget,
    SCOPE_OPTIONS
  ),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const month = resolveMonth(req.query.month);
      const data = await payrollCcAttendanceService.branchSummary(month, req.params.branchId);
      return res.json({ success: true, month, branch_id: req.params.branchId, data });
    } catch (err) {
      return fail(res, err, "GET /:branchId/summary");
    }
  }
);

payrollCcAttendanceRouter.get(
  "/:branchId/:costCentreId/employees",
  requireAuth,
  requireRole(...READ_ROLES),
  requireScopedRole(
    ["branch_head", "payroll_branch", "payroll_hr", "payroll_head", "payroll", "wfm", "process_manager"],
    branchScopeTarget,
    SCOPE_OPTIONS
  ),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const costCentreId = assertCostCentreId(res, req.params.costCentreId);
      if (!costCentreId) return;
      const month = resolveMonth(req.query.month);
      const data = await payrollCcAttendanceService.getCostCentreDetail(
        month,
        req.params.branchId,
        costCentreId
      );
      return res.json({ success: true, data });
    } catch (err) {
      return fail(res, err, "GET /:branchId/:costCentreId/employees");
    }
  }
);

payrollCcAttendanceRouter.get(
  "/:branchId/:costCentreId/history",
  requireAuth,
  requireRole(...READ_ROLES),
  requireScopedRole(
    ["branch_head", "payroll_branch", "payroll_hr", "payroll_head", "payroll", "wfm", "process_manager"],
    branchScopeTarget,
    SCOPE_OPTIONS
  ),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const costCentreId = assertCostCentreId(res, req.params.costCentreId);
      if (!costCentreId) return;
      const month = resolveMonth(req.query.month);
      const data = await payrollCcAttendanceService.getHistory(
        month,
        req.params.branchId,
        costCentreId
      );
      return res.json({ success: true, data });
    } catch (err) {
      return fail(res, err, "GET /:branchId/:costCentreId/history");
    }
  }
);

/**
 * CSV export of the grid — the legacy screen's Export button.
 *
 * Exports the LIVE grid, matching what is on screen. Every cell is passed through a quoting
 * helper: an employee name containing a comma would otherwise shift every column after it.
 */
payrollCcAttendanceRouter.get(
  "/:branchId/:costCentreId/export",
  requireAuth,
  requireRole(...READ_ROLES),
  requireScopedRole(
    ["branch_head", "payroll_branch", "payroll_hr", "payroll_head", "payroll", "wfm", "process_manager"],
    branchScopeTarget,
    SCOPE_OPTIONS
  ),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const costCentreId = assertCostCentreId(res, req.params.costCentreId);
      if (!costCentreId) return;
      const month = resolveMonth(req.query.month);
      const rows = await payrollCcAttendanceService.getLiveEmployeeGrid(
        month,
        req.params.branchId,
        costCentreId
      );

      const header = [
        "SNo", "EmpCode", "EmpName", "EmpLocation", "TotalDays",
        "A", "P", "OD", "HD/DH/FTP", "L", "H", "W", "SalDays",
      ];
      const cell = (v: unknown) => {
        const s = v === null || v === undefined ? "" : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [
        header.join(","),
        ...rows.map((r, i) =>
          [
            i + 1, r.employee_code, r.employee_name, r.emp_location, r.total_days,
            r.absent_days, r.present_days, r.od_days, r.half_days, r.leave_days,
            r.holiday_days, r.weekoff_days, r.sal_days,
          ]
            .map(cell)
            .join(",")
        ),
      ];

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="cc-attendance-${costCentreId}-${month}.csv"`
      );
      return res.send(lines.join("\n"));
    } catch (err) {
      return fail(res, err, "GET /:branchId/:costCentreId/export");
    }
  }
);

// ---------------------------------------------------------------------------
// Stage 1 — Branch Payroll HR / Branch WFM finalize
// ---------------------------------------------------------------------------

payrollCcAttendanceRouter.post(
  "/:branchId/:costCentreId/finalize",
  requireAuth,
  requireRole(...BRANCH_MAKER_ROLES),
  requireScopedRole(["payroll_hr", "wfm", "payroll_branch"], branchScopeTarget, SCOPE_OPTIONS),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const costCentreId = assertCostCentreId(res, req.params.costCentreId);
      if (!costCentreId) return;
      const month = resolveMonth(req.query.month ?? req.body?.month);
      const result = await payrollCcAttendanceService.finalize(
        month,
        req.params.branchId,
        costCentreId,
        actorOf(req),
        typeof req.body?.remarks === "string" ? req.body.remarks : undefined
      );

      // Notify the Branch Head. Deliberately after the commit and deliberately not awaited into
      // the transaction: a work-inbox hiccup must not roll back a finalization that succeeded.
      void triggerCcAttendanceFinalized(
        req.params.branchId,
        result.finalizationId,
        month,
        result.employees
      ).catch((e) => console.warn(`[CcAttendance] finalize notify failed — ${String(e)}`));

      return res.json({ success: true, data: result });
    } catch (err) {
      return fail(res, err, "POST /:branchId/:costCentreId/finalize");
    }
  }
);

// ---------------------------------------------------------------------------
// Stage 2 — Branch Head
// ---------------------------------------------------------------------------

payrollCcAttendanceRouter.post(
  "/:branchId/:costCentreId/branch-approve",
  requireAuth,
  requireRole(...BRANCH_APPROVER_ROLES),
  requireScopedRole(["branch_head"], branchScopeTarget, SCOPE_OPTIONS),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const costCentreId = assertCostCentreId(res, req.params.costCentreId);
      if (!costCentreId) return;
      const month = resolveMonth(req.query.month ?? req.body?.month);
      const result = await payrollCcAttendanceService.approve(
        "branch",
        month,
        req.params.branchId,
        costCentreId,
        actorOf(req),
        typeof req.body?.remarks === "string" ? req.body.remarks : undefined
      );

      void triggerCcAttendanceBranchApproved(
        req.params.branchId,
        result.finalizationId,
        month
      ).catch((e) => console.warn(`[CcAttendance] branch-approve notify failed — ${String(e)}`));

      return res.json({ success: true, data: result });
    } catch (err) {
      return fail(res, err, "POST /:branchId/:costCentreId/branch-approve");
    }
  }
);

// ---------------------------------------------------------------------------
// Stage 3 — HO Payroll Head
// ---------------------------------------------------------------------------

payrollCcAttendanceRouter.post(
  "/:branchId/:costCentreId/ho-approve",
  requireAuth,
  requireRole(...HO_APPROVER_ROLES),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const costCentreId = assertCostCentreId(res, req.params.costCentreId);
      if (!costCentreId) return;
      const month = resolveMonth(req.query.month ?? req.body?.month);
      const result = await payrollCcAttendanceService.approve(
        "ho",
        month,
        req.params.branchId,
        costCentreId,
        actorOf(req),
        typeof req.body?.remarks === "string" ? req.body.remarks : undefined
      );
      return res.json({ success: true, data: result });
    } catch (err) {
      return fail(res, err, "POST /:branchId/:costCentreId/ho-approve");
    }
  }
);

// ---------------------------------------------------------------------------
// Send back — either approver, before HO approval
// ---------------------------------------------------------------------------

/*
 * Send-back is the one branch-addressed route in this file that carried no scope guard, so a Branch
 * Head could send back a cost centre belonging to any branch — reopening another branch's finalized
 * attendance and resetting its stage. Every sibling route here is scoped; this one was missed.
 *
 * It cannot simply take requireScopedRole, because two different authorities share the route.
 * hasScopedAccess() returns false for a caller holding none of the roles it was given, so a single
 * list would either scope the Payroll Head to one branch (breaking HO send-back, which must reach
 * every branch exactly as ho-approve does) or leave the Branch Head unscoped again. The stage says
 * which authority is acting, so the guard branches on it: HO callers pass through as they do on
 * ho-approve, branch callers are held to their own branch.
 */
async function scopeSendBackToBranch(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.authUser?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }
    // An HO send-back is the Payroll Head's org-wide authority, unscoped by design.
    if (req.body?.stage === "ho" && (await hasAnyRole(userId, ...HO_APPROVER_ROLES))) {
      next();
      return;
    }
    const ok = await hasScopedAccess(
      userId,
      ["branch_head", "payroll_head", "payroll_branch", "payroll_hr", "wfm"],
      branchScopeTarget(req),
      SCOPE_OPTIONS,
    );
    if (!ok) {
      res.status(403).json({
        success: false,
        message: "Forbidden: this record is outside your assigned branch/process/team scope",
      });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}

payrollCcAttendanceRouter.post(
  "/:branchId/:costCentreId/send-back",
  requireAuth,
  requireRole("branch_head", "payroll_head", "super_admin"),
  scopeSendBackToBranch,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const costCentreId = assertCostCentreId(res, req.params.costCentreId);
      if (!costCentreId) return;
      const stage = req.body?.stage === "ho" ? "ho" : "branch";
      const month = resolveMonth(req.query.month ?? req.body?.month);
      const result = await payrollCcAttendanceService.sendBack(
        stage,
        month,
        req.params.branchId,
        costCentreId,
        actorOf(req),
        String(req.body?.reason ?? "")
      );
      return res.json({ success: true, data: result });
    } catch (err) {
      return fail(res, err, "POST /:branchId/:costCentreId/send-back");
    }
  }
);

// ---------------------------------------------------------------------------
// Unlock request — raised by the branch after HO approval
// ---------------------------------------------------------------------------

payrollCcAttendanceRouter.post(
  "/:branchId/:costCentreId/request-unlock",
  requireAuth,
  requireRole("payroll_hr", "wfm", "payroll_branch", "branch_head", "super_admin"),
  requireScopedRole(
    ["payroll_hr", "wfm", "payroll_branch", "branch_head"],
    branchScopeTarget,
    SCOPE_OPTIONS
  ),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const costCentreId = assertCostCentreId(res, req.params.costCentreId);
      if (!costCentreId) return;
      const month = resolveMonth(req.query.month ?? req.body?.month);
      const result = await payrollCcAttendanceService.requestUnlock(
        month,
        req.params.branchId,
        costCentreId,
        String(req.body?.reason ?? ""),
        actorOf(req)
      );

      void triggerCcAttendanceUnlockRequested(
        req.params.branchId,
        result.finalizationId,
        month
      ).catch((e) => console.warn(`[CcAttendance] unlock notify failed — ${String(e)}`));

      return res.json({ success: true, data: result });
    } catch (err) {
      return fail(res, err, "POST /:branchId/:costCentreId/request-unlock");
    }
  }
);
