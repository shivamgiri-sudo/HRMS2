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
      const tableKey = key(row.table_schema, row.table_name);
      if (!tables.has(tableKey)) tables.set(tableKey, new Map());
      tables.get(tableKey)!.set(row.column_name.toLowerCase(), {
        schema: row.table_schema,
        table: row.table_name,
        column: row.column_name,
        dataType: row.data_type,
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
    expression: `${alias}.${quoteIdentifier(column.column)}`,
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
