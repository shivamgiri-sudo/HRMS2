import type { NextFunction, Response } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { employeeRowScope, resolveCallerBranchScope, type SqlScope } from "../org/branchScope.js";

/**
 * Branch scoping for MCNmeet (owner ruling 2026-10-01). Meetings carry no branch column, so a meeting is in
 * the caller's scope when they created it, host it, are invited to it, or its host is an employee inside
 * the caller's branch / assigned scope. Org-wide roles (super_admin, admin, ceo ...) see everything.
 * `m` is the mcnmeet_meeting alias.
 */
export async function meetingScopeSql(user: { id: string }, m = "m"): Promise<SqlScope> {
  const caller = await resolveCallerBranchScope(user);
  if (caller.orgWide) return { sql: "1=1", params: [] };
  const emp = await employeeRowScope(user, "se");
  const me = caller.employeeId ?? "";
  return {
    sql: `(${m}.created_by = ? OR ${m}.host_employee_id = ? OR ${m}.host_employee_id = ?
           OR ${m}.host_employee_id IN (SELECT se.id FROM employees se WHERE ${emp.sql})
           OR EXISTS (SELECT 1 FROM mcnmeet_meeting_invitee mi WHERE mi.meeting_id = ${m}.id AND mi.employee_id IN (?, ?)))`,
    params: [user.id, me, user.id, ...emp.params, me, user.id],
  };
}

/** router.param("id") callback: unknown ids fall through to the handler's own 404. */
export async function meetingParamGuard(req: AuthenticatedRequest, res: Response, next: NextFunction, id: string) {
  try {
    if (!req.authUser?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const [exists] = await db.execute<RowDataPacket[]>("SELECT id FROM mcnmeet_meeting WHERE id = ? LIMIT 1", [id]);
    if (!(exists as RowDataPacket[]).length) return next();
    const scope = await meetingScopeSql(req.authUser);
    if (scope.sql === "1=1") return next();
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT 1 AS ok FROM mcnmeet_meeting m WHERE m.id = ? AND ${scope.sql} LIMIT 1`,
      [id, ...scope.params],
    );
    if ((rows as RowDataPacket[]).length) return next();
    return res.status(403).json({ success: false, message: "Forbidden: this meeting is outside your branch / assigned scope" });
  } catch (err) {
    return next(err);
  }
}
