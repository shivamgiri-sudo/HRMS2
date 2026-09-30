import { describe, expect, it } from "vitest";
import {
  NAMED_POOL_OPTIONS,
  SOURCE_TYPES,
  checkSheetCsvUrl,
  codeFromName,
  dateFormatOptions,
  describeFilterRows,
  describeSaveError,
  emptyFieldDraft,
  emptySourceForm,
  fieldsForType,
  filterToJson,
  formFromSource,
  parseFilter,
  processKeyOptions,
  toSourcePayload,
  validateField,
  validateFilterRows,
  validateSource,
  type SourceForm,
} from "../sources/source-form";

/**
 * These helpers decide what the Data Sources screen sends to the server. The risk is not a crash:
 * it is a source that saves, looks configured and then reads nothing, so the lists and rules are
 * pinned to the server's (kpi-studio.service.ts, .sources.ts, .pools.ts, .gsheet.ts).
 */

const PUBLISHED = "https://docs.google.com/spreadsheets/d/e/2PACX-abc/pub?gid=0&single=true&output=csv";

function form(overrides: Partial<SourceForm> = {}): SourceForm {
  return { ...emptySourceForm, source_name: "Dialer calls", source_code: "DIALER_CALLS", source_object: "calls", ...overrides };
}

describe("source types and option lists", () => {
  it("offers exactly the six types the server accepts", () => {
    expect(SOURCE_TYPES.map((type) => type.value).sort()).toEqual(
      ["google_sheet_csv", "integration_connector", "local_query", "manual", "named_pool", "upload"],
    );
    for (const type of SOURCE_TYPES) {
      expect(type.label.length).toBeGreaterThan(3);
      expect(type.description.length).toBeGreaterThan(10);
    }
  });

  it("lists the server's named pools", () => {
    expect(NAMED_POOL_OPTIONS.map((pool) => pool.key)).toEqual(["dialer", "onfido", "bella", "apr", "masmis"]);
  });

  it("lists the server's date formats, each with an example", () => {
    expect(dateFormatOptions.map((option) => option.value).sort()).toEqual(
      [
        "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y", "%Y/%m/%d", "%d-%b-%Y", "%d %b %Y",
        "%Y-%m-%d %H:%i:%s", "%d-%m-%Y %H:%i:%s", "excel_serial",
      ].sort(),
    );
    expect(dateFormatOptions.every((option) => option.example && option.label)).toBe(true);
  });

  it("explains the four process-key kinds in plain words", () => {
    const byValue = Object.fromEntries(processKeyOptions.map((option) => [option.value, option.label]));
    expect(byValue).toEqual({
      none: "Not tied to a process",
      constant: "Every row belongs to one process",
      column: "A column says which process",
      employee: "Use each employee's own process",
    });
  });
});

describe("fieldsForType", () => {
  it("shows table inputs only for the three database-backed types", () => {
    expect(fieldsForType("local_query")).toMatchObject({ table: true, integrationKey: false, namedPool: false, processKey: true });
    expect(fieldsForType("named_pool")).toMatchObject({ table: true, namedPool: true, integrationKey: false });
    expect(fieldsForType("integration_connector")).toMatchObject({ table: true, integrationKey: true, namedPool: false });
  });

  it("shows the link and column headings for a sheet, and nothing for file-backed types", () => {
    expect(fieldsForType("google_sheet_csv")).toMatchObject({ sheet: true, table: false, rowColumns: true, dateFormat: false });
    for (const type of ["upload", "manual"]) {
      expect(Object.values(fieldsForType(type)).some(Boolean)).toBe(false);
    }
  });
});

describe("validateSource", () => {
  it("accepts a plain local table", () => {
    expect(validateSource(form())).toEqual([]);
  });

  it("requires a name and a legal code", () => {
    const problems = validateSource(form({ source_name: " ", source_code: "9bad code" }));
    expect(problems).toHaveLength(2);
  });

  it("requires the integration key for a connector", () => {
    expect(validateSource(form({ source_type: "integration_connector" }))[0]).toMatch(/Integration Hub key/);
  });

  it("requires a known database for a named pool", () => {
    expect(validateSource(form({ source_type: "named_pool" }))[0]).toMatch(/Pick which database/);
    expect(validateSource(form({ source_type: "named_pool", integration_key: "nope" }))[0]).toMatch(/not a database/);
    expect(validateSource(form({ source_type: "named_pool", integration_key: "masmis" }))).toEqual([]);
  });

  it("requires the link and both column headings for a sheet", () => {
    const sheet = form({ source_type: "google_sheet_csv", source_object: "" });
    expect(validateSource(sheet)).toHaveLength(3);
    expect(validateSource({ ...sheet, csv_url: PUBLISHED, employee_key_column: "Emp Code", date_column: "Date" })).toEqual([]);
  });

  it("needs nothing beyond name and code for upload and manual", () => {
    expect(validateSource(form({ source_type: "upload", source_object: "" }))).toEqual([]);
    expect(validateSource(form({ source_type: "manual", source_object: "" }))).toEqual([]);
  });

  it("applies the process-key rules", () => {
    expect(validateSource(form({ process_key_kind: "constant" }))).toEqual(["Pick the process this source belongs to."]);
    expect(validateSource(form({ process_key_kind: "column", process_id: "p1" }))).toHaveLength(2);
    expect(
      validateSource(form({ process_key_kind: "column", process_id: "p1", process_key_column: "client_code", process_key_value: "GNC" })),
    ).toEqual([]);
    expect(validateSource(form({ process_key_kind: "employee", process_id: "p1" }))[0]).toMatch(/column that holds the employee/);
  });

  it("refuses the employee lookup on a connector", () => {
    const problems = validateSource(
      form({ source_type: "integration_connector", integration_key: "k", process_key_kind: "employee", process_id: "p1", employee_key_column: "emp" }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/only works for a table inside this system/);
  });

  it("skips process and date-format checks the database cannot store", () => {
    const broken = form({ process_key_kind: "constant", date_format: "%y" });
    expect(validateSource(broken)).toHaveLength(2);
    expect(validateSource(broken, { processGrain: false, dateFormat: false })).toEqual([]);
  });
});

describe("toSourcePayload", () => {
  it("matches what a seed script sends for a shared table mapped by column", () => {
    const payload = toSourcePayload(
      form({
        source_code: "inbound_cdr_gnc",
        source_object: " inbound_cdr_daily_actual ",
        date_column: "call_date",
        process_key_kind: "column",
        process_key_column: "client_code",
        process_key_value: "GNC",
        process_id: "p1",
      }),
    );
    expect(payload).toMatchObject({
      source_code: "INBOUND_CDR_GNC",
      source_type: "local_query",
      source_object: "inbound_cdr_daily_actual",
      employee_key_column: null,
      date_column: "call_date",
      date_format: null,
      process_key_kind: "column",
      process_key_column: "client_code",
      process_key_value: "GNC",
      process_id: "p1",
    });
    expect(payload).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("csv_url");
  });

  it("drops inputs that do not apply to the chosen type on a new source", () => {
    const payload = toSourcePayload(
      form({ source_type: "upload", integration_key: "stale", date_format: "%d-%m-%Y", process_key_kind: "constant", process_id: "p1" }),
    );
    expect(payload).toMatchObject({
      integration_key: null, source_object: null, date_format: null, process_key_kind: "none", process_id: null,
    });
  });

  it("keeps hidden settings when editing, so a rename cannot wipe them", () => {
    const payload = toSourcePayload(form({ id: "s1", source_type: "upload", process_key_kind: "employee", process_id: "p1" }));
    expect(payload).toMatchObject({ id: "s1", process_key_kind: "employee", process_id: "p1" });
  });

  it("sends the sheet link and tab only for a sheet", () => {
    const payload = toSourcePayload(form({ source_type: "google_sheet_csv", csv_url: ` ${PUBLISHED} `, sheet_tab: "" }));
    expect(payload.csv_url).toBe(PUBLISHED);
    expect(payload.sheet_tab).toBeNull();
  });

  it("omits settings the database cannot store", () => {
    const payload = toSourcePayload(form(), { processGrain: false, dateFormat: false });
    expect(payload).not.toHaveProperty("process_key_kind");
    expect(payload).not.toHaveProperty("date_format");
  });
});

describe("formFromSource and codeFromName", () => {
  it("restores the sheet link from config_json, as text or parsed", () => {
    const config = { csv_url: PUBLISHED, tab: "Daily" };
    for (const config_json of [config, JSON.stringify(config)]) {
      const restored = formFromSource({ id: "s1", source_code: "X", source_name: "X", source_type: "google_sheet_csv", config_json });
      expect(restored).toMatchObject({ id: "s1", csv_url: PUBLISHED, sheet_tab: "Daily", process_key_kind: "none" });
    }
  });

  it("turns nulls into empty inputs and survives unreadable config", () => {
    const restored = formFromSource({ id: "s1", source_type: "named_pool", integration_key: null, config_json: "{oops" });
    expect(restored).toMatchObject({ integration_key: "", csv_url: "", employee_key_kind: "employee_code", source_type: "named_pool" });
  });

  it("builds a legal code from a name", () => {
    expect(codeFromName("  Dialer call detail (2026) ")).toBe("DIALER_CALL_DETAIL_2026");
    expect(codeFromName("24x7 desk")).toMatch(/^[A-Z][A-Z0-9_]*$/);
  });
});

describe("checkSheetCsvUrl", () => {
  it("accepts a published CSV link", () => {
    expect(checkSheetCsvUrl(PUBLISHED)).toBeNull();
    expect(checkSheetCsvUrl("https://docs.google.com/spreadsheets/d/abc/export?format=csv")).toBeNull();
  });

  it("rejects, with a reason, everything the server rejects", () => {
    expect(checkSheetCsvUrl("")).toMatch(/Paste/);
    expect(checkSheetCsvUrl("not a link")).toMatch(/not a valid link/);
    expect(checkSheetCsvUrl(PUBLISHED.replace("https", "http"))).toMatch(/https/);
    expect(checkSheetCsvUrl("https://user:pw@docs.google.com/x/pub")).toMatch(/username or password/);
    expect(checkSheetCsvUrl("https://evil.example.com/pub?output=csv")).toMatch(/Only published Google Sheets/);
    expect(checkSheetCsvUrl("https://docs.google.com.evil.com/pub?output=csv")).toMatch(/Only published Google Sheets/);
    expect(checkSheetCsvUrl("https://docs.google.com/spreadsheets/d/abc/edit#gid=0")).toMatch(/Publish to web/);
  });
});

describe("field filters", () => {
  it("writes the exact stored shape: list for in, null for no-value operators, string otherwise", () => {
    expect(
      filterToJson([
        { column: " status ", op: "eq", value: " ANSWERED " },
        { column: "queue", op: "in", value: "a, b ,,c" },
        { column: "remarks", op: "is_not_blank", value: "ignored" },
        { column: "closed_at", op: "is_null", value: "" },
      ]),
    ).toEqual([
      { column: "status", op: "eq", value: "ANSWERED" },
      { column: "queue", op: "in", value: ["a", "b", "c"] },
      { column: "remarks", op: "is_not_blank", value: null },
      { column: "closed_at", op: "is_null", value: null },
    ]);
  });

  it("round-trips stored JSON, as text or parsed", () => {
    const stored = [
      { column: "status", op: "ne", value: "DROPPED" },
      { column: "queue", op: "in", value: ["a", "b"] },
      { column: "remarks", op: "is_blank", value: null },
    ];
    expect(filterToJson(parseFilter(JSON.stringify(stored)))).toEqual(stored);
    expect(filterToJson(parseFilter(stored))).toEqual(stored);
  });

  it("treats missing or unreadable filters as none", () => {
    for (const input of [null, undefined, "", "  ", "{bad", "{}", 7]) expect(parseFilter(input)).toEqual([]);
  });

  it("validates column names, operators and values", () => {
    expect(validateFilterRows([{ column: "status", op: "eq", value: "x" }, { column: "a", op: "is_null", value: "" }])).toEqual([]);
    expect(validateFilterRows([{ column: "", op: "eq", value: "x" }])[0]).toMatch(/Condition 1: choose a column/);
    expect(validateFilterRows([{ column: "call status", op: "eq", value: "x" }])[0]).toMatch(/not a valid column name/);
    expect(validateFilterRows([{ column: "status", op: "gte", value: " " }])[0]).toMatch(/enter a value/);
    expect(validateFilterRows([{ column: "status", op: "in", value: " , " }])[0]).toMatch(/at least one value/);
  });

  it("says what the conditions mean", () => {
    expect(describeFilterRows([])).toMatch(/every row/);
    expect(
      describeFilterRows([
        { column: "status", op: "eq", value: "ANSWERED" },
        { column: "queue", op: "in", value: "a, b" },
        { column: "remarks", op: "is_not_blank", value: "" },
      ]),
    ).toBe('Counts only rows where status is "ANSWERED" and queue is one of "a" or "b" and remarks has some text in it.');
  });
});

describe("validateField", () => {
  const draft = { ...emptyFieldDraft, field_name: "answered", source_column: "call_id", aggregate_fn: "COUNT" };

  it("accepts a filtered aggregate", () => {
    expect(validateField(draft, [{ column: "status", op: "eq", value: "ANSWERED" }], false)).toEqual([]);
  });

  it("rejects an illegal field name", () => {
    expect(validateField({ ...draft, field_name: "9 lives" }, [], false)).toHaveLength(1);
  });

  it("requires a column and an aggregate when there are conditions", () => {
    const rows = [{ column: "status", op: "eq" as const, value: "ANSWERED" }];
    expect(validateField({ ...draft, source_column: "" }, rows, false)[0]).toMatch(/Pick the column first/);
    expect(validateField({ ...draft, aggregate_fn: "NONE" }, rows, false)[0]).toMatch(/Take the value as-is/);
  });

  it("checks only the name for a file-backed source", () => {
    expect(validateField({ ...draft, source_column: "bad name" }, [], true)).toEqual([]);
  });
});

describe("describeSaveError", () => {
  it("passes a 400 message through", () => {
    expect(describeSaveError(Object.assign(new Error("Source needs a name"), { status: 400 }))).toBe("Source needs a name");
  });

  it("explains an out-of-scope refusal", () => {
    const error = Object.assign(new Error("Process X is not yours."), { status: 403, code: "OUT_OF_SCOPE" });
    expect(describeSaveError(error)).toBe("You can only set up data for processes you look after. Process X is not yours.");
  });

  it("explains a plain 403 and falls back when there is nothing to say", () => {
    expect(describeSaveError({ status: 403, message: "Forbidden" })).toMatch(/do not have permission/);
    expect(describeSaveError(null, "Try again")).toBe("Try again");
  });
});
