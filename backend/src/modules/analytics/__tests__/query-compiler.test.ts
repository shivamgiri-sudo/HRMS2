import { describe, it, expect } from "vitest";
import { compileQuery } from "../query-compiler.js";
import type { Dataset, DatasetField, ScopeClause } from "../analytics.types.js";

const f = (fieldKey: string, columnName: string, role: DatasetField["role"], extra: Partial<DatasetField> = {}): DatasetField => ({
  fieldKey, label: fieldKey, columnName, role, dataType: role === "measure" ? "number" : role === "time" ? "date" : "string",
  defaultAgg: "sum", format: "number", lookup: "none", description: null, sortOrder: 0, hidden: false, ...extra,
});
const DS: Dataset = {
  id: "ds1", code: "process_kpi_daily", name: "Process KPI", description: null, category: null, connection: "hrms",
  sourceTable: "process_metric_actual", timeField: "date", scopeMode: "process", processColumn: "process_id",
  branchColumn: null, employeeColumn: null, scopeProcessId: null, maxRows: 5000,
  fields: [
    f("date", "score_date", "time"), f("metric", "metric_key", "dimension"), f("value", "actual_value", "measure"),
    f("process", "process_id", "dimension", { lookup: "process" }), f("source", "source", "dimension"),
  ],
};
const NO_SCOPE: ScopeClause = { sql: "1=1", params: [], joins: [] };
const RANGE = { from: "2026-09-01", to: "2026-09-30" };

describe("compileQuery", () => {
  it("groups a sum by month and caps execution time", () => {
    const q = compileQuery(DS, { dataset: "x", dimensions: [{ field: "date", grain: "month" }], measures: [{ field: "value", agg: "sum" }] }, NO_SCOPE, RANGE);
    expect(q.sql.startsWith("SELECT /*+ MAX_EXECUTION_TIME(20000) */")).toBe(true);
    expect(q.sql).toContain("DATE_FORMAT(t.`score_date`, '%Y-%m-01') AS `d0`");
    expect(q.sql).toContain("SUM(t.`actual_value`) AS `m0`");
    expect(q.sql).toContain("GROUP BY 1");
    expect(q.columns.map((c) => c.key)).toEqual(["d0", "m0"]);
  });

  it("puts the date range first, then scope, then filters, with params in that order", () => {
    const scope: ScopeClause = { sql: "sp.branch_id = ?", params: ["b1"], joins: ["LEFT JOIN process_master sp ON sp.id = t.`process_id`"] };
    const q = compileQuery(DS, {
      dataset: "x", dimensions: [{ field: "metric" }], measures: [{ field: "value", agg: "avg" }],
      filters: [{ field: "metric", op: "in", value: ["A", "B", "C"] }],
    }, scope, RANGE);
    expect(q.sql).toContain("LEFT JOIN process_master sp ON sp.id = t.`process_id`");
    expect(q.sql).toMatch(/WHERE t\.`score_date` BETWEEN \? AND \? AND \(sp\.branch_id = \?\) AND t\.`metric_key` IN \(\?,\?,\?\)/);
    expect(q.params).toEqual(["2026-09-01", "2026-09-30", "b1", "A", "B", "C"]);
  });

  it("supports every filter operator with bound values only", () => {
    const run = (op: string, value?: unknown) => compileQuery(DS, { dataset: "x", dimensions: [], measures: [{ agg: "count" }], filters: [{ field: "metric", op: op as never, value }] }, NO_SCOPE, null);
    expect(run("between", [1, 5]).sql).toContain("t.`metric_key` BETWEEN ? AND ?");
    expect(run("contains", "ab").params).toEqual(["%ab%"]);
    expect(run("starts_with", "ab").params).toEqual(["ab%"]);
    expect(run("is_null").sql).toContain("t.`metric_key` IS NULL");
    expect(run("not_in", ["x"]).sql).toContain("NOT IN (?)");
    expect(run("gte", 3).sql).toContain("t.`metric_key` >= ?");
    expect(() => run("in", [])).toThrow(/at least one value/);
  });

  it("escapes LIKE wildcards in user text", () => {
    const q = compileQuery(DS, { dataset: "x", dimensions: [], measures: [{ agg: "count" }], filters: [{ field: "metric", op: "contains", value: "50%_x" }] }, NO_SCOPE, null);
    expect(q.params).toEqual(["%50\\%\\_x%"]);
  });

  it("count without a field is COUNT(*), count_distinct is DISTINCT", () => {
    const q = compileQuery(DS, { dataset: "x", dimensions: [], measures: [{ agg: "count" }, { field: "metric", agg: "count_distinct" }] }, NO_SCOPE, null);
    expect(q.sql).toContain("COUNT(*) AS `m0`");
    expect(q.sql).toContain("COUNT(DISTINCT t.`metric_key`) AS `m1`");
    expect(q.sql).not.toContain("GROUP BY");
  });

  it("weekday and week grains", () => {
    const wd = compileQuery(DS, { dataset: "x", dimensions: [{ field: "date", grain: "weekday" }], measures: [{ agg: "count" }] }, NO_SCOPE, null);
    expect(wd.sql).toContain("WEEKDAY(t.`score_date`) AS `d0`");
    const wk = compileQuery(DS, { dataset: "x", dimensions: [{ field: "date", grain: "week" }], measures: [{ agg: "count" }] }, NO_SCOPE, null);
    expect(wk.sql).toContain("DATE_SUB(DATE(t.`score_date`), INTERVAL WEEKDAY(t.`score_date`) DAY) AS `d0`");
  });

  it("rejects unknown fields, unknown sort keys and unsafe dataset columns", () => {
    expect(() => compileQuery(DS, { dataset: "x", dimensions: [{ field: "nope" }], measures: [{ agg: "count" }] }, NO_SCOPE, null)).toThrow(/Unknown field/);
    expect(() => compileQuery(DS, { dataset: "x", dimensions: [{ field: "metric" }], measures: [{ agg: "count" }], sort: [{ key: "evil", dir: "asc" }] }, NO_SCOPE, null)).toThrow(/sort/);
    const bad = { ...DS, fields: [f("x", "a; DROP TABLE t", "dimension")] };
    expect(() => compileQuery(bad, { dataset: "x", dimensions: [{ field: "x" }], measures: [{ agg: "count" }] }, NO_SCOPE, null)).toThrow(/Invalid/);
  });

  it("clamps the limit and sorts by an output key", () => {
    const q = compileQuery(DS, { dataset: "x", dimensions: [{ field: "metric" }], measures: [{ field: "value", agg: "sum" }], sort: [{ key: "m0", dir: "desc" }], limit: 999999 }, NO_SCOPE, null);
    expect(q.sql).toContain("ORDER BY `m0` DESC");
    expect(q.sql).toMatch(/LIMIT 5001$/);
    expect(q.limit).toBe(5000);
  });

  it("shows names for lookup dimensions", () => {
    const q = compileQuery(DS, { dataset: "x", dimensions: [{ field: "process" }], measures: [{ agg: "count" }] }, NO_SCOPE, null);
    expect(q.sql).toContain("LEFT JOIN process_master lk0 ON lk0.id = t.`process_id`");
    expect(q.sql).toContain("COALESCE(lk0.process_name, t.`process_id`) AS `d0`");
  });

  it("requires at least one measure and at most 4 dimensions", () => {
    expect(() => compileQuery(DS, { dataset: "x", dimensions: [{ field: "metric" }], measures: [] }, NO_SCOPE, null)).toThrow(/measure/);
    const five = Array.from({ length: 5 }, () => ({ field: "metric" }));
    expect(() => compileQuery(DS, { dataset: "x", dimensions: five, measures: [{ agg: "count" }] }, NO_SCOPE, null)).toThrow(/dimensions/);
  });

  it("a measure aggregate on a text column is refused except count", () => {
    expect(() => compileQuery(DS, { dataset: "x", dimensions: [], measures: [{ field: "metric", agg: "sum" }] }, NO_SCOPE, null)).toThrow(/number/);
  });
});
