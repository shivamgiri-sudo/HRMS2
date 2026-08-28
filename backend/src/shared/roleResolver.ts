import { db } from "../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { normalizeDashboardRole } from "./dashboardAccessRegistry.js";
import { columnExists } from "./schema-object-cache.js";

/**
 * Role priority is shared by authentication and dashboard scope resolution.
 * Every role used by the role dashboards is explicitly ranked so an employee
 * role can never accidentally outrank a scoped WFM, manager, HR or payroll role.
 *
 * AUDIT NOTE (2026-08-13): this is one of four independently-maintained places
 * that answer "what role(s) does this user have" — the others are
 * platform/policy/roles.ts (alias expansion for requireRole's allow/deny
 * check), shared/accessGuard.ts (hasRole/fetchUserRoles, its own UNION query
 * and its own admin bypass), and auth-launch.routes.ts's inferRoles (one-time
 * bulk-bootstrap heuristic, not part of the live per-request path). This file
 * is the source of truth for req.authUser.role/roles (via requireAuth) and for
 * GET /api/access/me. The one concrete drift found — accessGuard.ts's
 * fetchUserRoles() missing this file's "employee" fallback for a
 * mapped-but-role-less active employee — was closed on 2026-08-13 (both now
 * fall back to "employee" the same way). A full merge of all four mechanisms
 * remains open — judged too large/risky to do in one pass (touches the
 * authorization decision on 250+ routes) — flagged for a dedicated,
 * separately-reviewed phase.
 */
const ROLE_PRIORITY: Readonly<Record<string, number>> = {
  super_admin: 100,
  admin: 98,
  ceo: 96,
  coo: 95,
  management: 94,

  ho_hr: 92,
  hr_admin: 91,
  hr: 90,
  compliance_head: 89,

  ho_payroll: 88,
  payroll_head: 87,
  finance_head: 86,
  accounts_head: 85,
  payroll_admin: 84,
  payroll_hr: 83,
  payroll: 82,
  finance: 81,

  ho_operations: 80,
  operations_head: 79,
  ho_wfm: 78,
  ho_rta: 77,
  wfm: 76,
  wfm_spoc: 75,
  rta: 74,

  branch_head: 70,
  bm: 69,
  branch_manager: 68,
  branch_hr: 67,
  hr_branch: 66,
  branch_finance: 65,
  payroll_branch: 64,
  branch_it: 63,

  process_manager: 60,
  manager: 59,
  assistant_manager: 58,
  team_leader: 57,
  team_lead: 56,
  tl: 55,
  process_hr: 54,
  qa_manager: 53,
  quality_analyst: 52,

  recruiter: 45,
  trainer: 44,
  qa: 43,

  // ── roles that were absent from this table entirely ────────────────────────────────
  // A missing key scores 0 through the `?? 0` in resolvePrimaryRole, and every real
  // account also holds `employee` (10) — so the privileged role LOST every comparison,
  // primaryRole came back "employee", and resolveDashboardScope handed the user
  // SELF_ONLY. Measured live 2026-08-28: all four IT accounts opened an IT Manager
  // dashboard whose headcount tile read 1 (themselves); branch_admin and tq_head were in
  // the same state.
  //
  // `it` was already declared in dashboardScope's BRANCH_ALL_ROLES and
  // `operations_manager` / `quality_lead` in PROCESS_OR_TEAM_ROLES — those branches were
  // simply unreachable, because primaryRole could never resolve to any of them. Each rank
  // below matches the scope tier the role already declares (or is being given) there, so
  // this changes WHICH branch of resolveDashboardScope runs, not what that branch does.
  // dashboard-scope-role-coverage.test.ts fails if the two lists drift apart again.
  //
  // Deliberately NOT added: `interviewer` and `lms_admin` hold no dashboard scope and
  // promoting them would change primaryRole for 12 accounts across 30+ unrelated call
  // sites; `it_admin`/`payroll_admin`/`tl` and the other aliases are normalised away by
  // uniqueRoles before this table is consulted, so an entry for them would be dead.
  branch_admin: 62,     // branch tier, just under branch_it (63) above
  branch_qa: 61,
  branch_wfm: 60,       // ties process_manager; the tie breaks to branch_wfm by name,
                        // which is the direction we want — a branch grant beats a process one
  tq_head: 73,          // head-office function head: must outrank qa_manager (53) and
                        // quality_analyst (52), which a T&Q head commonly co-holds —
                        // otherwise the process-tier role wins and narrows them again
  quality_lead: 50,
  operations_manager: 49,
  ho_it: 42,
  it_head: 41,          // head-office tier: ORG_ALL_ROLES, fails closed to own branch
  it: 40,

  employee: 10,
  agent: 9,
  trainee: 8,
};

function normalizeRole(value: unknown): string {
  return normalizeDashboardRole(value);
}

function uniqueRoles(values: unknown[]): string[] {
  return Array.from(new Set(values.map(normalizeRole).filter(Boolean)));
}

export async function getUserRoleKeys(userId: string): Promise<string[]> {
  const resolved: string[] = [];

  // MySQL user_roles remains the role authority.
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1",
      [userId],
    );
    resolved.push(...rows.map((row) => row.role_key));
  } catch (error) {
    console.error("[roleResolver] user_roles lookup failed", error);
  }

  // Scoped assignments also carry a role_key. They must participate in role
  // resolution because many WFM/manager accounts are provisioned through scope.
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT role_key FROM user_assignment_scope WHERE user_id = ? AND active_status = 1",
      [userId],
    );
    resolved.push(...rows.map((row) => row.role_key));
  } catch {
    // Older databases may not have this table yet; user_roles still works.
  }

  /*
   * Compatibility fallback for installations that still store one role on auth_user.
   *
   * Guarded by columnExists rather than by the catch alone. This schema has no auth_user.role, so
   * the query threw ER_BAD_FIELD_ERROR every time it ran - and it runs whenever a user has no
   * user_roles and no assignment scope, which is often. It was the single most frequent error in
   * the log: 102 occurrences in the retained window, against 24 each for policy_acknowledgement
   * and performance_appraisal and 14 for two_fa_enabled.
   *
   * That volume is the problem. db/mysql.ts logs schema and logic errors deliberately, so a wrong
   * column is distinguishable from "no rows matched" - the mechanism that surfaced several real
   * bugs here. Flooding it with an error we already expect is what makes a real one easy to miss.
   *
   * Same treatment management.service already applies to its three known-absent objects, using the
   * same cache, which fails OPEN: if information_schema cannot be read it assumes the column is
   * present and the query still runs, so the worst case is today's behaviour.
   */
  if (resolved.length === 0 && await columnExists("auth_user", "role")) {
    try {
      const [rows] = await db.execute<RowDataPacket[]>(
        "SELECT role FROM auth_user WHERE id = ? LIMIT 1",
        [userId],
      );
      if (rows[0]?.role) resolved.push(rows[0].role);
    } catch {
      // Still guarded: the column can disappear between the cache entry and this query.
    }
  }

  // A mapped employee with no explicit role receives employee access only.
  if (resolved.length === 0) {
    try {
      const [rows] = await db.execute<RowDataPacket[]>(
        "SELECT id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1",
        [userId],
      );
      if (rows.length > 0) resolved.push("employee");
    } catch {
      // Final fallback below.
    }
  }

  const roles = uniqueRoles(resolved);
  if (roles.length > 0) return roles;

  console.warn(`[roleResolver] Could not resolve roles for user ${userId}; using employee access`);
  return ["employee"];
}

export function resolvePrimaryRole(roleKeys: readonly string[]): string {
  const normalized = uniqueRoles([...roleKeys]);
  if (normalized.length === 0) return "employee";

  return [...normalized].sort((left, right) => {
    const priorityDifference = (ROLE_PRIORITY[right] ?? 0) - (ROLE_PRIORITY[left] ?? 0);
    return priorityDifference !== 0 ? priorityDifference : left.localeCompare(right);
  })[0];
}

export async function getUserRoleContext(userId: string): Promise<{
  roleKeys: string[];
  primaryRole: string;
  isSuperAdmin: boolean;
  isHO: boolean;
}> {
  const roleKeys = await getUserRoleKeys(userId);
  const primaryRole = resolvePrimaryRole(roleKeys);
  const isSuperAdmin = roleKeys.includes("super_admin") || roleKeys.includes("admin");
  const isHO = roleKeys.some((role) =>
    role.startsWith("ho_") || ["ceo", "coo", "management"].includes(role),
  );

  return { roleKeys, primaryRole, isSuperAdmin, isHO };
}
