import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import type { Pool } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { NAMED_POOLS } from "../kpi/kpi-studio.pools.js";
import { AnalyticsError, type Dataset, type DatasetField } from "./analytics.types.js";
import { guessField, validateDatasetInput } from "./catalogue.validate.js";
import { isOrgWide } from "./scope.js";

/** Registry reads/writes. Cached 60 s because every query loads its dataset. */

const CACHE_MS = 60_000;
let cache: { at: number; list: Dataset[] } | null = null;
export function invalidateCatalogue(): void { cache = null; }

function mapField(r: RowDataPacket): DatasetField {
  return {
    fieldKey: String(r.field_key), label: String(r.label), columnName: String(r.column_name), role: r.role, dataType: r.data_type,
    defaultAgg: r.default_agg, format: r.format, lookup: r.lookup, description: r.description ?? null,
    sortOrder: Number(r.sort_order), hidden: Boolean(r.hidden),
  };
}

async function loadAll(): Promise<Dataset[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.list;
  const [ds] = await db.query<RowDataPacket[]>("SELECT * FROM analytics_dataset WHERE active_status = 1 ORDER BY category, name");
  const [fs] = await db.query<RowDataPacket[]>(
    "SELECT f.* FROM analytics_dataset_field f JOIN analytics_dataset d ON d.id = f.dataset_id WHERE d.active_status = 1 ORDER BY f.sort_order, f.label");
  const byDs = new Map<string, DatasetField[]>();
  for (const f of fs) { const k = String(f.dataset_id); if (!byDs.has(k)) byDs.set(k, []); byDs.get(k)!.push(mapField(f)); }
  const list: Dataset[] = ds.map((r) => ({
    id: String(r.id), code: String(r.code), name: String(r.name), description: r.description ?? null, category: r.category ?? null,
    connection: String(r.connection), sourceTable: String(r.source_table), timeField: r.time_field ?? null, scopeMode: r.scope_mode,
    processColumn: r.process_column ?? null, branchColumn: r.branch_column ?? null, employeeColumn: r.employee_column ?? null,
    scopeProcessId: r.scope_process_id ?? null, maxRows: Number(r.max_rows), fields: byDs.get(String(r.id)) ?? [],
  }));
  cache = { at: Date.now(), list };
  return list;
}

export async function getDataset(code: string): Promise<Dataset> {
  const ds = (await loadAll()).find((d) => d.code === code);
  if (!ds) throw new AnalyticsError(`No dataset "${code}"`, "NOT_FOUND");
  return ds;
}

/** Datasets this viewer can use. Organisation-wide datasets are hidden from scoped viewers; hidden fields never leave. */
export async function listDatasets(userId: string): Promise<Array<Omit<Dataset, "sourceTable" | "processColumn" | "branchColumn" | "employeeColumn"> & { sourceTable?: string }>> {
  const all = await loadAll();
  const orgWide = await isOrgWide(userId);
  return all
    .filter((d) => orgWide || d.scopeMode !== "org")
    .map((d) => ({
      id: d.id, code: d.code, name: d.name, description: d.description, category: d.category, connection: d.connection,
      timeField: d.timeField, scopeMode: d.scopeMode, scopeProcessId: d.scopeProcessId, maxRows: d.maxRows,
      fields: d.fields.filter((f) => !f.hidden).map((f) => ({ ...f, columnName: orgWide ? f.columnName : "" })),
      ...(orgWide ? { sourceTable: d.sourceTable } : {}),
    }));
}

/** Full definition for the admin editor. */
export async function getDatasetForEdit(code: string): Promise<Dataset> { return getDataset(code); }

async function assertColumnsExist(input: ReturnType<typeof validateDatasetInput>): Promise<void> {
  const cols = await tableColumns(input.connection, input.sourceTable);
  if (!cols.length) throw new AnalyticsError(`Table ${input.sourceTable} was not found on ${input.connection}`, "INVALID_DATASET");
  const have = new Set(cols.map((c) => c.column.toLowerCase()));
  const used = [
    ...input.fields.map((f) => f.columnName), input.processColumn, input.branchColumn, input.employeeColumn,
  ].filter((x): x is string => !!x);
  const missing = used.filter((c) => !have.has(c.toLowerCase()));
  if (missing.length) throw new AnalyticsError(`Columns not in ${input.sourceTable}: ${[...new Set(missing)].join(", ")}`, "INVALID_DATASET");
}

export async function saveDataset(raw: Record<string, unknown>, userId: string, existingCode?: string): Promise<Dataset> {
  const input = validateDatasetInput(raw);
  await assertColumnsExist(input);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [ex] = await conn.query<RowDataPacket[]>("SELECT id FROM analytics_dataset WHERE code = ? LIMIT 1", [existingCode ?? input.code]);
    const id = ex[0]?.id ? String(ex[0].id) : randomUUID();
    if (existingCode && !ex.length) throw new AnalyticsError(`No dataset "${existingCode}"`, "NOT_FOUND");
    if (!existingCode && ex.length) throw new AnalyticsError(`A dataset with code "${input.code}" already exists`, "INVALID_DATASET");
    await conn.query(
      `INSERT INTO analytics_dataset (id, code, name, description, category, connection, source_table, time_field, scope_mode,
         process_column, branch_column, employee_column, scope_process_id, max_rows, active_status, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), description=VALUES(description), category=VALUES(category), connection=VALUES(connection),
         source_table=VALUES(source_table), time_field=VALUES(time_field), scope_mode=VALUES(scope_mode), process_column=VALUES(process_column),
         branch_column=VALUES(branch_column), employee_column=VALUES(employee_column), scope_process_id=VALUES(scope_process_id),
         max_rows=VALUES(max_rows), active_status=1`,
      [id, input.code, input.name, input.description, input.category, input.connection, input.sourceTable, input.timeField, input.scopeMode,
        input.processColumn, input.branchColumn, input.employeeColumn, input.scopeProcessId, input.maxRows, userId]);
    await conn.query("DELETE FROM analytics_dataset_field WHERE dataset_id = ?", [id]);
    for (const f of input.fields) {
      await conn.query(
        `INSERT INTO analytics_dataset_field (id, dataset_id, field_key, label, column_name, role, data_type, default_agg, format, lookup, description, sort_order, hidden)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [randomUUID(), id, f.fieldKey, f.label, f.columnName, f.role, f.dataType, f.defaultAgg, f.format, f.lookup, f.description, f.sortOrder, f.hidden ? 1 : 0]);
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  invalidateCatalogue();
  return getDataset(input.code);
}

export async function archiveDataset(code: string): Promise<void> {
  await db.query("UPDATE analytics_dataset SET active_status = 0 WHERE code = ?", [code]);
  invalidateCatalogue();
}

export async function poolFor(connection: string): Promise<Pool | typeof db> {
  if (connection === "hrms") return db;
  const p = NAMED_POOLS[connection];
  if (!p) throw new AnalyticsError(`Unknown connection "${connection}"`, "INVALID_DATASET");
  return p.get();
}

/** Tables on a connection, for the admin picker. */
export async function listTables(connection: string): Promise<string[]> {
  const pool = await poolFor(connection);
  const [rows] = await (pool as typeof db).query<RowDataPacket[]>(
    "SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME LIMIT 3000");
  return rows.map((r) => String(r.t));
}

export async function tableColumns(connection: string, table: string): Promise<Array<{ column: string; type: string }>> {
  const [schema, name] = table.includes(".") ? table.split(".") : [null, table];
  const pool = await poolFor(connection);
  const [rows] = await (pool as typeof db).query<RowDataPacket[]>(
    `SELECT COLUMN_NAME c, DATA_TYPE d FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ${schema ? "?" : "DATABASE()"} AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
    schema ? [schema, name] : [name]);
  return rows.map((r) => ({ column: String(r.c), type: String(r.d) }));
}

/** Columns of a table with a first guess at each field, for the "register a dataset" screen. */
export async function introspect(connection: string, table: string) {
  const cols = await tableColumns(connection, table);
  if (!cols.length) throw new AnalyticsError(`Table ${table} was not found on ${connection}`, "NOT_FOUND");
  const fields = cols.map((c, i) => ({ ...guessField(c.column, c.type), sortOrder: i + 1, description: null, hidden: false, sqlType: c.type }));
  const has = (n: string) => cols.some((c) => c.column === n);
  const suggestion = has("process_id") && has("branch_id") ? "process_branch" : has("process_id") ? "process" : has("branch_id") ? "branch" : has("employee_id") ? "employee" : connection === "hrms" ? "org" : "constant";
  return {
    fields, suggestedScopeMode: suggestion,
    suggestedTimeField: fields.find((f) => f.role === "time")?.fieldKey ?? null,
  };
}
