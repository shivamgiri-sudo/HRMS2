import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import { buildScopeWhereClause, hasAnyRole, hasScopedAccess } from "../../shared/scopeAccess.js";
import { exitService } from "./exit.service.js";

export const exitSecureRouter = Router();
exitSecureRouter.use(requireAuth);

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
const EXIT_SCOPE_ROLES = ["manager", "assistant_manager", "tl", "branch_head", "process_manager", "hr"];

/**
 * FSM transitions for exit_request.status. Matches the frontend exactly — verified against
 * every updateStatus(...) call site in NativeExitManagement.tsx and NativeExitCommandCenter.tsx,
 * which already only ever offer this same linear progression (+ revoke from any non-terminal
 * state) via the UI. Originally built in exit-status-guard.compat.routes.ts, which never ran:
 * that router is mounted after this one and Express dispatches to the first handler that
 * matches, so its guard was dead code. Consolidated here, the one router that's actually
 * reachable for PATCH/POST /api/exit/:id/status.
 *
 * clearance_pending/fnf_pending/closed/withdrawn added 2026-08-14 (delta-audit Stage 5g,
 * user-approved): resignation.routes.ts's /mark-clearance-pending, /mark-fnf-pending, /close
 * and /withdraw wrote these four statuses directly via raw UPDATE with no transition check at
 * all — a status vocabulary this FSM didn't even recognize, so those four endpoints could
 * never have been guarded by it even in principle. Modeled as a second terminal chain off
 * 'accepted' (accepted → clearance_pending → fnf_pending → closed), parallel to the existing
 * accepted → notice_serving → exited chain — both are ways an accepted resignation concludes.
 * 'withdrawn' mirrors 'revoked' exactly (same source states): resignation.routes.ts's own
 * comment on /withdraw is "employee withdraws own resignation; HR/admin may withdraw on
 * behalf", the self/HR-initiated-cancel counterpart to 'revoked'. Live DB verified before
 * this change: exit_request has 2 rows in production, both already 'exited' — none in any of
 * these four states, so extending the map changes no live transition.
 */
export const ALLOWED_EXIT_TRANSITIONS: Record<string, string[]> = {
  draft: ["submitted", "revoked", "withdrawn"],
  submitted: ["manager_review", "hr_review", "rejected", "revoked", "withdrawn"],
  manager_review: ["hr_review", "rejected", "revoked", "withdrawn"],
  hr_review: ["admin_review", "accepted", "rejected", "revoked", "withdrawn"],
  admin_review: ["accepted", "rejected", "revoked", "withdrawn"],
  accepted: ["notice_serving", "clearance_pending", "revoked", "withdrawn"],
  notice_serving: ["exited", "revoked", "withdrawn"],
  clearance_pending: ["fnf_pending", "revoked", "withdrawn"],
  fnf_pending: ["closed", "revoked", "withdrawn"],
  closed: [],
  rejected: [],
  revoked: [],
  withdrawn: [],
  exited: [],
};

/** Shared by handleExitStatusUpdate below and resignation.routes.ts's status-writing endpoints
 * — the single source of truth for whether a transition is legal, so the two files can't drift
 * the way the four now-unmounted duplicate FSM guards did (see the file-header comment on
 * handleExitStatusUpdate). */
export function assertValidExitTransition(
  currentStatus: unknown,
  nextStatus: unknown,
): { ok: true } | { ok: false; message: string } {
  const from = normalizeExitStatus(currentStatus);
  const to = normalizeExitStatus(nextStatus);
  const allowed = ALLOWED_EXIT_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    return {
      ok: false,
      message: `Invalid exit transition: ${from} → ${to}. Allowed: ${allowed.join(", ") || "none"}`,
    };
  }
  return { ok: true };
}

/**
 * Blockers for the final "exited" transition: open clearance tasks, and F&F not yet approved
 * or still provisional. Originally built as finalExitBlockers() in exit.compat.routes.ts,
 * which never ran for the same shadowing reason as the FSM map above. Consolidated here.
 */
async function finalExitBlockers(exitRequestId: string): Promise<string[]> {
  const [clearanceRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS open_count
       FROM exit_clearance_task
      WHERE exit_request_id = ?
        AND status NOT IN ('cleared', 'waived')`,
    [exitRequestId],
  );
  const [ffRows] = await db.execute<RowDataPacket[]>(
    `SELECT status, is_ff_provisional
       FROM full_final_calculation
      WHERE exit_request_id = ?
      ORDER BY created_at DESC
      LIMIT 1`,
    [exitRequestId],
  );
  const ff = ffRows[0];
  const blockers: string[] = [];
  const openClearance = Number(clearanceRows[0]?.open_count ?? 0);
  if (openClearance > 0) blockers.push(`${openClearance} clearance task(s) still open`);
  if (!ff) blockers.push("F&F calculation is missing");
  else {
    if (!["approved", "paid"].includes(String(ff.status))) blockers.push(`F&F is ${ff.status}`);
    if (Number(ff.is_ff_provisional) === 1) blockers.push("F&F is provisional");
  }
  return blockers;
}

function normalizeExitStatus(status: unknown): string {
  const value = String(status ?? "").trim();
  return value === "exit_confirmed" ? "exited" : value;
}

async function exitListScope(userId: string) {
  if (await hasAnyRole(userId, "admin", "hr", "finance", "payroll", "ceo")) return { sql: "1=1", params: [] as unknown[] };
  const scoped = await buildScopeWhereClause(
    userId,
    EXIT_SCOPE_ROLES,
    {
      branchId: "e.branch_id",
      processId: "e.process_id",
      departmentId: "e.department_id",
      managerEmployeeId: "e.reporting_manager_id",
      employeeId: "e.id",
    },
    { allowAdminBypass: true, allowCeoAllRead: true },
  );
  if (scoped.sql !== "1=0") return scoped;
  const emp = await getEmployeeForUser(userId);
  if (emp?.id) return { sql: "e.id = ?", params: [emp.id] as unknown[] };
  return { sql: "1=0", params: [] as unknown[] };
}

async function canActOnExit(userId: string, exitRequestId: string) {
  if (await hasAnyRole(userId, "admin", "hr", "ceo")) return true;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT er.employee_id,
            e.branch_id,
            e.process_id,
            e.lob_id,
            e.department_id,
            e.reporting_manager_id,
            e.manager_id
       FROM exit_request er
       JOIN employees e ON e.id = er.employee_id
      WHERE er.id = ?
      LIMIT 1`,
    [exitRequestId],
  );
  const target = rows[0] as any;
  if (!target) return false;
  const callerEmp = await getEmployeeForUser(userId);
  if (callerEmp?.id === target.employee_id) return false;
  return hasScopedAccess(
    userId,
    EXIT_SCOPE_ROLES,
    {
      branchId: target.branch_id,
      processId: target.process_id,
      lobId: target.lob_id,
      departmentId: target.department_id,
      managerEmployeeId: target.reporting_manager_id ?? target.manager_id,
      employeeId: target.employee_id,
    },
    { allowAdminBypass: true, requireScopeForNonAdmin: true },
  );
}

exitSecureRouter.get("/stats", h(async (req: any, res: any) => {
  const scope = await exitListScope(req.authUser!.id);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT er.status, COUNT(*) AS cnt
       FROM exit_request er
       LEFT JOIN employees e ON e.id = er.employee_id
      WHERE ${scope.sql}
      GROUP BY er.status`,
    scope.params,
  );
  const counts: Record<string, number> = {};
  for (const row of rows as any[]) counts[String(row.status)] = Number(row.cnt ?? 0);
  const statuses = ["draft", "submitted", "manager_review", "hr_review", "admin_review", "accepted", "rejected", "revoked", "notice_serving", "exited"];
  const detailed = Object.fromEntries(statuses.map((s) => [s, counts[s] ?? 0])) as Record<string, number>;
  const total = Object.values(detailed).reduce((a, b) => a + b, 0);
  const pending = detailed.submitted + detailed.manager_review + detailed.hr_review + detailed.admin_review;
  return res.json({ success: true, data: { ...detailed, total, pending, completed: detailed.exited, active_notice: detailed.accepted + detailed.notice_serving } });
}));

exitSecureRouter.get("/", h(async (req: any, res: any) => {
  const privileged = await hasAnyRole(req.authUser!.id, "admin", "hr", "finance", "payroll", "ceo", ...EXIT_SCOPE_ROLES);
  if (!privileged) {
    const emp = await getEmployeeForUser(req.authUser!.id);
    if (!emp || !req.query.employeeId || String(req.query.employeeId) !== emp.id) {
      return res.status(403).json({ success: false, message: "Forbidden: employee collection access is not allowed" });
    }
  }
  const scope = await exitListScope(req.authUser!.id);
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const limit = Math.min(Math.max(1, Number(req.query.limit ?? 100) || 100), 500);
  const offset = (page - 1) * limit;
  const conds: string[] = [`(${scope.sql})`];
  const params: unknown[] = [...scope.params];
  if (req.query.status) { conds.push("er.status = ?"); params.push(String(req.query.status === "exit_confirmed" ? "exited" : req.query.status)); }
  if (req.query.employeeId) { conds.push("er.employee_id = ?"); params.push(String(req.query.employeeId)); }
  if (req.query.branchId) { conds.push("e.branch_id = ?"); params.push(String(req.query.branchId)); }
  if (req.query.processId) { conds.push("e.process_id = ?"); params.push(String(req.query.processId)); }
  if (req.query.search) {
    const q = `%${String(req.query.search)}%`;
    conds.push("(e.employee_code LIKE ? OR e.full_name LIKE ? OR er.resignation_reason LIKE ? OR er.exit_reason_category LIKE ?)");
    params.push(q, q, q, q);
  }
  const where = `WHERE ${conds.join(" AND ")}`;
  const fromSql = `FROM exit_request er LEFT JOIN employees e ON e.id = er.employee_id LEFT JOIN branch_master b ON b.id = e.branch_id LEFT JOIN process_master p ON p.id = e.process_id LEFT JOIN exit_employee_health_snapshot hs ON hs.exit_request_id = er.id LEFT JOIN (SELECT exit_request_id, COUNT(*) AS total_tasks, SUM(CASE WHEN status IN ('cleared','waived') THEN 1 ELSE 0 END) AS cleared_tasks FROM exit_clearance_task GROUP BY exit_request_id) clearance ON clearance.exit_request_id = er.id`;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT er.*, e.employee_code, COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS employee_name, b.branch_name, p.process_name, hs.engagement_score, hs.regrettable_exit, hs.risk_label, COALESCE(clearance.total_tasks, 0) AS clearance_total, COALESCE(clearance.cleared_tasks, 0) AS clearance_cleared ${fromSql} ${where} ORDER BY er.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const [countRows] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total ${fromSql} ${where}`, params);
  return res.json({ success: true, data: rows, total: Number(countRows[0]?.total ?? 0), page, limit });
}));

/**
 * Consolidated status-update handler — the sole implementation of PATCH/POST
 * /api/exit/:id/status. This used to be defined four separate times across four routers
 * mounted at /api/exit (exit.secure.routes.ts, exit.compat.routes.ts,
 * exit-status-guard.compat.routes.ts, exit.routes.ts); Express dispatches to the first
 * matching handler, so only this file's version — the one with the weakest guard — ever ran.
 * The other three each independently built half of the missing protection (FSM-transition
 * validity, and clearance/F&F blockers on "exited") as dead code. Both are merged in here;
 * the other three files' /:id/status registrations are removed. See
 * hrms2-exit-status-router-shadowing memory for the full history.
 */
async function handleExitStatusUpdate(req: any, res: any) {
  if (!(await canActOnExit(req.authUser!.id, req.params.id))) {
    return res.status(403).json({ success: false, message: "Forbidden: exit request is outside your action scope" });
  }

  const nextStatus = normalizeExitStatus(req.body?.status);
  const allowed = ["submitted", "manager_review", "hr_review", "admin_review", "accepted", "notice_serving", "exited", "revoked", "rejected"];
  if (!allowed.includes(nextStatus)) {
    return res.status(400).json({ success: false, message: "Invalid exit status" });
  }

  const remarks = String(req.body?.remarks ?? "").trim();
  if (!remarks) return res.status(400).json({ success: false, message: "Remarks are required" });

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT status FROM exit_request WHERE id = ? LIMIT 1`,
    [req.params.id],
  );
  const current = rows[0];
  if (!current) return res.status(404).json({ success: false, message: "Exit request not found" });

  const currentStatus = normalizeExitStatus(current.status);
  const allowedNext = ALLOWED_EXIT_TRANSITIONS[currentStatus] ?? [];
  if (!allowedNext.includes(nextStatus)) {
    return res.status(409).json({
      success: false,
      message: `Invalid exit transition: ${currentStatus} → ${nextStatus}. Allowed: ${allowedNext.join(", ") || "none"}`,
    });
  }

  if (nextStatus === "exited") {
    const blockers = await finalExitBlockers(req.params.id);
    if (blockers.length) {
      return res.status(409).json({
        success: false,
        message: "Cannot mark employee exited until exit controls are complete.",
        blockers,
      });
    }
  }

  // currentStatus is the value the FSM check above was decided on. Handing it to the
  // service lets the transaction there refuse the write if another approver moved the
  // request in the gap between that SELECT and the UPDATE — the two are separate
  // statements with no lock held in between, so without this both actors succeed.
  const data = await exitService.updateExitStatus(
    req.params.id,
    nextStatus,
    remarks,
    req.authUser!.id,
    currentStatus,
  );
  return res.json({ success: true, data, message: `Exit request status updated to ${nextStatus}` });
}

exitSecureRouter.patch("/:id/status", h(handleExitStatusUpdate));
exitSecureRouter.post("/:id/status", h(handleExitStatusUpdate));
