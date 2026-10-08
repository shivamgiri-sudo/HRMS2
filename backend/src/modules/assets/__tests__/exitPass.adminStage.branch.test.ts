import { beforeEach, describe, expect, it, vi } from "vitest";

/** Exit-pass admin stage (owner policy 2026-10-01): super_admin / it_head global; admin only for the branch of its own employee record. */
const { dbExecute, conn } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  conn: { beginTransaction: vi.fn(), execute: vi.fn(async () => [[], []]), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() },
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute, getConnection: vi.fn(async () => conn) } }));
const svc = await import("../exit-pass.service.js");

const actor = (branchId: string | null) => ({ employeeId: "e-admin", branchId, fullName: "A" });
beforeEach(() => {
  dbExecute.mockReset(); conn.execute.mockClear(); conn.commit.mockClear();
  dbExecute.mockResolvedValue([[{ id: "p1", status: "pending_admin_approval", branch_id: "br-A", requestor_employee_id: "e-req" }], []]);
});

describe("adminDecision", () => {
  const decide = (roles: string[], branchId: string | null) => svc.adminDecision("p1", actor(branchId), roles, "rejected", "no");
  it("admin of another branch is refused (403)", async () => {
    await expect(decide(["admin"], "br-B")).rejects.toMatchObject({ statusCode: 403 });
    expect(conn.commit).not.toHaveBeenCalled();
  });
  it("admin with no branch fails closed", async () => {
    await expect(decide(["admin"], null)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("admin of the same branch is allowed", async () => {
    await decide(["admin"], "br-A");
    expect(conn.commit).toHaveBeenCalled();
  });
  it("super_admin and it_head stay global", async () => {
    await decide(["super_admin"], "br-B");
    await decide(["it_head"], "br-C");
    expect(conn.commit).toHaveBeenCalledTimes(2);
  });
  it("branch_admin of the same branch still works, other branch refused", async () => {
    await decide(["branch_admin"], "br-A");
    await expect(decide(["branch_admin"], "br-B")).rejects.toMatchObject({ statusCode: 403 });
  });
  it("the requestor cannot decide their own pass", async () => {
    dbExecute.mockResolvedValue([[{ id: "p1", status: "pending_admin_approval", branch_id: "br-A", requestor_employee_id: "e-admin" }], []]);
    await expect(decide(["super_admin"], "br-A")).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("listPendingAdmin", () => {
  beforeEach(() => dbExecute.mockResolvedValue([[{ id: "p1" }], []]));
  it("admin is limited to own branch via SQL; super_admin is unfiltered", async () => {
    await svc.listPendingAdmin(actor("br-A"), ["admin"]);
    expect(String(dbExecute.mock.calls[0][0])).toMatch(/epr\.branch_id = \?/);
    expect(dbExecute.mock.calls[0][1]).toEqual(["br-A"]);
    dbExecute.mockClear();
    await svc.listPendingAdmin(actor("br-A"), ["super_admin"]);
    expect(String(dbExecute.mock.calls[0][0])).not.toMatch(/epr\.branch_id = \?/);
  });
  it("admin with no branch sees nothing", async () => {
    expect(await svc.listPendingAdmin(actor(null), ["admin"])).toEqual([]);
  });
});
