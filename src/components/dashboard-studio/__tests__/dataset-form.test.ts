import { describe, it, expect } from "vitest";
import {
  aggOptions, allowedScopeModes, columnChoices, emptyForm, fromDataset, matchTables, mergeIntrospection, patchField, slugCode,
  timeFieldChoices, toPayload, validateForm, withName,
  type ApiField, type DatasetPayload, type FormState, type IntrospectResult,
} from "../dataset-form";

const api = (columnName: string, extra: Partial<ApiField & { sqlType: string }> = {}): ApiField & { sqlType?: string } => ({
  fieldKey: columnName.toLowerCase(), label: columnName, columnName, role: "dimension", dataType: "string", defaultAgg: "count",
  format: "text", lookup: "none", description: null, sortOrder: 1, hidden: false, ...extra,
});
const INTRO: IntrospectResult = {
  fields: [
    api("sale_date", { role: "time", dataType: "date", format: "date", sqlType: "date", sortOrder: 1 }),
    api("process_id", { lookup: "process", sqlType: "varchar", sortOrder: 2 }),
    api("branch_id", { lookup: "branch", sqlType: "varchar", sortOrder: 3 }),
    api("amount", { role: "measure", dataType: "number", defaultAgg: "sum", format: "currency", sqlType: "decimal", sortOrder: 4 }),
  ],
  suggestedScopeMode: "process_branch", suggestedTimeField: "sale_date",
};
const DS: DatasetPayload = {
  code: "sales", name: "Sales", description: "All sales", category: "Revenue", connection: "hrms", sourceTable: "fact_sales",
  timeField: "sale_date", scopeMode: "process", processColumn: "process_id", branchColumn: null, employeeColumn: null,
  scopeProcessId: null, maxRows: 8000,
  fields: [
    { ...api("amount", { role: "measure", dataType: "number", defaultAgg: "avg", format: "currency" }), label: "Revenue", sortOrder: 2 },
    { ...api("sale_date", { role: "time", dataType: "date", format: "date" }), sortOrder: 1 },
  ] as ApiField[],
};
/** A new dataset that is ready to save. */
const ready = (over: Partial<FormState> = {}): FormState =>
  ({ ...mergeIntrospection({ ...withName(emptyForm(), "Daily Sales"), sourceTable: "fact_sales" }, INTRO), ...over });

describe("slugCode", () => {
  it("lower-cases and joins words with _", () => {
    expect(slugCode("Daily Sales (2024)")).toBe("daily_sales_2024");
    expect(slugCode("  Attrition -- by  Branch ")).toBe("attrition_by_branch");
  });
  it("always starts with a letter", () => {
    expect(slugCode("2024 sales")).toBe("d_2024_sales");
    expect(slugCode("_x")).toBe("x");
  });
  it("is empty for a blank or symbol-only name and never longer than 64", () => {
    expect(slugCode("")).toBe("");
    expect(slugCode("!!!")).toBe("");
    expect(slugCode("a".repeat(100))).toHaveLength(64);
    expect(slugCode(`${"a".repeat(63)} b`)).toBe("a".repeat(63));
  });
});

describe("emptyForm / withName", () => {
  it("starts on the HRMS connection with 5000 rows and no fields", () => {
    const f = emptyForm();
    expect(f).toMatchObject({ editingCode: null, connection: "hrms", maxRows: "5000", fields: [], timeField: "", fieldsFrom: "" });
  });
  it("fills the code from the name until the code is edited by hand", () => {
    expect(withName(emptyForm(), "Daily Sales").code).toBe("daily_sales");
    expect(withName({ ...emptyForm(), code: "mine", codeTouched: true }, "Daily Sales").code).toBe("mine");
  });
  it("never changes the code of a saved dataset", () => {
    expect(withName(fromDataset(DS), "Renamed")).toMatchObject({ name: "Renamed", code: "sales" });
  });
});

describe("fromDataset", () => {
  const f = fromDataset(DS);
  it("copies details and turns nulls into blanks", () => {
    expect(f).toMatchObject({ editingCode: "sales", name: "Sales", code: "sales", category: "Revenue", description: "All sales", maxRows: "8000",
      connection: "hrms", sourceTable: "fact_sales", scopeMode: "process", processColumn: "process_id", branchColumn: "", scopeProcessId: "", timeField: "sale_date" });
  });
  it("includes every saved field, ordered by sortOrder, and marks the columns as already read", () => {
    expect(f.fields.map((x) => x.fieldKey)).toEqual(["sale_date", "amount"]);
    expect(f.fields.every((x) => x.include)).toBe(true);
    expect(f.fieldsFrom).toBe("hrms|fact_sales");
    expect(validateForm(f)).toEqual([]);
  });
  it("offers scope columns that are not fields", () => {
    expect(columnChoices(f)).toEqual(["sale_date", "amount", "process_id"]);
  });
});

describe("mergeIntrospection", () => {
  it("first read fills every column as included with the suggested scope mode, scope columns and time field", () => {
    const f = ready();
    expect(f.fields.map((x) => [x.columnName, x.include, x.sqlType])).toEqual([["sale_date", true, "date"], ["process_id", true, "varchar"], ["branch_id", true, "varchar"], ["amount", true, "decimal"]]);
    expect(f).toMatchObject({ scopeMode: "process_branch", processColumn: "process_id", branchColumn: "branch_id", employeeColumn: "", timeField: "sale_date", fieldsFrom: "hrms|fact_sales" });
  });
  it("ignores a suggested scope mode the connection does not allow", () => {
    const f = mergeIntrospection({ ...emptyForm(), connection: "dialer", sourceTable: "calls", scopeMode: "constant" }, INTRO);
    expect(f.scopeMode).toBe("constant");
  });
  it("re-read keeps existing settings by column name, adds new columns as not included, drops missing ones", () => {
    const edited = fromDataset(DS);
    const merged = mergeIntrospection(edited, INTRO);
    expect(merged.fields.map((x) => [x.columnName, x.include])).toEqual([["sale_date", true], ["amount", true], ["process_id", false], ["branch_id", false]]);
    const amount = merged.fields.find((x) => x.columnName === "amount")!;
    expect(amount).toMatchObject({ label: "Revenue", defaultAgg: "avg", sqlType: "decimal" });
    expect(merged).toMatchObject({ scopeMode: "process", processColumn: "process_id", timeField: "sale_date" });

    const gone = mergeIntrospection(edited, { ...INTRO, fields: INTRO.fields.filter((x) => x.columnName !== "sale_date" && x.columnName !== "process_id") });
    expect(gone.fields.map((x) => x.columnName)).toEqual(["amount", "branch_id"]);
    expect(gone).toMatchObject({ timeField: "", processColumn: "" });
  });
  it("keeps a field the admin excluded as excluded", () => {
    const f = ready();
    const off = { ...f, fields: f.fields.map((x) => (x.columnName === "amount" ? { ...x, include: false } : x)) };
    expect(mergeIntrospection(off, INTRO).fields.find((x) => x.columnName === "amount")!.include).toBe(false);
  });
  it("starts over when the table is different from the one the fields came from", () => {
    const moved = { ...fromDataset(DS), sourceTable: "fact_orders" };
    const f = mergeIntrospection(moved, INTRO);
    expect(f.fields).toHaveLength(4);
    expect(f.fields.every((x) => x.include)).toBe(true);
    expect(f.fields.find((x) => x.columnName === "amount")!.label).toBe("amount");
    expect(f).toMatchObject({ scopeMode: "process_branch", fieldsFrom: "hrms|fact_orders" });
  });
});

describe("aggOptions / patchField / allowedScopeModes", () => {
  it("offers number-only aggregations only for numbers", () => {
    expect(aggOptions("number")).toEqual(["sum", "avg", "min", "max", "count", "count_distinct"]);
    for (const t of ["string", "date", "datetime", "boolean"]) expect(aggOptions(t)).toEqual(["count", "count_distinct"]);
  });
  it("falls back to count when a text field becomes a measure", () => {
    const text = ready().fields[1];
    expect(patchField({ ...text, defaultAgg: "sum" }, { role: "measure" }).defaultAgg).toBe("count");
    const num = ready().fields[3];
    expect(patchField(num, { defaultAgg: "max" }).defaultAgg).toBe("max");
  });
  it("limits outside connections to constant and org", () => {
    expect(allowedScopeModes("hrms")).toEqual(["process_branch", "process", "branch", "employee", "constant", "org"]);
    expect(allowedScopeModes("dialer")).toEqual(["constant", "org"]);
  });
  it("lists only included date fields as time field choices", () => {
    const f = ready();
    expect(timeFieldChoices(f).map((x) => x.fieldKey)).toEqual(["sale_date"]);
    expect(timeFieldChoices({ ...f, fields: f.fields.map((x) => ({ ...x, include: false })) })).toEqual([]);
  });
});

describe("validateForm", () => {
  const has = (f: FormState, re: RegExp) => validateForm(f).some((m) => re.test(m));
  it("passes a complete form", () => expect(validateForm(ready())).toEqual([]));
  it("requires a name", () => expect(has(ready({ name: "  " }), /name/i)).toBe(true));
  it("checks the code pattern", () => {
    for (const code of ["", "a", "1abc", "Abc", "has space", "a".repeat(65)]) expect(has(ready({ code }), /code must be/)).toBe(true);
    for (const code of ["ab", "a_1", "a".repeat(64)]) expect(has(ready({ code }), /code must be/)).toBe(false);
  });
  it("requires a valid table", () => {
    expect(has(ready({ sourceTable: "" }), /Choose the table/)).toBe(true);
    expect(has(ready({ sourceTable: "bad name;" }), /not a valid table/)).toBe(true);
    expect(validateForm({ ...ready(), sourceTable: "db.fact_sales", fieldsFrom: "hrms|db.fact_sales" })).toEqual([]);
  });
  it("asks to read columns again when the table changed after reading", () => {
    expect(has(ready({ sourceTable: "other" }), /Read columns/)).toBe(true);
  });
  it("requires at least one included field", () => {
    expect(has({ ...emptyForm(), name: "x", code: "xx", sourceTable: "t" }, /Read columns/)).toBe(true);
    const f = ready();
    expect(has({ ...f, timeField: "", fields: f.fields.map((x) => ({ ...x, include: false })) }, /at least one field/)).toBe(true);
  });
  it("allows at most 200 included fields", () => {
    const f = ready();
    const many = Array.from({ length: 201 }, (_, i) => ({ ...f.fields[1], fieldKey: `c_${i}`, columnName: `c_${i}` }));
    expect(has({ ...f, fields: many, timeField: "", scopeMode: "org" }, /at most 200/)).toBe(true);
  });
  it("requires the columns each scope mode needs", () => {
    expect(has(ready({ processColumn: "" }), /process column/)).toBe(true);
    expect(has(ready({ branchColumn: "" }), /branch column/)).toBe(true);
    expect(has(ready({ scopeMode: "process", branchColumn: "" }), /column/)).toBe(false);
    expect(has(ready({ scopeMode: "branch", processColumn: "", branchColumn: "" }), /branch column/)).toBe(true);
    expect(has(ready({ scopeMode: "employee" }), /employee column/)).toBe(true);
    expect(has(ready({ scopeMode: "constant" }), /needs a process/)).toBe(true);
    expect(validateForm(ready({ scopeMode: "constant", scopeProcessId: "p1" }))).toEqual([]);
    expect(validateForm(ready({ scopeMode: "org", processColumn: "", branchColumn: "" }))).toEqual([]);
  });
  it("allows only constant and org on an outside connection", () => {
    const ext = { connection: "dialer", fieldsFrom: "dialer|fact_sales" };
    expect(has(ready(ext), /outside connection/)).toBe(true);
    expect(validateForm(ready({ ...ext, scopeMode: "org" }))).toEqual([]);
  });
  it("requires the time field to be an included date field", () => {
    expect(has(ready({ timeField: "amount" }), /time field/)).toBe(true);
    expect(has(ready({ timeField: "nope" }), /time field/)).toBe(true);
    const f = ready();
    expect(has({ ...f, fields: f.fields.map((x) => (x.fieldKey === "sale_date" ? { ...x, include: false } : x)) }, /time field/)).toBe(true);
    expect(validateForm(ready({ timeField: "" }))).toEqual([]);
  });
  it("rejects number-only aggregations on non-number measures, but not on dimensions", () => {
    const f = ready();
    const set = (role: "measure" | "dimension") => ({ ...f, fields: f.fields.map((x) => (x.columnName === "branch_id" ? { ...x, role, defaultAgg: "sum" as const } : x)) });
    expect(has(set("measure"), /needs a number field/)).toBe(true);
    expect(validateForm(set("dimension"))).toEqual([]);
  });
  it("rejects bad field keys, duplicate keys and unsupported column names only when included", () => {
    const f = ready();
    const swap = (p: Partial<FormState["fields"][number]>) => ({ ...f, fields: f.fields.map((x, i) => (i === 1 ? { ...x, ...p } : x)) });
    expect(has(swap({ fieldKey: "x" }), /field key "x"/)).toBe(true);
    expect(has(swap({ fieldKey: "amount" }), /more than one/)).toBe(true);
    expect(has(swap({ columnName: "has space" }), /not supported/)).toBe(true);
    expect(validateForm({ ...swap({ fieldKey: "x", include: false }), scopeMode: "org" })).toEqual([]);
  });
  it("checks max rows", () => {
    for (const maxRows of ["0", "20001", "abc", "", "1.5"]) expect(has(ready({ maxRows }), /Max rows/)).toBe(true);
    for (const maxRows of ["1", "20000"]) expect(has(ready({ maxRows }), /Max rows/)).toBe(false);
  });
});

describe("toPayload", () => {
  it("produces exactly the API body with only included fields, numbered by position", () => {
    const f = ready({ description: " Sales per day ", category: "" });
    const form = { ...f, fields: f.fields.map((x) => (x.columnName === "branch_id" ? { ...x, include: false } : x)) };
    const p = toPayload(form);
    expect(Object.keys(p).sort()).toEqual(["branchColumn", "category", "code", "connection", "description", "employeeColumn", "fields", "maxRows", "name", "processColumn", "scopeMode", "scopeProcessId", "sourceTable", "timeField"]);
    expect(p).toMatchObject({ code: "daily_sales", name: "Daily Sales", description: "Sales per day", category: null, connection: "hrms", sourceTable: "fact_sales",
      timeField: "sale_date", scopeMode: "process_branch", processColumn: "process_id", branchColumn: "branch_id", employeeColumn: null, scopeProcessId: null, maxRows: 5000 });
    expect(p.fields.map((x) => [x.fieldKey, x.sortOrder])).toEqual([["sale_date", 1], ["process_id", 2], ["amount", 3]]);
    expect(Object.keys(p.fields[0]).sort()).toEqual(["columnName", "dataType", "defaultAgg", "description", "fieldKey", "format", "hidden", "label", "lookup", "role", "sortOrder"]);
  });
  it("sends only the scope values the chosen mode uses", () => {
    expect(toPayload(ready({ scopeMode: "constant", scopeProcessId: "p1" }))).toMatchObject({ processColumn: null, branchColumn: null, employeeColumn: null, scopeProcessId: "p1" });
    expect(toPayload(ready({ scopeMode: "org", scopeProcessId: "p1" }))).toMatchObject({ processColumn: null, branchColumn: null, scopeProcessId: null });
  });
  it("falls back to the field key for a blank label and null for no time field", () => {
    const f = ready({ timeField: "" });
    const p = toPayload({ ...f, fields: f.fields.map((x) => ({ ...x, label: "  " })) });
    expect(p.timeField).toBeNull();
    expect(p.fields[3].label).toBe("amount");
  });
  it("round-trips a saved dataset", () => {
    expect(toPayload(fromDataset(DS))).toEqual({ ...DS, fields: [{ ...DS.fields[1], sortOrder: 1 }, { ...DS.fields[0], sortOrder: 2 }] });
  });
});

describe("matchTables", () => {
  const tables = Array.from({ length: 1200 }, (_, i) => `tbl_${i}`).concat(["fact_sales", "sales_daily"]);
  it("shows at most 50 matches", () => {
    expect(matchTables(tables, "")).toHaveLength(50);
    expect(matchTables(tables, "tbl_1")).toHaveLength(50);
  });
  it("matches anywhere, ignoring case, with names that start with the text first", () => {
    expect(matchTables(tables, "SALES")).toEqual(["sales_daily", "fact_sales"]);
    expect(matchTables(tables, "zzz")).toEqual([]);
  });
});
