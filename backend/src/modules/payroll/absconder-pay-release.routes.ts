/**
 * /api/payroll/absconder-pay-release — the Branch Head then Payroll Head release of an absconder's held pay.
 *
 * Roles are asserted here, branch scope by guardExitEmployee (the same guard the F&F exception routes use).
 * The work lives in absconder-pay-release.service.ts.
 */
import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { hasAnyRole } from "../../shared/scopeAccess.js";
import { guardExitEmployee } from "../exit/exitScope.js";
import * as release from "./absconder-pay-release.service.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

export const absconderPayReleaseRouter = Router();
absconderPayReleaseRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

const VIEW_ROLES = ["branch_head", "payroll_head", "hr", "branch_hr", "payroll", "payroll_hr", "admin"];

function fail(res: any, err: unknown) {
  const e = err as { statusCode?: number; code?: string; message: string };
  return res.status(e.statusCode ?? 500).json({ success: false, code: e.code, message: e.message });
}
const bodyReason = (req: AuthenticatedRequest) => String((req.body as { reason?: string })?.reason ?? "");

absconderPayReleaseRouter.get(
  "/:exitRequestId",
  guardExitEmployee("exitRequestId"),
  h(async (req, res) => {
    const userId = req.authUser!.id;
    try {
      const state = await release.getReleaseState(req.params.exitRequestId);
      const isBh = await hasAnyRole(userId, "branch_head");
      const isPh = await hasAnyRole(userId, "payroll_head");
      const isHr = await hasAnyRole(userId, "hr", "branch_hr");
      const [emp] = await db.execute<RowDataPacket[]>(
        `SELECT er.employee_id, e.branch_id, er.pay_hold_at, er.ff_exception_at FROM exit_request er JOIN employees e ON e.id = er.employee_id WHERE er.id = ? LIMIT 1`,
        [req.params.exitRequestId],
      );
      const decider = emp[0] ? await release.holdDeciderRole(userId, { employee_id: String(emp[0].employee_id), branch_id: emp[0].branch_id ?? null }) : null;
      // The reporting manager is not in the role list but is one of the three who decide.
      if (!decider && !(await hasAnyRole(userId, ...VIEW_ROLES))) {
        return res.status(403).json({ success: false, code: "RELEASE_FORBIDDEN", message: "You cannot view this approval." });
      }
      return res.json({
        success: true,
        data: {
          ...state,
          // Placing / withdrawing a hold is the call of the reporting manager, branch Payroll HR or Branch Head.
          canPlaceHold: Boolean(decider) && !emp[0]?.pay_hold_at && !emp[0]?.ff_exception_at,
          canWithdrawHold: Boolean(decider) && Boolean(emp[0]?.pay_hold_at) && !emp[0]?.ff_exception_at,
          canBranchHeadDecide: isBh && (state.state === "awaiting_branch_head"),
          canPayrollHeadDecide: isPh && state.state === "awaiting_payroll_head",
          canReRequest: (isHr || isBh || isPh) && (state.state === "rejected_by_branch_head" || state.state === "rejected_by_payroll_head"),
        },
      });
    } catch (err) { return fail(res, err); }
  }),
);

function decision(role: "branch_head" | "payroll_head", kind: "approve" | "reject") {
  return h(async (req, res) => {
    const userId = req.authUser!.id;
    if (!(await hasAnyRole(userId, role))) {
      const who = role === "branch_head" ? "the employee's Branch Head" : "the Payroll Head";
      return res.status(403).json({ success: false, code: "RELEASE_FORBIDDEN", message: `Only ${who} can do this.` });
    }
    const p = { exitRequestId: req.params.exitRequestId, reason: bodyReason(req), actorUserId: userId, actorRole: role };
    try {
      if (role === "branch_head") {
        if (kind === "approve") await release.branchHeadApprove(p); else await release.branchHeadReject(p);
        return res.json({ success: true, message: kind === "approve" ? "Approved. The Payroll Head decides next." : "Rejected. Salary stays held at 0." });
      }
      if (kind === "approve") {
        const r = await release.payrollHeadApprove(p);
        return res.json({
          success: true,
          data: r,
          message: r.route === "payroll"
            ? "Released. Attendance days are restored in the open payroll run."
            : "Released. That month's payroll run is closed, so the salary is paid through the F&F.",
        });
      }
      await release.payrollHeadReject(p);
      return res.json({ success: true, message: "Rejected. Salary stays held at 0." });
    } catch (err) { return fail(res, err); }
  });
}

absconderPayReleaseRouter.post("/:exitRequestId/branch-head/approve", guardExitEmployee("exitRequestId"), decision("branch_head", "approve"));
absconderPayReleaseRouter.post("/:exitRequestId/branch-head/reject", guardExitEmployee("exitRequestId"), decision("branch_head", "reject"));
absconderPayReleaseRouter.post("/:exitRequestId/payroll-head/approve", guardExitEmployee("exitRequestId"), decision("payroll_head", "approve"));
absconderPayReleaseRouter.post("/:exitRequestId/payroll-head/reject", guardExitEmployee("exitRequestId"), decision("payroll_head", "reject"));

absconderPayReleaseRouter.post(
  "/:exitRequestId/re-request",
  guardExitEmployee("exitRequestId"),
  h(async (req, res) => {
    const userId = req.authUser!.id;
    if (!(await hasAnyRole(userId, "hr", "branch_hr", "branch_head", "payroll_head"))) {
      return res.status(403).json({ success: false, code: "RELEASE_FORBIDDEN", message: "Only HR, the Branch Head or the Payroll Head can re-request." });
    }
    try {
      await release.reRequest({ exitRequestId: req.params.exitRequestId, reason: bodyReason(req), actorUserId: userId });
      return res.json({ success: true, message: "Re-requested. The Branch Head decides again." });
    } catch (err) { return fail(res, err); }
  }),
);

absconderPayReleaseRouter.post(
  "/:exitRequestId/hold",
  guardExitEmployee("exitRequestId"),
  h(async (req, res) => {
    try {
      const out = await release.placeHold({ exitRequestId: req.params.exitRequestId, reason: bodyReason(req), actorUserId: req.authUser!.id });
      return res.json({ success: true, data: out, message: "Salary is on hold at 0 days. The Branch Head and then the Payroll Head release it." });
    } catch (err) { return fail(res, err); }
  }),
);

absconderPayReleaseRouter.post(
  "/:exitRequestId/hold/withdraw",
  guardExitEmployee("exitRequestId"),
  h(async (req, res) => {
    try {
      await release.withdrawHold({ exitRequestId: req.params.exitRequestId, reason: bodyReason(req), actorUserId: req.authUser!.id });
      return res.json({ success: true, message: "Hold withdrawn. Normal salary days are restored." });
    } catch (err) { return fail(res, err); }
  }),
);
