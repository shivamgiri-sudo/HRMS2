import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import {
  financeBranchFilter,
  resolveFinanceBranchScopeSet,
  type FinanceBranchScope,
} from "./finance-access-scope.js";

/**
 * Branch scoping for finance READ routes that role-gate branch_head (owner ruling 2026-10-01).
 *
 * Org-wide finance roles (super_admin, admin, ceo, finance, finance_head, accounts_head, payroll_head ...)
 * resolve to { mode: "all" } and are never filtered. Everyone else is limited to their own branch plus
 * explicit branch grants. A user with no resolvable branch is refused (403), never given "all".
 * A browser-supplied branchId may only NARROW the scope; one outside it is a 403.
 */
export function forbidden(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 403 });
}

export async function callerBranchScope(
  req: AuthenticatedRequest,
  requestedBranchId?: string | null,
): Promise<FinanceBranchScope> {
  const u = req.authUser as any;
  if (!u?.id) throw forbidden("Forbidden: authentication required");
  try {
    return await resolveFinanceBranchScopeSet({
      userId: String(u.id),
      primaryRole: String(u.role ?? req.userRoles?.[0] ?? ""),
      userRoles: req.userRoles ?? u.roles ?? [],
      requestedBranchId: requestedBranchId || undefined,
    });
  } catch (error) {
    throw forbidden(error instanceof Error ? `Forbidden: ${error.message}` : "Forbidden: outside your branch scope");
  }
}

/** Throws 403 unless `branchId` is inside the scope. mode "all" always passes (no DB, no change for org-wide). */
export function assertBranchInScope(scope: FinanceBranchScope, branchId: string | null | undefined, what = "record"): void {
  if (scope.mode === "all") return;
  if (!branchId || !scope.branchIds.includes(String(branchId))) {
    throw forbidden(`Forbidden: this ${what} is outside your branch / assigned scope`);
  }
}

/** The branch that owns a company bank account (null when missing). */
export async function bankAccountBranchId(bankAccountId: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT branch_id FROM company_bank_account WHERE id = ? LIMIT 1",
    [bankAccountId],
  );
  const b = (rows as RowDataPacket[])[0]?.branch_id;
  return b ? String(b) : null;
}

export async function assertBankAccountInScope(req: AuthenticatedRequest, bankAccountId: string): Promise<void> {
  const scope = await callerBranchScope(req);
  if (scope.mode === "all") return;
  assertBranchInScope(scope, await bankAccountBranchId(bankAccountId), "bank account");
}

export { financeBranchFilter };
export type { FinanceBranchScope };
