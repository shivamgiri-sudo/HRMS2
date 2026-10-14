// backend/src/modules/client-billing/client-billing-scope.ts
/**
 * Branch scope for every client-billing route (owner policy 2026-10-01, audit 2026-10-14 H1 / M3).
 *
 * Org-wide roles (finance, finance_head, accounts_head … via isOrgWideUser) see and act on every
 * branch. Everyone else (admin included) is limited to the branch of their OWN employees record.
 * A billing record belongs to its cost centre's branch. Fails closed: no own branch, or a record
 * whose cost centre has no branch, is out of scope.
 */
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { loadBranchPolicy } from "../../shared/branchDecisionScope.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";

export type BillingRecordKind = "invoice" | "creditNote" | "costCentre" | "changeRequest" | "provision";

/** null = org-wide (no filter); [] = nothing; otherwise the caller's own branch. */
export async function billingBranchScope(userId: string): Promise<string[] | null> {
  const policy = await loadBranchPolicy(userId);
  if (policy.orgWide) return null;
  return policy.ownBranchId ? [policy.ownBranchId] : [];
}

/** WHERE fragment limiting `branchColumn` to the scope (empty when org-wide). */
export function branchScopeCondition(branchColumn: string, branchIds: string[] | null): { sql: string | null; params: string[] } {
  if (branchIds === null) return { sql: null, params: [] };
  if (branchIds.length === 0) return { sql: "1 = 0", params: [] };
  return { sql: `${branchColumn} IN (${branchIds.map(() => "?").join(",")})`, params: [...branchIds] };
}

const BRANCH_SQL: Record<BillingRecordKind, string> = {
  invoice: `SELECT cc.branch_id FROM client_invoice ci LEFT JOIN cost_centre_master cc ON cc.id = ci.cost_centre_id WHERE ci.id = ? LIMIT 1`,
  creditNote: `SELECT cc.branch_id FROM client_credit_note ccn LEFT JOIN client_invoice ci ON ci.id = ccn.invoice_id LEFT JOIN cost_centre_master cc ON cc.id = ci.cost_centre_id WHERE ccn.id = ? LIMIT 1`,
  costCentre: `SELECT cc.branch_id FROM cost_centre_master cc WHERE cc.id = ? LIMIT 1`,
  changeRequest: `SELECT cc.branch_id FROM client_invoice_change_request cicr LEFT JOIN client_invoice ci ON ci.id = cicr.invoice_id LEFT JOIN cost_centre_master cc ON cc.id = ci.cost_centre_id WHERE cicr.id = ? LIMIT 1`,
  provision: `SELECT cc.branch_id FROM client_provision cp LEFT JOIN cost_centre_master cc ON cc.id = cp.cost_centre_id WHERE cp.id = ? LIMIT 1`,
};

/**
 * Branch of one record: undefined when the record does not exist, null when it has no branch.
 */
export async function recordBranch(kind: BillingRecordKind, id: string): Promise<string | null | undefined> {
  const [rows] = await db.execute<RowDataPacket[]>(BRANCH_SQL[kind], [id]);
  const row = (rows as RowDataPacket[])[0];
  if (!row) return undefined;
  return row.branch_id ? String(row.branch_id) : null;
}

/** Whether the scope admits a branch (org-wide admits everything, including no branch). */
export function scopeAllows(branchIds: string[] | null, branchId: string | null | undefined): boolean {
  if (branchIds === null) return true;
  return !!branchId && branchIds.includes(branchId);
}

/**
 * Route guard: sends 403 and returns false when the record is outside the caller's branch. A record
 * that does not exist passes, so the service keeps its usual "not found" answer.
 */
export async function guardBillingRecord(
  req: AuthenticatedRequest,
  res: Response,
  kind: BillingRecordKind,
  id: string | undefined = req.params.id,
): Promise<boolean> {
  const scope = await billingBranchScope(req.authUser!.id);
  if (scope === null) return true;
  if (!id) return true;
  const branch = await recordBranch(kind, String(id));
  if (branch === undefined) return true;
  if (scopeAllows(scope, branch)) return true;
  res.status(403).json({ success: false, error: "Forbidden: this billing record is outside your branch / assigned scope" });
  return false;
}

/** Splits ids into those inside the caller's scope and those outside it (missing ids count as inside). */
export async function partitionInvoicesByScope(userId: string, invoiceIds: string[]): Promise<{ allowed: string[]; denied: string[] }> {
  const scope = await billingBranchScope(userId);
  if (scope === null) return { allowed: [...invoiceIds], denied: [] };
  const allowed: string[] = [];
  const denied: string[] = [];
  for (const id of invoiceIds) {
    const branch = await recordBranch("invoice", id);
    if (branch === undefined || scopeAllows(scope, branch)) allowed.push(id);
    else denied.push(id);
  }
  return { allowed, denied };
}
