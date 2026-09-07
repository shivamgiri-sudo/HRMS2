import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pulling a metric out of a client's own database.
 *
 * The property under protection is the injection surface. A configurable source
 * unavoidably interpolates table and column names, because those cannot be
 * bound parameters — so every identifier must go through assertSafeIdentifier
 * and the aggregate must come from a fixed whitelist, never straight from the
 * request. These tests fail if either guard is removed.
 */
const { execute, getPoolForKey, poolQuery } = vi.hoisted(() => ({
  execute: vi.fn(),
  getPoolForKey: vi.fn(),
  poolQuery: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../external-db/external-db.service.js", () => ({ getPoolForKey }));

const svc = await import("../connector-refresh.service.js");

const BASE = {
  connectorKey: "proc_abc123", processId: "p1", metricKey: "abc_prepaid_pct",
  table: "orders", valueColumn: "prepaid_flag", aggregate: "AVG" as const,
  dateColumn: "order_date", from: "2026-08-01", to: "2026-08-31",
};

describe("refreshConnectorMetric", () => {
  beforeEach(() => {
    execute.mockReset(); poolQuery.mockReset(); getPoolForKey.mockReset();
    getPoolForKey.mockResolvedValue({ query: poolQuery });
    execute.mockResolvedValue([{ affectedRows: 1 }, []]);
  });

  it("rejects an identifier that is not a plain column name", async () => {
    await expect(svc.refreshConnectorMetric({ ...BASE, valueColumn: "x; DROP TABLE y" }))
      .rejects.toThrow();
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("rejects a table name carrying a quote", async () => {
    await expect(svc.refreshConnectorMetric({ ...BASE, table: "orders`--" }))
      .rejects.toThrow();
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("rejects an aggregate outside the whitelist", async () => {
    await expect(svc.refreshConnectorMetric({ ...BASE, aggregate: "SLEEP" as never }))
      .rejects.toThrow(/aggregate/i);
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("binds the dates rather than interpolating them", async () => {
    poolQuery.mockResolvedValue([[], []]);
    await svc.refreshConnectorMetric(BASE);
    const [sql, params] = poolQuery.mock.calls[0];
    expect(String(sql)).not.toContain("2026-08-01");
    expect(params).toEqual(["2026-08-01", "2026-08-31"]);
  });

  it("writes one row per day returned, tagged as connector-sourced", async () => {
    poolQuery.mockResolvedValue([[
      { d: "2026-08-01", v: "0.82" },
      { d: "2026-08-02", v: "0.79" },
    ], []]);
    const out = await svc.refreshConnectorMetric(BASE);
    expect(out.written).toBe(2);
    const insert = execute.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO process_metric_actual"));
    expect(insert).toBeTruthy();
    // 'connector' is a SQL literal (the source is never caller-supplied);
    // the connector key it came from is bound.
    expect(String(insert![0])).toContain("'connector'");
    expect(insert![1]).toContain("proc_abc123");
    expect(insert![1]).toContain("2026-08-01");
  });

  it("writes nothing when the source returns no rows", async () => {
    poolQuery.mockResolvedValue([[], []]);
    const out = await svc.refreshConnectorMetric(BASE);
    expect(out.written).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it("issues only a SELECT against the client's database", async () => {
    poolQuery.mockResolvedValue([[], []]);
    await svc.refreshConnectorMetric(BASE);
    expect(String(poolQuery.mock.calls[0][0]).trim().toUpperCase().startsWith("SELECT")).toBe(true);
  });
});
