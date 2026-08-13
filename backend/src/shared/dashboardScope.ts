import { db } from "../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { getUserRoleContext } from "./roleResolver.js";
import { normalizeDashboardRole } from "./dashboardAccessRegistry.js";
import { logSourceFailure } from "./apiResponse.js";

/**
 * Swallow a scope-resolution query failure into an empty row set.
 *
 * Callers treat "no rows" as fail-closed (deny / empty scope), which is the correct
 * security posture — but it means a transient DB fault silently narrows a user's
 * visibility with no trace. Always log so that is diagnosable.
 */
function emptyOnError(context: string, detail: Record<string, unknown> = {}) {
  return (err: unknown) => {
    logSourceFailure("dashboard-scope", err, { query: context, ...detail });
    return [[]] as any;
  };
}

export type ScopeLevel =
  | "ORG_ALL"
  | "BRANCH_ALL"
  | "PROCESS_ALL"
  | "TEAM_ONLY"
  | "SELF_ONLY"
  | "CUSTOM_SCOPE";

export type DashboardScope = {
  level: ScopeLevel;
  branchIds: string[];
  processIds: string[];
  employeeIds: string[];
  userId: string;
  role: string;
};

type AssignmentScopeRow = RowDataPacket & {
  role_key?: string | null;
  scope_type?: string | null;
  branch_id?: string | null;
  process_id?: string | null;
  manager_employee_id?: string | null;
};

/**
 * Roles whose reach is the whole platform regardless of any assignment row.
 *
 * Kept deliberately tiny. Narrowing these by a stray user_assignment_scope row could
 * lock an administrator out of the system, so they short-circuit before scopes load.
 */
const SYSTEM_WIDE_ROLES = new Set(["super_admin", "admin"]);

/**
 * Roles that exist only at head office, and therefore stay org-wide even when an
 * assignment row names a branch.
 *
 * Needed because "head office" is itself a branch in branch_master — three of them, in
 * fact (codes CORP, HQ, HEAD_OFFICE) — each holding ~12 employees. Narrowing by
 * assignment alone scoped the CEO to the 13 people sitting at head office.
 *
 * Membership is deliberately limited to titles with a branch-level counterpart already in
 * the model, so the distinction is structural rather than guesswork:
 *   operations_head / ho_operations  vs  branch_head
 *   ho_hr                            vs  branch_hr, hr_branch
 *   finance_head                     vs  branch_finance
 *   ho_it                            vs  branch_it, it
 *   ho_payroll, payroll_head         vs  payroll_branch
 *
 * `hr`, `hr_admin`, `payroll`, `payroll_hr`, `payroll_admin` and `finance` are absent on
 * purpose: each is used for both head-office and branch staff in this database, so an
 * assignment row is the only evidence of which one a given user is. Those must stay
 * narrowable or the leak returns — 14 of the 16 affected users are exactly that case.
 */
const HEAD_OFFICE_ROLES = new Set([
  "ceo", "coo", "management",
  "ho_hr", "ho_payroll", "ho_operations", "ho_wfm", "ho_rta", "ho_it",
  "compliance_head", "payroll_head", "finance_head", "accounts_head", "operations_head",
]);

/**
 * Roles that are head-office by default: they see every branch UNLESS they carry an
 * explicit branch/process assignment, in which case they are branch staff and see only
 * what they were assigned. See resolveDashboardScope for why the employee record is not
 * used to make that decision.
 */
const ORG_ALL_ROLES = new Set([
  "super_admin", "admin", "ceo", "coo", "management", "ho_hr", "hr_admin", "hr",
  "ho_payroll", "payroll_head", "finance_head", "accounts_head", "payroll_admin",
  "payroll_hr", "payroll", "finance", "ho_operations", "operations_head", "ho_wfm",
  "ho_rta", "compliance_head", "ho_it",
]);

// Roles that should be scoped to their assigned branch(es) only.
// branch_hr, hr_branch, payroll_branch, branch_finance moved here from ORG_ALL_ROLES
// so that branch-scoped staff only see their own branch data.
const BRANCH_ALL_ROLES = new Set([
  "branch_head", "bm", "branch_manager",
  "branch_hr", "hr_branch",
  "branch_finance",
  "payroll_branch",
  "branch_it",
  "it",   // IT department manager — scoped to their assigned branch
]);

const PROCESS_OR_TEAM_ROLES = new Set([
  "process_manager",
  "wfm", "wfm_spoc", "rta", "process_hr", "qa_manager", "quality_analyst", "quality_lead",
  "qa", "operations_manager", "recruiter",
]);

const TEAM_ROLES = new Set([
  "manager", "assistant_manager", "team_leader", "team_lead", "tl",
]);

const SELF_ONLY_ROLES = new Set(["employee", "agent", "trainee"]);

export class DashboardScopeConfigurationError extends Error {
  readonly statusCode = 409;
  readonly code = "DASHBOARD_SCOPE_NOT_CONFIGURED";

  constructor(role: string, scopeType: string) {
    super(`No active ${scopeType} scope is configured for role ${role}`);
    this.name = "DashboardScopeConfigurationError";
  }
}

function unique(values: unknown[]): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

async function loadAssignmentScopes(userId: string, roleKeys: readonly string[]): Promise<AssignmentScopeRow[]> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT role_key, scope_type, branch_id, process_id, manager_employee_id
         FROM user_assignment_scope
        WHERE user_id = ? AND active_status = 1`,
      [userId],
    );
    // Both sides must be normalised through the same alias table.
    //
    // getUserRoleKeys returns roles already normalised (DASHBOARD_ROLE_ALIASES maps
    // payroll_admin -> payroll, hr_branch -> branch_hr, tl -> team_leader, and ten more),
    // but user_assignment_scope.role_key stores the raw value an administrator typed. A
    // one-sided comparison therefore discarded any scope row written in an alias form.
    //
    // Live example: NARESH KUMAR CHAUHAN (MAS00175) holds payroll_admin + payroll_hr and
    // has two scope_type='all' rows keyed payroll_admin / payroll_hr. Both normalise to
    // `payroll`, so neither matched the raw comparison and both grants were dropped. That
    // was invisible while a missing grant still fell through to ORG_ALL; once absent
    // grants correctly fail closed, it would have narrowed a head-office payroll
    // administrator to the 13 people sitting at Head Office.
    const allowedRoles = new Set(roleKeys.map((role) => normalizeDashboardRole(role)));
    return (rows as AssignmentScopeRow[]).filter((row) => {
      const role = normalizeDashboardRole(row.role_key);
      return !role || allowedRoles.has(role);
    });
  } catch (err) {
    logSourceFailure("dashboard-scope", err, { query: "user_assignment_scope", userId });
    return [];
  }
}

async function resolveEmployeeScope(userId: string): Promise<{
  employeeId: string | null;
  branchIds: string[];
  processIds: string[];
}> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, branch_id, process_id
       FROM employees
      WHERE user_id = ? AND active_status = 1
      ORDER BY updated_at DESC
      LIMIT 1`,
    [userId],
  ).catch(emptyOnError("employees by user_id", { site: "resolveEmployeeScope" }));

  const row = rows[0] as RowDataPacket | undefined;
  return {
    employeeId: row?.id ? String(row.id) : null,
    branchIds: unique([row?.branch_id]),
    processIds: unique([row?.process_id]),
  };
}

async function branchesForProcesses(processIds: readonly string[]): Promise<string[]> {
  if (processIds.length === 0) return [];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT branch_id
       FROM employees
      WHERE process_id IN (${processIds.map(() => "?").join(",")})
        AND branch_id IS NOT NULL
        AND active_status = 1`,
    [...processIds],
  ).catch(emptyOnError("branch_master by process", { site: "branchesForProcesses" }));
  return unique(rows.map((row) => row.branch_id));
}

/**
 * Every employee reporting to a manager, directly or indirectly.
 *
 * Was a recursive CTE with UNION ALL. Five employees in this database have
 * reporting_manager_id or manager_id pointing at themselves, and a self-edge under UNION ALL
 * recurses until MySQL hits cte_max_recursion_depth (1000) rather than terminating — so the
 * query took 16.5 seconds to return 600 rows for the busiest manager, and timed out audit
 * runs entirely. The `OR` across two parent columns also prevents either index being used.
 *
 * The active population is ~1,344 rows, so one indexed read of the whole edge set and a walk
 * in memory is both faster and simpler: 1.26s against 16.5s for the same 600 ids. The
 * visited set makes cycles of any length harmless instead of merely bounded, and self-edges
 * are dropped when the map is built — an employee is not their own subordinate.
 *
 * The 5 self-referencing rows remain a data defect worth correcting at source; this makes
 * the resolver immune to them rather than dependent on that cleanup.
 */
async function resolveTeamEmployeeIds(managerEmployeeId: string): Promise<string[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, reporting_manager_id, manager_id
       FROM employees
      WHERE active_status = 1`,
  ).catch(emptyOnError("employees reporting edges", { site: "resolveTeamEmployeeIds" }));

  const childrenOf = new Map<string, string[]>();
  for (const row of rows as RowDataPacket[]) {
    const childId = String(row.id ?? "").trim();
    if (!childId) continue;
    for (const parentId of [row.reporting_manager_id, row.manager_id]) {
      const parent = String(parentId ?? "").trim();
      // A self-edge is not a reporting relationship; it is the data defect above.
      if (!parent || parent === childId) continue;
      const bucket = childrenOf.get(parent);
      if (bucket) bucket.push(childId);
      else childrenOf.set(parent, [childId]);
    }
  }

  const collected = new Set<string>();
  const queue = [...(childrenOf.get(managerEmployeeId) ?? [])];
  while (queue.length > 0) {
    const employeeId = queue.pop()!;
    if (collected.has(employeeId)) continue;
    collected.add(employeeId);
    for (const child of childrenOf.get(employeeId) ?? []) {
      if (!collected.has(child)) queue.push(child);
    }
  }
  // The manager is never a member of their own team, even if a self-edge suggests otherwise.
  collected.delete(managerEmployeeId);
  return [...collected];
}

/**
 * Demo-bypass-aware wrapper around resolveDashboardScope.
 *
 * Demo-bypass identities (INTERNAL_DEMO_BYPASS, e.g. "demo-super-admin-id") have no backing
 * row in user_roles, user_assignment_scope, auth_user or employees, so
 * resolveDashboardScope's own internal getUserRoleContext(userId) call always misses for them
 * and silently falls back to role "employee" — regardless of which demo role actually logged
 * in — which then throws DashboardScopeConfigurationError (409) for every demo session.
 * Confirmed live 2026-08-06 across dashboard.routes.ts, management.routes.ts, kpi.routes.ts
 * and bi.routes.ts, all hitting this identically; the same underlying gap recurs more widely
 * (also via hasRole()/fetchUserRoles() in it-provisioning.routes.ts, and via
 * resolveDashboardScope directly in tat.routes.ts, qa-audit.routes.ts, work-inbox.routes.ts —
 * flagged, not all fixed here; see hrms2-demo-identity-role-resolution-gap memory).
 *
 * For the two roles resolveDashboardScope itself already treats as unconditionally org-wide
 * (its own SYSTEM_WIDE_ROLES set: "super_admin", "admin"), this constructs that same ORG_ALL
 * scope directly for a demo session instead of calling resolveDashboardScope, matching its
 * existing logic exactly. Every other role — real or demo — falls through to
 * resolveDashboardScope completely unchanged. This is purely additive: resolveDashboardScope
 * itself is untouched, so every existing caller and every existing test of it (including the
 * v2 quality/operations dashboards' deliberately fail-closed "unconfigured account" contract,
 * tests/dashboards-v2.routes.test.ts) is unaffected unless a caller explicitly switches to
 * this wrapper.
 */
export async function resolveDashboardScopeForRequest(
  user: { id: string; role?: string; isDemo?: boolean },
  primaryRole: string,
): Promise<DashboardScope> {
  if (user.isDemo === true && (user.role === "super_admin" || user.role === "admin")) {
    return { level: "ORG_ALL", branchIds: [], processIds: [], employeeIds: [], userId: user.id, role: user.role };
  }
  return resolveDashboardScope(user.id, primaryRole);
}

export async function resolveDashboardScope(userId: string, _role: string): Promise<DashboardScope> {
  const context = await getUserRoleContext(userId);
  const effectiveRole = context.primaryRole;

  // super_admin / admin are system-wide by definition and must never be narrowed by a
  // stray assignment row, or an administrator could lock themselves out of the platform.
  // Head-office titles are org-wide for the same reason: head office is itself a branch
  // in branch_master, so narrowing the CEO by assignment scoped him to 13 people.
  if (SYSTEM_WIDE_ROLES.has(effectiveRole) || HEAD_OFFICE_ROLES.has(effectiveRole)) {
    return { level: "ORG_ALL", branchIds: [], processIds: [], employeeIds: [], userId, role: effectiveRole };
  }

  const [assignments, employee] = await Promise.all([
    loadAssignmentScopes(userId, context.roleKeys),
    resolveEmployeeScope(userId),
  ]);

  // Head office sees every branch; anyone assigned to a branch sees only that branch.
  //
  // The deciding signal is an explicit branch/process row in user_assignment_scope — NOT
  // the user's own employees.branch_id. Head-office staff are themselves employees of
  // some branch, so using the employee record would narrow every HO user to their own
  // office. An explicit assignment row is a deliberate administrative act; the employee
  // record is just where the person sits.
  //
  // Previously this function returned ORG_ALL for any role in ORG_ALL_ROLES before
  // assignment scopes were even loaded, which made the check below unreachable and leaked
  // company-wide data to 15 branch-assigned users. `hr` outranks `branch_head` in
  // ROLE_PRIORITY, so three branch heads holding both roles were also silently elevated —
  // defeating the protection BRANCH_ALL_ROLES exists to provide.
  const explicitlyScoped = assignments.filter((row) => {
    const scopeType = String(row.scope_type ?? "").trim().toLowerCase();
    if (scopeType === "all") return false;
    return Boolean(row.branch_id) || Boolean(row.process_id);
  });
  const assignedBranchIds = unique(explicitlyScoped.map((row) => row.branch_id));
  const assignedProcessIds = unique(explicitlyScoped.map((row) => row.process_id));

  if (ORG_ALL_ROLES.has(effectiveRole) && !SELF_ONLY_ROLES.has(effectiveRole)) {
    if (assignedBranchIds.length === 0 && assignedProcessIds.length === 0) {
      // No branch/process assignment. These role keys (hr, hr_admin, payroll, payroll_hr,
      // payroll_admin, finance) are used for both head-office and branch staff, so absence
      // of any assignment row is not evidence of head office — it is absence of evidence.
      // Defaulting to ORG_ALL here meant a single mis-provisioned `payroll` account would
      // silently see every salary line in the company (2,755 lines / 1,467 employees on the
      // current run). Head office must be stated explicitly, via a scope_type='all' row or
      // an unambiguous head-office role key.
      //
      // Every real privileged user already carries an explicit 'all' grant, so this
      // narrows nobody in production today — only test fixtures sat on the old default.
      const hasAllGrant = assignments.some(
        (row) => String(row.scope_type ?? "").trim().toLowerCase() === "all",
      );
      if (hasAllGrant) {
        return { level: "ORG_ALL", branchIds: [], processIds: [], employeeIds: [], userId, role: effectiveRole };
      }
      // Fail closed to the employee's own branch rather than opening the whole org.
      if (employee.branchIds.length > 0) {
        return {
          level: "BRANCH_ALL",
          branchIds: employee.branchIds,
          processIds: [],
          employeeIds: [],
          userId,
          role: effectiveRole,
        };
      }
      // No assignment and no branch to fall back on: refuse rather than guess. The message
      // tells an administrator exactly what to add.
      throw new DashboardScopeConfigurationError(effectiveRole, "branch or scope_type='all'");
    }
    // Assigned to specific branches/processes: scope to exactly those, and no wider.
    // The employee's own branch is deliberately excluded — the assignment is the grant.
    if (assignedProcessIds.length > 0) {
      return {
        level: "PROCESS_ALL",
        branchIds: unique([...assignedBranchIds, ...await branchesForProcesses(assignedProcessIds)]),
        processIds: assignedProcessIds,
        employeeIds: [],
        userId,
        role: effectiveRole,
      };
    }
    return {
      level: "BRANCH_ALL",
      branchIds: assignedBranchIds,
      processIds: [],
      employeeIds: [],
      userId,
      role: effectiveRole,
    };
  }

  const processIds = unique([
    ...assignments.map((row) => row.process_id),
    ...employee.processIds,
  ]);
  const assignmentBranchIds = unique(assignments.map((row) => row.branch_id));
  const derivedBranchIds = await branchesForProcesses(processIds);
  const branchIds = unique([
    ...assignmentBranchIds,
    ...employee.branchIds,
    ...derivedBranchIds,
  ]);
  if (BRANCH_ALL_ROLES.has(effectiveRole)) {
    // A branch role is defined by its branch, never by whichever process the person
    // happens to sit in. `branchIds` above unions the assignment with the employee's own
    // branch AND every branch reachable from their process, which over-granted:
    // VIJAY KUMAR (MAS22774) is branch_head of MOHALI — 3 back-office staff — but his own
    // employee row sits in the BACK OFFICE process, and branchesForProcesses hands that
    // process's other branches back, including NOIDA-2's 55 staff. Six branches from a
    // one-branch assignment, and BRANCH_ALL filters rows directly on this list.
    //
    // Explicit assignment wins outright, on the same principle applied above: the
    // assignment is the grant. Only when a branch role carries no assignment at all does
    // it fall back to the employee's own branch — which is a narrowing, never a widening.
    const grantedBranchIds = assignedBranchIds.length > 0 ? assignedBranchIds : employee.branchIds;
    if (grantedBranchIds.length > 0) {
      return {
        level: "BRANCH_ALL",
        branchIds: grantedBranchIds,
        processIds: [],
        employeeIds: [],
        userId,
        role: effectiveRole,
      };
    }
    throw new DashboardScopeConfigurationError(effectiveRole, "branch");
  }

  if (PROCESS_OR_TEAM_ROLES.has(effectiveRole)) {
    if (processIds.length > 0) {
      return { level: "PROCESS_ALL", branchIds, processIds, employeeIds: [], userId, role: effectiveRole };
    }
    throw new DashboardScopeConfigurationError(effectiveRole, "process");
  }

  if (TEAM_ROLES.has(effectiveRole)) {
    if (!employee.employeeId) {
      throw new DashboardScopeConfigurationError(effectiveRole, "reporting hierarchy");
    }
    const employeeIds = await resolveTeamEmployeeIds(employee.employeeId);
    return { level: "TEAM_ONLY", branchIds: [], processIds: [], employeeIds, userId, role: effectiveRole };
  }

  if (SELF_ONLY_ROLES.has(effectiveRole) && !employee.employeeId) {
    throw new DashboardScopeConfigurationError(effectiveRole, "employee mapping");
  }

  if (!employee.employeeId) {
    throw new DashboardScopeConfigurationError(effectiveRole, "employee mapping");
  }

  return {
    level: "SELF_ONLY",
    branchIds: employee.branchIds,
    processIds: employee.processIds,
    employeeIds: unique([employee.employeeId]),
    userId,
    role: effectiveRole,
  };
}

export async function narrowDashboardScope(
  scope: DashboardScope,
  requestedBranchId?: string | null,
  requestedProcessId?: string | null,
): Promise<DashboardScope> {
  const branchId = String(requestedBranchId ?? "").trim();
  const processId = String(requestedProcessId ?? "").trim();
  if (!branchId && !processId) return scope;
  if (scope.level === "SELF_ONLY" || scope.level === "TEAM_ONLY") return scope;

  const deny = (): DashboardScope => ({ ...scope, level: "CUSTOM_SCOPE", branchIds: [], processIds: [] });

  if (scope.level === "BRANCH_ALL" && branchId && !scope.branchIds.includes(branchId)) return deny();
  if (scope.level === "PROCESS_ALL" && processId && !scope.processIds.includes(processId)) return deny();

  if (branchId) {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM branch_master WHERE id = ? AND active_status = 1 LIMIT 1",
      [branchId],
    ).catch(emptyOnError("branch_master validity", { site: "narrowDashboardScope" }));
    if (rows.length === 0) return deny();
  }

  if (processId) {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM process_master WHERE id = ? AND active_status = 1 LIMIT 1",
      [processId],
    ).catch(emptyOnError("process_master validity", { site: "narrowDashboardScope" }));
    if (rows.length === 0) return deny();
  }

  if (scope.level === "BRANCH_ALL" && processId) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT 1 FROM employees
        WHERE process_id = ?
          AND branch_id IN (${scope.branchIds.map(() => "?").join(",")})
          AND active_status = 1 LIMIT 1`,
      [processId, ...scope.branchIds],
    ).catch(emptyOnError("process within branch scope", { site: "narrowDashboardScope" }));
    if (rows.length === 0) return deny();
  }

  if (scope.level === "PROCESS_ALL" && branchId) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT 1 FROM employees
        WHERE branch_id = ?
          AND process_id IN (${scope.processIds.map(() => "?").join(",")})
          AND active_status = 1 LIMIT 1`,
      [branchId, ...scope.processIds],
    ).catch(emptyOnError("branch within process scope", { site: "narrowDashboardScope" }));
    if (rows.length === 0) return deny();
  }

  if (branchId && processId) {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT 1 FROM employees WHERE branch_id = ? AND process_id = ? AND active_status = 1 LIMIT 1",
      [branchId, processId],
    ).catch(emptyOnError("branch+process pair validity", { site: "narrowDashboardScope" }));
    if (rows.length === 0) return deny();
  }

  // Narrow only the dimension the caller actually supplied. A PROCESS_ALL user who
  // filters by branch alone previously lost their process restriction entirely here
  // (processIds fell back to []), and buildScopeWhere's CUSTOM_SCOPE branch skips the
  // process clause whenever processIds is empty — so "my process, this branch" silently
  // became "every process at this branch". The same widening ran the other way for a
  // BRANCH_ALL user filtering by process alone. Carrying the caller's own already-granted
  // scope forward for the untouched dimension (instead of clearing it) keeps both filters
  // in effect together; it can only narrow what buildScopeWhere returns, never widen it,
  // because it is always a subset of (or equal to) what `scope` already allowed.
  return {
    ...scope,
    level: "CUSTOM_SCOPE",
    branchIds: branchId ? [branchId] : scope.branchIds,
    processIds: processId ? [processId] : scope.processIds,
  };
}

export function buildScopeWhere(
  scope: DashboardScope,
  branchCol = "branch_id",
  processCol = "process_id",
): { sql: string; params: string[] } {
  if (scope.level === "ORG_ALL") return { sql: "1=1", params: [] };

  if (scope.level === "BRANCH_ALL") {
    if (scope.branchIds.length === 0) return { sql: "1=0", params: [] };
    return {
      sql: `${branchCol} IN (${scope.branchIds.map(() => "?").join(",")})`,
      params: [...scope.branchIds],
    };
  }

  if (scope.level === "PROCESS_ALL") {
    if (branchCol === "bm.id" && scope.branchIds.length > 0) {
      return {
        sql: `${branchCol} IN (${scope.branchIds.map(() => "?").join(",")})`,
        params: [...scope.branchIds],
      };
    }
    if (scope.processIds.length === 0) return { sql: "1=0", params: [] };
    return {
      sql: `${processCol} IN (${scope.processIds.map(() => "?").join(",")})`,
      params: [...scope.processIds],
    };
  }

  if (scope.level === "CUSTOM_SCOPE") {
    const conditions: string[] = [];
    const params: string[] = [];
    if (scope.branchIds.length > 0) {
      conditions.push(`${branchCol} IN (${scope.branchIds.map(() => "?").join(",")})`);
      params.push(...scope.branchIds);
    }
    if (scope.processIds.length > 0) {
      conditions.push(`${processCol} IN (${scope.processIds.map(() => "?").join(",")})`);
      params.push(...scope.processIds);
    }
    return conditions.length > 0 ? { sql: conditions.join(" AND "), params } : { sql: "1=0", params: [] };
  }

  return { sql: "1=0", params: [] };
}

export function buildScopeWhereEmployees(scope: DashboardScope, alias = "e"): { sql: string; params: string[] } {
  if (scope.level === "ORG_ALL") return { sql: "1=1", params: [] };
  if (scope.level === "SELF_ONLY" || scope.level === "TEAM_ONLY") {
    const employeeIds = scope.employeeIds ?? [];
    if (employeeIds.length === 0) return { sql: "1=0", params: [] };
    return {
      sql: `${alias}.id IN (${employeeIds.map(() => "?").join(",")})`,
      params: [...employeeIds],
    };
  }
  return buildScopeWhere(scope, `${alias}.branch_id`, `${alias}.process_id`);
}

export function buildEmployeeLinkedScopeWhere(
  scope: DashboardScope,
  employeeCol: string,
  branchCol = "branch_id",
  processCol = "process_id",
): { sql: string; params: string[] } {
  if (scope.level === "SELF_ONLY" || scope.level === "TEAM_ONLY") {
    const employeeIds = scope.employeeIds ?? [];
    if (employeeIds.length === 0) return { sql: "1=0", params: [] };
    return {
      sql: `${employeeCol} IN (${employeeIds.map(() => "?").join(",")})`,
      params: [...employeeIds],
    };
  }
  return buildScopeWhere(scope, branchCol, processCol);
}

export function scopeToSqlWhere(scope: DashboardScope, tableAlias = "e"): { sql: string; params: any[] } {
  return buildScopeWhereEmployees(scope, tableAlias);
}
