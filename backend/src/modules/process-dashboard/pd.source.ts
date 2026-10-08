/**
 * Process Dashboard -- the ONLY code that reads an admin-mapped APR table.
 *
 * Safety model (an admin names a table and columns; none of it is trusted):
 *  - schema must be in ALLOWED_SCHEMAS; schema/table/column names pass assertSafeIdentifier (single part) AND are looked up in
 *    information_schema -- the name that reaches SQL text is the one information_schema returned, never the caller's string;
 *  - values (dates, process_filter value, agent code) are bound parameters;
 *  - every read runs in START TRANSACTION READ ONLY on its own connection, with a MAX_EXECUTION_TIME hint and a hard LIMIT;
 *  - sensitive tables / columns (credentials, payroll, PII) are refused.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { assertSafeIdentifier } from "../integration-hub/adapters/databaseAdapter.js";
import { ALLOWED_SCHEMAS, FIELD_KEYS, SENSITIVE_COLUMN_RE, SENSITIVE_TABLE_RE, fieldKind, type CategoryOrUnconfigured, type TimeUnit } from "./pd.fields.js";
import { compatible, typeClass, type ColumnInfo } from "./pd.suggest.js";
import { newStats, normalizeRow, type NormRow, type NormStats } from "./pd.metrics.js";

export class PdError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export interface ProcessFilter { column: string; value: string | number | boolean }
export interface PdConfig {
  processId: string; category: CategoryOrUnconfigured; label: string | null;
  aprSchema: string | null; aprTable: string | null; columnMap: Record<string, string>;
  timeUnit: TimeUnit; processFilter: ProcessFilter | null; refreshSeconds: number; enabled: boolean;
  configuredBy: string | null; updatedAt: string | null;
}

export const MAX_SOURCE_ROWS = 150_000;
const QUERY_TIMEOUT_MS = 20_000;

export function assertSourceName(schema: string, table: string): { schema: string; table: string } {
  const s = String(schema ?? "").trim(); const t = String(table ?? "").trim();
  if (!(ALLOWED_SCHEMAS as readonly string[]).includes(s)) throw new PdError(400, "SCHEMA_NOT_ALLOWED", `Schema must be one of: ${ALLOWED_SCHEMAS.join(", ")}`);
  if (t.includes(".")) throw new PdError(400, "BAD_IDENTIFIER", "Table name must not contain a dot");
  try { assertSafeIdentifier(t, "table"); } catch { throw new PdError(400, "BAD_IDENTIFIER", "Invalid table name"); }
  if (SENSITIVE_TABLE_RE.test(t)) throw new PdError(400, "TABLE_NOT_ALLOWED", "That table holds credentials or payroll data and cannot be used");
  return { schema: s, table: t };
}

export const quoteIdent = (name: string): string => {
  if (name.includes(".") || name.includes("`")) throw new PdError(400, "BAD_IDENTIFIER", "Invalid identifier");
  assertSafeIdentifier(name);
  return `\`${name}\``;
};

type Conn = Awaited<ReturnType<typeof db.getConnection>>;
/** Run fn on a connection that cannot write: START TRANSACTION READ ONLY, rolled back afterwards. */
export async function withReadOnly<T>(fn: (conn: Conn) => Promise<T>): Promise<T> {
  const conn = await db.getConnection();
  try {
    await conn.query("SET SESSION information_schema_stats_expiry = 0").catch(() => undefined);
    await conn.query("START TRANSACTION READ ONLY");
    try { return await fn(conn); } finally { await conn.query("ROLLBACK").catch(() => undefined); }
  } finally { conn.release(); }
}

export async function listTables(schema: string): Promise<Array<{ table: string; rows: number | null; updatedAt: string | null }>> {
  const { schema: s } = assertSourceName(schema, "x");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT TABLE_NAME AS t, TABLE_ROWS AS r, UPDATE_TIME AS u FROM information_schema.tables
      WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME LIMIT 3000`, [s]);
  return rows.filter((r) => !SENSITIVE_TABLE_RE.test(String(r.t)))
    .map((r) => ({ table: String(r.t), rows: r.r === null ? null : Number(r.r), updatedAt: r.u ? String(r.u) : null }));
}

export async function listColumns(schema: string, table: string): Promise<ColumnInfo[]> {
  const src = assertSourceName(schema, table);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COLUMN_NAME AS c, DATA_TYPE AS d, COLUMN_TYPE AS ct FROM information_schema.columns
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION LIMIT 600`, [src.schema, src.table]);
  if (!rows.length) throw new PdError(404, "TABLE_NOT_FOUND", `${src.schema}.${src.table} does not exist`);
  return rows.map((r) => ({ name: String(r.c), dataType: String(r.d), columnType: String(r.ct) }));
}

export interface MapProblem { field: string; message: string }
/** Check a column_map against the verified columns. Returns the map with names replaced by information_schema's spelling, plus problems. */
export function verifyColumnMap(columnMap: Record<string, string>, columns: ColumnInfo[], processFilter: ProcessFilter | null): { map: Record<string, string>; filterColumn: string | null; problems: MapProblem[] } {
  const byLower = new Map(columns.map((c) => [c.name.toLowerCase(), c]));
  const problems: MapProblem[] = []; const map: Record<string, string> = {}; const seen = new Map<string, string>();
  for (const [field, col] of Object.entries(columnMap)) {
    if (!FIELD_KEYS.includes(field)) { problems.push({ field, message: `Unknown canonical field "${field}"` }); continue; }
    const c = byLower.get(String(col).toLowerCase());
    if (!c) { problems.push({ field, message: `Column "${col}" does not exist in the table` }); continue; }
    if (SENSITIVE_COLUMN_RE.test(c.name)) { problems.push({ field, message: `Column "${c.name}" looks like personal/financial data and cannot be mapped` }); continue; }
    try { quoteIdent(c.name); } catch { problems.push({ field, message: `Column "${c.name}" has characters that are not supported` }); continue; }
    const kind = fieldKind(field)!;
    if (!compatible(kind, typeClass(c.dataType))) { problems.push({ field, message: `Column "${c.name}" is ${c.dataType}; ${field} needs a ${kind === "date" ? "DATE/DATETIME" : kind === "text" ? "text" : "numeric/time"} column` }); continue; }
    if (seen.has(c.name.toLowerCase())) { problems.push({ field, message: `Column "${c.name}" is already mapped to ${seen.get(c.name.toLowerCase())}` }); continue; }
    seen.set(c.name.toLowerCase(), field); map[field] = c.name;
  }
  let filterColumn: string | null = null;
  if (processFilter) {
    const c = byLower.get(String(processFilter.column).toLowerCase());
    if (!c) problems.push({ field: "process_filter", message: `Filter column "${processFilter.column}" does not exist in the table` });
    else { filterColumn = c.name; try { quoteIdent(c.name); } catch { problems.push({ field: "process_filter", message: "Filter column has unsupported characters" }); filterColumn = null; } }
  }
  return { map, filterColumn, problems };
}

export interface SelectOpts { from?: string; to?: string; agentCode?: string; date?: string; limit: number; order?: "asc" | "desc" }
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Pure: builds the SELECT from a VERIFIED map (names already resolved through information_schema). */
export function buildSelectSql(cfg: { aprSchema: string; aprTable: string }, map: Record<string, string>, filterColumn: string | null, processFilter: ProcessFilter | null, opts: SelectOpts): { sql: string; params: unknown[] } {
  const src = assertSourceName(cfg.aprSchema, cfg.aprTable);
  if (!map.date || !map.agent_code) throw new PdError(400, "UNMAPPED_REQUIRED", "agent_code and date must be mapped");
  const limit = Math.floor(Number(opts.limit));
  if (!Number.isFinite(limit) || limit < 1 || limit > MAX_SOURCE_ROWS + 1) throw new PdError(400, "BAD_LIMIT", "Invalid limit");
  const dateCol = quoteIdent(map.date);
  const sel = Object.entries(map).map(([f, c]) => (f === "date" ? `DATE_FORMAT(${quoteIdent(c)}, '%Y-%m-%d') AS \`date\`` : `${quoteIdent(c)} AS \`${f}\``));
  const where: string[] = []; const params: unknown[] = [];
  for (const d of [opts.from, opts.to, opts.date]) if (d !== undefined && !ISO.test(d)) throw new PdError(400, "BAD_DATE", "Dates must be YYYY-MM-DD");
  if (opts.date) { where.push(`${dateCol} >= ? AND ${dateCol} < DATE_ADD(?, INTERVAL 1 DAY)`); params.push(opts.date, opts.date); }
  if (opts.from) { where.push(`${dateCol} >= ?`); params.push(opts.from); }
  if (opts.to) { where.push(`${dateCol} < DATE_ADD(?, INTERVAL 1 DAY)`); params.push(opts.to); }
  if (opts.agentCode) { where.push(`${quoteIdent(map.agent_code)} = ?`); params.push(opts.agentCode); }
  if (processFilter && filterColumn) { where.push(`${quoteIdent(filterColumn)} = ?`); params.push(processFilter.value); }
  const order = opts.order === "desc" ? "DESC" : "ASC";
  const sql = `SELECT /*+ MAX_EXECUTION_TIME(${QUERY_TIMEOUT_MS}) */ ${sel.join(", ")} FROM ${quoteIdent(src.schema)}.${quoteIdent(src.table)}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY ${dateCol} ${order}, ${quoteIdent(map.agent_code)} ASC LIMIT ${limit}`;
  return { sql, params };
}

export interface Resolved { cfg: PdConfig & { aprSchema: string; aprTable: string }; map: Record<string, string>; filterColumn: string | null; mapped: Set<string> }

/** Verify the stored config against information_schema right now (the table may have been altered since it was saved). */
export async function resolveConfig(cfg: PdConfig): Promise<Resolved> {
  if (!cfg.aprSchema || !cfg.aprTable) throw new PdError(409, "NOT_CONFIGURED", "This process has no APR table configured");
  const columns = await listColumns(cfg.aprSchema, cfg.aprTable);
  const v = verifyColumnMap(cfg.columnMap, columns, cfg.processFilter);
  if (v.problems.length) throw new PdError(409, "CONFIG_STALE", `Mapping no longer valid: ${v.problems.map((p) => p.message).join("; ")}`);
  if (!v.map.agent_code || !v.map.date) throw new PdError(409, "UNMAPPED_REQUIRED", "agent_code and date must be mapped");
  return { cfg: cfg as Resolved["cfg"], map: v.map, filterColumn: v.filterColumn, mapped: new Set(Object.keys(v.map)) };
}

export interface FetchResult { rows: NormRow[]; stats: NormStats; truncated: boolean }
export async function fetchRows(r: Resolved, opts: Omit<SelectOpts, "limit"> & { limit?: number }): Promise<FetchResult> {
  const limit = opts.limit ?? MAX_SOURCE_ROWS;
  const { sql, params } = buildSelectSql(r.cfg, r.map, r.filterColumn, r.cfg.processFilter, { ...opts, limit: limit + 1 });
  const raw = await withReadOnly(async (conn) => (await conn.query<RowDataPacket[]>(sql, params))[0]);
  const stats = newStats(); const rows: NormRow[] = [];
  const truncated = raw.length > limit;
  for (const rec of raw.slice(0, limit)) { const n = normalizeRow(rec as Record<string, unknown>, r.cfg.timeUnit, stats); if (n) rows.push(n); }
  return { rows, stats, truncated };
}

export interface Freshness { lastDataAt: string | null; latestDate: string | null; earliestDate: string | null; rows: number }
export async function readFreshness(r: Resolved): Promise<Freshness> {
  const src = assertSourceName(r.cfg.aprSchema, r.cfg.aprTable);
  const dateCol = quoteIdent(r.map.date);
  const where = r.cfg.processFilter && r.filterColumn ? ` WHERE ${quoteIdent(r.filterColumn)} = ?` : "";
  const params = where ? [r.cfg.processFilter!.value] : [];
  return withReadOnly(async (conn) => {
    const [a] = await conn.query<RowDataPacket[]>(
      `SELECT /*+ MAX_EXECUTION_TIME(${QUERY_TIMEOUT_MS}) */ DATE_FORMAT(MAX(${dateCol}), '%Y-%m-%d') AS mx, DATE_FORMAT(MIN(${dateCol}), '%Y-%m-%d') AS mn, COUNT(*) AS n
         FROM ${quoteIdent(src.schema)}.${quoteIdent(src.table)}${where}`, params);
    const [t] = await conn.query<RowDataPacket[]>(
      `SELECT UPDATE_TIME AS u FROM information_schema.tables WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1`, [src.schema, src.table]);
    return { latestDate: a[0]?.mx ?? null, earliestDate: a[0]?.mn ?? null, rows: Number(a[0]?.n ?? 0), lastDataAt: t[0]?.u ? String(t[0].u) : null };
  });
}

/** Cheap change fingerprint of one day's rows: row count plus the sum of every mapped numeric column. */
export async function readDayFingerprint(r: Resolved, date: string): Promise<string> {
  const src = assertSourceName(r.cfg.aprSchema, r.cfg.aprTable);
  if (!ISO.test(date)) throw new PdError(400, "BAD_DATE", "Dates must be YYYY-MM-DD");
  const dateCol = quoteIdent(r.map.date);
  const sums = Object.entries(r.map).filter(([f]) => ["count", "money", "time"].includes(fieldKind(f) ?? ""))
    .map(([, c], i) => `, COALESCE(SUM(CAST(${quoteIdent(c)} AS DECIMAL(24,4))), 0) AS s${i}`).join("");
  const where = [`${dateCol} >= ? AND ${dateCol} < DATE_ADD(?, INTERVAL 1 DAY)`]; const params: unknown[] = [date, date];
  if (r.cfg.processFilter && r.filterColumn) { where.push(`${quoteIdent(r.filterColumn)} = ?`); params.push(r.cfg.processFilter.value); }
  return withReadOnly(async (conn) => {
    const [a] = await conn.query<RowDataPacket[]>(
      `SELECT /*+ MAX_EXECUTION_TIME(${QUERY_TIMEOUT_MS}) */ COUNT(*) AS n${sums} FROM ${quoteIdent(src.schema)}.${quoteIdent(src.table)} WHERE ${where.join(" AND ")}`, params);
    return JSON.stringify(a[0] ?? {});
  });
}
