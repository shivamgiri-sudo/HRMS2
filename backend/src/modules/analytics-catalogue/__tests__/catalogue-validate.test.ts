import { describe, it, expect } from "vitest";
import { validateDatasetInput, guessField } from "../catalogue.validate.js";

const good = {
  code: "my_sales", name: "My sales", connection: "hrms", sourceTable: "sales_raw", scopeMode: "process", processColumn: "process_id",
  timeField: "date",
  fields: [
    { fieldKey: "date", label: "Date", columnName: "report_date", role: "time", dataType: "date" },
    { fieldKey: "amount", label: "Amount", columnName: "amount", role: "measure", dataType: "number", defaultAgg: "sum", format: "currency" },
    { fieldKey: "orders", label: "Orders", columnName: "order_id", role: "measure", dataType: "string", defaultAgg: "count_distinct" },
  ],
};

describe("validateDatasetInput", () => {
  it("accepts a well-formed dataset and fills defaults", () => {
    const v = validateDatasetInput(good);
    expect(v.maxRows).toBe(5000);
    expect(v.fields[0].lookup).toBe("none");
    expect(v.fields[1].sortOrder).toBe(2);
  });
  it("rejects unsafe identifiers", () => {
    expect(() => validateDatasetInput({ ...good, sourceTable: "x; drop" })).toThrow(/table/);
    expect(() => validateDatasetInput({ ...good, fields: [{ ...good.fields[0], columnName: "a b" }] })).toThrow(/column/);
    expect(() => validateDatasetInput({ ...good, code: "Bad Code" })).toThrow(/code/);
  });
  it("needs the scope column its mode uses", () => {
    expect(() => validateDatasetInput({ ...good, processColumn: null })).toThrow(/process column/);
    expect(() => validateDatasetInput({ ...good, scopeMode: "constant" })).toThrow(/process/);
  });
  it("external connections must be constant or org", () => {
    expect(() => validateDatasetInput({ ...good, connection: "dialer" })).toThrow(/constant or org/);
    expect(validateDatasetInput({ ...good, connection: "dialer", scopeMode: "org" }).connection).toBe("dialer");
    expect(() => validateDatasetInput({ ...good, connection: "nowhere", scopeMode: "org" })).toThrow(/connection/);
  });
  it("time field must exist and be a date", () => {
    expect(() => validateDatasetInput({ ...good, timeField: "amount" })).toThrow(/time field/);
    expect(() => validateDatasetInput({ ...good, timeField: "missing" })).toThrow(/time field/);
  });
  it("measures that sum or average must be numbers; field keys unique", () => {
    expect(() => validateDatasetInput({ ...good, fields: [...good.fields, { fieldKey: "xx", label: "X", columnName: "name", role: "measure", dataType: "string", defaultAgg: "sum" }] })).toThrow(/number/);
    expect(() => validateDatasetInput({ ...good, fields: [...good.fields, good.fields[1]] })).toThrow(/twice/);
  });
});

describe("guessField", () => {
  it("guesses role, type and format from a column", () => {
    expect(guessField("report_date", "date")).toMatchObject({ role: "time", dataType: "date" });
    expect(guessField("amount", "decimal")).toMatchObject({ role: "measure", dataType: "number", defaultAgg: "sum", format: "currency" });
    expect(guessField("process_id", "char")).toMatchObject({ role: "dimension", lookup: "process" });
    expect(guessField("conversion_pct", "decimal")).toMatchObject({ format: "percent", defaultAgg: "avg" });
    expect(guessField("created_at", "datetime")).toMatchObject({ role: "dimension", dataType: "datetime" });
  });
});
