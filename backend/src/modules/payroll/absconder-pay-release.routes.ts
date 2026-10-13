/**
 * /api/payroll/absconder-pay-release — hold and release of an absconder's salary.
 *
 * The reporting manager requests; the branch Payroll HR approves, rejects, places directly and releases.
 * The Branch Head and Payroll Head have no part. Who may act is decided in the service (it knows the
 * employee's manager and branch); branch scope is also enforced by guardExitEmployee.
 */
import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { hasAnyRole } from "../../shared/scopeAccess.js";
import { db } from "../../db/mysql.js";
import { guardExitEmployee } from "../exit/exitScope.js";
import * as release from "./absconder-pay-release.service.js";

export const absconderPayReleaseRouter = Router();
absconderPayReleaseRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

function fail(res: any, err: unknown) {
  const e = err as { statusCode?: number; code?: string; message: string };
  return res.status(e.statusCode ?? 500).json({ success: false, code: e.code, message: e.message });
}
const reasonOf = (req: AuthenticatedRequest) => String((req.body as { reason?: string })?.reason ?? "");

absconderPayReleaseRouter.get(
  "/:exitRequestId",
  guardExitEmployee("exitRequestId"),
  h(async (req, res) => {
    const userId = req.authUser!.id;
    try {
      const state = await release.getHoldState(req.params.exitRequestId);
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT e.branch_id, mgr.user_id AS manager_user_id
           FROM exit_request er JOIN employees e ON e.id = er.employee_id
           LEFT JOIN employees mgr ON mgr.id = COALESCE(e.reporting_manager_id, e.manager_id)
          WHERE er.id = ? LIMIT 1`,
        [req.params.exitRequestId],
      );
      const isManager = String(rows[0]?.manager_user_id ?? "") === userId;
      const isPayrollHr = await release.isBranchPayrollHr(userId, rows[0]?.branch_id ?? null);
      const canSee = isManager || isPayrollHr || (await hasAnyRole(userId, "hr", "branch_hr", "payroll_head", "payroll", "branch_head", "admin"));
      if (!canSee) return res.status(403).json({ success: false, code: "HOLD_FORBIDDEN", message: "You cannot view this." });
      return res.json({
        success: true,
        data: {
          ...state,
          canRequestHold: isManager && (state.state === "not_held" || state.state === "request_rejected" || state.state === "released"),
          canDecideRequest: isPayrollHr && state.state === "hold_requested",
          canPlaceHold: isPayrollHr && (state.state === "not_held" || state.state === "request_rejected" || state.state === "released"),
          canRelease: isPayrollHr && state.state === "held",
        },
      });
    } catch (err) { return fail(res, err); }
  }),
);

type Action = (p: { exitRequestId: string; reason: string; actorUserId: string }) => Promise<unknown>;
function post(path: string, run: Action, ok: (r: any) => string) {
  absconderPayReleaseRouter.post(
    `/:exitRequestId/${path}`,
    guardExitEmployee("exitRequestId"),
    h(async (req, res) => {
      try {
        const out = await run({ exitRequestId: req.params.exitRequestId, reason: reasonOf(req), actorUserId: req.authUser!.id });
        return res.json({ success: true, data: out ?? null, message: ok(out) });
      } catch (err) { return fail(res, err); }
    }),
  );
}

post("hold/request", release.requestHold, () => "Requested. The branch Payroll HR decides next; salary is unchanged until then.");
post("hold/approve", release.approveHoldRequest, () => "Hold approved. Salary days are 0 until you release it.");
post("hold/reject", release.rejectHoldRequest, () => "Request declined. Salary continues as normal.");
post("hold", release.placeHold, () => "Salary is on hold at 0 days until you release it.");
post("hold/release", release.releaseHold, (r) =>
  r?.route === "payroll"
    ? "Released. Attendance days are restored in the open payroll run."
    : "Released. That month's payroll run is closed, so the salary is paid through the F&F.");
