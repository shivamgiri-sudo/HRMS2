import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import { getUserRoleKeys, isOrgWideUser } from "../../../shared/scopeAccess.js";
import { resolveEffectiveApprover } from "../../../shared/approvalEscalation.js";
import type { LoopbackCtx } from "../types.js";

/**
 * Who the popup is being built for, in the terms the owner's branch policy (rulings 2026-10-01) uses:
 * org-wide ONLY for ORG_WIDE_EXEMPT_ROLES (isOrgWideUser); everyone else is limited to the branch on their OWN
 * employees record. Assignment rows may narrow, never widen, so none of this reads user_assignment_scope.
 * `admin`, `hr`, `branch_head`, `payroll_hr` ... are branch-scoped; `admin` is NOT a wildcard here.
 */
export interface CallerScope {
  userId: string;
  employeeId: string | null;
  employeeCode: string | null;
  /** Branch on the caller's own active employees record; null when they have none. */
  branchId: string | null;
  orgWide: boolean;
  roles: string[];
}

/**
 * The data-access seam. Everything that touches the database goes through `io`, so scope tests swap these three/four
 * functions instead of mocking the database (see __tests__/scope-fixture.ts). Production code never reassigns them.
 */
export const io = {
  async loadCaller(userId: string): Promise<CallerScope> {
    const [orgWide, roles, [rows]] = await Promise.all([
      isOrgWideUser(userId),
      getUserRoleKeys(userId),
      db.execute<RowDataPacket[]>(
        "SELECT id, employee_code, branch_id FROM employees WHERE user_id = ? AND active_status = 1 ORDER BY updated_at DESC LIMIT 1",
        [userId],
      ),
    ]);
    const e = (rows as RowDataPacket[])[0];
    return {
      userId,
      employeeId: e?.id ? String(e.id) : null,
      employeeCode: e?.employee_code ? String(e.employee_code) : null,
      branchId: e?.branch_id ? String(e.branch_id) : null,
      orgWide: Boolean(orgWide),
      roles: roles.map(String),
    };
  },
  /** employees.id -> branch_id (null when unknown). */
  async employeeBranches(employeeIds: unknown[]): Promise<Map<string, string | null>> {
    const rows = await lookup((m) => `SELECT id, branch_id FROM employees WHERE id IN (${m})`, employeeIds);
    return new Map(rows.map((r) => [String(r.id), r.branch_id ? String(r.branch_id) : null]));
  },
  /** auth user id -> { employeeId, branchId } of the person's active employee record. */
  async userEmployees(userIds: unknown[]): Promise<Map<string, { employeeId: string; branchId: string | null }>> {
    const rows = await lookup(
      (m) => `SELECT user_id, id, branch_id FROM employees WHERE user_id IN (${m}) AND active_status = 1 ORDER BY updated_at ASC`,
      userIds,
    );
    return new Map(rows.map((r) => [String(r.user_id), { employeeId: String(r.id), branchId: r.branch_id ? String(r.branch_id) : null }]));
  },
  /** The reporting manager responsible for this employee's requests today (skip-level when the manager is on approved leave). */
  async effectiveApproverEmployeeId(employeeId: string): Promise<string | null> {
    return (await resolveEffectiveApprover(employeeId)).approverId;
  },
  /** cost_centre_master.id -> branch_id. */
  async costCentreBranches(costCentreIds: unknown[]): Promise<Map<string, string | null>> {
    const rows = await lookup((m) => `SELECT id, branch_id FROM cost_centre_master WHERE id IN (${m})`, costCentreIds);
    return new Map(rows.map((r) => [String(r.id), r.branch_id ? String(r.branch_id) : null]));
  },
};

const cache = new WeakMap<LoopbackCtx, Promise<CallerScope>>();

export function callerScope(ctx: LoopbackCtx): Promise<CallerScope> {
  let p = cache.get(ctx);
  if (!p) {
    p = io.loadCaller(ctx.userId);
    cache.set(ctx, p);
  }
  return p;
}

/** Org-wide caller, or the row's branch is the caller's own branch. A caller with no own branch sees no branch-bound row. */
export function branchAllowed(me: CallerScope, branchId: unknown): boolean {
  if (me.orgWide) return true;
  return Boolean(me.branchId && branchId && String(branchId) === me.branchId);
}

/** True when the row belongs to the caller themself (employee id) — a person never decides their own request. */
export function isOwnEmployee(me: CallerScope, employeeId: unknown): boolean {
  return Boolean(me.employeeId && employeeId && String(employeeId) === me.employeeId);
}

const holds = (me: CallerScope, ...roles: string[]) => roles.some((r) => me.roles.includes(r));
export { holds as callerHolds };

async function lookup(sql: (marks: string) => string, ids: unknown[]): Promise<RowDataPacket[]> {
  const uniq = Array.from(new Set(ids.filter((x) => x !== null && x !== undefined && x !== "").map(String)));
  if (!uniq.length) return [];
  const out: RowDataPacket[] = [];
  for (let i = 0; i < uniq.length; i += 500) {
    const chunk = uniq.slice(i, i + 500);
    const [rows] = await db.execute<RowDataPacket[]>(sql(chunk.map(() => "?").join(",")), chunk);
    out.push(...(rows as RowDataPacket[]));
  }
  return out;
}

/**
 * Payroll-family rows are keyed by employee: drop the caller's own, and drop rows whose employee is in another branch.
 * Org-wide callers keep everything except their own.
 */
export async function keepEmployeeRowsInBranch<T>(me: CallerScope, rows: T[], employeeIdOf: (r: T) => unknown): Promise<T[]> {
  const mine = rows.filter((r) => !isOwnEmployee(me, employeeIdOf(r)));
  if (me.orgWide) return mine;
  const branches = await io.employeeBranches(mine.map(employeeIdOf));
  return mine.filter((r) => branchAllowed(me, branches.get(String(employeeIdOf(r)))));
}
