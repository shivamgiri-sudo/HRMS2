import { describe, it, expect, vi } from "vitest";
import type { PoolConnection } from "mysql2/promise";
import {
  canonicalValue,
  configuredRatioMultiplier,
} from "../performance-publication.service.js";

/**
 * A ratio metric is staged and published by two different pieces of code, and
 * they have to agree.
 *
 * Staging (performance-ingestion.service.ts) writes each row as
 *   (numerator / denominator) * binding.ratioMultiplier   [default 100]
 * into performance_fact_lineage.
 *
 * Publication re-derives the canonical value from the SUMMED numerator and
 * denominator, so it must apply the same multiplier. It used to infer one from
 * the metric's unit string:
 *
 *   const multiplier = unit.toLowerCase() === "percent" ? 100 : 1;
 *
 * So any metric whose unit was spelled '%', 'percentage' or 'rate' — all
 * ordinary choices — staged 95.0 into lineage and published 0.95 into
 * kpi_daily_actual. The same fact, 100x apart, and nothing failed: both numbers
 * are individually plausible, and the reconciliation counts row COUNTS, not
 * values.
 *
 * The multiplier now comes from the approved mapping version, which is the only
 * place it was ever configured.
 */

const lineageRow = (over: Record<string, unknown> = {}) =>
  ({
    source_dataset_id: "ds-1",
    mapping_version_id: "mv-1",
    dataset_key: "staging_manual_performance_certification",
    actual_value: 95,
    numerator_value: 95,
    denominator_value: 100,
    source_record_count: 1,
    process_id_at_event: "proc-1",
    branch_id_at_event: "branch-1",
    aggregation_method: "ratio",
    unit: "percent",
    metric_code: "ACCURACY_RATE",
    created_at: "2026-08-01 10:00:00",
    ...over,
  }) as never;

function connectionReturning(mappingJson: unknown): PoolConnection {
  return {
    execute: vi.fn().mockResolvedValue([[{ mapping_json: mappingJson }], []]),
  } as unknown as PoolConnection;
}

const MAPPING = {
  employeeIdentifierField: "employee_code",
  metrics: [
    { metricCode: "PRODUCTION_COUNT", valueField: "production_count", aggregation: "sum" },
    {
      metricCode: "ACCURACY_RATE",
      numeratorField: "correct_records",
      denominatorField: "audited_records",
      aggregation: "ratio",
      ratioMultiplier: 100,
    },
  ],
};

describe("the canonical ratio multiplier comes from the approved mapping", () => {
  it("uses the configured multiplier even when the unit is not the literal 'percent'", async () => {
    // The regression. Unit '%' is not the string 'percent', so the old code
    // used a multiplier of 1 and published 0.95 while lineage held 95.
    const rows = [lineageRow({ unit: "%" })];
    const multiplier = await configuredRatioMultiplier(connectionReturning(MAPPING), rows);

    expect(multiplier).toBe(100);
    expect(canonicalValue(rows, multiplier).actualValue).toBe(95);
  });

  it("agrees with what staging wrote into lineage", async () => {
    // Staging stored 95 for this row. The canonical value must be the same
    // number, not a different scale of it.
    const rows = [lineageRow({ unit: "percentage", actual_value: 95 })];
    const multiplier = await configuredRatioMultiplier(connectionReturning(MAPPING), rows);
    expect(canonicalValue(rows, multiplier).actualValue).toBe(Number(rows[0].actual_value));
  });

  it("sums numerator and denominator across rows before dividing", async () => {
    // 190/200 = 0.95 -> 95. Not the mean of two per-row percentages, which
    // would differ whenever the denominators differ.
    const rows = [
      lineageRow({ numerator_value: 90, denominator_value: 100 }),
      lineageRow({ numerator_value: 100, denominator_value: 100, created_at: "2026-08-01 11:00:00" }),
    ];
    const multiplier = await configuredRatioMultiplier(connectionReturning(MAPPING), rows);
    const canonical = canonicalValue(rows, multiplier);

    expect(canonical.actualValue).toBe(95);
    expect(canonical.numeratorValue).toBe(190);
    expect(canonical.denominatorValue).toBe(200);
  });

  it("honours a non-default multiplier rather than assuming 100", async () => {
    const mapping = {
      metrics: [{ metricCode: "ACCURACY_RATE", aggregation: "ratio", ratioMultiplier: 1 }],
    };
    const rows = [lineageRow({ unit: "percent" })];
    const multiplier = await configuredRatioMultiplier(connectionReturning(mapping), rows);

    // unit IS 'percent' here, so the old code would have forced 100.
    expect(multiplier).toBe(1);
    expect(canonicalValue(rows, multiplier).actualValue).toBe(0.95);
  });

  it("defaults to 100 when the mapping names the metric but omits the multiplier", async () => {
    // Matches the ingestion service's own `?? 100` default, so the two stay in
    // step rather than diverging on an omission.
    const mapping = { metrics: [{ metricCode: "ACCURACY_RATE", aggregation: "ratio" }] };
    const multiplier = await configuredRatioMultiplier(
      connectionReturning(mapping), [lineageRow({ unit: "ratio" })],
    );
    expect(multiplier).toBe(100);
  });

  it("falls back to the unit when no mapping can be resolved", async () => {
    // Pre-existing lineage rows keep whatever they were published with, rather
    // than silently changing value on the next republish.
    const rows = [lineageRow({ mapping_version_id: null, unit: "percent" })];
    const conn = { execute: vi.fn() } as unknown as PoolConnection;
    expect(await configuredRatioMultiplier(conn, rows)).toBe(100);

    const plain = [lineageRow({ mapping_version_id: null, unit: "count" })];
    expect(await configuredRatioMultiplier(conn, plain)).toBe(1);
  });

  it("survives unparseable mapping JSON instead of failing the publish", async () => {
    const conn = connectionReturning("{not json");
    const multiplier = await configuredRatioMultiplier(conn, [lineageRow({ unit: "percent" })]);
    expect(multiplier).toBe(100);
  });
});

describe("the other aggregations are unchanged by this fix", () => {
  it("sum adds the row values", () => {
    const rows = [
      lineageRow({ aggregation_method: "sum", actual_value: 10, metric_code: "PRODUCTION_COUNT" }),
      lineageRow({ aggregation_method: "sum", actual_value: 15, metric_code: "PRODUCTION_COUNT" }),
    ];
    expect(canonicalValue(rows, 100).actualValue).toBe(25);
  });

  it("average weights by source record count", () => {
    // (80*1 + 90*9) / 10 = 89, not the unweighted 85.
    const rows = [
      lineageRow({ aggregation_method: "average", actual_value: 80, source_record_count: 1 }),
      lineageRow({ aggregation_method: "average", actual_value: 90, source_record_count: 9 }),
    ];
    expect(canonicalValue(rows, 100).actualValue).toBe(89);
  });

  it("latest takes the most recent row deterministically", () => {
    const rows = [
      lineageRow({ aggregation_method: "latest", actual_value: 300, created_at: "2026-08-01 09:00:00" }),
      lineageRow({ aggregation_method: "latest", actual_value: 250, created_at: "2026-08-01 17:00:00" }),
    ];
    expect(canonicalValue(rows, 100).actualValue).toBe(250);
  });
});
