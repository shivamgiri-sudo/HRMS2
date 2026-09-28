import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute, query: dbExecute } }));

const { costCentreService } = await import("../org.service.js");

function listQuery() {
  const call = dbExecute.mock.calls.find(([sql]) => /FROM cost_centre_master cc/i.test(String(sql)));
  return { sql: String(call?.[0] ?? ""), params: (call?.[1] ?? []) as unknown[] };
}

beforeEach(() => {
  dbExecute.mockReset();
  dbExecute.mockResolvedValue([[], []]);
});

describe("Org Masters cost centres are branch-scoped", () => {
  it("applies no branch filter for an all-branch caller (branchIds undefined)", async () => {
    await costCentreService.list({});
    expect(listQuery().sql).not.toMatch(/cc\.branch_id IN/);
  });

  it("restricts a scoped caller to the branches they are entitled to", async () => {
    await costCentreService.list({ branchIds: ["b1", "b2"] });
    const { sql, params } = listQuery();
    expect(sql).toMatch(/cc\.branch_id IN \(\?,\?\)/);
    expect(params).toEqual(expect.arrayContaining(["b1", "b2"]));
  });

  it("an EMPTY entitlement returns nothing, never 'no filter'", async () => {
    await costCentreService.list({ branchIds: [] });
    expect(listQuery().sql).toMatch(/1=0/);
  });

  it("a requested branch outside the entitlement can only narrow, never widen", async () => {
    await costCentreService.list({ branchIds: ["b1"], branch_id: "b9" });
    const { sql } = listQuery();
    expect(sql).toMatch(/cc\.branch_id = \?/);
    expect(sql).toMatch(/cc\.branch_id IN \(\?\)/);
  });
});
