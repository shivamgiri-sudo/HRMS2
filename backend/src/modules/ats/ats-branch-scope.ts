import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { ORG_WIDE_EXEMPT_ROLES, getUserAssignmentScopes, getUserRoleKeys } from "../../shared/scopeAccess.js";
import { branchNameVariants } from "./ats-vocabulary.js";

/**
 * ONE branch-scope resolver for the ATS module (owner ruling 2026-10-01).
 *
 * Org-wide roles (ORG_WIDE_EXEMPT_ROLES) see every branch. EVERY other role - hr, manager, recruiter,
 * branch_head, payroll_hr ... - is limited to its own employees.branch_id plus any branch / process in its
 * user_assignment_scope rows. A scope_type='all' row held by a non-org-wide role is downgraded to the
 * user's own branch (same rule as buildScopeWhereClause). A user whose scope cannot be resolved gets
 * nothing: orgWide=false with empty branch and process sets => every predicate here is `1=0`.
 *
 * A browser-supplied ?branch= may only NARROW this set (see narrowToAllowedBranch), never widen it.
 */
export type AtsBranchScope = {
  orgWide: boolean;
  /** branch_master ids the caller may see. */
  branchIds: string[];
  /** Every spelling (name, code, id, known alias) ats_candidate.applied_for_branch may hold for those branches. */
  branchSpellings: string[];
  /** Canonical branch_master.branch_name values. */
  branchNames: string[];
  /** applied_for_process values from assignment rows (process-only scopes). */
  processNames: string[];
};

export const NO_ATS_SCOPE: AtsBranchScope = { orgWide: false, branchIds: [], branchSpellings: [], branchNames: [], processNames: [] };

export async function resolveAtsBranchScope(userId: string): Promise<AtsBranchScope> {
  const roleKeys = await getUserRoleKeys(userId);
  if (roleKeys.some((r) => ORG_WIDE_EXEMPT_ROLES.includes(r))) {
    return { orgWide: true, branchIds: [], branchSpellings: [], branchNames: [], processNames: [] };
  }

  const scopes = await getUserAssignmentScopes(userId);
  const branchIds = new Set<string>();
  const processNames = new Set<string>();
  for (const s of scopes) {
    if (s.scope_type !== "all" && s.branch_id) branchIds.add(String(s.branch_id));
    if (s.scope_type !== "all" && s.process_id) processNames.add(String(s.process_id));
  }
  const [own] = await db.execute<RowDataPacket[]>(
    "SELECT branch_id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1",
    [userId],
  );
  const ownBranch = (own as RowDataPacket[])?.[0]?.branch_id;
  if (ownBranch) branchIds.add(String(ownBranch));

  const ids = [...branchIds];
  const names: string[] = [];
  const spellings = new Set<string>(ids);
  if (ids.length > 0) {
    const [bm] = await db.execute<RowDataPacket[]>(
      `SELECT branch_name, branch_code FROM branch_master WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    for (const r of bm as RowDataPacket[]) {
      if (r.branch_name) {
        names.push(String(r.branch_name));
        for (const v of branchNameVariants(String(r.branch_name))) spellings.add(v);
      }
      if (r.branch_code) spellings.add(String(r.branch_code));
    }
  }
  return { orgWide: false, branchIds: ids, branchSpellings: [...spellings], branchNames: names, processNames: [...processNames] };
}

/** True when the scope can see nothing at all. */
export const scopeIsEmpty = (s: AtsBranchScope) =>
  !s.orgWide && s.branchSpellings.length === 0 && s.processNames.length === 0;

const col = (alias: string | undefined, name: string) => (alias ? `${alias}.${name}` : name);

/** SQL predicate over an ats_candidate alias. `1=1` org-wide, `1=0` none. Safe to AND into a WHERE. */
export function buildCandidateScopeSql(s: AtsBranchScope, alias?: string): { sql: string; params: unknown[] } {
  if (s.orgWide) return { sql: "1=1", params: [] };
  const parts: string[] = [];
  const params: unknown[] = [];
  if (s.branchSpellings.length > 0) {
    parts.push(`${col(alias, "applied_for_branch")} IN (${s.branchSpellings.map(() => "?").join(",")})`);
    params.push(...s.branchSpellings);
  }
  if (s.processNames.length > 0) {
    parts.push(`${col(alias, "applied_for_process")} IN (${s.processNames.map(() => "?").join(",")})`);
    params.push(...s.processNames);
  }
  return parts.length > 0 ? { sql: `(${parts.join(" OR ")})`, params } : { sql: "1=0", params: [] };
}

/** Predicate over a plain-text branch NAME column (e.g. job_requisition.branch_name, ats_recruiter_hiring_activity.branch_name). */
export function buildBranchNameScopeSql(s: AtsBranchScope, column: string): { sql: string; params: unknown[] } {
  if (s.orgWide) return { sql: "1=1", params: [] };
  if (s.branchSpellings.length === 0) return { sql: "1=0", params: [] };
  return { sql: `${column} IN (${s.branchSpellings.map(() => "?").join(",")})`, params: [...s.branchSpellings] };
}

/** Is a free-text branch (name / code / id) inside the caller's scope? Org-wide => always; empty/unknown => false. */
export function branchInScope(s: AtsBranchScope, branch: unknown): boolean {
  if (s.orgWide) return true;
  const b = String(branch ?? "").trim();
  if (!b) return false;
  const lower = b.toLowerCase();
  return s.branchSpellings.some((x) => x.toLowerCase() === lower);
}

/**
 * Client-supplied branch may only narrow. Returns the branch to filter by, or:
 *  - `{ forbidden: true }` when the client asked for a branch outside the caller's scope
 *  - `{ branch: null }` when org-wide and nothing was asked (no filter)
 */
export function narrowToAllowedBranch(
  s: AtsBranchScope,
  requested: unknown,
): { branch: string | null; forbidden: boolean } {
  const r = String(requested ?? "").trim();
  if (s.orgWide) return { branch: r || null, forbidden: false };
  if (!r) return { branch: null, forbidden: false };
  return branchInScope(s, r) ? { branch: r, forbidden: false } : { branch: null, forbidden: true };
}

export const OUT_OF_BRANCH_MESSAGE = "Forbidden: this record is outside your branch / assigned scope";

/**
 * Branch to feed a single-branch aggregate (cached dashboard). Org-wide: whatever was asked (or none = all).
 * Everyone else is pinned to ONE branch of their own: the requested one if it is theirs, otherwise their first
 * branch. Asking for a foreign branch, or having no branch at all, is `ok:false` (caller answers 403).
 */
export function pinDashboardBranch(
  s: AtsBranchScope,
  requested: unknown,
): { ok: true; branch: string | undefined } | { ok: false } {
  const n = narrowToAllowedBranch(s, requested);
  if (n.forbidden) return { ok: false };
  if (s.orgWide) return { ok: true, branch: n.branch ?? undefined };
  if (n.branch) return { ok: true, branch: n.branch };
  const first = s.branchNames[0];
  return first ? { ok: true, branch: first } : { ok: false };
}
