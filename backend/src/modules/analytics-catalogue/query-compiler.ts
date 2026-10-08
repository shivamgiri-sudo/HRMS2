import { assertSafeIdentifier } from "../integration-hub/adapters/databaseAdapter.js";
import {
  AGGS, AnalyticsError, GRAINS, OPS,
  type Agg, type Dataset, type DatasetField, type Grain, type QuerySpec, type ResultColumn, type ScopeClause,
} from "./analytics.types.js";
import type { Range } from "./date-range.js";

/**
 * QuerySpec -> parameterised SQL. Pure: no I/O, so every rule here is unit-tested.
 *
 * Safety rules, in order of importance:
 *  1. Identifiers only ever come from the dataset registry, and each passes assertSafeIdentifier before it is quoted.
 *  2. Every user value is a bound parameter. Output aliases are generated (d0, m0), never user text.
 *  3. The viewer's scope clause is ANDed in by the caller-supplied ScopeClause; this function cannot drop it.
 *  4. The row limit is clamped to the dataset's max_rows and a MySQL execution cap bounds every statement.
 */

export const MAX_DIMENSIONS = 4;
export const MAX_MEASURES = 8;
const EXEC_MS = 20000;

const col = (name: string) => `t.\`${assertSafeIdentifier(name, "column")}\``;
/** Dimensions holding an id (or a metric code) are shown by name. Fixed map: never built from user input. */
const LOOKUP_JOIN: Record<string, { table: string; name: string; key: string }> = {
  process: { table: "process_master", name: "process_name", key: "id" },
  branch: { table: "branch_master", name: "branch_name", key: "id" },
  employee: { table: "employees", name: "full_name", key: "id" },
  metric: { table: "kpi_metric_master", name: "metric_name", key: "id" },
  metric_code: { table: "kpi_metric_master", name: "metric_name", key: "metric_code" },
};

function field(ds: Dataset, key: string): DatasetField {
  const fd = ds.fields.find((x) => x.fieldKey === key);
  if (!fd) throw new AnalyticsError(`Unknown field "${key}" for dataset ${ds.code}`);
  return fd;
}

function grainExpr(c: string, grain: Grain | undefined, dataType: string): string {
  switch (grain) {
    case "hour": return `HOUR(${c})`;
    case "day": return `DATE(${c})`;
    case "week": return `DATE_SUB(DATE(${c}), INTERVAL WEEKDAY(${c}) DAY)`;
    case "month": return `DATE_FORMAT(${c}, '%Y-%m-01')`;
    case "quarter": return `CONCAT(YEAR(${c}), '-Q', QUARTER(${c}))`;
    case "year": return `YEAR(${c})`;
    case "weekday": return `WEEKDAY(${c})`;
    default: return dataType === "datetime" ? `DATE(${c})` : c;
  }
}

function aggExpr(agg: Agg, c: string | null): string {
  if (agg === "count") return c ? `COUNT(${c})` : "COUNT(*)";
  if (!c) throw new AnalyticsError(`"${agg}" needs a field`);
  if (agg === "count_distinct") return `COUNT(DISTINCT ${c})`;
  return `${agg.toUpperCase()}(${c})`;
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export interface CompiledQuery { sql: string; params: unknown[]; columns: ResultColumn[]; limit: number; /** true when the limit is the dataset's own cap, not the user's top-N */ capped: boolean }

export function compileQuery(ds: Dataset, spec: QuerySpec, scope: ScopeClause, range: Range | null): CompiledQuery {
  assertSafeIdentifier(ds.sourceTable, "table");
  const dims = spec.dimensions ?? [];
  const measures = spec.measures ?? [];
  if (dims.length > MAX_DIMENSIONS) throw new AnalyticsError(`At most ${MAX_DIMENSIONS} dimensions`);
  if (!measures.length) throw new AnalyticsError("Pick at least one measure");
  if (measures.length > MAX_MEASURES) throw new AnalyticsError(`At most ${MAX_MEASURES} measures`);

  const select: string[] = [];
  const joins: string[] = [...scope.joins];
  const columns: ResultColumn[] = [];

  dims.forEach((d, i) => {
    const fd = field(ds, d.field);
    if (d.grain && !GRAINS.includes(d.grain)) throw new AnalyticsError(`Unknown grain "${d.grain}"`);
    const isTime = fd.role === "time" || fd.dataType === "date" || fd.dataType === "datetime";
    const grain = isTime ? d.grain : undefined;
    let expr = grainExpr(col(fd.columnName), grain, fd.dataType);
    if (fd.lookup !== "none" && LOOKUP_JOIN[fd.lookup] && ds.connection === "hrms") {
      const lk = LOOKUP_JOIN[fd.lookup];
      joins.push(`LEFT JOIN ${lk.table} lk${i} ON lk${i}.${lk.key} = ${col(fd.columnName)}`);
      expr = `COALESCE(lk${i}.${lk.name}, ${col(fd.columnName)})`;
    }
    select.push(`${expr} AS \`d${i}\``);
    columns.push({ key: `d${i}`, label: fd.label, kind: "dimension", format: isTime && !grain ? "date" : fd.format, dataType: fd.dataType, grain });
  });

  measures.forEach((m, i) => {
    const fd = m.field ? field(ds, m.field) : null;
    const agg = m.agg ?? fd?.defaultAgg ?? "count";
    if (!AGGS.includes(agg)) throw new AnalyticsError(`Unknown aggregation "${agg}"`);
    if (fd && !["count", "count_distinct"].includes(agg) && fd.dataType !== "number") {
      throw new AnalyticsError(`"${agg}" needs a number field; ${fd.label} is ${fd.dataType}`);
    }
    select.push(`${aggExpr(agg, fd ? col(fd.columnName) : null)} AS \`m${i}\``);
    columns.push({
      key: `m${i}`, label: m.alias?.slice(0, 80) || (fd ? `${fd.label}${agg === fd.defaultAgg ? "" : ` (${agg.replace("_", " ")})`}` : "Count"),
      kind: "measure", format: agg === "count" || agg === "count_distinct" ? "integer" : fd?.format ?? "number", dataType: "number",
    });
  });

  const where: string[] = [];
  const params: unknown[] = [];
  if (range && ds.timeField) {
    const tf = field(ds, ds.timeField);
    where.push(`${col(tf.columnName)} BETWEEN ? AND ?`);
    params.push(range.from, tf.dataType === "datetime" ? `${range.to} 23:59:59` : range.to);
  }
  where.push(`(${scope.sql})`);
  params.push(...scope.params);

  for (const flt of spec.filters ?? []) {
    const c = col(field(ds, flt.field).columnName);
    if (!OPS.includes(flt.op)) throw new AnalyticsError(`Unknown filter "${flt.op}"`);
    const list = () => {
      const v = Array.isArray(flt.value) ? flt.value : [flt.value];
      if (!v.length || v.length > 500) throw new AnalyticsError("A list filter needs at least one value (max 500)");
      return v;
    };
    switch (flt.op) {
      case "eq": where.push(`${c} = ?`); params.push(flt.value); break;
      case "neq": where.push(`${c} <> ?`); params.push(flt.value); break;
      case "gt": where.push(`${c} > ?`); params.push(flt.value); break;
      case "gte": where.push(`${c} >= ?`); params.push(flt.value); break;
      case "lt": where.push(`${c} < ?`); params.push(flt.value); break;
      case "lte": where.push(`${c} <= ?`); params.push(flt.value); break;
      case "in": case "not_in": { const v = list(); where.push(`${c} ${flt.op === "in" ? "IN" : "NOT IN"} (${v.map(() => "?").join(",")})`); params.push(...v); break; }
      case "between": { const v = list(); if (v.length !== 2) throw new AnalyticsError("between needs two values"); where.push(`${c} BETWEEN ? AND ?`); params.push(v[0], v[1]); break; }
      case "contains": where.push(`${c} LIKE ?`); params.push(`%${likeEscape(String(flt.value ?? ""))}%`); break;
      case "starts_with": where.push(`${c} LIKE ?`); params.push(`${likeEscape(String(flt.value ?? ""))}%`); break;
      case "is_null": where.push(`${c} IS NULL`); break;
      case "not_null": where.push(`${c} IS NOT NULL`); break;
    }
  }

  const keys = new Set(columns.map((c) => c.key));
  const order = (spec.sort ?? []).map((s) => {
    if (!keys.has(s.key)) throw new AnalyticsError(`Cannot sort by "${s.key}"`);
    return `\`${s.key}\` ${s.dir === "desc" ? "DESC" : "ASC"}`;
  });
  if (!order.length && dims.length) order.push("1 ASC");

  const limit = Math.max(1, Math.min(Math.floor(Number(spec.limit) || ds.maxRows), ds.maxRows));
  const sql = [
    `SELECT /*+ MAX_EXECUTION_TIME(${EXEC_MS}) */ ${select.join(", ")}`,
    `FROM \`${ds.sourceTable}\` t`,
    ...joins,
    `WHERE ${where.join(" AND ")}`,
    dims.length ? `GROUP BY ${dims.map((_, i) => i + 1).join(", ")}` : "",
    order.length ? `ORDER BY ${order.join(", ")}` : "",
    // One extra row tells the caller the result was cut off.
    `LIMIT ${limit + 1}`,
  ].filter(Boolean).join("\n");
  return { sql, params, columns, limit, capped: limit === ds.maxRows };
}
