import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Independent dashboard reads must be issued concurrently, not one after another:
 * against the remote production DB every serial statement costs a full network
 * round trip. These tests pin (a) that the statements overlap in flight and
 * (b) that the assembled payload is unchanged.
 */
const { execute, state } = vi.hoisted(() => ({
  execute: vi.fn(),
  state: { inflight: 0, maxInflight: 0 },
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
// The scorecard also fans out to external dialer/quality feeds; never let a unit
// test reach a real connection.
vi.mock("../kpi-cdr-source.js", () => ({
  resolveCdrScorecard: vi.fn().mockResolvedValue(null),
  getCdrAgentBreakdown: vi.fn().mockResolvedValue([]),
  getCdrAgentCalls: vi.fn().mockResolvedValue([]),
}));
vi.mock("../kpi-shivamgiri-source.js", () => ({
  SHIVAMGIRI_CLIENT_ID: "x",
  fetchShivamgiriQualityScore: vi.fn().mockResolvedValue(null),
}));
vi.mock("../process-metric-source.js", () => ({
  fetchProcessMetricValues: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("../../workforce-mandate/hc-formula.service.js", () => ({
  fetchActiveHc: vi.fn().mockResolvedValue(null),
  fetchRolling30dAttritionRate: vi.fn().mockResolvedValue(null),
  fetchRolling60dShrinkagePct: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../../shared/scopeAccess.js", () => ({
  buildScopeWhereClause: vi.fn().mockResolvedValue({ sql: "1=1", params: [] }),
  hasAnyRole: vi.fn().mockResolvedValue(true),
}));

/** Resolves on a later tick while tracking how many statements are in flight. */
function tracked(rows: (sql: string) => unknown[]) {
  return async (sql: string) => {
    state.inflight += 1;
    state.maxInflight = Math.max(state.maxInflight, state.inflight);
    await new Promise((r) => setTimeout(r, 5));
    state.inflight -= 1;
    return [rows(String(sql))];
  };
}

beforeEach(() => {
  state.inflight = 0;
  state.maxInflight = 0;
  execute.mockReset();
});

describe("GNC sale dashboard", () => {
  it("runs its independent aggregates concurrently and keeps the payload shape", async () => {
    execute.mockImplementation(
      tracked((sql) => {
        if (
          /SUM\(gross_amount\) AS turnover,\s+COUNT\(\*\) AS sale_count/.test(
            sql,
          ) &&
          !/GROUP BY/.test(sql)
        ) {
          return [
            { turnover: 1000, sale_count: 4, prepaid_count: 3, cod_count: 1 },
          ];
        }
        return [];
      }),
    );
    const { getGncSaleDashboard } =
      await import("../gnc-sale-dashboard.service.js");
    const out = await getGncSaleDashboard("2026-09-01", "2026-09-10");
    expect(state.maxInflight).toBeGreaterThanOrEqual(10);
    expect(out.headline.turnover).toBe(1000);
    expect(out.headline.saleCount).toBe(4);
    expect(out.headline.aov).toBe(250);
    expect(out.from).toBe("2026-09-01");
    expect(out.dateWiseTrend).toEqual([]);
  });
});

describe("Bellavita chat overview", () => {
  it("loads the sales pair and the target lookups in the same wave as the other loaders", async () => {
    execute.mockImplementation(tracked(() => []));
    const { getBellavitaChatOverview } =
      await import("../bellavita-chat-overview.service.js");
    await getBellavitaChatOverview("2026-09-01", "2026-09-03", "Overall");
    // 8 loaders + 2 target lookups + the second bb_sale query all overlap.
    expect(state.maxInflight).toBeGreaterThanOrEqual(10);
  });
});

describe("Process performance metric drill-down", () => {
  const FILTERS = { from: "2026-07-01", to: "2026-07-31" };
  it.each([
    ["attrition", 2],
    ["quality", 3],
    ["operations", 2],
    ["pnl", 3],
  ])("%s issues its statements together", async (section, expected) => {
    // exits/late_marks/issues satisfy the coverage gate the attrition section checks first.
    execute.mockImplementation(
      tracked(() => [{ exits: 1, late_marks: 1, issues: 1 }]),
    );
    const svc = await import("../process-performance.service.js");
    await svc.getMetricDetail("u", section as never, FILTERS as never);
    expect(state.maxInflight).toBeGreaterThanOrEqual(expected as number);
  });
});

describe("KPI scorecard", () => {
  it("fires each family's actual + trend query together and applies results in order", async () => {
    execute.mockImplementation(
      tracked((sql) => {
        if (/FROM process_master/.test(sql))
          return [{ process_code: "BLA_BLI_BLU" }];
        if (/GROUP BY m\.metric_code, period/.test(sql)) {
          return [
            { metric_code: "SALES_COUNT", period: "2026-09", value: "5" },
          ];
        }
        if (/GROUP BY m\.metric_code/.test(sql)) {
          return [{ metric_code: "SALES_COUNT", value: "7", n: 2 }];
        }
        return [];
      }),
    );
    const { getKpiScorecardsForProcessId } =
      await import("../kpi-scorecard.service.js");
    const rows = await getKpiScorecardsForProcessId("p1", {
      from: "2026-09-01",
      to: "2026-09-30",
    } as never);
    expect(rows).not.toBeNull();
    // BLA_BLI_BLU spans rate + volume (+ more) families -> at least 4 statements overlap.
    expect(state.maxInflight).toBeGreaterThanOrEqual(4);
    const sales = rows!.find((r) =>
      JSON.stringify(r).includes("abc_sale_target"),
    );
    expect(sales).toBeDefined();
  });
});

describe("Bellavita sale / cart routes", () => {
  it("resolve the target-admin role lookup together with the dashboard payload", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of [
      "bellavita-sale-dashboard.routes.ts",
      "bellavita-cart-dashboard.routes.ts",
    ]) {
      const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
      expect(src).toContain("const [data, canSetTarget] = await Promise.all([");
    }
  });
});
