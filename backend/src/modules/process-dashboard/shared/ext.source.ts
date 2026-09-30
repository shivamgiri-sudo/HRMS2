/**
 * Process Dashboard (sales / outbound) -- read-only, whitelisted access to an admin-named source table.
 * Reuses the safety of pd.source.ts: schema whitelist (db_masmis / mas_hrms), assertSafeIdentifier via quoteIdent, names confirmed in
 * information_schema (the spelling that reaches SQL text is the one information_schema returned), personal-data columns refused,
 * bound values, START TRANSACTION READ ONLY on its own connection, MAX_EXECUTION_TIME and a hard LIMIT.
 */
import type { RowDataPacket } from "mysql2";
import { PdError, assertSourceName, listColumns, quoteIdent, withReadOnly } from "../pd.source.js";
import { SENSITIVE_COLUMN_RE } from "../pd.fields.js";
import { scoreHeader, typeClass, type ColumnInfo, type TypeClass } from "../pd.suggest.js";

export type ExtKind = "text" | "date" | "number" | "time";
export interface ExtField { key: string; label: string; kind: ExtKind; required: boolean; synonyms: string[] }
export interface ExtFilter { column: string; value: string }
export interface ExtSource { schema: string; table: string; filter: ExtFilter | null }
export interface Verified { map: Record<string, string>; filterColumn: string | null; columns: ColumnInfo[]; problems: Array<{ field: string; message: string }> }

export const MAX_EXT_ROWS = 200_000;
const QUERY_TIMEOUT_MS = 20_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function compatibleExt(kind: ExtKind, tc: TypeClass): boolean {
  switch (kind) {
    case "date": return tc === "date";
    case "time": return tc === "time";
    case "text": return tc === "text" || tc === "numeric";
    case "number": return tc === "numeric" || tc === "text";
  }
}

/** Pure: check a canonical->column map against the table's real columns. Names come back in information_schema's spelling. */
export function verifyExtMap(columnMap: Record<string, string>, columns: ColumnInfo[], fields: ExtField[], filter: ExtFilter | null): Omit<Verified, "columns"> {
  const byLower = new Map(columns.map((c) => [c.name.toLowerCase(), c]));
  const problems: Verified["problems"] = []; const map: Record<string, string> = {}; const seen = new Map<string, string>();
  for (const [field, col] of Object.entries(columnMap)) {
    const spec = fields.find((f) => f.key === field);
    if (!spec) { problems.push({ field, message: `Unknown field "${field}"` }); continue; }
    const c = byLower.get(String(col).toLowerCase());
    if (!c) { problems.push({ field, message: `Column "${col}" does not exist in the table` }); continue; }
    if (SENSITIVE_COLUMN_RE.test(c.name)) { problems.push({ field, message: `Column "${c.name}" looks like personal/financial data and cannot be mapped` }); continue; }
    try { quoteIdent(c.name); } catch { problems.push({ field, message: `Column "${c.name}" has characters that are not supported` }); continue; }
    if (!compatibleExt(spec.kind, typeClass(c.dataType))) { problems.push({ field, message: `Column "${c.name}" is ${c.dataType}; ${spec.label} needs a ${spec.kind === "date" ? "DATE/DATETIME" : spec.kind === "time" ? "TIME" : spec.kind === "number" ? "numeric" : "text"} column` }); continue; }
    if (seen.has(c.name.toLowerCase())) { problems.push({ field, message: `Column "${c.name}" is already mapped to ${seen.get(c.name.toLowerCase())}` }); continue; }
    seen.set(c.name.toLowerCase(), field); map[field] = c.name;
  }
  for (const f of fields) if (f.required && !map[f.key] && !problems.some((p) => p.field === f.key)) problems.push({ field: f.key, message: `${f.label} must be mapped` });
  let filterColumn: string | null = null;
  if (filter) {
    const c = byLower.get(String(filter.column).toLowerCase());
    if (!c) problems.push({ field: "filter", message: `Filter column "${filter.column}" does not exist in the table` });
    else if (SENSITIVE_COLUMN_RE.test(c.name)) problems.push({ field: "filter", message: `Filter column "${c.name}" looks like personal data` });
    else { try { quoteIdent(c.name); filterColumn = c.name; } catch { problems.push({ field: "filter", message: "Filter column has unsupported characters" }); } }
  }
  return { map, filterColumn, problems };
}

/** Pure: best column per field from header names (score >= 60), never a sensitive column, each column used once. */
export function suggestExtMap(columns: ColumnInfo[], fields: ExtField[]): { columnMap: Record<string, string>; unmatched: string[] } {
  const cands: Array<{ field: string; col: string; score: number }> = [];
  for (const f of fields) for (const c of columns) {
    if (SENSITIVE_COLUMN_RE.test(c.name) || !compatibleExt(f.kind, typeClass(c.dataType))) continue;
    const score = scoreHeader(c.name, f.synonyms);
    if (score >= 60) cands.push({ field: f.key, col: c.name, score });
  }
  cands.sort((a, b) => b.score - a.score || a.field.localeCompare(b.field) || a.col.localeCompare(b.col));
  const columnMap: Record<string, string> = {}; const used = new Set<string>();
  for (const c of cands) { if (columnMap[c.field] || used.has(c.col)) continue; columnMap[c.field] = c.col; used.add(c.col); }
  return { columnMap, unmatched: fields.filter((f) => !columnMap[f.key]).map((f) => f.key) };
}

/** Name + filter checks that need no DB (shape). Throws PdError 400. */
export function parseSource(schema: unknown, table: unknown, filter: unknown): ExtSource {
  const s = assertSourceName(String(schema ?? ""), String(table ?? ""));
  let f: ExtFilter | null = null;
  if (filter !== undefined && filter !== null) {
    const x = filter as { column?: unknown; value?: unknown };
    if (typeof x.column !== "string" || !(typeof x.value === "string" || typeof x.value === "number") || String(x.value).length > 191 || !String(x.value).length) throw new PdError(400, "INVALID_CONFIG", "filter must be {column, value}");
    quoteIdent(x.column);
    f = { column: x.column, value: String(x.value) };
  }
  return { schema: s.schema, table: s.table, filter: f };
}

export async function verifySource(src: ExtSource, columnMap: Record<string, string>, fields: ExtField[]): Promise<Verified> {
  const columns = await listColumns(src.schema, src.table);
  const v = verifyExtMap(columnMap, columns, fields, src.filter);
  return { ...v, columns };
}

export interface SelectOpts { from?: string; to?: string; agentCode?: string; limit: number }
const dateIsDateTime = (columns: ColumnInfo[], col: string) => /^(datetime|timestamp)$/i.test(columns.find((c) => c.name === col)?.dataType ?? "");

/** Pure: SELECT of the mapped columns of a VERIFIED map. `hour` is derived from the date column (DATETIME) or the optional time column. */
export function buildExtSelect(src: ExtSource, map: Record<string, string>, filterColumn: string | null, columns: ColumnInfo[], opts: SelectOpts): { sql: string; params: unknown[] } {
  const t = assertSourceName(src.schema, src.table);
  if (!map.date || !map.agent_code) throw new PdError(400, "UNMAPPED_REQUIRED", "agent_code and date must be mapped");
  const limit = Math.floor(Number(opts.limit));
  if (!Number.isFinite(limit) || limit < 1 || limit > MAX_EXT_ROWS + 1) throw new PdError(400, "BAD_LIMIT", "Invalid limit");
  for (const d of [opts.from, opts.to]) if (d !== undefined && !ISO.test(d)) throw new PdError(400, "BAD_DATE", "Dates must be YYYY-MM-DD");
  const dateCol = quoteIdent(map.date);
  const sel = Object.entries(map).map(([f, c]) => {
    if (f === "date") return `DATE_FORMAT(${quoteIdent(c)}, '%Y-%m-%d') AS \`date\``;
    if (f === "call_time") return `HOUR(${quoteIdent(c)}) AS \`hour\``;
    return `${quoteIdent(c)} AS \`${f}\``;
  });
  if (!map.call_time && dateIsDateTime(columns, map.date)) sel.push(`HOUR(${dateCol}) AS \`hour\``);
  const where: string[] = []; const params: unknown[] = [];
  if (opts.from) { where.push(`${dateCol} >= ?`); params.push(opts.from); }
  if (opts.to) { where.push(`${dateCol} < DATE_ADD(?, INTERVAL 1 DAY)`); params.push(opts.to); }
  if (opts.agentCode) { where.push(`${quoteIdent(map.agent_code)} = ?`); params.push(opts.agentCode); }
  if (src.filter && filterColumn) { where.push(`${quoteIdent(filterColumn)} = ?`); params.push(src.filter.value); }
  const sql = `SELECT /*+ MAX_EXECUTION_TIME(${QUERY_TIMEOUT_MS}) */ ${sel.join(", ")} FROM ${quoteIdent(t.schema)}.${quoteIdent(t.table)}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY ${dateCol} ASC LIMIT ${limit}`;
  return { sql, params };
}

export async function readRaw(sql: string, params: unknown[]): Promise<RowDataPacket[]> {
  return withReadOnly(async (conn) => (await conn.query<RowDataPacket[]>(sql, params))[0]);
}

export interface DistinctValue { value: string; rows: number }
/** Distinct values of one VERIFIED column over the newest `days` days of data (for status / disposition mapping). Values are data, shown as text. */
export async function readDistinct(src: ExtSource, map: Record<string, string>, filterColumn: string | null, field: string, limit = 200): Promise<{ values: DistinctValue[]; truncated: boolean }> {
  const t = assertSourceName(src.schema, src.table);
  if (!map[field] || !map.date) return { values: [], truncated: false };
  const col = quoteIdent(map[field]); const dateCol = quoteIdent(map.date);
  const where = src.filter && filterColumn ? ` AND ${quoteIdent(filterColumn)} = ?` : "";
  const params = where ? [src.filter!.value] : [];
  const rows = await withReadOnly(async (conn) => (await conn.query<RowDataPacket[]>(
    `SELECT /*+ MAX_EXECUTION_TIME(${QUERY_TIMEOUT_MS}) */ CAST(${col} AS CHAR(191)) AS v, COUNT(*) AS n FROM ${quoteIdent(t.schema)}.${quoteIdent(t.table)}
      WHERE ${dateCol} >= DATE_SUB((SELECT MAX(${dateCol}) FROM ${quoteIdent(t.schema)}.${quoteIdent(t.table)}), INTERVAL 90 DAY)${where}
      GROUP BY v ORDER BY n DESC LIMIT ${limit + 1}`, params))[0]);
  return { values: rows.slice(0, limit).map((r) => ({ value: r.v === null ? "" : String(r.v), rows: Number(r.n) })), truncated: rows.length > limit };
}

export interface Freshness { latestDate: string | null; earliestDate: string | null; rows: number }
export async function readExtFreshness(src: ExtSource, map: Record<string, string>, filterColumn: string | null): Promise<Freshness> {
  const t = assertSourceName(src.schema, src.table); const dateCol = quoteIdent(map.date);
  const where = src.filter && filterColumn ? ` WHERE ${quoteIdent(filterColumn)} = ?` : "";
  const params = where ? [src.filter!.value] : [];
  const r = await withReadOnly(async (conn) => (await conn.query<RowDataPacket[]>(
    `SELECT /*+ MAX_EXECUTION_TIME(${QUERY_TIMEOUT_MS}) */ DATE_FORMAT(MAX(${dateCol}), '%Y-%m-%d') AS mx, DATE_FORMAT(MIN(${dateCol}), '%Y-%m-%d') AS mn, COUNT(*) AS n FROM ${quoteIdent(t.schema)}.${quoteIdent(t.table)}${where}`, params))[0]);
  return { latestDate: r[0]?.mx ?? null, earliestDate: r[0]?.mn ?? null, rows: Number(r[0]?.n ?? 0) };
}

/** Cheap change fingerprint over the newest days: row count + max date. Used by the tab's live refresh. */
export async function readExtFingerprint(src: ExtSource, map: Record<string, string>, filterColumn: string | null): Promise<string> {
  const f = await readExtFreshness(src, map, filterColumn);
  return `${f.rows}|${f.latestDate ?? ""}`;
}

export const asJson = <T>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") { try { return JSON.parse(v) as T; } catch { return fallback; } }
  return v as T;
};
export const strList = (v: unknown, max = 200): string[] => (Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter((x) => x.length > 0 && x.length <= 191) : []).slice(0, max);
export const num = (v: unknown): number | null => { if (v === null || v === undefined || v === "") return null; const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, "").trim()); return Number.isFinite(n) ? n : null; };
export const norm = (v: unknown): string => String(v ?? "").trim().toLowerCase();
