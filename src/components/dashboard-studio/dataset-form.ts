/**
 * Pure form logic for the "Register a dataset" admin screen. No React.
 * Mirrors backend/src/modules/analytics-catalogue/catalogue.validate.ts so the admin sees every problem before saving.
 */
import type { Agg, Format } from "./types";

export const ROLES = ["dimension", "measure", "time"] as const;
export const FORMATS: readonly Format[] = ["number", "integer", "percent", "currency", "duration", "text", "date"];
export const LOOKUPS = ["none", "process", "branch", "employee", "metric", "metric_code"] as const;
export const SCOPE_MODES = ["process_branch", "process", "branch", "employee", "constant", "org"] as const;
const ALL_AGGS: readonly Agg[] = ["sum", "avg", "min", "max", "count", "count_distinct"];
const COUNT_AGGS: readonly Agg[] = ["count", "count_distinct"];

export type Role = (typeof ROLES)[number];
export type Lookup = (typeof LOOKUPS)[number];
export type ScopeMode = (typeof SCOPE_MODES)[number];
export type DataType = "string" | "number" | "date" | "datetime" | "boolean";

export const AGG_LABELS: Record<Agg, string> = { sum: "Sum", avg: "Average", min: "Minimum", max: "Maximum", count: "Count", count_distinct: "Count unique" };
export const LOOKUP_LABELS: Record<Lookup, string> = { none: "None", process: "Process name", branch: "Branch name", employee: "Employee name", metric: "Metric name", metric_code: "Metric name (by code)" };
export const SCOPE_INFO: Record<ScopeMode, { title: string; help: string }> = {
  process_branch: { title: "Process and branch", help: "Each row has a process and a branch column" },
  process: { title: "Process", help: "Each row has a process column" },
  branch: { title: "Branch", help: "Each row has a branch column" },
  employee: { title: "Employee", help: "Each row belongs to an employee; their process and branch decide access" },
  constant: { title: "One process", help: "The whole table belongs to one process" },
  org: { title: "Organisation-wide", help: "Organisation-wide: only people with organisation-wide access can use it" },
};
/** Which pickers each "who can see" mode needs. */
export const SCOPE_NEEDS: Record<ScopeMode, Array<"processColumn" | "branchColumn" | "employeeColumn" | "scopeProcessId">> = {
  process_branch: ["processColumn", "branchColumn"], process: ["processColumn"], branch: ["branchColumn"],
  employee: ["employeeColumn"], constant: ["scopeProcessId"], org: [],
};
const NEED_LABELS = { processColumn: "process column", branchColumn: "branch column", employeeColumn: "employee column", scopeProcessId: "process" } as const;

/** One field as the API sends and stores it. */
export interface ApiField {
  fieldKey: string; label: string; columnName: string; role: Role; dataType: DataType; defaultAgg: Agg;
  format: Format; lookup: Lookup; description: string | null; sortOrder: number; hidden: boolean;
}
export interface IntrospectResult { fields: Array<ApiField & { sqlType?: string }>; suggestedScopeMode: string; suggestedTimeField: string | null }
/** Full dataset from GET /admin/datasets/:code, and the body POST/PUT expect. */
export interface DatasetPayload {
  code: string; name: string; description: string | null; category: string | null; connection: string; sourceTable: string;
  timeField: string | null; scopeMode: ScopeMode; processColumn: string | null; branchColumn: string | null;
  employeeColumn: string | null; scopeProcessId: string | null; maxRows: number; fields: ApiField[];
}

export interface FormField extends Omit<ApiField, "sortOrder"> { include: boolean; sqlType: string | null }
export interface FormState {
  /** Code of the dataset being edited; null when registering a new one. */
  editingCode: string | null;
  /** True once the admin typed a code by hand, so the name stops overwriting it. */
  codeTouched: boolean;
  name: string; code: string; category: string; description: string; maxRows: string;
  connection: string; sourceTable: string;
  /** "connection|table" the field list was read from; "" until columns are read. */
  fieldsFrom: string;
  scopeMode: ScopeMode; processColumn: string; branchColumn: string; employeeColumn: string; scopeProcessId: string;
  timeField: string; fields: FormField[];
}

const CODE = /^[a-z][a-z0-9_]{1,63}$/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_$]{0,63}$/;
const TABLE = /^[A-Za-z_][A-Za-z0-9_$]{0,63}(\.[A-Za-z_][A-Za-z0-9_$]{0,63})?$/;
const sourceKey = (f: Pick<FormState, "connection" | "sourceTable">) => `${f.connection}|${f.sourceTable.trim()}`;
const isDate = (t: string) => t === "date" || t === "datetime";

/** "Daily Sales (2024)" -> "daily_sales_2024". Lower-case a-z, 0-9 and _, starting with a letter, at most 64 characters. */
export function slugCode(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return (/^[a-z]/.test(s) || !s ? s : `d_${s}`).slice(0, 64).replace(/_+$/, "");
}

export function emptyForm(): FormState {
  return {
    editingCode: null, codeTouched: false, name: "", code: "", category: "", description: "", maxRows: "5000",
    connection: "hrms", sourceTable: "", fieldsFrom: "", scopeMode: "org", processColumn: "", branchColumn: "", employeeColumn: "",
    scopeProcessId: "", timeField: "", fields: [],
  };
}

export function fromDataset(ds: DatasetPayload): FormState {
  const base = { connection: ds.connection || "hrms", sourceTable: ds.sourceTable ?? "" };
  return {
    ...base, editingCode: ds.code, codeTouched: true, name: ds.name ?? "", code: ds.code, category: ds.category ?? "",
    description: ds.description ?? "", maxRows: String(ds.maxRows ?? 5000), fieldsFrom: sourceKey(base),
    scopeMode: (SCOPE_MODES as readonly string[]).includes(ds.scopeMode) ? ds.scopeMode : "org",
    processColumn: ds.processColumn ?? "", branchColumn: ds.branchColumn ?? "", employeeColumn: ds.employeeColumn ?? "",
    scopeProcessId: ds.scopeProcessId ?? "", timeField: ds.timeField ?? "",
    fields: [...(ds.fields ?? [])].sort((a, b) => a.sortOrder - b.sortOrder).map(({ sortOrder: _s, ...f }) => ({ ...f, include: true, sqlType: null })),
  };
}

/** Typing a name fills the code until the admin edits the code themselves (never when editing a saved dataset). */
export function withName(form: FormState, name: string): FormState {
  return form.editingCode || form.codeTouched ? { ...form, name } : { ...form, name, code: slugCode(name) };
}

export function aggOptions(dataType: string): readonly Agg[] { return dataType === "number" ? ALL_AGGS : COUNT_AGGS; }

export function allowedScopeModes(connection: string): ScopeMode[] {
  return connection === "hrms" ? [...SCOPE_MODES] : ["constant", "org"];
}

/** Change one field, keeping its aggregation legal for its role and data type. */
export function patchField(f: FormField, patch: Partial<FormField>): FormField {
  const next = { ...f, ...patch };
  if (next.role === "measure" && !aggOptions(next.dataType).includes(next.defaultAgg)) next.defaultAgg = "count";
  return next;
}

/** Included date fields: the only valid choices for the time field. */
export function timeFieldChoices(form: FormState): FormField[] { return form.fields.filter((f) => f.include && isDate(f.dataType)); }

/** Every column name we know for the table (included or not), plus any column a scope picker already points at. */
export function columnChoices(form: FormState): string[] {
  return [...new Set([...form.fields.map((f) => f.columnName), form.processColumn, form.branchColumn, form.employeeColumn].filter(Boolean))];
}

/**
 * Apply "Read columns".
 * First read for this table: every column is filled in as guessed, with the suggested scope mode and time field.
 * Re-read of the same table: existing field settings win (matched by column name), columns new to the table are added
 * as not-included, and columns that no longer exist are dropped.
 */
export function mergeIntrospection(form: FormState, res: IntrospectResult): FormState {
  const incoming: FormField[] = res.fields.map(({ sortOrder: _s, sqlType, ...f }) => ({ ...f, description: f.description ?? null, hidden: !!f.hidden, include: true, sqlType: sqlType ?? null }));
  const key = sourceKey(form);
  if (!form.fields.length || form.fieldsFrom !== key) {
    const cols = new Set(incoming.map((f) => f.columnName));
    const allowed = allowedScopeModes(form.connection);
    const suggested = res.suggestedScopeMode as ScopeMode;
    const pick = (c: string) => (cols.has(c) ? c : "");
    return {
      ...form, fields: incoming, fieldsFrom: key,
      scopeMode: allowed.includes(suggested) ? suggested : allowed.includes(form.scopeMode) ? form.scopeMode : "org",
      processColumn: pick("process_id"), branchColumn: pick("branch_id"), employeeColumn: pick("employee_id"),
      timeField: res.suggestedTimeField ?? "",
    };
  }
  const fresh = new Map(incoming.map((f) => [f.columnName, f]));
  const kept = form.fields.filter((f) => fresh.has(f.columnName)).map((f) => ({ ...f, sqlType: fresh.get(f.columnName)!.sqlType }));
  const have = new Set(kept.map((f) => f.columnName));
  const fields = [...kept, ...incoming.filter((f) => !have.has(f.columnName)).map((f) => ({ ...f, include: false }))];
  const stillThere = (c: string) => (fresh.has(c) ? c : "");
  return {
    ...form, fields, fieldsFrom: key,
    timeField: fields.some((f) => f.include && f.fieldKey === form.timeField) ? form.timeField : "",
    processColumn: stillThere(form.processColumn), branchColumn: stillThere(form.branchColumn), employeeColumn: stillThere(form.employeeColumn),
  };
}

/** Every problem that would make the server reject this dataset, in plain language. Empty means ready to save. */
export function validateForm(form: FormState): string[] {
  const errs: string[] = [];
  if (!form.name.trim()) errs.push("Give the dataset a name.");
  if (!CODE.test(form.code.trim())) errs.push("The code must be 2 to 64 characters, start with a letter, and use only lower-case letters, digits and _.");
  const table = form.sourceTable.trim();
  if (!table) errs.push("Choose the table this dataset reads from.");
  else if (!TABLE.test(table)) errs.push(`"${table}" is not a valid table name.`);
  const rows = Number(form.maxRows);
  if (!Number.isInteger(rows) || rows < 1 || rows > 20000) errs.push("Max rows must be a whole number from 1 to 20000.");

  if (!allowedScopeModes(form.connection).includes(form.scopeMode)) {
    errs.push("A table on an outside connection has no HRMS process or branch ids, so it can only be \"One process\" or \"Organisation-wide\".");
  } else {
    for (const need of SCOPE_NEEDS[form.scopeMode]) {
      if (!form[need].trim()) errs.push(`"${SCOPE_INFO[form.scopeMode].title}" needs a ${NEED_LABELS[need]}: pick one in step 3.`);
      else if (need !== "scopeProcessId" && !IDENT.test(form[need].trim())) errs.push(`"${form[need]}" is not a valid ${NEED_LABELS[need]} name.`);
    }
  }

  const included = form.fields.filter((f) => f.include);
  if (table && form.fields.length && form.fieldsFrom !== sourceKey(form)) errs.push("The table changed after its columns were read. Press \"Read columns\" again.");
  else if (!form.fields.length) errs.push("Press \"Read columns\" to load the table's columns.");
  else if (!included.length) errs.push("Include at least one field.");
  if (included.length > 200) errs.push(`A dataset can have at most 200 fields (${included.length} are included).`);
  const seen = new Set<string>();
  for (const f of included) {
    if (!CODE.test(f.fieldKey)) errs.push(`Column "${f.columnName}" cannot be included: its field key "${f.fieldKey}" must be 2 to 64 lower-case letters, digits or _.`);
    else if (seen.has(f.fieldKey)) errs.push(`Field key "${f.fieldKey}" is used by more than one included column.`);
    seen.add(f.fieldKey);
    if (!IDENT.test(f.columnName)) errs.push(`Column "${f.columnName}" cannot be included: its name has characters that are not supported.`);
    if (f.role === "measure" && !aggOptions(f.dataType).includes(f.defaultAgg)) errs.push(`${f.label || f.fieldKey}: ${AGG_LABELS[f.defaultAgg]} needs a number field. Use Count or Count unique.`);
  }
  if (form.timeField) {
    const tf = included.find((f) => f.fieldKey === form.timeField);
    if (!tf || !isDate(tf.dataType)) errs.push("The time field must be an included date field.");
  }
  return errs;
}

/** Exactly the body POST /admin/datasets and PUT /admin/datasets/:code expect. */
export function toPayload(form: FormState): DatasetPayload {
  const needs = SCOPE_NEEDS[form.scopeMode];
  const col = (k: "processColumn" | "branchColumn" | "employeeColumn" | "scopeProcessId") => (needs.includes(k) && form[k].trim() ? form[k].trim() : null);
  return {
    code: form.code.trim(), name: form.name.trim(), description: form.description.trim() || null, category: form.category.trim() || null,
    connection: form.connection || "hrms", sourceTable: form.sourceTable.trim(), timeField: form.timeField || null, scopeMode: form.scopeMode,
    processColumn: col("processColumn"), branchColumn: col("branchColumn"), employeeColumn: col("employeeColumn"), scopeProcessId: col("scopeProcessId"),
    maxRows: Math.max(1, Math.min(Math.trunc(Number(form.maxRows)) || 5000, 20000)),
    fields: form.fields.filter((f) => f.include).map(({ include: _i, sqlType: _t, ...f }, i) => ({
      ...f, label: f.label.trim() || f.fieldKey, description: f.description?.trim() || null, sortOrder: i + 1,
    })),
  };
}

/** Up to `max` table names matching what the admin typed (names that start with it first). */
export function matchTables(tables: string[], typed: string, max = 50): string[] {
  const q = typed.trim().toLowerCase();
  if (!q) return tables.slice(0, max);
  const starts: string[] = []; const contains: string[] = [];
  for (const t of tables) {
    const l = t.toLowerCase();
    if (l.startsWith(q)) starts.push(t); else if (l.includes(q)) contains.push(t);
  }
  return [...starts, ...contains].slice(0, max);
}
