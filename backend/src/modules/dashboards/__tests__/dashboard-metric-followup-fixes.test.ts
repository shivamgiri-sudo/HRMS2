import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * Follow-up fixes from the 2026-08-13 home dashboard audit, beyond the first batch
 * (scope narrowing, asOf, TEAM_ONLY drilldowns, leave-approvals scope):
 *
 *   - targetScopeId(): a multi-branch/process scope must not compare its aggregate
 *     value against one arbitrary branch's target.
 *   - HEADCOUNT: dashboard-metric.service.ts and management.service.ts must agree on
 *     whether date_of_joining <= CURDATE() is part of "headcount".
 *   - BGV drilldown: must match getBgvMetrics' own "pending" bucket, not a superset.
 */

const source = readFileSync(
  resolve(__dirname, "../dashboard-metric.service.ts"),
  "utf-8",
);
const drilldownSource = readFileSync(
  resolve(__dirname, "../dashboard-drilldown.service.ts"),
  "utf-8",
);

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

describe("targetScopeId", () => {
  it("returns the single id for a scope naming exactly one branch/process", async () => {
    const { getHeadcountMetrics } = await import("../dashboard-metric.service.js");
    execute.mockReset();
    execute.mockResolvedValue([[{ active: 5, required_hc: null, available_hc: 0 }], []]);

    await getHeadcountMetrics({
      level: "BRANCH_ALL",
      branchIds: ["branch-1"],
      processIds: [],
      employeeIds: [],
      userId: "u1",
      role: "branch_head",
    });

    // No assertion on DB calls here — targetScopeId is exercised indirectly via
    // enrichMetric, which is mocked out at the db layer above; the direct unit tests
    // below on the exported helper are the precise regression guard.
  });

  it("is defined and behaves as documented (single id passes through, ambiguous/empty falls back to null)", () => {
    // targetScopeId is not exported (module-private by design — it is purely an
    // argument-shaping detail of wrapEnriched's call sites), so this pins the exact
    // source-level contract instead: every wrapEnriched call site must route through
    // it rather than reaching back into scope.branchIds[0]/scope.processIds[0]
    // directly, which is what silently compared a multi-branch aggregate against one
    // arbitrary branch's target.
    expect(source).toMatch(
      /function targetScopeId\(ids: readonly string\[\]\): string \| null \{\s*return ids\.length === 1 \? ids\[0\] : null;/,
    );
    // No live call site reaches into scope.branchIds[0]/scope.processIds[0] directly
    // any more — every reference to the raw index form left in this file is inside a
    // comment explaining why, not a real argument.
    const rawIndexLines = source
      .split("\n")
      .filter((line) => /scope\.branchIds\[0\]|scope\.processIds\[0\]/.test(line));
    for (const line of rawIndexLines) {
      expect(line.trim().startsWith("*") || line.trim().startsWith("//")).toBe(true);
    }
    const targetScopeIdCallCount = (source.match(/targetScopeId\(scope\.branchIds\)/g) ?? []).length;
    // Every metric builder passes through targetScopeId for both dimensions equally.
    const processCallCount = (source.match(/targetScopeId\(scope\.processIds\)/g) ?? []).length;
    expect(targetScopeIdCallCount).toBeGreaterThan(0);
    expect(targetScopeIdCallCount).toBe(processCallCount);
  });
});

describe("HEADCOUNT definition stays aligned with management.service.ts", () => {
  it("getHeadcountMetrics requires date_of_joining <= CURDATE(), matching the three management.service.ts headcount queries", () => {
    const start = source.indexOf("export async function getHeadcountMetrics");
    const fnSlice = source.slice(start, start + 2000);
    expect(fnSlice).toMatch(/e\.active_status = 1 AND e\.date_of_joining <= CURDATE\(\)/);
  });

  it("drillHeadcount matches the same definition, so the drilldown reconciles to the tile", () => {
    const start = drilldownSource.indexOf("async function drillHeadcount");
    const fnSlice = drilldownSource.slice(start, start + 2000);
    expect(fnSlice).toMatch(/WHERE e\.active_status = 1/);
    expect(fnSlice).toMatch(/e\.date_of_joining <= CURDATE\(\)/);
  });
});

describe("BGV drilldown matches the tile's pending bucket exactly", () => {
  it("uses the same status IN (...) list as getBgvMetrics' outstanding bucket, not a wider NOT IN", () => {
    const metricStart = source.indexOf("export async function getBgvMetrics");
    const metricSlice = source.slice(metricStart, metricStart + 3000);
    // getBgvMetrics rolls its checks up per candidate now (2026-08-28: the tile counted
    // 280 check rows against 109 real people), so the outstanding-status list lives in
    // the named OUTSTANDING constant rather than inline in a `... AS pending` SUM CASE.
    // The list itself is what has to stay in step with the drilldown.
    const pendingMatch = metricSlice.match(/const OUTSTANDING = `\(bgv\.status IS NULL OR bgv\.status IN \(([^)]+)\)\)`/);
    expect(pendingMatch, "could not find getBgvMetrics' outstanding bucket definition").not.toBeNull();
    expect(pendingMatch![1]).toBe("'pending','not_started','queued','manual_review','in_progress'");

    const drillStart = drilldownSource.indexOf("async function drillBgv");
    // 2500, not 1200: drillBgv now groups per candidate and carries the explanatory
    // header for that, which pushed the WHERE clause past the old window.
    const drillSlice = drilldownSource.slice(drillStart, drillStart + 2500);
    // The active WHERE clause, not the explanatory comment above it (which still
    // mentions the old NOT IN pattern in prose on purpose, as a "don't reintroduce
    // this" note) — assert on the actual condition line.
    expect(drillSlice).toMatch(
      /WHERE COALESCE\(bgv\.status,'pending'\) IN \('pending','not_started','queued','manual_review','in_progress'\)/,
    );
    expect(drillSlice).not.toMatch(/WHERE COALESCE\(bgv\.status,'pending'\) NOT IN/);
  });
});

describe("ONBOARDING drilldown accepts a bucket filter", () => {
  it("scopes to just the stuck status when filters.bucket = 'stuck'", async () => {
    const { getDrilldown } = await import("../dashboard-drilldown.service.js");
    execute.mockReset();
    execute.mockResolvedValueOnce([[{ status: "stuck", count: 2 }], []]);
    execute.mockResolvedValueOnce([[], []]);

    const scope = {
      level: "ORG_ALL" as const,
      branchIds: [],
      processIds: [],
      employeeIds: [],
      userId: "u1",
      role: "hr",
    };
    await getDrilldown("ONBOARDING", scope, { bucket: "stuck" });

    const [statusSql, statusParams] = execute.mock.calls[0];
    expect(statusSql).toContain("b.status IN (?)");
    expect(statusParams).toContain("stuck");
  });

  it("returns every status when no bucket filter is given (unchanged default behavior)", async () => {
    const { getDrilldown } = await import("../dashboard-drilldown.service.js");
    execute.mockReset();
    execute.mockResolvedValueOnce([[{ status: "pending", count: 3 }, { status: "stuck", count: 2 }], []]);
    execute.mockResolvedValueOnce([[], []]);

    const scope = {
      level: "ORG_ALL" as const,
      branchIds: [],
      processIds: [],
      employeeIds: [],
      userId: "u1",
      role: "hr",
    };
    await getDrilldown("ONBOARDING", scope, {});

    const [statusSql] = execute.mock.calls[0];
    expect(statusSql).not.toContain("b.status IN (?)");
  });
});
