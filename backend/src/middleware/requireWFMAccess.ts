import type { Request, Response, NextFunction } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";
import type { AuthenticatedRequest } from "./authMiddleware.js";

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
      `SELECT role FROM user_roles WHERE user_id = ? AND role = 'admin' LIMIT 1`,
      [userId]
    );

    if (adminRows.length > 0) {
      return next(); // Admin has full access
    }

    // Check if user has WFM role for this branch
    const [wfmRows] = await db.execute<RowDataPacket[]>(
      `SELECT ur.role, sa.branch_id
       FROM user_roles ur
       LEFT JOIN scope_assignments sa ON ur.user_id = sa.user_id
       WHERE ur.user_id = ?
         AND ur.role = 'wfm'
         AND (sa.branch_id = ? OR sa.branch_id IS NULL)
       LIMIT 1`,
      [userId, line.branch_id]
    );

    if (wfmRows.length === 0) {
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
