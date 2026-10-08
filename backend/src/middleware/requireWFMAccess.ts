import type { Request, Response, NextFunction } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";
import type { AuthenticatedRequest } from "./authMiddleware.js";
import { hasScopedAccess } from "../shared/scopeAccess.js";

type PayrollLineRow = RowDataPacket & { branch_id?: string | number | null; employee_code?: string | null };

/**
 * Middleware to check if user has WFM access for the branch of the employee in the payroll line
 * WFM team members can only update overtime for employees in their assigned branch
 */
export async function requireWFMAccess(req: Request, res: Response, next: NextFunction) {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.authUser?.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    // Get the payroll line to find the employee's branch
    const lineId = req.params.lineId;
    if (!lineId) {
      return res.status(400).json({ success: false, message: "Line ID required" });
    }

    const [lineRows] = await db.execute<RowDataPacket[]>(
      `SELECT e.branch_id, e.employee_code
       FROM salary_prep_line spl
       JOIN employees e ON spl.employee_id = e.id
       WHERE spl.id = ? LIMIT 1`,
      [lineId]
    );

    const line = lineRows[0] as PayrollLineRow | undefined;
    if (!line) {
      return res.status(404).json({ success: false, message: "Payroll line not found" });
    }

    // Check if user is admin (has full access)
    const [adminRows] = await db.execute<RowDataPacket[]>(
      `SELECT role_key FROM user_roles WHERE user_id = ? AND role_key IN ('admin','super_admin') AND active_status = 1 LIMIT 1`,
      [userId]
    );

    if (adminRows.length > 0) {
      return next(); // Admin has full access
    }

    // Check if user has WFM scope for this branch.
    //
    // This joined `scope_assignments`, which does not exist and never has - no
    // migration creates it and nothing else in the tree names it. The query
    // therefore threw ER_NO_SUCH_TABLE on every call, the catch below turned
    // that into a 500, and no non-admin WFM user has ever been able to update
    // overtime. Admins were unaffected because they return above.
    //
    // Resolved through hasScopedAccess rather than by guessing a table name:
    // it is what every other scoped route uses, it reads the real source of
    // truth (user_assignment_scope), and its default
    // requireScopeForNonAdmin=true denies a wfm user who has no scope row.
    // That default matters here - the original predicate was
    // `(sa.branch_id = ? OR sa.branch_id IS NULL)` against a LEFT JOIN, so had
    // the table existed, a wfm user with no scope row would have been granted
    // access to EVERY branch. Restoring the feature must not restore that.
    const hasWfmScope = await hasScopedAccess(
      userId,
      ["wfm"],
      { branchId: line.branch_id != null ? String(line.branch_id) : undefined },
      { allowAdminBypass: true }
    );

    if (!hasWfmScope) {
      return res.status(403).json({
        success: false,
        message: "Access denied: Only WFM team members can update overtime for this branch",
      });
    }

    // User has WFM access for this branch
    next();
  } catch (error) {
    console.error("Error in requireWFMAccess middleware:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}
