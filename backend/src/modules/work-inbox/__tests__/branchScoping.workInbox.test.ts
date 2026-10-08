import { beforeEach, describe, expect, it, vi } from "vitest";

/** Work inbox (owner ruling 2026-10-01): branch roles act on / read only their own branch's work items. */
const { dbExecute, state, canViewEmployee } = vi.hoisted(() => ({
  dbExecute: vi.fn(), canViewEmployee: vi.fn(),
  state: { roleKeys: ["branch_head"] as string[], orgWide: false, branchIds: ["b1"] as string[], item: {} as any },
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../shared/roleResolver.js", () => ({ getUserRoleContext: async () => ({ roleKeys: state.roleKeys, primaryRole: state.roleKeys[0] }) }));
vi.mock("../../../shared/enterpriseScope.js", () => ({ canViewEmployee }));
vi.mock("../../org/branchScope.js", () => ({
  resolveCallerBranchScope: async () => ({ orgWide: state.orgWide, branchIds: state.branchIds }),
  branchAllowed: (s: any, b: string) => s.orgWide || s.branchIds.includes(b),
}));

const svc = await import("../work-inbox.service.js");

beforeEach(() => {
  dbExecute.mockReset(); canViewEmployee.mockReset();
  state.roleKeys = ["branch_head"]; state.orgWide = false; state.branchIds = ["b1"];
  state.item = { assigned_to_user_id: "someone", assigned_to_role: "hr", status: "pending", branch_id: "b2", entity_type: null, entity_id: null };
  dbExecute.mockImplementation(async () => [[state.item], []]);
});

describe("assertWorkItemAccess", () => {
  it("a branch head cannot act on another branch's item (was: any item)", async () => {
    await expect(svc.assertWorkItemAccess("u1", "w1", "complete")).rejects.toMatchObject({ statusCode: 403 });
  });
  it("a branch head acts on an item of its own branch", async () => {
    state.item.branch_id = "b1";
    await expect(svc.assertWorkItemAccess("u1", "w1", "complete")).resolves.toBeUndefined();
  });
  it("an item with no branch fails closed for a branch role, unless it is about a visible employee", async () => {
    state.item.branch_id = null;
    await expect(svc.assertWorkItemAccess("u1", "w1", "escalate")).rejects.toMatchObject({ statusCode: 403 });
    state.item.entity_type = "employee"; state.item.entity_id = "emp-1";
    canViewEmployee.mockResolvedValue(true);
    await expect(svc.assertWorkItemAccess("u1", "w1", "escalate")).resolves.toBeUndefined();
  });
  it("the assignee keeps working on their own item; an org-wide role stays unconditional", async () => {
    state.item.assigned_to_user_id = "u1"; state.roleKeys = ["employee"];
    await expect(svc.assertWorkItemAccess("u1", "w1", "complete")).resolves.toBeUndefined();
    state.item.assigned_to_user_id = "x"; state.roleKeys = ["super_admin"]; state.orgWide = true;
    await expect(svc.assertWorkItemAccess("u1", "w1", "complete")).resolves.toBeUndefined();
  });
  it("a plain employee who is not the assignee is refused", async () => {
    state.roleKeys = ["employee"];
    await expect(svc.assertWorkItemAccess("u1", "w1", "complete")).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("assertWorkItemReadAccess (awol-context / priority)", () => {
  it("refuses a user with no relation to the item, and a hr in another branch", async () => {
    state.roleKeys = ["employee"];
    await expect(svc.assertWorkItemReadAccess("u1", "w1")).rejects.toMatchObject({ statusCode: 403 });
    state.roleKeys = ["hr"];
    await expect(svc.assertWorkItemReadAccess("u1", "w1")).rejects.toMatchObject({ statusCode: 403 });
  });
  it("allows hr for an item of its own branch and the assignee", async () => {
    state.roleKeys = ["hr"]; state.item.branch_id = "b1";
    await expect(svc.assertWorkItemReadAccess("u1", "w1")).resolves.toBeUndefined();
    state.roleKeys = ["employee"]; state.item.assigned_to_user_id = "u1"; state.item.branch_id = "b9";
    await expect(svc.assertWorkItemReadAccess("u1", "w1")).resolves.toBeUndefined();
  });
});

describe("derived pending-leave rows", () => {
  it("scope the HR fallback to own / assigned branches unless the caller is org-wide", async () => {
    dbExecute.mockReset(); dbExecute.mockResolvedValue([[], []]);
    await svc.getDerivedRegistryItems("u1", "hr", ["hr"]);
    let [sql, params] = dbExecute.mock.calls[0];
    expect(sql).toMatch(/e\.branch_id IN \(SELECT vb\.branch_id FROM employees vb/);
    expect(params.slice(0, 5)).toEqual(["u1", "hr", 0, "u1", "u1"]);
    dbExecute.mockClear();
    // admin is branch-scoped like hr since 2026-10-01 (not in ORG_WIDE_EXEMPT_ROLES) ...
    await svc.getDerivedRegistryItems("u1", "admin", ["admin"]);
    [, params] = dbExecute.mock.calls[0];
    expect(params.slice(0, 5)).toEqual(["u1", "admin", 0, "u1", "u1"]);
    dbExecute.mockClear();
    // ... while an org-wide role keeps the company-wide view.
    await svc.getDerivedRegistryItems("u1", "super_admin", ["super_admin"]);
    [, params] = dbExecute.mock.calls[0];
    expect(params.slice(0, 5)).toEqual(["u1", "super_admin", 1, "u1", "u1"]);
  });
});
