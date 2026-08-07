import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The GRN list and summary must filter to a user's whole branch set, not one branch.
 *
 * These assert the SQL that actually reaches mysql2, because that is where the guarantee
 * lives: the frontend branch dropdown is not security, and a scope that resolves correctly
 * but never reaches the WHERE clause protects nothing.
 *
 * The `1=1` case matters as much as the IN case. A global caller must produce NO branch
 * predicate at all — if "all" ever leaked into the SQL as a literal, an index on branch_id
 * would stop being usable on the busiest finance query in the module.
 */

// listGrns runs its main SELECT through db.query (LIMIT/OFFSET are interpolated, which
// db.execute's prepared-statement path rejects); getGrnSummary uses db.execute. Both have to
// be mocked or the failure looks like a scope bug rather than a missing stub.
const { execute, query } = vi.hoisted(() => ({ execute: vi.fn(), query: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query } }));

/**
 * Imported once, in beforeAll, rather than per test.
 *
 * grn.service.ts transitively pulls in budget-consumption, grn-smart and vendor-payment, and
 * the first `await import` of that graph goes through Vite's transform. In isolation that is
 * ~300ms; inside the full suite it has been measured past 20s. With the usual
 * `await import` inside each `it()`, whichever test ran first paid the whole cost and timed
 * out on an assertion that was never reached — so the failure named the wrong thing. Paying
 * it once here keeps the per-test timeout meaningful.
 */
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

/** The SELECT that carries the branch predicate, ignoring COUNT/lookup round-trips. */
function callWith(fragment: string) {
  const calls = [...query.mock.calls, ...execute.mock.calls];
  const hit = calls.find(([sql]) => String(sql).includes(fragment));
  if (!hit) {
    throw new Error(
      `no query containing ${fragment}\n${calls.map(([s]) => String(s).slice(0, 90)).join("\n")}`,
    );
  }
  return { sql: String(hit[0]), params: (hit[1] ?? []) as unknown[] };
}

describe("grnService.listGrns — branch scope", () => {
  it("emits an IN clause with one placeholder per granted branch", async () => {
    await grnService.listGrns({
      branchScope: { mode: "branches", branchIds: ["noida", "noida-2", "ahmedabad"] },
    });
    const { sql, params } = callWith("FROM grn_request");
    expect(sql).toContain("g.branch_id IN (?, ?, ?)");
    expect(params.slice(0, 3)).toEqual(["noida", "noida-2", "ahmedabad"]);
  });

  it("emits no branch predicate at all for global scope", async () => {
    await grnService.listGrns({ branchScope: { mode: "all" } });
    const { sql } = callWith("FROM grn_request");
    // g.branch_id still appears in `LEFT JOIN branch_master bm ON bm.id = g.branch_id`, which
    // is a join, not a filter — so assert on the predicate forms specifically.
    expect(sql).not.toContain("g.branch_id IN (");
    expect(sql).not.toContain("g.branch_id = ?");
    expect(sql, "'1=1' would be dead weight on the hottest finance query").not.toContain("1=1");
  });

  it("still honours a plain branchId from an unmigrated caller", async () => {
    // The adapter path. Routers migrate one at a time; the ones still passing a single
    // branchId must behave exactly as they did before.
    await grnService.listGrns({ branchId: "branch-own" });
    const { sql, params } = callWith("FROM grn_request");
    expect(sql).toContain("g.branch_id = ?");
    expect(params[0]).toBe("branch-own");
  });

  it("lets branchScope win when both are supplied", async () => {
    await grnService.listGrns({
      branchId: "ignored",
      branchScope: { mode: "branches", branchIds: ["noida", "ahmedabad"] },
    });
    const { sql, params } = callWith("FROM grn_request");
    expect(sql).toContain("g.branch_id IN (?, ?)");
    expect(sql).not.toContain("g.branch_id = ?");
    expect(params).not.toContain("ignored");
  });
});

describe("grnService.getGrnSummary — branch scope", () => {
  it("scopes the status roll-up to the granted branches", async () => {
    // The summary feeds the header counts on /finance/grn. If it were unscoped it would leak
    // other branches' totals even while the list below it was correctly filtered.
    await grnService.getGrnSummary({
      branchScope: { mode: "branches", branchIds: ["noida", "ahmedabad"] },
    });
    const { sql, params } = callWith("GROUP BY g.status");
    expect(sql).toContain("g.branch_id IN (?, ?)");
    expect(params.slice(0, 2)).toEqual(["noida", "ahmedabad"]);
  });

  it("emits no branch predicate for global scope", async () => {
    await grnService.getGrnSummary({ branchScope: { mode: "all" } });
    expect(callWith("GROUP BY g.status").sql).not.toContain("g.branch_id");
  });
});
