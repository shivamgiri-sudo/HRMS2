import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbExecute, aprExecute, qualityExecute, outboundExecute, salesBrandExecute, getPoolForKey } = vi.hoisted(() => {
  const dbExecute = vi.fn();
  const aprExecute = vi.fn();
  const qualityExecute = vi.fn();
  const outboundExecute = vi.fn();
  const salesBrandExecute = vi.fn();
  return {
    dbExecute,
    aprExecute,
    qualityExecute,
    outboundExecute,
    salesBrandExecute,
    getPoolForKey: vi.fn(async (key: string) => {
      if (key === "apr_productivity") return { execute: aprExecute };
      if (key === "quality_audit") return { execute: qualityExecute };
      if (key === "outbound_calls") return { execute: outboundExecute };
      if (key === "sales_brand_mis") return { execute: salesBrandExecute };
      throw new Error(`No credentials configured for integration: ${key}`);
    }),
  };
});

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: dbExecute },
}));

vi.mock("../../external-db/external-db.service.js", () => ({
  getPoolForKey,
}));

import { previewPerformanceSources } from "../performance-source-preview.service.js";

function setupTargetDb() {
  dbExecute.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM integration_config")) {
      return [[
        { integration_key: "apr_productivity", active_status: 1, has_credentials: 1, test_ok: 1, test_error: null },
        { integration_key: "quality_audit", active_status: 1, has_credentials: 1, test_ok: 1, test_error: null },
        { integration_key: "outbound_calls", active_status: 1, has_credentials: 1, test_ok: 1, test_error: null },
        { integration_key: "sales_brand_mis", active_status: 1, has_credentials: 1, test_ok: 1, test_error: null },
      ], []];
    }
    if (sql.includes("FROM employees")) {
      return [[
        { id: "emp-1", employee_code: "MAS1001", biometric_code: "BIO1001" },
        { id: "emp-2", employee_code: "MAS1002", biometric_code: "BIO1002" },
      ], []];
    }
    return [[], []];
  });
}

describe("performance source preview", () => {
  beforeEach(() => {
    dbExecute.mockReset();
    aprExecute.mockReset();
    qualityExecute.mockReset();
    outboundExecute.mockReset();
    salesBrandExecute.mockReset();
    getPoolForKey.mockClear();
    setupTargetDb();
  });

  it("previews all source formulas without writing kpi facts", async () => {
    aprExecute.mockResolvedValueOnce([[
      { agent_user: "MAS1001", total_talk: 600, total_dispo: 120, total_calls: 12, source_records: 2 },
      { agent_user: "BIO1002", total_talk: 300, total_dispo: 60, total_calls: 6, source_records: 1 },
      { agent_user: "UNKNOWN", total_talk: 50, total_dispo: 10, total_calls: 1, source_records: 1 },
    ], []]);
    qualityExecute.mockResolvedValueOnce([[
      { agent_user: "MAS1001", points_earned: 180, points_possible: 200, fatal_audits: 1, total_audits: 4, last_audit_date: "2026-07-18" },
    ], []]);
    outboundExecute.mockResolvedValueOnce([[
      { agent_user: "MAS1001", converted_sales: 3, eligible_contacts: 12, source_records: 12 },
    ], []]);
    salesBrandExecute.mockResolvedValueOnce([[
      { agent_user: "MAS1001", total_calls: 20, total_aht: 600, total_talk: 400, total_dispo: 100, source_records: 2 },
    ], []]);
    salesBrandExecute.mockResolvedValueOnce([[
      { agent_user: "MAS1001", converted_sales: 4, revenue: 2400, cod_orders: 1, rto_orders: 1, source_records: 4 },
    ], []]);

    const result = await previewPerformanceSources({ date: "2026-07-18", yearMonth: "2026-07" });

    expect(result.sources.apr).toMatchObject({ ok: true, sourceRows: 3, mappedRows: 2, unmappedRows: 1 });
    expect(result.sources.apr.metrics).toContainEqual(expect.objectContaining({ metricCode: "AHT", value: 60 }));
    expect(result.sources.quality.metrics).toContainEqual(expect.objectContaining({ metricCode: "QUALITY_SCORE", value: 90 }));
    expect(result.sources.quality.metrics).toContainEqual(expect.objectContaining({ metricCode: "FATAL_RATE", value: 25 }));
    expect(result.sources.conversion.metrics).toContainEqual(expect.objectContaining({ metricCode: "CONVERSION_RATE", value: 25 }));
    expect(result.sources.salesBrandMis).toMatchObject({ ok: true, sourceRows: 1, mappedRows: 1, unmappedRows: 0 });
    expect(result.sources.salesBrandMis.metrics).toContainEqual(expect.objectContaining({ metricCode: "DIALS", value: 20 }));
    expect(result.sources.salesBrandMis.metrics).toContainEqual(expect.objectContaining({ metricCode: "ACW", value: 5 }));
    expect(result.sources.salesOrders.errors).toEqual([]);
    expect(result.sources.salesOrders).toMatchObject({ ok: true, sourceRows: 1, mappedRows: 1, unmappedRows: 0 });
    expect(result.sources.salesOrders.metrics).toContainEqual(expect.objectContaining({ metricCode: "REVENUE", value: 2400 }));
    expect(result.sources.salesOrders.metrics).toContainEqual(expect.objectContaining({ metricCode: "AOV", value: 600 }));
    expect(dbExecute.mock.calls.some(([sql]: [string]) => sql.includes("INSERT INTO kpi_daily_actual"))).toBe(false);
  });

  it("reports connector setup gaps without throwing", async () => {
    getPoolForKey.mockRejectedValueOnce(new Error("No credentials configured for integration: apr_productivity"));

    const result = await previewPerformanceSources({ date: "2026-07-18", yearMonth: "2026-07" });

    expect(result.sources.apr.ok).toBe(false);
    expect(result.sources.apr.errors).toEqual(["No credentials configured for integration: apr_productivity"]);
  });
});
