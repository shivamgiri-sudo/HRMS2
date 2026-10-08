import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The canonical P&L is usable by a multi-branch finance user.
 *
 * It was not. Every read went through `resolveFinanceBranchScope`, the single-branch adapter,
 * which THROWS when a caller holds more than one branch and has not named one:
 *
 *     "This finance screen does not support multi-branch access yet; select a single branch"
 *
 * That is a safe failure — nothing leaked — but it made the summary, trend and export unusable
 * for precisely the people most likely to hold several branches. The reads now resolve the SET.
 *
 * WHY THIS IS A SMALL CHANGE AND NOT A REWRITE
 * The base query filtered `p.branch_id = ?`; it now also ANDs `p.branch_id IN (…)`. The
 * allocation overlay downstream already groups its cost pools BY BRANCH before allocating, so
 * handing it rows from three branches needs no change to the arithmetic at all.
 *
 * THE DANGEROUS DIRECTION IS THE ONE TESTED HARDEST. Widening a scope filter is exactly where a
 * data leak comes from, so the tests below care most about what must NOT happen: an empty
 * entitlement must return nothing rather than everything, and a branch named in the query
 * string must never widen what the caller is entitled to.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));

/**
 * Runs listProcesses against a mocked driver and returns every statement it issued.
 *
 * All statements rather than one hand-picked by a regex: the base query is the only one that
 * can carry a branch predicate, so asserting over the whole set is both simpler and immune to
 * the projection being reshaped later.
 */
async function baseQueryFor(filters: Record<string, unknown>) {
  const statements: string[] = [];
  const params: unknown[] = [];
  execute.mockReset();
  execute.mockImplementation(async (sql: string, bound?: unknown[]) => {
    statements.push(String(sql));
    params.push(...((bound ?? []) as unknown[]));
    return [[], []];
  });
  const { processPnlService } = await import("../process-pnl.service.js");
  // The service memoises by period, so a second call with the same period and different branch
  // filters would be served from the cache and issue no SQL at all — which reads as "the
  // predicate is missing" when in fact the query never ran.
  processPnlService.invalidateCaches();
  await processPnlService.listProcesses(filters as never).catch(() => undefined);
  expect(statements.length, "listProcesses issued no query at all").toBeGreaterThan(0);
  return { sql: statements.join(" "), params };
}

describe("the branch entitlement predicate", () => {
  it("filters on a single branch exactly as before when one is requested", async () => {
    const q = await baseQueryFor({ period: "2026-01", branchId: "br1" });
    expect(q.sql).toContain("p.branch_id = ?");
    expect(q.params).toContain("br1");
  });

  it("uses an IN predicate for a multi-branch entitlement", async () => {
    const q = await baseQueryFor({ period: "2026-02", branchIds: ["br1", "br2", "br3"] });
    expect(q.sql).toMatch(/p\.branch_id IN \(\?, \?, \?\)/);
    expect(q.params).toEqual(expect.arrayContaining(["br1", "br2", "br3"]));
  });

  it("returns NOTHING for an empty entitlement, never everything", async () => {
    // The whole risk of this change in one test. A dropped predicate here would serve every
    // branch's P&L to someone entitled to none.
    const q = await baseQueryFor({ period: "2026-03", branchIds: [] });
    expect(q.sql).toContain("1=0");
    expect(q.sql).not.toMatch(/p\.branch_id IN \(\)/);
  });

  it("ANDs the requested branch WITH the entitlement rather than replacing it", async () => {
    // Asking for a branch outside your entitlement must return nothing, not that branch. Both
    // predicates present means the intersection, which for a disjoint pair is empty.
    const q = await baseQueryFor({ period: "2026-04", branchId: "br9", branchIds: ["br1", "br2"] });
    expect(q.sql).toContain("p.branch_id = ?");
    expect(q.sql).toMatch(/p\.branch_id IN \(\?, \?\)/);
    expect(q.params).toEqual(expect.arrayContaining(["br9", "br1", "br2"]));
  });

  it("applies no branch predicate at all for a global-scope caller", async () => {
    // mode 'all' passes neither field, which must leave the query unfiltered by branch.
    // Asserted on the PREDICATE, not the string: p.branch_id is also in the SELECT projection,
    // so a bare toContain would fail on a perfectly correct unfiltered query.
    const q = await baseQueryFor({ period: "2026-05" });
    expect(q.sql).not.toContain("p.branch_id = ?");
    expect(q.sql).not.toMatch(/p\.branch_id IN \(/);
    expect(q.sql).not.toContain("1=0");
  });

  it("binds every branch as a parameter, never interpolating one", async () => {
    const q = await baseQueryFor({ period: "2026-06", branchIds: ["br1'; DROP TABLE x; --"] });
    expect(q.sql).not.toContain("DROP TABLE");
    expect(q.params).toContain("br1'; DROP TABLE x; --");
  });
});

describe("the routes resolve a set, not a single branch", () => {
  let PNL: string;
  let BPO: string;
  beforeAll(async () => {
    const { readFileSync } = await import("fs");
    const at = (rel: string) =>
      new URL(rel, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    PNL = readFileSync(at("../process-pnl.routes.ts"), "utf8");
    BPO = readFileSync(at("../bpo-pnl.routes.ts"), "utf8");
  });

  it("uses the set resolver in both P&L read paths", () => {
    for (const [name, src] of [["process-pnl", PNL], ["bpo-pnl", BPO]] as const) {
      const scoped = src.slice(src.indexOf("async function scopedFilters"));
      const body = scoped.slice(0, scoped.indexOf("\n}"));
      expect(body, `${name} scopedFilters must resolve the set`).toContain("resolveFinanceBranchScopeSet");
    }
  });

  it("passes branchIds only for a scoped caller, never for a global one", () => {
    // A global caller must keep getting an unfiltered query; handing them an explicit list of
    // every branch would silently drop any branch created after the request began.
    for (const src of [PNL, BPO]) {
      const scoped = src.slice(src.indexOf("async function scopedFilters"));
      const body = scoped.slice(0, scoped.indexOf("\n}"));
      expect(body).toContain('scope.mode === "all" ? base');
      expect(body).toContain("branchIds: scope.branchIds");
    }
  });

  it("still sends a lone branch as branchId, keeping single-branch behaviour identical", () => {
    // The overwhelmingly common case must produce byte-identical SQL to before this change.
    for (const src of [PNL, BPO]) {
      const scoped = src.slice(src.indexOf("async function scopedFilters"));
      const body = scoped.slice(0, scoped.indexOf("\n}"));
      expect(body).toContain("scope.branchIds.length === 1");
    }
  });
});
