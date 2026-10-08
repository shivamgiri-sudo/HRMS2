/**
 * Test double for ../payroll-branch-scope.js that behaves like an ORG-WIDE caller (nothing is
 * restricted). Older route tests were written before branch scoping existed; they only need the
 * scope layer out of the way. Branch scoping itself is covered by branchScoping.payroll.test.ts.
 */
const open = { sql: "1=1", params: [] as unknown[] };
export const orgWideScopeMock = {
  OUT_OF_SCOPE_MESSAGE: "Forbidden",
  OUT_OF_SCOPE_BODY: { success: false, error: "Forbidden", message: "Forbidden" },
  employeeScopeFor: async () => open,
  scopeFor: async () => open,
  isOrgWideCaller: async () => true,
  canSeeEmployee: async () => true,
  guardEmployee: async () => true,
  filterVisibleEmployeeIds: async (_r: unknown, ids: string[]) => new Set(ids),
  visibleBranchIdsFor: async () => null,
  visibleBranchIdsForUser: async () => null,
  narrowBranch: async (_r: unknown, requested?: string) => ({ ok: true, branchIds: requested ? [requested] : null }),
  canSeeRun: async () => true,
  requireRunInScope: () => (_q: unknown, _s: unknown, next: () => void) => next(),
  guardOwnedRow: async () => true,
  controlTowerScope: async () => ({ scopeSql: "1=1", scopeParams: [] }),
  employeeIdsForGapKeys: async (k: string[]) => k.map(() => null),
  guardGapKeys: async () => true,
  branchInScopeSql: async () => open,
  employeeCodeScopeSql: async () => open,
};
