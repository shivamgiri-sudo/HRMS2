import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import { isOrgWideUser } from "../../../shared/scopeAccess.js";
import { getEmployeeForUser } from "../../../shared/accessGuard.js";
import { resolveEffectiveApprover } from "../../../shared/approvalEscalation.js";
import { callerHasRole } from "./_roles.js";

/**
 * Approval Center row-level scope. The popup must show a request ONLY to the person responsible for deciding it.
 * Owner policy (rulings 2026-10-01): everyone is limited to the branch on their OWN employees record, assignment rows may
 * narrow but never widen, and only isOrgWideUser() people (super_admin, ceo, coo, cfo, payroll_head, finance_head,
 * accounts_head, finance, department heads) see every branch. admin / hr / branch_head / managers are BRANCH-scoped.
 * Fail closed: a branch-clamped caller with no branch on their record, or a row whose branch cannot be resolved, sees nothing.
 */
export interface CallerScope {
  userId: string;
  orgWide: boolean;
  employeeId: string | null;
  ownBranchId: string | null;
  /** True when a row living in `branchId` is inside the caller's branch policy. */
  allows(branchId: string | null | undefined): boolean;
}

export async function callerScope(userId: string): Promise<CallerScope> {
  const orgWide = await isOrgWideUser(userId);
  const emp = await getEmployeeForUser(userId);
  let ownBranchId: string | null = null;
  if (emp?.id) {
    const [rows] = await db.execute<RowDataPacket[]>("SELECT branch_id FROM employees WHERE id = ? LIMIT 1", [emp.id]);
    const b = (rows as RowDataPacket[])[0]?.branch_id;
    ownBranchId = b ? String(b) : null;
  }
  return {
    userId,
    orgWide,
    employeeId: emp?.id ? String(emp.id) : null,
    ownBranchId,
    allows: (branchId) => orgWide || (!!ownBranchId && !!branchId && String(branchId) === ownBranchId),
  };
}

export interface EmpRef {
  /** employees.id */
  employeeId?: unknown;
  /** employees.employee_code */
  employeeCode?: unknown;
  /** Branch id if the module's own row already carries it. */
  branchId?: unknown;
}

const nz = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());

/** employee id / code -> employees.branch_id, one query for a whole page of rows. */
export async function employeeBranchMaps(refs: EmpRef[]): Promise<{ byId: Map<string, string | null>; byCode: Map<string, string | null> }> {
  const ids = [...new Set(refs.filter((r) => !nz(r.branchId) && nz(r.employeeId)).map((r) => nz(r.employeeId)))];
  const codes = [...new Set(refs.filter((r) => !nz(r.branchId) && !nz(r.employeeId) && nz(r.employeeCode)).map((r) => nz(r.employeeCode)))];
  const byId = new Map<string, string | null>();
  const byCode = new Map<string, string | null>();
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT id, branch_id FROM employees WHERE id IN (${part.map(() => "?").join(",")})`, part);
    for (const r of rows as RowDataPacket[]) byId.set(String(r.id), r.branch_id ? String(r.branch_id) : null);
  }
  for (let i = 0; i < codes.length; i += CHUNK) {
    const part = codes.slice(i, i + CHUNK);
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT employee_code, branch_id FROM employees WHERE employee_code IN (${part.map(() => "?").join(",")})`, part);
    for (const r of rows as RowDataPacket[]) byCode.set(String(r.employee_code), r.branch_id ? String(r.branch_id) : null);
  }
  return { byId, byCode };
}

/**
 * Keep rows whose employee sits inside the caller's branch policy (org-wide callers keep everything).
 * `pick` returns however the row identifies its employee/branch; unresolvable rows are dropped for clamped callers.
 */
export async function keepInBranch<T>(userId: string, rows: T[], pick: (r: T) => EmpRef, scope?: CallerScope): Promise<T[]> {
  // Nobody decides a request about their own employee record (maker-checker), org-wide callers included.
  rows = await dropOwn(userId, rows, pick);
  if (rows.length === 0) return rows;
  const s = scope ?? (await callerScope(userId));
  if (s.orgWide) return rows;
  if (!s.ownBranchId) return [];
  const refs = rows.map(pick);
  const { byId, byCode } = await employeeBranchMaps(refs);
  return rows.filter((_, i) => {
    const ref = refs[i];
    const branch = nz(ref.branchId) || (nz(ref.employeeId) ? byId.get(nz(ref.employeeId)) : byCode.get(nz(ref.employeeCode)));
    return s.allows(branch ?? null);
  });
}

/** Keep rows where the caller is the employee's effective approver (reporting manager, or skip-level while the manager is on leave). */
export async function keepEffectiveApprover<T>(userId: string, rows: T[], employeeIdOf: (r: T) => unknown, scope?: CallerScope): Promise<T[]> {
  if (rows.length === 0) return rows;
  const s = scope ?? (await callerScope(userId));
  if (!s.employeeId) return [];
  const cache = new Map<string, Promise<string | null>>();
  const keep = await Promise.all(
    rows.map(async (r) => {
      const eid = nz(employeeIdOf(r));
      if (!eid) return false;
      let p = cache.get(eid);
      if (!p) {
        p = resolveEffectiveApprover(eid).then((a) => a.approverId ?? null);
        cache.set(eid, p);
      }
      return (await p) === s.employeeId;
    }),
  );
  return rows.filter((_, i) => keep[i]);
}

/** Drop rows about the caller's own employee record (no self-approval), by id or code. */
export async function dropOwn<T>(userId: string, rows: T[], pick: (r: T) => EmpRef): Promise<T[]> {
  const emp = await getEmployeeForUser(userId);
  if (!emp?.id) return rows;
  return rows.filter((r) => {
    const p = pick(r);
    if (nz(p.employeeId) && nz(p.employeeId) === String(emp.id)) return false;
    if (nz(p.employeeCode) && nz(p.employeeCode) === String(emp.employee_code)) return false;
    return true;
  });
}

/**
 * Two-way gate for stages the reporting manager normally owns but a branch role may also decide:
 *   - the employee's EFFECTIVE APPROVER (reporting manager / skip-level on leave) sees it wherever the employee sits;
 *   - a caller holding one of `fallbackRoles` sees it only if the employee is in the caller's OWN branch;
 *   - org-wide callers see everything; everyone else (e.g. a manager who is not this employee's approver) sees nothing.
 */
export async function keepApproverOrBranchRole<T>(
  userId: string,
  rows: T[],
  pick: (r: T) => EmpRef & { employeeId?: unknown },
  fallbackRoles: string[],
): Promise<T[]> {
  rows = await dropOwn(userId, rows, pick);
  if (rows.length === 0) return rows;
  const scope = await callerScope(userId);
  if (scope.orgWide) return rows;
  const refs = rows.map(pick);
  // Rows that only carry an employee code are resolved to ids first so the approver check can run.
  const needId = refs.filter((r) => !nz(r.employeeId) && nz(r.employeeCode));
  const codeToId = new Map<string, string>();
  if (needId.length) {
    const codes = [...new Set(needId.map((r) => nz(r.employeeCode)))];
    const [rs] = await db.execute<RowDataPacket[]>(`SELECT id, employee_code FROM employees WHERE employee_code IN (${codes.map(() => "?").join(",")})`, codes);
    for (const r of rs as RowDataPacket[]) codeToId.set(String(r.employee_code), String(r.id));
  }
  const idOf = (r: EmpRef) => nz(r.employeeId) || codeToId.get(nz(r.employeeCode)) || "";
  const approverIdx = new Set<number>();
  (await keepEffectiveApprover(userId, rows.map((_, i) => i), (i) => idOf(refs[i]), scope)).forEach((i) => approverIdx.add(i));
  const mayFallback = scope.ownBranchId ? await callerHasRole(userId, ...fallbackRoles) : false;
  const inBranch = new Set<number>();
  if (mayFallback) {
    const idx = rows.map((_, i) => i);
    (await keepInBranch(userId, idx, (i) => ({ ...refs[i], employeeId: idOf(refs[i]) || undefined }), scope)).forEach((i) => inBranch.add(i));
  }
  return rows.filter((_, i) => approverIdx.has(i) || inBranch.has(i));
}

/**
 * Like keepInBranch, for rows that carry a branch only as a free key (branch_master id, branch_name or branch_code), e.g. the
 * legacy ATS tables. Unknown keys are dropped for clamped callers.
 */
export async function keepInBranchByKey<T>(userId: string, rows: T[], keyOf: (r: T) => unknown, scope?: CallerScope): Promise<T[]> {
  if (rows.length === 0) return rows;
  const s = scope ?? (await callerScope(userId));
  if (s.orgWide) return rows;
  if (!s.ownBranchId) return [];
  const keys = [...new Set(rows.map((r) => nz(keyOf(r))).filter(Boolean))];
  const resolved = new Map<string, string>();
  if (keys.length) {
    const ph = keys.map(() => "?").join(",");
    const [bs] = await db.execute<RowDataPacket[]>(
      `SELECT id, branch_name, branch_code FROM branch_master WHERE id IN (${ph}) OR branch_name IN (${ph}) OR branch_code IN (${ph})`,
      [...keys, ...keys, ...keys],
    );
    for (const b of bs as RowDataPacket[]) {
      for (const k of [b.id, b.branch_name, b.branch_code]) if (nz(k)) resolved.set(nz(k), String(b.id));
    }
  }
  return rows.filter((r) => s.allows(resolved.get(nz(keyOf(r))) ?? null));
}

/**
 * work_item rows from GET /api/work-inbox/my are matched by user id OR by ROLE QUEUE (every holder of the role, in every
 * branch). Keep a row only if it is assigned to the caller personally, or it is an unassigned role-queue item filed under a
 * branch the caller is allowed to act in (org-wide callers: any). Unknown items are dropped (fail closed).
 */
export async function keepWorkItemsForCaller<T>(userId: string, rows: T[], idOf: (r: T) => unknown, scope?: CallerScope): Promise<T[]> {
  if (rows.length === 0) return rows;
  const s = scope ?? (await callerScope(userId));
  const ids = [...new Set(rows.map((r) => nz(idOf(r))).filter(Boolean))];
  if (ids.length === 0) return [];
  const [rs] = await db.execute<RowDataPacket[]>(
    `SELECT id, assigned_to_user_id, branch_id FROM work_item WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
  const byId = new Map<string, { assignee: string; branch: string | null }>();
  for (const r of rs as RowDataPacket[]) byId.set(String(r.id), { assignee: nz(r.assigned_to_user_id), branch: r.branch_id ? String(r.branch_id) : null });
  return rows.filter((r) => {
    const w = byId.get(nz(idOf(r)));
    if (!w) return false;
    if (w.assignee) return w.assignee === userId;
    return s.allows(w.branch);
  });
}

/** BGV / ATS rows keyed by candidate: the candidate's branch is ats_candidate.applied_for_branch (id or name), falling back to branch_display_name. */
export async function keepCandidatesInBranch<T>(userId: string, rows: T[], candidateIdOf: (r: T) => unknown, scope?: CallerScope): Promise<T[]> {
  if (rows.length === 0) return rows;
  const s = scope ?? (await callerScope(userId));
  if (s.orgWide) return rows;
  const ids = [...new Set(rows.map((r) => nz(candidateIdOf(r))).filter(Boolean))];
  const keyById = new Map<string, string>();
  if (ids.length) {
    const [rs] = await db.execute<RowDataPacket[]>(
      `SELECT id, COALESCE(NULLIF(applied_for_branch, ''), branch_display_name) AS branch_key FROM ats_candidate WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    for (const r of rs as RowDataPacket[]) keyById.set(String(r.id), nz(r.branch_key));
  }
  return keepInBranchByKey(userId, rows, (r) => keyById.get(nz(candidateIdOf(r))), s);
}
