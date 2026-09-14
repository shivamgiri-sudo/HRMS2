import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export interface SourceColumn {
  schema: string;
  table: string;
  column: string;
  dataType: string;
}

export interface SourceFieldLineage {
  sourceSchema: string;
  sourceTable: string;
  sourceColumn: string | null;
  transformation: string;
  confidence: "EXACT" | "DERIVED" | "UNAVAILABLE";
}

interface SchemaColumnRow extends RowDataPacket {
  current_schema: string;
  table_schema: string;
  table_name: string;
  column_name: string;
  data_type: string;
}

interface SchemaSnapshot {
  loadedAt: number;
  currentSchema: string;
  tables: Map<string, Map<string, SourceColumn>>;
}

const CACHE_TTL_MS = 60_000;
let snapshotPromise: Promise<SchemaSnapshot> | null = null;

function parseTableRef(tableRef: string) {
  const separator = tableRef.indexOf(".");
  if (separator < 0) return { schema: "__CURRENT__", table: tableRef };
  return { schema: tableRef.slice(0, separator), table: tableRef.slice(separator + 1) };
}

function key(schema: string, table: string) {
  return `${schema.toLowerCase()}.${table.toLowerCase()}`;
}

function quoteIdentifier(value: string) {
  return `\`${value.replace(/`/g, "``")}\``;
}

/**
 * MySQL binary types, which must never reach JSON unconverted.
 *
 * mysql2 returns BINARY/VARBINARY/BLOB as a Node Buffer, and JSON.stringify renders a Buffer as
 * {"type":"Buffer","data":[49,50,...]} rather than a readable value. Selecting such a column
 * needs CAST(... AS CHAR).
 *
 * Exactly one column in either source schema is binary today —
 * employee_bank_detail.account_number (varbinary(500)), surfaced by the BPO master reports as
 * BANK_ACCOUNT_NUMBER — but the check is by data type rather than by name so the next binary
 * column is handled without anyone remembering this.
 */
const BINARY_DATA_TYPES = new Set([
  "binary", "varbinary", "blob", "tinyblob", "mediumblob", "longblob",
]);

export function isBinarySourceType(dataType: string | null | undefined): boolean {
  return BINARY_DATA_TYPES.has(String(dataType ?? "").toLowerCase());
}

/** Reference a source column in SQL, CASTing binary types so they survive JSON. */
export function sourceColumnReference(alias: string, column: SourceColumn): string {
  const reference = `${alias}.${quoteIdentifier(column.column)}`;
  return isBinarySourceType(column.dataType) ? `CAST(${reference} AS CHAR)` : reference;
}

/**
 * Read an information_schema column whichever case the server labels it.
 *
 * This is not defensive padding — it is the whole reason this registry never worked. Against
 * mas_hrms the query below returns TABLE_SCHEMA / TABLE_NAME / COLUMN_NAME / DATA_TYPE in
 * UPPERCASE (measured: 13,092 rows, every key uppercase), while the loader read row.table_schema
 * and friends. Those were all `undefined`, so `key(undefined, undefined)` threw
 *
 *   TypeError: Cannot read properties of undefined (reading 'toLowerCase')
 *
 * on the FIRST row. loadSnapshot() rejects, the .catch below rethrows, and nothing between here
 * and the route catches it — so every BPO master report answered 500. The registry has only ever
 * had two commits, so this family has never worked against this database.
 *
 * The suite could not catch it either: tests/setup.ts mocks db.execute to `[[], []]`, so the loop
 * never runs and the snapshot resolves to an empty map. Only `current_schema` survived, because it
 * is explicitly aliased in the SELECT and therefore keeps the case it was written in.
 *
 * Both casings are accepted rather than just switching to uppercase: the label case depends on the
 * server, and hardcoding either one moves the breakage to the other configuration.
 */
function pick(row: Record<string, unknown>, column: string): string | undefined {
  const value = row[column] ?? row[column.toUpperCase()];
  return value === null || value === undefined ? undefined : String(value);
}

async function loadSnapshot(): Promise<SchemaSnapshot> {
  const now = Date.now();
  if (snapshotPromise) {
    const current = await snapshotPromise;
    if (now - current.loadedAt < CACHE_TTL_MS) return current;
  }

  snapshotPromise = db.execute<SchemaColumnRow[]>(
    `SELECT DATABASE() AS current_schema, table_schema, table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_schema IN (DATABASE(), 'db_audit')
      ORDER BY CASE WHEN table_schema = DATABASE() THEN 0 ELSE 1 END, table_schema, table_name, ordinal_position`
  ).then(([rows]) => {
    const currentSchema = String(rows[0]?.current_schema ?? "mas_hrms");
    const tables = new Map<string, Map<string, SourceColumn>>();
    for (const row of rows) {
      const tableSchema = pick(row, "table_schema");
      const tableName = pick(row, "table_name");
      const columnName = pick(row, "column_name");
      if (!tableSchema || !tableName || !columnName) continue;
      const tableKey = key(tableSchema, tableName);
      if (!tables.has(tableKey)) tables.set(tableKey, new Map());
      tables.get(tableKey)!.set(columnName.toLowerCase(), {
        schema: tableSchema,
        table: tableName,
        column: columnName,
        dataType: pick(row, "data_type") ?? "",
      });
    }
    return { loadedAt: Date.now(), currentSchema, tables };
  }).catch((error) => {
    snapshotPromise = null;
    throw error;
  });

  return snapshotPromise;
}

async function resolveTable(tableRef: string) {
  const snapshot = await loadSnapshot();
  const parsed = parseTableRef(tableRef);
  if (parsed.schema !== "__CURRENT__") {
    const columns = snapshot.tables.get(key(parsed.schema, parsed.table));
    return columns ? { schema: parsed.schema, table: parsed.table, columns } : null;
  }

  const currentColumns = snapshot.tables.get(key(snapshot.currentSchema, parsed.table));
  if (currentColumns) return { schema: snapshot.currentSchema, table: parsed.table, columns: currentColumns };

  const auditColumns = snapshot.tables.get(key("db_audit", parsed.table));
  if (auditColumns) return { schema: "db_audit", table: parsed.table, columns: auditColumns };
  return null;
}

export async function sourceTableExists(tableRef: string) {
  return Boolean(await resolveTable(tableRef));
}

export async function sourceColumns(tableRef: string) {
  return (await resolveTable(tableRef))?.columns ?? new Map<string, SourceColumn>();
}

export async function sourceHasColumns(tableRef: string, requiredColumns: string[]) {
  const columns = await sourceColumns(tableRef);
  return requiredColumns.every((column) => columns.has(column.toLowerCase()));
}

export async function firstSourceColumn(tableRef: string, candidates: string[]) {
  const columns = await sourceColumns(tableRef);
  for (const candidate of candidates) {
    const column = columns.get(candidate.toLowerCase());
    if (column) return column;
  }
  return null;
}

export async function sourceTableSql(tableRef: string) {
  const resolved = await resolveTable(tableRef);
  if (!resolved) return null;
  return `${quoteIdentifier(resolved.schema)}.${quoteIdentifier(resolved.table)}`;
}

export async function sourceExpression(
  alias: string,
  tableRef: string,
  candidates: string[],
  options: { transformation?: string; fallback?: string } = {}
) {
  const column = await firstSourceColumn(tableRef, candidates);
  if (!column) {
    return {
      expression: options.fallback ?? "NULL",
      lineage: {
        sourceSchema: parseTableRef(tableRef).schema,
        sourceTable: parseTableRef(tableRef).table,
        sourceColumn: null,
        transformation: "SOURCE COLUMN NOT PRESENT IN RUNTIME SCHEMA",
        confidence: "UNAVAILABLE" as const,
      },
    };
  }
  return {
    expression: sourceColumnReference(alias, column),
    lineage: {
      sourceSchema: column.schema,
      sourceTable: column.table,
      sourceColumn: column.column,
      transformation: options.transformation ?? "DIRECT",
      confidence: (options.transformation ? "DERIVED" : "EXACT") as "EXACT" | "DERIVED",
    },
  };
}

export function clearSourceRegistryCache() {
  snapshotPromise = null;
}

export async function describeSourceTable(tableRef: string) {
  const resolved = await resolveTable(tableRef);
  if (!resolved) {
    return {
      sourceSchema: parseTableRef(tableRef).schema,
      sourceTable: parseTableRef(tableRef).table,
      status: "MISSING" as const,
      columns: [] as SourceColumn[],
    };
  }
  return {
    sourceSchema: resolved.schema,
    sourceTable: resolved.table,
    status: "AVAILABLE" as const,
    columns: [...resolved.columns.values()],
  };
}
