/**
 * Branch scoping for the META WhatsApp inbox.
 *
 * The inbox list was branch-filtered but every per-lead call (thread, mark-read, reply, send-file)
 * only checked the caller's role, so any Branch HR holding a lead id could read or message another
 * branch's candidate. This module is the single place that decides "may this user touch this lead".
 *
 * Fail-closed: a branch-scoped user whose branch cannot be resolved (no active employee record, or
 * no branch on it) sees nothing. The previous list query skipped the filter in that case and showed
 * every branch instead.
 */

import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';

/** Roles that see ALL branches — same set the campaign/leads pages already use. */
export const ALL_BRANCH_ROLES: readonly string[] = ['super_admin', 'admin', 'hr', 'management', 'manager'];

export type BranchScope = { all: true } | { all: false; branchName: string | null };

export function hasAllBranchAccess(roles: readonly string[]): boolean {
  return roles.some((r) => ALL_BRANCH_ROLES.includes(r));
}

/**
 * Resolve the caller's branch scope. `roles` is every role the caller holds (a user's primary role
 * alone is not enough — a secondary `hr` role must count).
 */
export async function resolveBranchScope(userId: string, roles: readonly string[]): Promise<BranchScope> {
  if (hasAllBranchAccess(roles)) return { all: true };

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT bm.branch_name
       FROM employees e
       JOIN branch_master bm ON bm.id = e.branch_id
      WHERE e.user_id = ? AND e.active_status = 1
      LIMIT 1`,
    [userId]
  );
  return { all: false, branchName: (rows[0]?.branch_name as string | null) ?? null };
}

/** True when the lead belongs to the caller's branch (or the caller sees all branches). */
export async function canAccessLead(leadId: string, scope: BranchScope): Promise<boolean> {
  if (scope.all) return true;
  if (!scope.branchName) return false;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1
       FROM meta_lead_raw ml
       JOIN job_requisition jr ON jr.id = ml.requisition_id
      WHERE ml.id = ? AND jr.branch_name = ?
      LIMIT 1`,
    [leadId, scope.branchName]
  );
  return rows.length > 0;
}

/**
 * HR may message a lead if: they are shortlisted (qualified), or any prior conversation exists
 * (outbound OR inbound). The prior-message check covers candidates who received an interview
 * invitation via the ATS shortlist flow — the conversation is already open, HR must be able
 * to follow up from the inbox without re-running screening.
 */
export async function canMessageLead(leadId: string): Promise<{ allowed: boolean; reason?: string }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ml.screening_result,
            (SELECT COUNT(*) FROM meta_lead_messages m
              WHERE m.lead_id = ml.id) AS message_count
       FROM meta_lead_raw ml
      WHERE ml.id = ?
      LIMIT 1`,
    [leadId]
  );
  const row = rows[0];
  if (!row) return { allowed: false, reason: 'Lead not found' };
  if (row.screening_result === 'qualified' || Number(row.message_count) > 0) return { allowed: true };
  return {
    allowed: false,
    reason: 'Candidate is not shortlisted for this requisition yet — run screening first',
  };
}
