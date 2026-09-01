import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Group E fix: a GRN split across more than one cost centre has its own grn_request.cost_centre_id
 * set to NULL by grn-smart.service.ts (saveAllocations/saveComponentAllocations) — the real
 * per-cost-centre truth lives in grn_cost_allocation, correctly populated per split. Before this
 * fix, listGrns()'s plain `g.cost_centre_id = ?` filter made such a GRN invisible to the Branch
 * Budget drill-down for every cost centre it actually touches, even though
 * budget-cost-centre-utilization.service.ts (the "Consumed" figure) already reads
 * grn_cost_allocation directly. See [[hrms2-grn-cost-allocation-budget-blind-spot]].
 *
 * Also covers the `excludeDraft` opt-in filter added for the same drill-down (item 14).
 */

const { execute, query } = vi.hoisted(() => ({ execute: vi.fn(), query: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query } }));

// Same import-cost note as grn-multi-branch-list.test.ts: pay the transitive-import cost once.
let grnService: typeof import("../grn.service.js")["grnService"];
beforeAll(async () => {
  ({ grnService } = await import("../grn.service.js"));
}, 120_000);

beforeEach(() => {
  execute.mockReset();
  query.mockReset();
  execute.mockResolvedValue([[], []]);
  query.mockResolvedValue([[], []]);
});

function callWith(fragment: string) {
  const calls = [...query.mock.calls, ...execute.mock.calls];
  const hit = calls.find(([sql]) => String(sql).includes(fragment));
  if (!hit) {
    throw new Error(
      `no query containing ${fragment}\n${calls.map(([s]) => String(s).slice(0, 120)).join("\n")}`,
    );
  }
  return { sql: String(hit[0]), params: (hit[1] ?? []) as unknown[] };
}

describe("grnService.listGrns — cost centre filter matches split-GRN allocations", () => {
  it("OR-matches grn_cost_allocation for the same cost centre, bound twice", async () => {
    await grnService.listGrns({ costCentreId: "cc-noida-2-ops" });
    const { sql, params } = callWith("FROM grn_request");
    expect(sql).toContain("g.cost_centre_id = ?");
    expect(sql).toContain("EXISTS (");
    expect(sql).toContain("FROM grn_cost_allocation gca");
    expect(sql).toContain("gca.grn_request_id = g.id");
    expect(sql).toContain("gca.cost_centre_id = ?");
    expect(sql).toContain("gca.lifecycle_status IN ('reserved', 'consumed')");
    // Bound three times: the header column, the allocation EXISTS clause, and the split-share
    // ctx_alloc subquery (this drill-down's own-cost-centre-share join, added alongside this
    // same fix so the row list shows a split GRN's share here rather than its full header total).
    expect(params.filter((p) => p === "cc-noida-2-ops")).toHaveLength(3);
  });

  it("also applies the OR-matched filter to the COUNT query", async () => {
    await grnService.listGrns({ costCentreId: "cc-noida-2-ops" });
    const { sql, params } = callWith("SELECT COUNT(*)");
    expect(sql).toContain("EXISTS (");
    expect(params.filter((p) => p === "cc-noida-2-ops")).toHaveLength(2);
  });

  it("does not touch the cost-centre condition when no costCentreId is given", async () => {
    await grnService.listGrns({});
    const { sql } = callWith("FROM grn_request");
    expect(sql).not.toContain("grn_cost_allocation");
  });

  it("joins this cost centre's split share, further narrowed by head/subHead when given", async () => {
    // A GRN split across cost centres/heads keeps one header row but several allocation rows —
    // without this join the row list shows every split GRN's FULL header amount on every cost
    // centre it touches, instead of just this drill-down's own share.
    await grnService.listGrns({ costCentreId: "cc-noida-2-ops", head: "Rent", subHead: "Office" });
    const { sql, params } = callWith("FROM grn_request");
    expect(sql).toContain("LEFT JOIN (");
    expect(sql).toContain("ctx_alloc.amount_with_tax AS context_amount_with_tax");
    expect(sql).toContain("ctx_alloc.pnl_cost_amount AS context_pnl_cost_amount");
    expect(sql).toContain("ON ctx_alloc.grn_request_id = g.id");
    expect(sql).toContain("AND bl.head = ?");
    expect(sql).toContain("AND bl.sub_head = ?");
    // Join params (cost centre, head, sub-head) come before the header WHERE's own bindings.
    expect(params.slice(0, 3)).toEqual(["cc-noida-2-ops", "Rent", "Office"]);
  });

  it("omits the head/sub-head narrowing from the join when they are not given", async () => {
    await grnService.listGrns({ costCentreId: "cc-noida-2-ops" });
    const { sql, params } = callWith("FROM grn_request");
    expect(sql).toContain("LEFT JOIN (");
    expect(sql).not.toContain("AND bl.head = ?");
    expect(sql).not.toContain("AND bl.sub_head = ?");
    expect(params[0]).toBe("cc-noida-2-ops");
  });
});

describe("grnService.listGrns — excludeDraft opt-in", () => {
  it("adds a status <> 'draft' condition when excludeDraft is true", async () => {
    await grnService.listGrns({ excludeDraft: true });
    const { sql } = callWith("FROM grn_request");
    expect(sql).toContain("g.status <> 'draft'");
  });

  it("does not add the condition by default, so existing callers keep seeing drafts", async () => {
    await grnService.listGrns({});
    const { sql } = callWith("FROM grn_request");
    expect(sql).not.toContain("g.status <> 'draft'");
  });

  it("does not add the condition when excludeDraft is explicitly false", async () => {
    await grnService.listGrns({ excludeDraft: false });
    const { sql } = callWith("FROM grn_request");
    expect(sql).not.toContain("g.status <> 'draft'");
  });
});
