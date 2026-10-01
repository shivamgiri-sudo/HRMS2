import type { NextFunction, Response } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { canViewEmployee } from "../../shared/enterpriseScope.js";
import { branchPredicate, employeeRowScope, resolveCallerBranchScope, type SqlScope } from "../org/branchScope.js";

/**
 * Branch scoping for the asset register (owner ruling 2026-10-01): hr sees / changes only assets of its own
 * branch (asset_master.branch_id) or assets currently held by an employee inside its scope. Org-wide
 * roles are unaffected. `a` = asset_master alias, `aa` = the OPEN asset_assignment row alias.
 */
export async function assetScopeSql(user: { id: string }, a = "a", aa = "aa"): Promise<SqlScope> {
  const caller = await resolveCallerBranchScope(user);
  if (caller.orgWide) return { sql: "1=1", params: [] };
  const byBranch = branchPredicate(caller, `${a}.branch_id`);
  const emp = await employeeRowScope(user, "se");
  return {
    sql: `(${byBranch.sql} OR ${aa}.employee_id IN (SELECT se.id FROM employees se WHERE ${emp.sql}))`,
    params: [...byBranch.params, ...emp.params],
  };
}

export async function assetInScope(user: { id: string }, assetId: string): Promise<"missing" | boolean> {
  const [exists] = await db.execute<RowDataPacket[]>("SELECT id FROM asset_master WHERE id = ? LIMIT 1", [assetId]);
  if (!(exists as RowDataPacket[]).length) return "missing";
  const scope = await assetScopeSql(user);
  if (scope.sql === "1=1") return true;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 AS ok FROM asset_master a
       LEFT JOIN asset_assignment aa ON aa.asset_id = a.id AND aa.returned_date IS NULL
      WHERE a.id = ? AND ${scope.sql} LIMIT 1`,
    [assetId, ...scope.params],
  );
  return (rows as RowDataPacket[]).length > 0;
}

/** router.param("id") callback: unknown ids fall through to the handler's own 404. */
export async function assetParamGuard(req: AuthenticatedRequest, res: Response, next: NextFunction, id: string) {
  try {
    if (!req.authUser?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const verdict = await assetInScope(req.authUser, id);
    if (verdict === "missing" || verdict === true) return next();
    return res.status(403).json({ success: false, message: "Forbidden: this asset is outside your branch / assigned scope" });
  } catch (err) {
    return next(err);
  }
}

export async function canUseBranch(user: { id: string }, branchId: unknown): Promise<boolean> {
  if (branchId === undefined || branchId === null || branchId === "") return true;
  const caller = await resolveCallerBranchScope(user);
  return caller.orgWide || caller.branchIds.includes(String(branchId));
}

export const canAssignToEmployee = (user: { id: string }, employeeId: string) => canViewEmployee(user, employeeId);
