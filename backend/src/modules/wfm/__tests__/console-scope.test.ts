import { describe, it, expect, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/enterpriseScope.js", () => ({ resolveUserBusinessScope: vi.fn() }));

import { allowedBranchIds, assignedProcessIds, canAccessTarget, decideConsoleScope, isOrgWide } from "../console-scope.js";
import type { UserBusinessScope } from "../../../shared/enterpriseScope.js";

const B1 = "11111111-1111-1111-1111-111111111111";
const B2 = "22222222-2222-2222-2222-222222222222";
const P1 = "aaaaaaaa-0000-0000-0000-000000000001"; // belongs to B1
const P2 = "aaaaaaaa-0000-0000-0000-000000000002"; // belongs to B2
const PROCESS_BRANCH: Record<string, string> = { [P1]: B1, [P2]: B2 };
const lookup = async (id: string) => ({ exists: id in PROCESS_BRANCH, branchId: PROCESS_BRANCH[id] ?? null });

const scope = (o: Partial<UserBusinessScope>): UserBusinessScope => ({
  userId: "u", roles: [], employeeId: "e", employeeCode: "C", branchId: null, processId: null, lobId: null, departmentId: null,
  isSuperAdmin: false, isAdmin: false, isHr: false, isPayroll: false, isFinance: false, assignments: [], ...o,
});
const asked = (branchId = "", processId = "") => ({ branchId, processId });

describe("org-wide roles", () => {
  it.each(["super_admin", "ceo", "coo", "cfo", "finance"])("%s is unrestricted", async (role) => {
    const s = scope({ roles: [role] });
    expect(isOrgWide(s)).toBe(true);
    expect(allowedBranchIds(s)).toBeNull();
    expect(await decideConsoleScope(s, asked(B2), lookup)).toEqual({ ok: true, inject: {} });
    expect(await decideConsoleScope(s, asked(), lookup)).toEqual({ ok: true, inject: {} });
  });
  it("admin and wfm are NOT org-wide (owner ruling 2026-10-01)", () => {
    expect(isOrgWide(scope({ roles: ["admin"] }))).toBe(false);
    expect(isOrgWide(scope({ roles: ["wfm"] }))).toBe(false);
  });
});

describe("branch-level role (own branch)", () => {
  const s = scope({ roles: ["branch_head"], branchId: B1 });
  it("may name their own branch", async () => expect(await decideConsoleScope(s, asked(B1), lookup)).toEqual({ ok: true, inject: {} }));
  it("may NOT name another branch (the cross-branch read this fixes)", async () => {
    expect(await decideConsoleScope(s, asked(B2), lookup)).toMatchObject({ ok: false, status: 403 });
  });
  it("naming nothing is narrowed to their own branch", async () => {
    expect(await decideConsoleScope(s, asked(), lookup)).toEqual({ ok: true, inject: { branchId: B1 } });
  });
  it("may name a process in their branch, not one in another branch", async () => {
    expect(await decideConsoleScope(s, asked("", P1), lookup)).toEqual({ ok: true, inject: {} });
    expect(await decideConsoleScope(s, asked("", P2), lookup)).toMatchObject({ ok: false, status: 403 });
  });
  it("a process must belong to the branch they named", async () => {
    const two = scope({ roles: ["hr"], branchId: B1, assignments: [{ roleKey: "hr", scopeType: "branch", branchId: B2, processId: null, lobId: null, departmentId: null, managerEmployeeId: null, clientId: null }] });
    expect(await decideConsoleScope(two, asked(B1, P2), lookup)).toMatchObject({ ok: false, status: 403 });
    expect(await decideConsoleScope(two, asked(B2, P2), lookup)).toEqual({ ok: true, inject: {} });
  });
  it("an unknown process id is refused, not trusted", async () => {
    expect(await decideConsoleScope(s, asked("", "ffffffff-0000-0000-0000-000000000000"), lookup)).toMatchObject({ ok: false, status: 403 });
  });
});

describe("admin without an org-wide role", () => {
  it("is limited to their own branch like HR", async () => {
    const s = scope({ roles: ["admin"], branchId: B1 });
    expect(await decideConsoleScope(s, asked(B2), lookup)).toMatchObject({ ok: false, status: 403 });
    expect(await decideConsoleScope(s, asked(), lookup)).toEqual({ ok: true, inject: { branchId: B1 } });
  });
});

describe("assigned scope", () => {
  const asg = (scopeType: string, branchId: string | null, processId: string | null = null) =>
    ({ roleKey: "hr", scopeType, branchId, processId, lobId: null, departmentId: null, managerEmployeeId: null, clientId: null });
  it("several assigned branches: must pick one, and may pick any of them", async () => {
    const s = scope({ roles: ["hr"], branchId: B1, assignments: [asg("branch", B1), asg("branch", B2)] });
    expect(await decideConsoleScope(s, asked(), lookup)).toMatchObject({ ok: false, status: 400 });
    expect(await decideConsoleScope(s, asked(B2), lookup)).toEqual({ ok: true, inject: {} });
  });
  it("scope_type 'all' means everything in the OWN branch, never the company", async () => {
    const s = scope({ roles: ["hr"], branchId: B1, assignments: [asg("all", null)] });
    expect(allowedBranchIds(s)).toEqual([B1]);
    expect(await decideConsoleScope(s, asked(B2), lookup)).toMatchObject({ ok: false, status: 403 });
  });
  it("process-level role: own process only, injected when nothing is named", async () => {
    const s = scope({ roles: ["process_manager"], branchId: B1, processId: P1 });
    expect(assignedProcessIds(s)).toEqual([P1]);
    expect(await decideConsoleScope(s, asked("", P1), lookup)).toEqual({ ok: true, inject: {} });
    expect(await decideConsoleScope(s, asked("", P2), lookup)).toMatchObject({ ok: false, status: 403 });
    expect(await decideConsoleScope(s, asked(), lookup)).toEqual({ ok: true, inject: { processId: P1 } });
  });
  it("a process assignment in another branch is reachable through its branch", async () => {
    const s = scope({ roles: ["manager"], branchId: B1, assignments: [asg("process", null, P2)] });
    expect(await decideConsoleScope(s, asked(B2, P2), lookup)).toEqual({ ok: true, inject: {} });
  });
  it("no branch and no process assigned: refused", async () => {
    expect(await decideConsoleScope(scope({ roles: ["hr"] }), asked(), lookup)).toMatchObject({ ok: false, status: 403 });
  });
  it("entity routes skip the 'select a branch' demand but still validate what is named", async () => {
    const s = scope({ roles: ["hr"], branchId: B1, assignments: [asg("branch", B1), asg("branch", B2)] });
    expect(await decideConsoleScope(s, asked(), lookup, false)).toEqual({ ok: true, inject: {} });
    expect(await decideConsoleScope(scope({ roles: ["branch_head"], branchId: B1 }), asked(B2), lookup, false)).toMatchObject({ ok: false, status: 403 });
  });
});

describe("canAccessTarget (by-id rows)", () => {
  const s = scope({ roles: ["branch_head"], branchId: B1 });
  it("allows a row in the caller's branch, refuses another branch's", async () => {
    expect(await canAccessTarget(s, { branchId: B1 })).toBe(true);
    expect(await canAccessTarget(s, { branchId: B2 })).toBe(false);
  });
  it("a row with no branch / process is not visible to a scoped user", async () => {
    expect(await canAccessTarget(s, {})).toBe(false);
  });
  it("an org-wide role sees every row", async () => {
    expect(await canAccessTarget(scope({ roles: ["ceo"] }), { branchId: B2 })).toBe(true);
  });
});
