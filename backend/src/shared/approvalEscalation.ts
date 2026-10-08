import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";

export interface EffectiveApprover {
  approverId: string | null;
  isEscalated: boolean;
  escalationReason: string | null;
}

/**
 * Resolves who should approve a request for a given employee.
 *
 * Normally returns the direct reporting manager. If that manager has an
 * approved leave record covering today (any leave type, any duration),
 * returns the skip-level manager instead (manager's manager).
 *
 * Returns approverId: null when no approver is resolvable — callers must
 * fall back to HR Admin / privileged role bypass.
 */
export async function resolveEffectiveApprover(employeeId: string): Promise<EffectiveApprover> {
  // Step 1: direct manager
  const [mgrRows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(e.reporting_manager_id, e.manager_id) AS manager_id
       FROM employees e
      WHERE e.id = ?
      LIMIT 1`,
    [employeeId],
  );
  const directManagerId: string | null = (mgrRows[0] as any)?.manager_id ?? null;

  if (!directManagerId) {
    return { approverId: null, isEscalated: false, escalationReason: null };
  }

  // Step 2: is the direct manager on approved leave today?
  const [leaveRows] = await db.execute<RowDataPacket[]>(
    `SELECT lr.id
       FROM leave_request lr
       JOIN employees mgr ON mgr.id = lr.employee_id
      WHERE mgr.id = ?
        AND lr.status IN ('approved', 'branch_head_approved')
        AND lr.from_date <= CURDATE()
        AND lr.to_date   >= CURDATE()
      LIMIT 1`,
    [directManagerId],
  );

  if ((leaveRows as RowDataPacket[]).length === 0) {
    // Direct manager is available
    return { approverId: directManagerId, isEscalated: false, escalationReason: null };
  }

  // Step 3: direct manager is on leave — resolve skip-level (manager's manager)
  const [skipRows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(mgr.reporting_manager_id, mgr.manager_id) AS skip_manager_id
       FROM employees mgr
      WHERE mgr.id = ?
      LIMIT 1`,
    [directManagerId],
  );
  const skipManagerId: string | null = (skipRows[0] as any)?.skip_manager_id ?? null;

  return {
    approverId: skipManagerId,
    isEscalated: true,
    escalationReason: "Direct manager on approved leave",
  };
}
