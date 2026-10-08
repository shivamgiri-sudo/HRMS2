/**
 * Branch / process scoping for the Roster Command Center (/wfm/roster-command-center) endpoints.
 *
 * Before this, roster-analytics, trends, audit, interventions and the by-id detail reads trusted whatever
 * branchId / processId the client sent, so any role that could open the page could read every branch by editing
 * a query string. The rule here (owner ruling 2026-10-01, same as the rest of the platform):
 *
 *   - ORG_WIDE_EXEMPT_ROLES (super_admin, ceo, coo, cfo, payroll_head, finance_head, accounts_head, finance)
 *     see everything and are not touched.
 *   - everyone else is limited to their own branch, their assigned branch(es), and the processes they are
 *     assigned to (process-level roles: their own process too).
 *   - the UI's branchId / processId / lobId only ever NARROW within that, never widen it.
 *
 * `consoleScopeGuard()` is a router-level middleware: it validates the branchId / processId the caller named
 * and, when they named none, injects the single branch / process they are limited to into req.query — so every
 * handler below it (which already reads req.query.branchId) is scoped without per-handler changes. A caller who
 * is limited to several branches and named none gets a 400 asking them to pick one, because silently combining
 * would need every query rewritten; the UI is expected to send a branch (it auto-selects one for scoped users).
 */
import type { NextFunction, Request, Response } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { ORG_WIDE_EXEMPT_ROLES } from "../../shared/scopeAccess.js";
import { resolveUserBusinessScope, type UserBusinessScope } from "../../shared/enterpriseScope.js";

export const OUT_OF_SCOPE_MSG = "Forbidden: this is outside your assigned branch / process scope";

/** Roles whose own employee branch is their default branch scope. */
export const BRANCH_LEVEL_ROLES = [
  "hr", "hr_admin", "payroll_hr", "branch_head", "branch_hr", "hr_branch", "branch_admin",
  "wfm", "wfm_spoc", "branch_wfm", "payroll", "payroll_branch", "rta", "operations_manager", "admin",
];
/** Reporting / process-level roles: their own employees.process_id is a default process scope. */
export const PROCESS_LEVEL_ROLES = ["manager", "process_manager", "assistant_manager", "tl", "team_leader", "qa", "trainer"];

export function isOrgWide(scope: UserBusinessScope): boolean {
  return scope.roles.some((r) => ORG_WIDE_EXEMPT_ROLES.includes(r));
}

/** Branch ids the caller may see. null = unrestricted (org-wide). */
export function allowedBranchIds(scope: UserBusinessScope): string[] | null {
  if (isOrgWide(scope)) return null;
  const set = new Set<string>();
  if (scope.branchId && scope.roles.some((r) => BRANCH_LEVEL_ROLES.includes(r))) set.add(scope.branchId);
  for (const a of scope.assignments) {
    if ((a.scopeType === "branch" || a.scopeType === "branch_process") && a.branchId) set.add(a.branchId);
    // scope_type 'all' means "everything within my own branch", never company-wide.
    if (a.scopeType === "all" && scope.branchId) set.add(scope.branchId);
  }
  return [...set];
}

/** Processes the caller is assigned to (assignment rows, plus their own process for process-level roles). */
export function assignedProcessIds(scope: UserBusinessScope): string[] {
  const set = new Set<string>();
  for (const a of scope.assignments) {
    if ((a.scopeType === "process" || a.scopeType === "branch_process" || a.scopeType === "team") && a.processId) set.add(a.processId);
  }
  if (scope.processId && scope.roles.some((r) => PROCESS_LEVEL_ROLES.includes(r))) set.add(scope.processId);
  return [...set];
}

export async function getScope(req: Request): Promise<UserBusinessScope | null> {
  const user = (req as { authUser?: { id: string } }).authUser;
  if (!user?.id) return null;
  return resolveUserBusinessScope(user as never);
}

async function processBranch(processId: string): Promise<{ exists: boolean; branchId: string | null }> {
  const [rows] = await db.execute<RowDataPacket[]>("SELECT branch_id FROM process_master WHERE id = ? LIMIT 1", [processId]);
  const r = (rows as RowDataPacket[])[0];
  return { exists: !!r, branchId: r?.branch_id ? String(r.branch_id) : null };
}

/** A row keyed by branch and/or process: visible when its branch is the caller's, or its process is assigned. */
export async function canAccessTarget(
  scope: UserBusinessScope,
  target: { branchId?: string | null; processId?: string | null },
): Promise<boolean> {
  if (isOrgWide(scope)) return true;
  const branches = allowedBranchIds(scope) ?? [];
  if (target.branchId && branches.includes(String(target.branchId))) return true;
  if (target.processId) {
    if (assignedProcessIds(scope).includes(String(target.processId))) return true;
    const p = await processBranch(String(target.processId));
    if (p.branchId && branches.includes(p.branchId)) return true;
  }
  return false;
}

/** The employee must belong to a branch / process the caller may see. */
export async function canAccessEmployee(scope: UserBusinessScope, employeeId: string): Promise<boolean> {
  if (isOrgWide(scope)) return true;
  const [rows] = await db.execute<RowDataPacket[]>("SELECT branch_id, process_id FROM employees WHERE id = ? LIMIT 1", [employeeId]);
  const e = (rows as RowDataPacket[])[0];
  if (!e) return false;
  return canAccessTarget(scope, { branchId: e.branch_id ? String(e.branch_id) : null, processId: e.process_id ? String(e.process_id) : null });
}

const NOT_ASKED = new Set(["", "all", "__all__", "undefined", "null"]);
const one = (v: unknown): string => {
  const s = Array.isArray(v) ? String(v[0] ?? "") : typeof v === "string" ? v : "";
  return NOT_ASKED.has(s.trim().toLowerCase()) ? "" : s.trim();
};

type GuardOutcome =
  | { ok: true; inject: { branchId?: string; processId?: string } }
  | { ok: false; status: number; message: string };

/** Pure decision, separated from Express so it can be unit-tested. */
export async function decideConsoleScope(
  scope: UserBusinessScope,
  asked: { branchId: string; processId: string },
  lookupProcess: (id: string) => Promise<{ exists: boolean; branchId: string | null }> = processBranch,
  /** false for entity-scoped routes (/employee-profile/:id ...): the id is validated by a param guard instead. */
  requireSelection = true,
): Promise<GuardOutcome> {
  if (isOrgWide(scope)) return { ok: true, inject: {} };
  const branches = allowedBranchIds(scope) ?? [];
  const procs = assignedProcessIds(scope);

  if (asked.branchId) {
    const branchOk = branches.includes(asked.branchId);
    // A process-level user may name the branch of a process they are assigned to.
    let viaProcess = false;
    if (!branchOk && procs.length) {
      for (const p of procs) { if ((await lookupProcess(p)).branchId === asked.branchId) { viaProcess = true; break; } }
    }
    if (!branchOk && !viaProcess) return { ok: false, status: 403, message: OUT_OF_SCOPE_MSG };
  }
  if (asked.processId) {
    const p = await lookupProcess(asked.processId);
    const ok = procs.includes(asked.processId) || (p.branchId !== null && branches.includes(p.branchId));
    if (!ok) return { ok: false, status: 403, message: OUT_OF_SCOPE_MSG };
    // The process must belong to the branch the caller named, if they named one.
    if (asked.branchId && p.branchId && p.branchId !== asked.branchId) return { ok: false, status: 403, message: OUT_OF_SCOPE_MSG };
  }
  if (asked.branchId || asked.processId) return { ok: true, inject: {} };

  // Nothing named: inject the one branch / process the caller is limited to.
  if (!requireSelection) return { ok: true, inject: {} };
  if (branches.length === 1) return { ok: true, inject: { branchId: branches[0] } };
  if (branches.length > 1) return { ok: false, status: 400, message: "Select a branch: your scope covers more than one." };
  if (procs.length === 1) return { ok: true, inject: { processId: procs[0] } };
  if (procs.length > 1) return { ok: false, status: 400, message: "Select a process: your scope covers more than one." };
  return { ok: false, status: 403, message: "No branch or process scope is assigned to your account." };
}

/** Router-level middleware: validates / injects req.query.branchId & processId. Place AFTER requireAuth. */
export function consoleScopeGuard(opts: { entityPaths?: RegExp } = {}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = await getScope(req);
      if (!scope) return res.status(401).json({ success: false, message: "Unauthorized" });
      // An employee named in the query (member / employee drill-downs) must be visible to the caller.
      const emp = one(req.query.employeeId) || one(req.query.employee_id);
      if (emp && !(await canAccessEmployee(scope, emp))) {
        return res.status(403).json({ success: false, error: OUT_OF_SCOPE_MSG, message: OUT_OF_SCOPE_MSG });
      }
      const entityRoute = !!opts.entityPaths && opts.entityPaths.test(req.path);
      const out = await decideConsoleScope(scope, { branchId: one(req.query.branchId), processId: one(req.query.processId) }, processBranch, !entityRoute);
      if (!out.ok) return res.status(out.status).json({ success: false, error: out.message, message: out.message });
      // Normalise "all" placeholders so handlers see "not asked", then inject the caller's single scope.
      for (const k of ["branchId", "processId"] as const) if (k in req.query && !one(req.query[k])) delete (req.query as Record<string, unknown>)[k];
      if (out.inject.branchId) (req.query as Record<string, unknown>).branchId = out.inject.branchId;
      if (out.inject.processId) (req.query as Record<string, unknown>).processId = out.inject.processId;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/** router.param('branchId', branchParamGuard()): the :branchId path segment must be one of the caller's branches. */
export function branchParamGuard() {
  return async (req: Request, res: Response, next: NextFunction, value: string) => {
    try {
      const scope = await getScope(req);
      if (!scope) return res.status(401).json({ success: false, message: "Unauthorized" });
      if (await canAccessTarget(scope, { branchId: value })) return next();
      return res.status(403).json({ success: false, error: OUT_OF_SCOPE_MSG, message: OUT_OF_SCOPE_MSG });
    } catch (err) {
      return next(err);
    }
  };
}

/** router.param('employeeId', employeeParamGuard()): the :employeeId path segment must be visible to the caller. */
export function employeeParamGuard() {
  return async (req: Request, res: Response, next: NextFunction, value: string) => {
    try {
      const scope = await getScope(req);
      if (!scope) return res.status(401).json({ success: false, message: "Unauthorized" });
      if (await canAccessEmployee(scope, value)) return next();
      return res.status(403).json({ success: false, error: OUT_OF_SCOPE_MSG, message: OUT_OF_SCOPE_MSG });
    } catch (err) {
      return next(err);
    }
  };
}

export interface ConsoleOptions {
  orgWide: boolean;
  branches: { id: string; branch_name: string }[];
  processes: { id: string; process_name: string; branch_id: string | null }[];
}

/**
 * A branch belongs on this console only when it is active (and not past its close date) and its legal entity is
 * MAS Callnet. The Dialdesk branch (company_name 'Ispark Dataconnect Pvt Ltd') and branches with no company recorded
 * are left out. company_name is free text ('Mas Callnet India Pvt. Ltd.' / 'MAS Call Net India Pvt Ltd' / ...), so it
 * is compared with spaces and dots removed.
 */
const MAS_ACTIVE_BRANCH =
  "b.active_status = 1 AND (b.close_date IS NULL OR b.close_date >= CURDATE()) " +
  "AND LOWER(REPLACE(REPLACE(COALESCE(b.company_name, ''), ' ', ''), '.', '')) LIKE 'mascallnet%'";

/** Branch and Process dropdown options limited to what the caller may see: active, MAS Callnet only. */
export async function getConsoleOptions(scope: UserBusinessScope): Promise<ConsoleOptions> {
  const orgWide = isOrgWide(scope);
  const allowed = allowedBranchIds(scope); // null = org-wide
  const processIds = assignedProcessIds(scope);

  // Scope filter shared by both queries: the caller's branches, or processes they are assigned to.
  const scopeSql = (branchCol: string, processCol: string | null) => {
    if (orgWide) return { sql: "1=1", params: [] as unknown[] };
    const ors: string[] = [];
    const params: unknown[] = [];
    if (allowed && allowed.length) { ors.push(`${branchCol} IN (${allowed.map(() => "?").join(",")})`); params.push(...allowed); }
    if (processCol && processIds.length) { ors.push(`${processCol} IN (${processIds.map(() => "?").join(",")})`); params.push(...processIds); }
    return { sql: ors.length ? `(${ors.join(" OR ")})` : "1=0", params };
  };

  const ps = scopeSql("pm.branch_id", "pm.id");
  const [processes] = await db.execute<RowDataPacket[]>(
    `SELECT pm.id, pm.process_name, pm.branch_id
       FROM process_master pm
       JOIN branch_master b ON b.id = pm.branch_id
      WHERE pm.active_status = 1 AND (pm.close_date IS NULL OR pm.close_date >= CURDATE())
        AND ${MAS_ACTIVE_BRANCH} AND ${ps.sql}
      ORDER BY pm.process_name`,
    ps.params,
  );

  // Branches: the caller's own, plus the branch of any process they are assigned to.
  const branchIds = new Set<string>(allowed ?? []);
  if (!orgWide) for (const p of processes as RowDataPacket[]) if (p.branch_id) branchIds.add(String(p.branch_id));
  const [branches] = orgWide
    ? await db.execute<RowDataPacket[]>(`SELECT b.id, b.branch_name FROM branch_master b WHERE ${MAS_ACTIVE_BRANCH} ORDER BY b.branch_name`)
    : branchIds.size === 0
      ? [[] as RowDataPacket[]]
      : await db.execute<RowDataPacket[]>(
          `SELECT b.id, b.branch_name FROM branch_master b WHERE ${MAS_ACTIVE_BRANCH} AND b.id IN (${[...branchIds].map(() => "?").join(",")}) ORDER BY b.branch_name`,
          [...branchIds],
        );
  return { orgWide, branches: branches as ConsoleOptions["branches"], processes: processes as ConsoleOptions["processes"] };
}
