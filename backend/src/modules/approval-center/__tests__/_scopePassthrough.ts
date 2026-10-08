/**
 * Pass-through stand-in for adapters/_scope.js, used by the mapping/decide tests that are not about branch policy
 * (they have no database). Branch / approver behaviour is covered by scope.adapters.test.ts against a fake database.
 */
export const passthrough = {
  callerScope: async () => ({ userId: "u", orgWide: true, employeeId: null, ownBranchId: null, allows: () => true }),
  employeeBranchMaps: async () => ({ byId: new Map(), byCode: new Map() }),
  keepInBranch: async (_u: string, rows: unknown[]) => rows,
  keepInBranchByKey: async (_u: string, rows: unknown[]) => rows,
  keepCandidatesInBranch: async (_u: string, rows: unknown[]) => rows,
  keepEffectiveApprover: async (_u: string, rows: unknown[]) => rows,
  keepApproverOrBranchRole: async (_u: string, rows: unknown[]) => rows,
  keepWorkItemsForCaller: async (_u: string, rows: unknown[]) => rows,
  dropOwn: async (_u: string, rows: unknown[]) => rows,
};
