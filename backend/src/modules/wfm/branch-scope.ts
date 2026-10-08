import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  resolveUserBusinessScope,
  buildEmployeeScopeCondition,
  canViewEmployee,
  type UserBusinessScope,
  type ScopeCondition,
} from "../../shared/enterpriseScope.js";
import { ORG_WIDE_EXEMPT_ROLES } from "../../shared/scopeAccess.js";

/**
 * Branch-scoping helpers for the workforce modules (owner ruling 2026-10-01).
 *
 * Org-wide roles (ORG_WIDE_EXEMPT_ROLES) are never restricted. Everyone else is limited to their own
 * branch / assigned scope, a browser-supplied ?branchId= / body.branch_id may only NARROW that scope,
 * and a caller with no resolvable scope sees nothing (fail closed).
 */

/** Roles that work at branch level: their own employees.branch_id is their default scope. */
export const BRANCH_LEVEL_ROLES = [
  "admin", "hr", "hr_admin", "payroll_hr", "branch_head", "branch_hr", "hr_branch", "branch_admin",
  "wfm", "wfm_spoc", "payroll", "payroll_branch", "rta", "operations_manager",
];

/** Reporting / process-level roles: their own employees.process_id is a default process scope. */
export const PROCESS_LEVEL_ROLES = ["manager", "process_manager", "assistant_manager", "tl", "team_leader", "qa", "trainer"];

/** Processes the caller is assigned to (assignment rows, plus own process for process-level roles). */
export function assignedProcessIds(scope: UserBusinessScope): string[] {
  const set = new Set<string>();
  for (const a of scope.assignments) {
    if ((a.scopeType === "process" || a.scopeType === "branch_process" || a.scopeType === "team") && a.processId) set.add(a.processId);
  }
  if (scope.processId && scope.roles.some((r) => PROCESS_LEVEL_ROLES.includes(r))) set.add(scope.processId);
  return [...set];
}

export type Alias = {
  employeeId?: string;
  branchId?: string;
  processId?: string;
  managerEmployeeId?: string;
};

export function isOrgWide(scope: UserBusinessScope): boolean {
  return scope.roles.some((r) => ORG_WIDE_EXEMPT_ROLES.includes(r));
}

function isBranchLevel(scope: UserBusinessScope): boolean {
  return scope.roles.some((r) => BRANCH_LEVEL_ROLES.includes(r));
}

/**
 * Screens gated to a payroll / admin audience (attendance exception bucket, manual overrides, ...) used to let `admin`
 * reach every employee. admin is branch-scoped like hr (owner ruling 2026-10-01): returns the caller's scope when they
 * are an `admin` WITHOUT an org-wide role (their data must be limited to it), or null when no extra limit applies
 * (org-wide roles, and other gate roles such as payroll_head / payroll_admin whose scope is a separate decision).
 */
export async function branchAdminScope(userId: string): Promise<UserBusinessScope | null> {
  const scope = await resolveUserBusinessScope(userId);
  if (isOrgWide(scope) || !scope.roles.includes("admin")) return null;
  return scope;
}

export async function getScope(req: { authUser?: { id: string } | null }): Promise<UserBusinessScope | null> {
  if (!req.authUser?.id) return null;
  return resolveUserBusinessScope(req.authUser as any);
}

/** SQL predicate (without leading AND) for rows owned by an employee/branch/process the caller may see. */
export function scopePredicate(scope: UserBusinessScope, alias: Alias): ScopeCondition {
  if (isOrgWide(scope)) return { sql: "1=1", params: [] };
  const ors: string[] = [];
  const params: unknown[] = [];

  const base = buildEmployeeScopeCondition(scope, alias);
  if (base.sql !== "1=0") {
    ors.push(`(${base.sql})`);
    params.push(...base.params);
  }
  if (isBranchLevel(scope) && scope.branchId && alias.branchId) {
    ors.push(`${alias.branchId} = ?`);
    params.push(scope.branchId);
  }
  if (scope.employeeId && alias.managerEmployeeId) {
    ors.push(`${alias.managerEmployeeId} = ?`);
    params.push(scope.employeeId);
  }
  if (ors.length === 0) return { sql: "1=0", params: [] };
  return { sql: ors.join(" OR "), params };
}

/** Branch ids the caller may see, or null for org-wide. Empty array = nothing. */
export function allowedBranchIds(scope: UserBusinessScope): string[] | null {
  if (isOrgWide(scope)) return null;
  const set = new Set<string>();
  if (isBranchLevel(scope) && scope.branchId) set.add(scope.branchId);
  for (const a of scope.assignments) {
    if ((a.scopeType === "branch" || a.scopeType === "branch_process") && a.branchId) set.add(a.branchId);
    if (a.scopeType === "all" && scope.branchId) set.add(scope.branchId);
  }
  // Own-branch clamp (owner ruling 2026-10-01): assignment rows never reach past the branch on the
  // caller's own employee record. No own branch (account not linked to an employee): rows decide.
  if (scope.branchId) return [...set].filter((id) => id === scope.branchId);
  return [...set];
}

export async function canAccessBranch(scope: UserBusinessScope, branchId: string | null | undefined): Promise<boolean> {
  if (isOrgWide(scope)) return true;
  if (!branchId) return false;
  if (scope.branchId && branchId !== scope.branchId) return false;
  const allowed = allowedBranchIds(scope) ?? [];
  if (allowed.includes(branchId)) return true;
  const procIds = assignedProcessIds(scope);
  if (procIds.length === 0) return false;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM process_master WHERE branch_id = ? AND id IN (${procIds.map(() => "?").join(",")}) LIMIT 1`,
    [branchId, ...procIds],
  );
  return (rows as RowDataPacket[]).length > 0;
}

export async function canAccessProcess(
  scope: UserBusinessScope,
  processId: string | null | undefined,
  branchId?: string | null,
): Promise<boolean> {
  if (isOrgWide(scope)) return true;
  if (!processId) return false;
  // Own-branch clamp: a process the caller is assigned to is only theirs inside their own branch.
  if (scope.branchId) {
    if (branchId && branchId !== scope.branchId) return false;
    if (!branchId) {
      const [prow] = await db.execute<RowDataPacket[]>("SELECT branch_id FROM process_master WHERE id = ? LIMIT 1", [processId]);
      const pb = (prow as RowDataPacket[])[0]?.branch_id;
      if (pb && String(pb) !== scope.branchId) return false;
    }
  }
  if (assignedProcessIds(scope).includes(processId)) return true;
  if (branchId && (await canAccessBranch(scope, branchId))) return true;
  const allowed = allowedBranchIds(scope) ?? [];
  if (allowed.length === 0) return false;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM process_master WHERE id = ? AND branch_id IN (${allowed.map(() => "?").join(",")}) LIMIT 1`,
    [processId, ...allowed],
  );
  return (rows as RowDataPacket[]).length > 0;
}

export async function canAccessEmployee(scope: UserBusinessScope, employeeId: string | null | undefined): Promise<boolean> {
  if (isOrgWide(scope)) return true;
  if (!employeeId) return false;
  if (scope.employeeId === employeeId) return true;
  if (await canViewEmployee(scope.userId, employeeId)) return true;
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT branch_id, reporting_manager_id FROM employees WHERE id = ? LIMIT 1",
    [employeeId],
  );
  const row = (rows as RowDataPacket[])[0];
  if (!row) return false;
  if (scope.employeeId && row.reporting_manager_id === scope.employeeId) return true;
  return isBranchLevel(scope) && !!scope.branchId && row.branch_id === scope.branchId;
}

export type BranchFilter =
  | { denied: true }
  | { denied: false; branchIds: string[] | null };

/**
 * Intersect a browser-supplied branch filter with what the caller may see.
 * branchIds === null  -> org-wide, no restriction (client value, if any, is returned as [client]).
 */
export function resolveBranchFilter(scope: UserBusinessScope, clientBranchId?: string | null): BranchFilter {
  const asked = clientBranchId ? String(clientBranchId) : "";
  const allowed = allowedBranchIds(scope);
  if (allowed === null) return { denied: false, branchIds: asked ? [asked] : null };
  if (asked) return allowed.includes(asked) ? { denied: false, branchIds: [asked] } : { denied: true };
  if (allowed.length === 0) return { denied: true };
  return { denied: false, branchIds: allowed };
}

export const OUT_OF_SCOPE_MSG = "Forbidden: outside your branch / assigned scope";

type GuardOpts = {
  /** query / body / param keys that carry the browser's branch and process filter. */
  branchKeys?: string[];
  processKeys?: string[];
  /** keys carrying a branch / process NAME (resolved to ids and checked like an id). */
  branchNameKeys?: string[];
  processNameKeys?: string[];
  /** body keys holding an ARRAY of process ids (every entry is checked). */
  processArrayKeys?: string[];
  /** non-org-wide callers must name a branch or process (for writes that cannot be auto-narrowed). */
  requireTarget?: boolean;
  /** default true: when the caller names no branch/process, narrow req.query to their own scope. */
  inject?: boolean;
  /** req.query keys the narrowing value is written to (defaults: branchId / processId). */
  injectBranchKey?: string;
  injectProcessKey?: string;
};

/**
 * Express middleware: validates a browser-supplied branch/process filter against the caller's scope
 * (403 when outside) and, when none was supplied, injects the caller's own branch (or process) into
 * req.query so downstream services that already honour ?branchId= / ?processId= are narrowed.
 * EVERY source (route params, query, body) of every key is validated, so a value smuggled in a second
 * location cannot bypass the check. Org-wide roles pass untouched. A caller with no resolvable scope is
 * refused (fail closed).
 */
export function branchScopeGuard(opts: GuardOpts = {}) {
  const branchKeys = opts.branchKeys ?? ["branchId", "branch_id"];
  const processKeys = opts.processKeys ?? ["processId", "process_id"];
  const inject = opts.inject ?? true;
  const injectBranchKey = opts.injectBranchKey ?? "branchId";
  const injectProcessKey = opts.injectProcessKey ?? "processId";
  return async (req: any, res: any, next: any) => {
    try {
      const scope = await getScope(req);
      if (!scope) return res.status(401).json({ success: false, message: "Unauthorized" });
      if (isOrgWide(scope)) return next();

      const collect = (keys: string[]): string[] => {
        const out = new Set<string>();
        for (const k of keys) {
          for (const src of [req.params, req.query, req.body]) {
            const v = src?.[k];
            if (v !== undefined && v !== null && String(v) !== "" && String(v) !== "all" && String(v) !== "__all__") out.add(String(v));
          }
        }
        return [...out];
      };
      const askedBranches = collect(branchKeys);
      const askedProcesses = collect(processKeys);
      for (const k of opts.processArrayKeys ?? []) {
        const arr = req.body?.[k];
        if (Array.isArray(arr)) for (const v of arr) if (v) askedProcesses.push(String(v));
      }
      const askedBranchNames = collect(opts.branchNameKeys ?? []);
      const askedProcessNames = collect(opts.processNameKeys ?? []);
      const allowed = allowedBranchIds(scope) ?? [];
      const procIds = assignedProcessIds(scope);
      const deny = () => res.status(403).json({ success: false, message: OUT_OF_SCOPE_MSG });

      // A browser-supplied NAME is resolved to ids; every matching row must be inside the caller's scope.
      for (const name of askedBranchNames) {
        const [bRows] = await db.execute<RowDataPacket[]>("SELECT id FROM branch_master WHERE branch_name = ?", [name]);
        for (const r of bRows as RowDataPacket[]) if (!allowed.includes(String(r.id))) return deny();
        if ((bRows as RowDataPacket[]).length === 0 && allowed.length === 0) return deny();
      }
      for (const name of askedProcessNames) {
        const [pRows] = await db.execute<RowDataPacket[]>("SELECT id, branch_id FROM process_master WHERE process_name = ?", [name]);
        for (const r of pRows as RowDataPacket[]) if (!(await canAccessProcess(scope, String(r.id), r.branch_id ? String(r.branch_id) : null))) return deny();
        if ((pRows as RowDataPacket[]).length === 0 && allowed.length === 0 && procIds.length === 0) return deny();
      }
      const namedTarget = askedBranchNames.length > 0 || askedProcessNames.length > 0;

      for (const b of askedBranches) {
        if (allowed.length > 0) {
          if (!allowed.includes(b)) return deny();
        } else if (askedProcesses.length > 0) {
          for (const p of askedProcesses) if (!(await canAccessProcess(scope, p, b))) return deny();
        } else if (procIds.length > 0 && (await canAccessBranch(scope, b))) {
          // Process-level caller naming only a branch: stay inside their own process.
          if (procIds.length !== 1) {
            return res.status(400).json({ success: false, message: "Select a process: your scope covers more than one" });
          }
          req.query[injectProcessKey] = procIds[0];
        } else {
          return deny();
        }
      }
      for (const p of askedProcesses) {
        if (!(await canAccessProcess(scope, p, askedBranches.length === 1 ? askedBranches[0] : null))) return deny();
      }

      const hasTarget = askedBranches.length > 0 || askedProcesses.length > 0 || namedTarget;
      if (!hasTarget && opts.requireTarget) {
        return res.status(400).json({ success: false, message: "branchId or processId is required for your scope" });
      }
      if (!hasTarget) {
        if (allowed.length === 0 && procIds.length === 0 && !req.query?.employeeId) return deny();
        // Per-employee requests are checked against the employee itself (employeeFieldGuard).
        if (inject && !req.query?.employeeId) {
          if (allowed.length === 1) req.query[injectBranchKey] = allowed[0];
          else if (allowed.length === 0 && procIds.length === 1) req.query[injectProcessKey] = procIds[0];
          else {
            return res.status(400).json({ success: false, message: "Select a branch or process: your scope covers more than one" });
          }
        }
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/** router.param handler: the :branchId path parameter must be one of the caller's branches. */
export function branchParamGuard() {
  return async (req: any, res: any, next: any, value: string) => {
    try {
      const scope = await getScope(req);
      if (!scope) return res.status(401).json({ success: false, message: "Unauthorized" });
      if (isOrgWide(scope)) return next();
      if ((allowedBranchIds(scope) ?? []).includes(String(value))) return next();
      return res.status(403).json({ success: false, message: OUT_OF_SCOPE_MSG });
    } catch (err) {
      return next(err);
    }
  };
}

/** router.param handler: the :employeeId / :id path parameter must be an employee the caller may see. */
export function employeeParamGuard() {
  return async (req: any, res: any, next: any, value: string) => {
    try {
      const scope = await getScope(req);
      if (!scope) return res.status(401).json({ success: false, message: "Unauthorized" });
      if (await canAccessEmployee(scope, String(value))) return next();
      return res.status(403).json({ success: false, message: OUT_OF_SCOPE_MSG });
    } catch (err) {
      return next(err);
    }
  };
}

/** A row keyed by branch and/or process: visible when its branch is the caller's, or its process is assigned. */
export async function canAccessTarget(
  scope: UserBusinessScope,
  target: { branchId?: string | null; processId?: string | null },
): Promise<boolean> {
  if (isOrgWide(scope)) return true;
  if (target.branchId && (allowedBranchIds(scope) ?? []).includes(String(target.branchId))) return true;
  if (target.processId && (await canAccessProcess(scope, target.processId, target.branchId ?? null))) return true;
  return false;
}

/** Middleware: the employee id named in req.query/body[key] must be visible to the caller. */
function valuesOf(req: any, key: string): string[] {
  const out = new Set<string>();
  for (const src of [req.params, req.query, req.body]) {
    const v = src?.[key];
    if (v !== undefined && v !== null && String(v) !== "") out.add(String(v));
  }
  return [...out];
}

export function employeeFieldGuard(...keys: string[]) {
  return async (req: any, res: any, next: any) => {
    try {
      const scope = await getScope(req);
      if (!scope) return res.status(401).json({ success: false, message: "Unauthorized" });
      if (isOrgWide(scope)) return next();
      for (const k of keys) {
        for (const v of valuesOf(req, k)) {
          if (!(await canAccessEmployee(scope, v))) {
            return res.status(403).json({ success: false, message: OUT_OF_SCOPE_MSG });
          }
        }
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * Middleware factory: the roster cycle / plan id named in req.params/query/body[key] must belong to a
 * branch or process the caller may see. `table` is weekly_roster_cycle or wfm_roster_plan. Unknown ids
 * pass through (the handler answers 404 / empty); org-wide roles pass untouched.
 */
export function rosterOwnerGuard(table: string, ...keys: string[]) {
  return async (req: any, res: any, next: any) => {
    try {
      const scope = await getScope(req);
      if (!scope) return res.status(401).json({ success: false, message: "Unauthorized" });
      if (isOrgWide(scope)) return next();
      for (const k of keys) {
        for (const v of valuesOf(req, k)) {
          const [rows] = await db.execute<RowDataPacket[]>(
            `SELECT branch_id, process_id FROM ${table} WHERE id = ? LIMIT 1`,
            [v],
          );
          const row = (rows as RowDataPacket[])[0];
          if (!row) continue;
          if (!(await canAccessTarget(scope, { branchId: row.branch_id, processId: row.process_id }))) {
            return res.status(403).json({ success: false, message: OUT_OF_SCOPE_MSG });
          }
        }
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * Middleware factory for by-id endpoints on a row owned by an employee: the row's employee must be the
 * caller or inside the caller's branch / scope. `table`/`column` are developer-supplied constants.
 * Unknown ids pass through (the handler answers 404); org-wide roles pass untouched.
 */
export function employeeOwnerGuard(table: string, idKey = "id", column = "employee_id") {
  return async (req: any, res: any, next: any) => {
    try {
      const scope = await getScope(req);
      if (!scope) return res.status(401).json({ success: false, message: "Unauthorized" });
      if (isOrgWide(scope)) return next();
      for (const id of valuesOf(req, idKey)) {
        const [rows] = await db.execute<RowDataPacket[]>(`SELECT ${column} AS owner FROM ${table} WHERE id = ? LIMIT 1`, [id]);
        const owner = (rows as RowDataPacket[])[0]?.owner;
        if (!owner) continue;
        if (!(await canAccessEmployee(scope, String(owner)))) {
          return res.status(403).json({ success: false, message: OUT_OF_SCOPE_MSG });
        }
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

type RestPolicyLike = { scope_type?: string | null; scope_id?: string | null };

/** Rest-policy rows: organization-wide rows are readable by all but writable only by org-wide roles. */
export async function canTouchScopedPolicy(scope: UserBusinessScope, row: RestPolicyLike, write: boolean): Promise<boolean> {
  if (isOrgWide(scope)) return true;
  const type = row.scope_type ?? "organization";
  if (type === "organization") return !write;
  if (!row.scope_id) return false;
  if (type === "branch") return (allowedBranchIds(scope) ?? []).includes(String(row.scope_id));
  if (type === "process") return canAccessProcess(scope, String(row.scope_id), null);
  if (type === "employee") return canAccessEmployee(scope, String(row.scope_id));
  return false;
}

/** Pure, synchronous: is this employee row (id / branch_id / process_id / reporting_manager_id) inside the caller's scope? */
export function rowInScope(
  scope: UserBusinessScope,
  row: { id?: string | null; branch_id?: string | null; process_id?: string | null; reporting_manager_id?: string | null },
): boolean {
  if (isOrgWide(scope)) return true;
  if (row.id && scope.employeeId === row.id) return true;
  if (row.branch_id && (allowedBranchIds(scope) ?? []).includes(String(row.branch_id))) return true;
  if (row.process_id && assignedProcessIds(scope).includes(String(row.process_id))) return true;
  if (scope.employeeId && row.reporting_manager_id === scope.employeeId) return true;
  return scope.assignments.some((a) => a.scopeType === "team" && a.managerEmployeeId && a.managerEmployeeId === row.reporting_manager_id);
}

/** userId-based convenience wrappers for modules that only carry a user id. */
export async function userIsOrgWide(userId: string): Promise<boolean> {
  return isOrgWide(await resolveUserBusinessScope(userId));
}

export async function userCanAccessProcess(userId: string, processId: string | null | undefined, branchId?: string | null): Promise<boolean> {
  return canAccessProcess(await resolveUserBusinessScope(userId), processId, branchId ?? null);
}

/** 'unrestricted' for org-wide roles, otherwise the process ids in the caller's own branch / assignments. */
export async function scopedProcessIdsForUser(userId: string): Promise<"unrestricted" | string[]> {
  const scope = await resolveUserBusinessScope(userId);
  if (isOrgWide(scope)) return "unrestricted";
  const ids = new Set<string>(assignedProcessIds(scope));
  const branches = allowedBranchIds(scope) ?? [];
  if (branches.length) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM process_master WHERE branch_id IN (${branches.map(() => "?").join(", ")})`,
      branches,
    );
    for (const r of rows as RowDataPacket[]) ids.add(String(r.id));
  }
  return [...ids];
}
