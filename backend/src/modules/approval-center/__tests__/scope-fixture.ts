import { io, type CallerScope } from "../adapters/scope-guard.js";

/**
 * Scope-test fixture: swaps the data-access seam of adapters/scope-guard.ts so a test can run an adapter as a chosen
 * person without a database. Call useScope(...) / useDirectory(...) before the adapter's list(); use a fresh ctx per person.
 */
export interface ScopeWorld {
  /** employees.id -> branch_id */
  employees?: Record<string, string | null>;
  /** auth user id -> { employeeId, branchId } (for requesters / authors who are not callers) */
  users?: Record<string, { employeeId: string; branchId: string | null }>;
  /** cost_centre_master.id -> branch_id */
  costCentres?: Record<string, string | null>;
  /** employees.id -> employees.id of the effective approver (reporting manager / skip-level) */
  approvers?: Record<string, string | null>;
}

export const ORG_WIDE: CallerScope = {
  userId: "u-caller", employeeId: "emp-ho", employeeCode: "E-HO", branchId: "b-ho", orgWide: true,
  roles: ["super_admin"],
};

export const person = (over: Partial<CallerScope>): CallerScope => ({
  userId: "u-caller", employeeId: "emp-me", employeeCode: "E-ME", branchId: "b-noi", orgWide: false, roles: [], ...over,
});

/** Every caller is the same person `me`. */
export function useScope(me: CallerScope, world: ScopeWorld = {}) {
  useDirectory({ [me.userId]: me }, world, me);
}

/** Many callers: ctx.userId picks the person. */
export function useDirectory(people: Record<string, CallerScope>, world: ScopeWorld = {}, fallback?: CallerScope) {
  io.loadCaller = async (userId) => {
    const p = people[userId] ?? fallback;
    if (!p) throw new Error(`scope fixture: unknown caller ${userId}`);
    return p;
  };
  const empBranch = new Map<string, string | null>();
  for (const p of Object.values(people)) if (p.employeeId) empBranch.set(p.employeeId, p.branchId);
  for (const [k, v] of Object.entries(world.employees ?? {})) empBranch.set(k, v);
  io.employeeBranches = async (ids) => {
    const m = new Map<string, string | null>();
    for (const id of ids) if (id !== null && id !== undefined && empBranch.has(String(id))) m.set(String(id), empBranch.get(String(id))!);
    return m;
  };
  const userEmp = new Map<string, { employeeId: string; branchId: string | null }>();
  for (const [uid, p] of Object.entries(people)) if (p.employeeId) userEmp.set(uid, { employeeId: p.employeeId, branchId: p.branchId });
  for (const [k, v] of Object.entries(world.users ?? {})) userEmp.set(k, v);
  io.userEmployees = async (ids) => {
    const m = new Map<string, { employeeId: string; branchId: string | null }>();
    for (const id of ids) if (userEmp.has(String(id))) m.set(String(id), userEmp.get(String(id))!);
    return m;
  };
  io.costCentreBranches = async (ids) => {
    const m = new Map<string, string | null>();
    for (const id of ids) if (String(id) in (world.costCentres ?? {})) m.set(String(id), world.costCentres![String(id)]);
    return m;
  };
  io.effectiveApproverEmployeeId = async (employeeId) => world.approvers?.[employeeId] ?? null;
}
