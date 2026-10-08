import type { RequestHandler } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getUserRoleKeys, isOrgWideUser } from "../../shared/scopeAccess.js";
import { loadBranchPolicy, userBranchId } from "../../shared/branchDecisionScope.js";
import {
  buildEmployeeScopeCondition,
  canViewEmployee,
  resolveUserBusinessScope,
} from "../../shared/enterpriseScope.js";

/**
 * Branch scoping for the DPDP withdrawal admin queue (owner ruling 2026-10-01).
 * dpo (which also passes admin / super_admin via accessGuard's admin-superset rule) stays org-wide.
 * hr / compliance are limited to requests raised by employees inside their own branch / assignments.
 * A client ?branch_id= can only narrow this, never widen it.
 */
export type RequesterScope = { sql: string; params: unknown[] };

/**
 * Who sees every branch's requests: a REAL `dpo` role or an org-wide role (isOrgWideUser). accessGuard.hasRole() answers
 * true for `admin` on every role, which used to make admin the DPO for all branches; admin is branch-scoped (owner policy
 * 2026-10-01) and now falls through to the branch checks below like hr / compliance.
 */
async function seesAllBranches(userId: string): Promise<boolean> {
  if ((await getUserRoleKeys(userId)).includes("dpo")) return true;
  return Boolean(await isOrgWideUser(userId));
}

/** Returns null for org-wide callers, otherwise a SQL predicate over dcw.requester_id. */
export async function buildRequesterScope(user: { id: string }): Promise<RequesterScope | null> {
  if (await seesAllBranches(user.id)) return null;
  const cond = buildEmployeeScopeCondition(await resolveUserBusinessScope(user), {
    employeeId: "e.id", branchId: "e.branch_id", processId: "e.process_id", lobId: "e.lob_id",
    departmentId: "e.department_id", managerEmployeeId: "e.reporting_manager_id",
  });
  if (cond.sql === "1=1") return null;
  return {
    sql: `dcw.requester_id IN (SELECT e.user_id FROM employees e WHERE e.user_id IS NOT NULL AND (${cond.sql}))`,
    params: cond.params,
  };
}

/** Guard for every /dpdp-withdrawal/:id/* route: a non-org-wide caller may only touch in-scope requests (or their own). */
export const withdrawalScopeGuard: RequestHandler = async (req: any, res, next) => {
  try {
    const user = req.authUser;
    if (!user?.id) return next();
    if (await seesAllBranches(user.id)) return next();
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT requester_id FROM dpdp_consent_withdrawal WHERE id = ? LIMIT 1",
      [req.params.id]
    );
    const requesterId = (rows as RowDataPacket[])[0]?.requester_id;
    if (!requesterId) return next(); // unknown id: handler returns its own 404
    if (String(requesterId) === String(user.id)) return next();
    const [emp] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM employees WHERE user_id = ? ORDER BY active_status DESC LIMIT 1",
      [requesterId]
    );
    const employeeId = (emp as RowDataPacket[])[0]?.id;
    if (employeeId && (await canViewEmployee(user, String(employeeId)))) return next();
    return res.status(403).json({ success: false, message: "Forbidden: this request is outside your branch / assigned scope" });
  } catch (err) {
    return next(err);
  }
};

/**
 * DECIDE guard for start-review / approve / reject (same predicate as the Approval Center popup): dpo / org-wide roles decide any
 * request; hr / compliance / admin only a request whose REQUESTER's employee record sits in the branch of the caller's OWN
 * employees record (no assignment widening, fail closed when either branch is unknown). Self-decisions are refused by the service.
 */
export const withdrawalDecideGuard: RequestHandler = async (req: any, res, next) => {
  try {
    const user = req.authUser;
    if (!user?.id) return next();
    if (await seesAllBranches(user.id)) return next();
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT requester_id FROM dpdp_consent_withdrawal WHERE id = ? LIMIT 1",
      [req.params.id]
    );
    const requesterId = (rows as RowDataPacket[])[0]?.requester_id;
    if (!requesterId) return next(); // unknown id: handler returns its own 404
    if (String(requesterId) === String(user.id)) return next(); // service refuses deciding your own request
    const policy = await loadBranchPolicy(user.id);
    if (policy.allows(await userBranchId(requesterId))) return next();
    return res.status(403).json({ success: false, message: "Forbidden: this request is outside your branch / assigned scope" });
  } catch (err) {
    return next(err);
  }
};
