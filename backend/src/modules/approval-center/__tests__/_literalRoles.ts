/**
 * Stand-in for adapters/_roles.js in mapping tests that have no database: the literal role keys the caller holds are whatever
 * the test sets in `heldRoles.list`. (Role designation is covered end to end in scope.*.test.ts against a fake user_roles table.)
 */
export const heldRoles = { list: [] as string[] };
export const rolesModule = {
  callerRoleKeys: async () => heldRoles.list,
  callerHasRole: async (_u: string, ...allowed: string[]) => allowed.some((r) => heldRoles.list.includes(r)),
};
