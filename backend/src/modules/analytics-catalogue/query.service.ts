import type { RowDataPacket } from "mysql2";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";
import { db } from "../../db/mysql.js";
import { AnalyticsError, type QueryResult, type QuerySpec } from "./analytics.types.js";
import { getDataset, poolFor } from "./catalogue.service.js";
import { resolveRange, shiftRange, type Range } from "./date-range.js";
import { compileQuery } from "./query-compiler.js";
import { ANALYTICS_VIEWER_ROLES, buildDatasetScope } from "./scope.js";

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; p: Promise<QueryResult> }>();

const pad = (n: number) => String(n).padStart(2, "0");
function norm(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) && v.length < 18) return Number(v);
  if (Buffer.isBuffer(v)) return v.toString("utf8");
  return String(v);
}

async function execute(spec: QuerySpec, userId: string, range: Range | null, dimsOverride?: QuerySpec["dimensions"]) {
  const ds = await getDataset(spec.dataset);
  const scope = await buildDatasetScope(userId, ds, spec.scope ?? {});
  const compiled = compileQuery(ds, { ...spec, dimensions: dimsOverride ?? spec.dimensions, sort: dimsOverride ? [] : spec.sort }, scope, range);
  const pool = await poolFor(ds.connection);
  const [rows] = await (pool as typeof db).query<RowDataPacket[]>(compiled.sql, compiled.params as never[]);
  return { compiled, rows: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, norm(v)]))) };
}

/** Run a spec as this viewer. Scope is always the viewer's; results cached 60 s per viewer and spec. */
export function runQuery(userId: string, spec: QuerySpec): Promise<QueryResult> {
  if (!spec || typeof spec.dataset !== "string") throw new AnalyticsError("A query needs a dataset");
  const key = `${userId}|${JSON.stringify(spec)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.p;
  const p = (async (): Promise<QueryResult> => {
    const range = resolveRange(spec.dateRange);
    const { compiled, rows } = await execute(spec, userId, range);
    const over = rows.length > compiled.limit;
    const out = over ? rows.slice(0, compiled.limit) : rows;
    // Only a hit on the dataset's own cap is "truncated"; a user's top-N is what they asked for.
    const truncated = over && compiled.capped;
    const totals = await totalsFor(spec, userId, range, out, compiled.columns.length);
    let compare: QueryResult["compare"];
    if (spec.compare && range) {
      const prev = shiftRange(range, spec.compare);
      const t = await execute(spec, userId, prev, []);
      compare = { range: prev, totals: pickMeasures(t.rows[0] ?? {}) };
    }
    return { columns: compiled.columns, rows: out, truncated, range, compare, totals, generatedAt: new Date().toISOString() };
  })();
  cache.set(key, { at: Date.now(), p });
  p.catch(() => cache.delete(key));
  if (cache.size > 500) { const k = cache.keys().next().value; if (k) cache.delete(k); }
  return p;
}

const pickMeasures = (r: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(r).filter(([k]) => /^m\d+$/.test(k)).map(([k, v]) => [k, typeof v === "number" ? v : v === null ? null : Number(v)]));

/** Grand totals: exact (re-aggregated by SQL) so averages and distinct counts are right, not summed rows. */
async function totalsFor(spec: QuerySpec, userId: string, range: Range | null, rows: Array<Record<string, unknown>>, _cols: number) {
  if (!spec.dimensions?.length) return pickMeasures(rows[0] ?? {});
  const t = await execute(spec, userId, range, []);
  return pickMeasures(t.rows[0] ?? {});
}

/** Branches and processes the viewer can narrow to (the filter bar options). */
export async function scopeOptions(userId: string) {
  const c = await buildScopeWhereClause(userId, ANALYTICS_VIEWER_ROLES, { processId: "p.id", branchId: "p.branch_id" }, { allowAdminBypass: true, allowCeoAllRead: true });
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT p.id, p.process_name, p.process_code, p.branch_id, b.branch_name
       FROM process_master p LEFT JOIN branch_master b ON b.id = p.branch_id
      WHERE p.active_status = 1 AND (${c.sql}) ORDER BY p.process_name`, c.params as never[]);
  const branches = new Map<string, string>();
  for (const r of rows) if (r.branch_id) branches.set(String(r.branch_id), String(r.branch_name ?? r.branch_id));
  return {
    processes: rows.map((r) => ({ id: String(r.id), name: String(r.process_name), code: r.process_code ?? null, branchId: r.branch_id ?? null })),
    branches: [...branches].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Distinct values of one field (filter pickers), within the viewer's scope. */
export async function fieldValues(userId: string, dataset: string, field: string, search = ""): Promise<string[]> {
  const spec: QuerySpec = {
    dataset, dimensions: [{ field }], measures: [{ agg: "count" }], limit: 200, dateRange: { preset: "last_90" },
    filters: search ? [{ field, op: "contains", value: search.slice(0, 60) }] : [], sort: [{ key: "m0", dir: "desc" }],
  };
  const r = await runQuery(userId, spec);
  return r.rows.map((x) => x.d0).filter((v) => v !== null).map(String);
}
