import type { Request, Response, NextFunction } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * DPDP Act 2023 §13 enforcement.
 * Blocks data access for employees who have an approved, active withdrawal order.
 * Must be applied AFTER requireRole on employee-scoped GET endpoints.
 *
 * The target employee is resolved from route params (:id / :employeeId)
 * or query param (?employeeId=). For /me endpoints this guard is not needed
 * since the user is accessing their own data.
 *
 * The requester_id in dpdp_consent_withdrawal is the auth_user.id of the employee.
 * We resolve from employees.id via a JOIN when the param is an employee UUID.
 */
export async function checkDpdpRestriction(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const targetId =
      (req.params as Record<string, string>).id ??
      (req.params as Record<string, string>).employeeId ??
      (req.query.employeeId as string | undefined);

    if (!targetId) {
      next();
      return;
    }

    // targetId could be either employees.id or auth_user.id depending on the endpoint.
    // Check both: if it matches an employee record, resolve via user_id; also check directly.
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT dcw.id
       FROM dpdp_consent_withdrawal dcw
       WHERE dcw.data_restriction_applied = 1
         AND dcw.status = 'approved'
         AND (
           dcw.requester_id = ?
           OR dcw.requester_id IN (
             SELECT e.user_id FROM employees e WHERE e.id = ? LIMIT 1
           )
         )
       LIMIT 1`,
      [targetId, targetId]
    );

    if (rows.length > 0) {
      res.status(403).json({
        success: false,
        message:
          "Access restricted: this employee has an active DPDP data withdrawal order. Contact the compliance/DPO team.",
        code: "DPDP_RESTRICTION_ACTIVE",
      });
      return;
    }

    next();
  } catch (err) {
    // Guard failures must never break primary operations — log and allow through
    console.error("[dpdp-guard] restriction check failed:", err);
    next();
  }
}
