import { NAMED_POOLS } from "../kpi/kpi-studio.pools.js";
import {
  AGGS, AnalyticsError, DATA_TYPES, FIELD_ROLES, FORMATS, LOOKUPS, SCOPE_MODES,
  type Agg, type DataType, type Dataset, type DatasetField, type FieldFormat, type FieldRole, type Lookup, type ScopeMode,
} from "./analytics.types.js";

const IDENT = /^[A-Za-z_][A-Za-z0-9_$]{0,63}$/;
const CODE = /^[a-z][a-z0-9_]{1,63}$/;
const TABLE = /^[A-Za-z_][A-Za-z0-9_$]{0,63}(\.[A-Za-z_][A-Za-z0-9_$]{0,63})?$/;

type Input = Record<string, unknown>;
const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const opt = (v: unknown) => (str(v) ? str(v) : null);
const oneOf = <T extends string>(v: unknown, list: readonly T[], what: string, dflt?: T): T => {
  const s = str(v) || dflt;
  if (!s || !list.includes(s as T)) throw new AnalyticsError(`Invalid ${what}: ${s || "(blank)"}`, "INVALID_DATASET");
  return s as T;
};
const ident = (v: unknown, what: string) => {
  const s = str(v);
  if (!IDENT.test(s)) throw new AnalyticsError(`Invalid ${what}: ${s || "(blank)"}`, "INVALID_DATASET");
  return s;
};

export type DatasetInput = Omit<Dataset, "id">;

/** Everything an admin submits for a dataset, checked before a single identifier can reach SQL. */
export function validateDatasetInput(raw: Input): DatasetInput {
  const code = str(raw.code);
  if (!CODE.test(code)) throw new AnalyticsError("Invalid code: use lower-case letters, digits and _", "INVALID_DATASET");
  const name = str(raw.name).slice(0, 128);
  if (!name) throw new AnalyticsError("A dataset needs a name", "INVALID_DATASET");
  const connection = str(raw.connection) || "hrms";
  if (connection !== "hrms" && !NAMED_POOLS[connection]) throw new AnalyticsError(`Unknown connection "${connection}"`, "INVALID_DATASET");
  const sourceTable = str(raw.sourceTable);
  if (!TABLE.test(sourceTable)) throw new AnalyticsError(`Invalid table: ${sourceTable || "(blank)"}`, "INVALID_DATASET");
  const scopeMode = oneOf<ScopeMode>(raw.scopeMode, SCOPE_MODES, "scope mode");
  if (connection !== "hrms" && !["constant", "org"].includes(scopeMode)) {
    throw new AnalyticsError("A dataset on an external connection must be constant or org scoped: its rows carry no HRMS ids", "INVALID_DATASET");
  }
  const col = (v: unknown, what: string) => (opt(v) ? ident(v, `${what} column`) : null);
  const processColumn = col(raw.processColumn, "process");
  const branchColumn = col(raw.branchColumn, "branch");
  const employeeColumn = col(raw.employeeColumn, "employee");
  const scopeProcessId = opt(raw.scopeProcessId);
  const needs: Record<ScopeMode, Array<[string | null, string]>> = {
    process_branch: [[processColumn, "process column"], [branchColumn, "branch column"]],
    process: [[processColumn, "process column"]],
    branch: [[branchColumn, "branch column"]],
    employee: [[employeeColumn, "employee column"]],
    constant: [[scopeProcessId, "process (the one process this whole table belongs to)"]],
    org: [],
  };
  for (const [v, what] of needs[scopeMode]) if (!v) throw new AnalyticsError(`Scope mode ${scopeMode} needs a ${what}`, "INVALID_DATASET");

  const rawFields = Array.isArray(raw.fields) ? (raw.fields as Input[]) : [];
  if (!rawFields.length) throw new AnalyticsError("A dataset needs at least one field", "INVALID_DATASET");
  if (rawFields.length > 200) throw new AnalyticsError("At most 200 fields", "INVALID_DATASET");
  const seen = new Set<string>();
  const fields: DatasetField[] = rawFields.map((f, i) => {
    const fieldKey = str(f.fieldKey);
    if (!CODE.test(fieldKey)) throw new AnalyticsError(`Invalid field key "${fieldKey}"`, "INVALID_DATASET");
    if (seen.has(fieldKey)) throw new AnalyticsError(`Field "${fieldKey}" appears twice`, "INVALID_DATASET");
    seen.add(fieldKey);
    const role = oneOf<FieldRole>(f.role, FIELD_ROLES, `role for ${fieldKey}`);
    const dataType = oneOf<DataType>(f.dataType, DATA_TYPES, `data type for ${fieldKey}`, "string");
    const defaultAgg = oneOf<Agg>(f.defaultAgg, AGGS, `aggregation for ${fieldKey}`, role === "measure" && dataType === "number" ? "sum" : "count");
    if (role === "measure" && !["count", "count_distinct"].includes(defaultAgg) && dataType !== "number") {
      throw new AnalyticsError(`${fieldKey}: ${defaultAgg} needs a number field`, "INVALID_DATASET");
    }
    return {
      fieldKey, label: str(f.label).slice(0, 128) || fieldKey, columnName: ident(f.columnName, `column for ${fieldKey}`),
      role, dataType, defaultAgg,
      format: oneOf<FieldFormat>(f.format, FORMATS, `format for ${fieldKey}`, dataType === "number" ? "number" : dataType === "string" ? "text" : "date"),
      lookup: oneOf<Lookup>(f.lookup, LOOKUPS, `lookup for ${fieldKey}`, "none"),
      description: opt(f.description)?.slice(0, 300) ?? null,
      sortOrder: Number.isFinite(Number(f.sortOrder)) && f.sortOrder !== undefined ? Number(f.sortOrder) : i + 1,
      hidden: Boolean(f.hidden),
    };
  });
  const timeField = opt(raw.timeField);
  if (timeField) {
    const tf = fields.find((x) => x.fieldKey === timeField);
    if (!tf || !["date", "datetime"].includes(tf.dataType)) throw new AnalyticsError(`The time field must be a date field of this dataset (${timeField})`, "INVALID_DATASET");
  }
  const maxRows = Math.max(1, Math.min(Number(raw.maxRows) || 5000, 20000));
  return {
    code, name, description: opt(raw.description)?.slice(0, 500) ?? null, category: opt(raw.category)?.slice(0, 64) ?? null,
    connection, sourceTable, timeField, scopeMode, processColumn, branchColumn, employeeColumn, scopeProcessId, maxRows, fields,
  };
}

/** A first guess for a column when an admin registers a table; they review it before saving. */
export function guessField(column: string, sqlType: string): Omit<DatasetField, "sortOrder" | "description" | "hidden"> {
  const c = column.toLowerCase(); const t = sqlType.toLowerCase();
  const label = column.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
  const numeric = /int|decimal|float|double|numeric|bit/.test(t);
  const dataType: DataType = /datetime|timestamp/.test(t) ? "datetime" : t === "date" ? "date" : numeric ? "number" : "string";
  const lookup: Lookup = c === "process_id" || c.endsWith("_process_id") ? "process" : c === "branch_id" || c.endsWith("_branch_id") ? "branch" : c === "employee_id" ? "employee" : "none";
  const isKey = c === "id" || c.endsWith("_id") || c.endsWith("_code");
  const isMeasure = numeric && !isKey && !/^(is_|has_)|status|flag$|year|month/.test(c);
  const role: FieldRole = dataType === "date" ? "time" : isMeasure ? "measure" : "dimension";
  const percent = /pct|percent|rate|ratio/.test(c);
  const format: FieldFormat = dataType === "date" || dataType === "datetime" ? "date"
    : !isMeasure ? (numeric ? "integer" : "text")
    : percent ? "percent" : /amount|revenue|salary|price|cost|ctc|value_inr|rupee/.test(c) ? "currency" : /seconds|duration|_sec$/.test(c) ? "duration" : "number";
  const defaultAgg: Agg = !isMeasure ? "count" : percent || /avg|average|score|duration|seconds/.test(c) ? "avg" : "sum";
  return { fieldKey: c.replace(/[^a-z0-9_]/g, "_").replace(/^([^a-z])/, "f_$1").slice(0, 64), label, columnName: column, role, dataType, defaultAgg, format, lookup };
}
