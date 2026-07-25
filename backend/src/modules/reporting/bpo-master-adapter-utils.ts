import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { BranchScope } from "./reporting.scope.js";
import { getBpoMasterReport } from "./bpo-master-report-registry.js";
import type { SourceColumn, SourceFieldLineage } from "./bpo-master-source-registry.js";

export interface VerifiedAdapterFilters {
  month?: string;
  from?: string;
  to?: string;
  branchId?: string;
  processId?: string;
  employeeCode?: string;
  clientId?: string;
  limit: number;
  offset: number;
}

export interface VerificationSummary {
  runtimeSchemaVerified: true;
  exactMappedFieldCount: number;
  derivedMappedFieldCount: number;
  unavailableFieldCount: number;
  duplicateGrainCount: number;
  sourceRowCount: number;
  distinctGrainCount: number;
  accuracyStatus: "SCHEMA_VERIFIED" | "DUPLICATE_GRAIN_FOUND";
}

export interface VerifiedAdapterResult {
  rows: Record<string, unknown>[];
  totalCount: number;
  sourceTable: string;
  availableKeys: string[];
  lineage: Record<string, SourceFieldLineage>;
  verification: VerificationSummary;
}

export interface FieldSpec {
  expression: string;
  lineage: SourceFieldLineage;
}

const NO_SCOPE_SENTINEL = "__NO_BRANCH_SCOPE__";

export function quote(value: string) {
  return `\`${value.replace(/`/g, "``")}\``;
}

export function currentMonth(value?: string) {
  return /^\d{4}-\d{2}$/.test(String(value ?? ""))
    ? String(value)
    : new Date().toISOString().slice(0, 7);
}

export function dateBounds(filters: VerifiedAdapterFilters) {
  const reportMonth = currentMonth(filters.month);
  const [year, month] = reportMonth.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    reportMonth,
    from: filters.from ?? `${reportMonth}-01`,
    to: filters.to ?? `${reportMonth}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function directField(
  alias: string,
  tableRef: string,
  columns: Map<string, SourceColumn>,
  candidates: string[],
  transformation = "DIRECT"
): FieldSpec | null {
  for (const candidate of candidates) {
    const column = columns.get(candidate.toLowerCase());
    if (!column) continue;
    return {
      expression: `${alias}.${quote(column.column)}`,
      lineage: {
        sourceSchema: column.schema,
        sourceTable: column.table,
        sourceColumn: column.column,
        transformation,
        confidence: transformation === "DIRECT" ? "EXACT" : "DERIVED",
      },
    };
  }
  return null;
}

export function derivedField(
  sourceSchema: string,
  sourceTable: string,
  sourceColumn: string | null,
  expression: string,
  transformation: string
): FieldSpec {
  return {
    expression,
    lineage: {
      sourceSchema,
      sourceTable,
      sourceColumn,
      transformation,
      confidence: "DERIVED",
    },
  };
}

export function constantField(expression: string, transformation: string): FieldSpec {
  return derivedField("SYSTEM", "REPORT_ENGINE", null, expression, transformation);
}

export function addField(fields: Map<string, FieldSpec>, key: string, spec: FieldSpec | null | undefined) {
  if (spec) fields.set(key, spec);
}

export function branchScopeWhere(
  scope: BranchScope,
  filters: VerifiedAdapterFilters,
  expressions: { branch?: string | null; process?: string | null; employeeCode?: string | null }
) {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (!scope.isSuperAdmin && scope.branchIds.length > 0) {
    if (scope.branchIds.includes(NO_SCOPE_SENTINEL) || !expressions.branch) {
      clauses.push("1 = 0");
    } else if (filters.branchId) {
      clauses.push(`${expressions.branch} = ?`);
      params.push(filters.branchId);
    } else {
      clauses.push(`${expressions.branch} IN (${scope.branchIds.map(() => "?").join(",")})`);
      params.push(...scope.branchIds);
    }
  } else if (filters.branchId && expressions.branch) {
    clauses.push(`${expressions.branch} = ?`);
    params.push(filters.branchId);
  }

  if (filters.processId && expressions.process) {
    clauses.push(`${expressions.process} = ?`);
    params.push(filters.processId);
  }
  if (filters.employeeCode && expressions.employeeCode) {
    clauses.push(`${expressions.employeeCode} = ?`);
    params.push(filters.employeeCode);
  }
  return { clauses, params };
}

function normalize(code: string, rows: RowDataPacket[]) {
  const definition = getBpoMasterReport(code);
  if (!definition) return rows as Record<string, unknown>[];
  return rows.map((row) => Object.fromEntries(
    definition.columns.map((column) => [column.key, row[column.key] ?? null])
  ));
}

function distinctExpression(keys: string[]) {
  if (!keys.length) return "NULL";
  return `CONCAT_WS('¦', ${keys.map((key) => `COALESCE(CAST(${quote(key)} AS CHAR),'∅')`).join(", ")})`;
}

export async function executeVerifiedReport(options: {
  code: string;
  sourceTable: string;
  fields: Map<string, FieldSpec>;
  fromSql: string;
  joins?: string[];
  where?: string[];
  params?: unknown[];
  orderBy?: string;
  grainKeys: string[];
  filters: VerifiedAdapterFilters;
}): Promise<VerifiedAdapterResult> {
  const selectSql = [...options.fields.entries()]
    .map(([key, spec]) => `${spec.expression} AS ${quote(key)}`)
    .join(",\n       ");
  const whereSql = options.where?.length ? `WHERE ${options.where.join(" AND ")}` : "";
  const baseSql = `SELECT ${selectSql}
                     FROM ${options.fromSql}
                     ${(options.joins ?? []).join("\n")}
                     ${whereSql}`;
  const summarySql = `SELECT COUNT(*) AS total,
                             COUNT(DISTINCT ${distinctExpression(options.grainKeys)}) AS distinct_grain
                        FROM (${baseSql}) verified_source`;
  const [summaryRows] = await db.execute<RowDataPacket[]>(summarySql, options.params ?? []);
  const totalCount = Number(summaryRows[0]?.total ?? 0);
  const distinctGrainCount = Number(summaryRows[0]?.distinct_grain ?? 0);
  const duplicateGrainCount = Math.max(0, totalCount - distinctGrainCount);
  const paginatedSql = `${baseSql} ${options.orderBy ? `ORDER BY ${options.orderBy}` : ""} LIMIT ? OFFSET ?`;
  const [rows] = await db.execute<RowDataPacket[]>(paginatedSql, [
    ...(options.params ?? []),
    options.filters.limit,
    options.filters.offset,
  ]);
  const lineage = Object.fromEntries([...options.fields.entries()].map(([key, spec]) => [key, spec.lineage]));
  const exactMappedFieldCount = Object.values(lineage).filter((item) => item.confidence === "EXACT").length;
  const derivedMappedFieldCount = Object.values(lineage).filter((item) => item.confidence === "DERIVED").length;
  const definition = getBpoMasterReport(options.code);
  const unavailableFieldCount = Math.max(0, (definition?.columns.length ?? options.fields.size) - options.fields.size);

  return {
    rows: normalize(options.code, rows),
    totalCount,
    sourceTable: options.sourceTable,
    availableKeys: [...options.fields.keys()],
    lineage,
    verification: {
      runtimeSchemaVerified: true,
      exactMappedFieldCount,
      derivedMappedFieldCount,
      unavailableFieldCount,
      duplicateGrainCount,
      sourceRowCount: totalCount,
      distinctGrainCount,
      accuracyStatus: duplicateGrainCount > 0 ? "DUPLICATE_GRAIN_FOUND" : "SCHEMA_VERIFIED",
    },
  };
}
