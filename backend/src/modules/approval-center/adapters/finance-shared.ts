import { getUserRoles } from "../../access/access.service.js";
import { resolveFinanceBranchScopeSet, type FinanceBranchScope } from "../../finance/finance-access-scope.js";
import type { LoopbackCtx } from "../types.js";

/**
 * Finance adapters need to answer "can THIS caller decide THIS row right now" for lists that return
 * scope-visible rows. The caller's roles are read in-process (one query, cached per ctx) — the same
 * `user_roles` source requireRole uses — so the filter matches the guards on the decide endpoint.
 */
const roleCache = new WeakMap<LoopbackCtx, Promise<string[]>>();

export function callerRoles(ctx: LoopbackCtx): Promise<string[]> {
  let p = roleCache.get(ctx);
  if (!p) {
    p = getUserRoles(ctx.userId).then((rows) => {
      const keys = rows.map((r) => String(r.role_key));
      // LITERAL role keys only (no alias expansion, no super_admin wildcard): a stage is designated by the exact role it names.
      return Array.from(new Set(keys.map((k) => k.toLowerCase())));
    });
    roleCache.set(ctx, p);
  }
  return p;
}

export const hasRole = (roles: string[], ...wanted: string[]) => wanted.some((w) => roles.includes(w));

/** Branch scope the finance endpoints apply to the caller; null when it cannot be resolved (treated as no access). */
export async function callerBranchScope(ctx: LoopbackCtx, roles: string[]): Promise<FinanceBranchScope | null> {
  try {
    return await resolveFinanceBranchScopeSet({ userId: ctx.userId, primaryRole: roles[0], userRoles: roles });
  } catch {
    return null;
  }
}

export function inBranchScope(scope: FinanceBranchScope | null, branchId: unknown): boolean {
  if (!scope) return false;
  if (scope.mode === "all") return true;
  return !!branchId && scope.branchIds.includes(String(branchId));
}

/** Whole days between an ISO/mysql date and now; null when unparsable. */
export function ageDays(v: unknown, now = Date.now()): number | null {
  if (v === null || v === undefined || v === "") return null;
  const t = new Date(String(v)).getTime();
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((now - t) / 86_400_000));
}

/** The rows array out of the several envelope shapes finance routes use. */
export function rowsOf(res: any): any[] {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.data)) return res.data;
  if (Array.isArray(res?.data?.rows)) return res.data.rows;
  if (Array.isArray(res?.rows)) return res.rows;
  return [];
}
