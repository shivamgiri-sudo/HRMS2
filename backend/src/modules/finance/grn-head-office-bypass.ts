/**
 * Head Office GRN Bypass Logic
 *
 * Owner ruling (2026-09-23): When Finance Head raises a GRN at Head Office branch,
 * the normal 3-stage approval chain (Branch Head → Accounts Head → Finance Head)
 * is shortened to a single Accounts Head approval:
 *
 *   1. Branch Head approval is skipped (Finance Head is senior; no point asking Branch Head)
 *   2. Finance Head approval is skipped (Finance Head already raised it; no self-approval)
 *   3. Only Accounts Head reviews and approves
 *
 * On submit: GRN goes directly to `branch_head_approved` (pending Accounts Head review),
 *            with budget reserved as if Branch Head had approved.
 *
 * On Accounts Head approval: GRN goes directly to final status (`pending_accounts_payment`
 *            for vendor / `approved` for imprest), with budget consumed and GRN number
 *            assigned as if Finance Head had approved.
 */

import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

const HEAD_OFFICE_NAME_PATTERNS = [
  /^head\s*office$/i,
  /^ho$/i,
  /^corporate\s*office$/i,
  /^hq$/i,
  /^headquarters$/i,
];

/**
 * Checks if a branch is the Head Office by name pattern.
 *
 * Caches the lookup by branch_id since the mapping is stable and this is called
 * on every submission.
 */
const headOfficeBranchCache = new Map<string, boolean>();

export async function isHeadOfficeBranch(branchId: string | null | undefined): Promise<boolean> {
  if (!branchId) return false;

  const cached = headOfficeBranchCache.get(branchId);
  if (cached !== undefined) return cached;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT branch_name FROM branch_master WHERE id = ? LIMIT 1`,
    [branchId]
  );
  const branchName = String((rows[0] as any)?.branch_name ?? "").trim();
  const isHeadOffice = HEAD_OFFICE_NAME_PATTERNS.some((pattern) => pattern.test(branchName));

  headOfficeBranchCache.set(branchId, isHeadOffice);
  return isHeadOffice;
}

/**
 * Checks if the actor has finance_head role.
 */
export function isFinanceHead(actorRole: string, userRoles?: string[]): boolean {
  const allRoles = [actorRole, ...(userRoles ?? [])]
    .filter((r): r is string => Boolean(r))
    .map((r) => r.toLowerCase());
  return allRoles.includes("finance_head");
}

/**
 * Checks if a GRN submission qualifies for the Head Office bypass.
 *
 * Returns true when:
 *   - The GRN is for a Head Office branch
 *   - The submitter has the finance_head role
 */
export async function qualifiesForHeadOfficeBypass(
  branchId: string | null | undefined,
  actorRole: string,
  userRoles?: string[]
): Promise<boolean> {
  if (!isFinanceHead(actorRole, userRoles)) return false;
  return await isHeadOfficeBranch(branchId);
}

/**
 * Checks if an Accounts Head approval should skip to final status.
 *
 * Returns true when:
 *   - The GRN was submitted by someone with finance_head role
 *   - The GRN is for a Head Office branch
 *
 * This is checked at Accounts Head approval time to determine whether to skip
 * Finance Head and go directly to final status.
 */
export async function shouldSkipFinanceHeadOnAccountsApproval(
  grn: {
    branch_id?: string | null;
    submitted_by?: string | null;
    created_by?: string | null;
  }
): Promise<boolean> {
  if (!grn.branch_id) return false;
  if (!(await isHeadOfficeBranch(grn.branch_id))) return false;

  // Check if the submitter (or creator if no submitter) has finance_head role
  const submitterId = grn.submitted_by || grn.created_by;
  if (!submitterId) return false;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT role FROM users WHERE id = ? LIMIT 1`,
    [submitterId]
  );
  const submitterRole = String((rows[0] as any)?.role ?? "").toLowerCase();

  // Also check user_role_mapping for additional roles
  const [roleRows] = await db.execute<RowDataPacket[]>(
    `SELECT r.role_key FROM user_role_mapping urm
     JOIN roles r ON r.id = urm.role_id
     WHERE urm.user_id = ?`,
    [submitterId]
  );
  const allRoles = [
    submitterRole,
    ...roleRows.map((row) => String((row as any).role_key ?? "").toLowerCase()),
  ];

  return allRoles.includes("finance_head");
}

/**
 * Clears the head office branch cache (useful for testing or after branch_master updates).
 */
export function clearHeadOfficeBranchCache(): void {
  headOfficeBranchCache.clear();
}
