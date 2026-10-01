import { beforeEach, describe, expect, it, vi } from "vitest";

/** Visitor (owner ruling 2026-10-01): ho_hr / hr_admin / security_head are branch-scoped, not org-wide. */
const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
const repo = await import("../visitor.repository.js");

const scope = (roles: string[], unrestricted = false) => ({ userId: "u", employeeId: "e1", branchId: "b1", roles, unrestricted });
beforeEach(() => { dbExecute.mockReset(); dbExecute.mockResolvedValue([[], []]); });

describe("visitor list scope", () => {
  it.each(["ho_hr", "hr_admin", "security_head"])("%s only lists its own branch's visits", async (role) => {
    await repo.listVisits(scope([role]) as any, { limit: 10, offset: 0 } as any);
    const [sql, params] = dbExecute.mock.calls[0];
    expect(sql).toMatch(/vv\.branch_id = \?/);
    expect(params).toContain("b1");
  });
  it("org-wide (unrestricted) callers get no branch predicate", async () => {
    await repo.listVisits(scope(["admin"], true) as any, { limit: 10, offset: 0 } as any);
    expect(dbExecute.mock.calls[0][0]).not.toMatch(/vv\.branch_id = \?/);
  });
});
