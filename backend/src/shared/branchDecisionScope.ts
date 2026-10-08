import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";
import { isOrgWideUser } from "./scopeAccess.js";

/**
 * Branch predicate for DECIDE (approve / reject) endpoints. Same rule the Approval Center popup applies
 * (approval-center/adapters/scope-guard.ts), so a module's own endpoint and the popup agree:
 * owner policy 2026-10-01 - org-wide ONLY via isOrgWideUser(); everyone else is limited to the branch on their OWN
 * employees record. user_assignment_scope never widens this. Fail closed: no own branch or unknown row branch = denied.
 */
export interface BranchPolicy {
  userId: string;
  orgWide: boolean;
  employeeId: string | null;
  ownBranchId: string | null;
  allows(branchId: unknown): boolean;
}

export async function loadBranchPolicy(userId: string): Promise<BranchPolicy> {
  const orgWide = Boolean(await isOrgWideUser(userId));
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT id, branch_id FROM employees WHERE user_id = ? AND active_status = 1 ORDER BY updated_at DESC LIMIT 1",
    [userId],
  );
  const e = (rows as RowDataPacket[])[0];
  const ownBranchId = e?.branch_id ? String(e.branch_id) : null;
  return {
    userId,
    orgWide,
    employeeId: e?.id ? String(e.id) : null,
    ownBranchId,
    allows: (branchId) => orgWide || (!!ownBranchId && !!branchId && String(branchId) === ownBranchId),
  };
}

/** employees.id -> branch_id (null when unknown). */
export async function employeeBranchId(employeeId: unknown): Promise<string | null> {
  if (!employeeId) return null;
  const [rows] = await db.execute<RowDataPacket[]>("SELECT branch_id FROM employees WHERE id = ? LIMIT 1", [String(employeeId)]);
  const b = (rows as RowDataPacket[])[0]?.branch_id;
  return b ? String(b) : null;
}

/** auth user id -> branch_id of that person's active employee record (null when unknown). */
export async function userBranchId(authUserId: unknown): Promise<string | null> {
  if (!authUserId) return null;
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT branch_id FROM employees WHERE user_id = ? AND active_status = 1 ORDER BY updated_at DESC LIMIT 1",
    [String(authUserId)],
  );
  const b = (rows as RowDataPacket[])[0]?.branch_id;
  return b ? String(b) : null;
}

/** cost_centre_master.id -> branch_id (null when unknown). */
export async function costCentreBranchId(costCentreId: unknown): Promise<string | null> {
  if (!costCentreId) return null;
  const [rows] = await db.execute<RowDataPacket[]>("SELECT branch_id FROM cost_centre_master WHERE id = ? LIMIT 1", [String(costCentreId)]);
  const b = (rows as RowDataPacket[])[0]?.branch_id;
  return b ? String(b) : null;
}

/** auth user ids -> branch_id of each person's active employee record (missing / unknown = null). One query per 500 ids. */
export async function userBranchIds(authUserIds: unknown[]): Promise<Map<string, string | null>> {
  const ids = Array.from(new Set(authUserIds.filter(Boolean).map(String)));
  const out = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT user_id, branch_id FROM employees WHERE user_id IN (${part.map(() => "?").join(",")}) AND active_status = 1 ORDER BY updated_at ASC`,
      part,
    );
    for (const r of rows as RowDataPacket[]) out.set(String(r.user_id), r.branch_id ? String(r.branch_id) : null);
  }
  return out;
}
