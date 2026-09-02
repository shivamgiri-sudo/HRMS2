import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * One KPI reading several data sources.
 *
 * The case this exists for: PCT(audited_passed, total_calls) where audited_passed is maintained by
 * the QA team in a Google Sheet and total_calls comes from the dialer database. Before this, a
 * definition pointed at exactly one source and the only workaround was copying one side into the
 * other's system — the manual reconciliation the whole feature exists to remove.
 *
 * What is worth pinning:
 *  1. Values from different sources genuinely combine into one input set for the formula.
 *  2. A field supplied by two sources is resolved deterministically AND reported, never silently.
 *  3. One unreachable source does not discard the others' data — the formula's own null handling
 *     decides whether a result is possible, which is more honest than throwing everything away.
 *  4. A field a source declared but had no value for is still PRESENT as null, so the engine can tell
 *     "no data" from "not wired up".
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));

// Neither external route is reachable from a unit test, and neither is what is under test here.
vi.mock("../../external-db/external-db.service.js", () => ({
  getPoolForKey: vi.fn(async () => {
    throw new Error("dialer unreachable");
  }),
}));

const fetchSheetCsv = vi.fn();
vi.mock("../kpi-studio.gsheet.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../kpi-studio.gsheet.js")>();
  return { ...original, fetchSheetCsv: (...args: unknown[]) => fetchSheetCsv(...args) };
});

import { readMergedSourceValues, readConfigJson } from "../kpi-studio.sources.js";
import { evaluateFormula } from "../kpi-formula.engine.js";

const EMPLOYEE = "emp-1";
const DATE = "2026-08-21";

/** A sheet source carrying the QA team's audit figures. */
const sheetSource = {
  id: "src-sheet",
  source_code: "QA_SHEET",
  source_name: "QA audit sheet",
  source_type: "google_sheet_csv",
  employee_key_column: "Employee Code",
  date_column: "Audit Date",
  config_json: { csv_url: "https://docs.google.com/spreadsheets/d/e/x/pub?output=csv" },
};

/** A local table carrying dialer volumes. */
const localSource = {
  id: "src-local",
  source_code: "DIALER_LOCAL",
  source_name: "Dialer volumes",
  source_type: "local_query",
  source_object: "call_daily",
  employee_key_column: "employee_id",
  employee_key_kind: "employee_id",
  date_column: "call_date",
};

beforeEach(() => {
  execute.mockReset();
  fetchSheetCsv.mockReset();
});

/** Mocks the employee-code lookup the sheet reader performs, plus a local query result. */
function mockDb(localRows: Array<Record<string, unknown>> = []) {
  execute.mockImplementation(async (sql: string) => {
    if (sql.includes("employee_code FROM employees")) {
      return [[{ id: EMPLOYEE, employee_code: "MAS001" }], []];
    }
    if (sql.includes("__employee_key")) return [localRows, []];
    return [[], []];
  });
}

describe("readMergedSourceValues", () => {
  it("combines fields from a sheet and a local table into one input set", () => {
    // The headline case. Neither source alone can answer the formula.
    mockDb([{ __employee_key: EMPLOYEE, __score_date: DATE, total_calls: 240 }]);
    fetchSheetCsv.mockResolvedValue({
      headers: ["Employee Code", "Audit Date", "audited_passed"],
      rows: [{ "Employee Code": "MAS001", "Audit Date": DATE, audited_passed: "12" }],
    });

    return readMergedSourceValues(
      [
        { source: sheetSource as any, fields: [{ field_name: "audited_passed", aggregate_fn: "SUM" }] },
        { source: localSource as any, fields: [{ field_name: "total_calls", source_column: "total_calls", aggregate_fn: "SUM" }] },
      ],
      [EMPLOYEE],
      DATE,
      DATE,
    ).then((merged) => {
      const bucket = merged.values.get(`${EMPLOYEE}|${DATE}`);
      expect(bucket?.get("audited_passed")).toBe(12);
      expect(bucket?.get("total_calls")).toBe(240);
      expect(merged.failures).toEqual([]);

      // And the formula that motivated all of this actually evaluates.
      const result = evaluateFormula("PCT(audited_passed, total_calls)", Object.fromEntries(bucket!));
      expect(result.value).toBeCloseTo(5, 5);
    });
  });

  it("aggregates several sheet rows for the same employee and day", () => {
    // A QA sheet legitimately has one row per audited call, so the field's aggregate decides what
    // the day's figure is.
    mockDb();
    fetchSheetCsv.mockResolvedValue({
      headers: ["Employee Code", "Audit Date", "audited_passed"],
      rows: [
        { "Employee Code": "MAS001", "Audit Date": DATE, audited_passed: "4" },
        { "Employee Code": "MAS001", "Audit Date": DATE, audited_passed: "5" },
        { "Employee Code": "MAS001", "Audit Date": DATE, audited_passed: "3" },
      ],
    });

    return readMergedSourceValues(
      [{ source: sheetSource as any, fields: [{ field_name: "audited_passed", aggregate_fn: "SUM" }] }],
      [EMPLOYEE],
      DATE,
      DATE,
    ).then((merged) => {
      expect(merged.values.get(`${EMPLOYEE}|${DATE}`)?.get("audited_passed")).toBe(12);
      expect(merged.rowsRead).toBe(3);
    });
  });

  it("averages instead when the field says so", () => {
    mockDb();
    fetchSheetCsv.mockResolvedValue({
      headers: ["Employee Code", "Audit Date", "score"],
      rows: [
        { "Employee Code": "MAS001", "Audit Date": DATE, score: "80" },
        { "Employee Code": "MAS001", "Audit Date": DATE, score: "90" },
      ],
    });

    return readMergedSourceValues(
      [{ source: sheetSource as any, fields: [{ field_name: "score", aggregate_fn: "AVG" }] }],
      [EMPLOYEE],
      DATE,
      DATE,
    ).then((merged) => {
      expect(merged.values.get(`${EMPLOYEE}|${DATE}`)?.get("score")).toBe(85);
    });
  });

  it("keeps a declared field present as null when the sheet had no value", () => {
    // Present-but-null is a fact about the source. Omitting the key would make the engine report a
    // wiring error instead, and those must stay distinguishable.
    mockDb();
    fetchSheetCsv.mockResolvedValue({
      headers: ["Employee Code", "Audit Date", "audited_passed", "fatal_count"],
      rows: [{ "Employee Code": "MAS001", "Audit Date": DATE, audited_passed: "12", fatal_count: "" }],
    });

    return readMergedSourceValues(
      [
        {
          source: sheetSource as any,
          fields: [
            { field_name: "audited_passed", aggregate_fn: "SUM" },
            { field_name: "fatal_count", aggregate_fn: "SUM" },
          ],
        },
      ],
      [EMPLOYEE],
      DATE,
      DATE,
    ).then((merged) => {
      const bucket = merged.values.get(`${EMPLOYEE}|${DATE}`)!;
      expect(bucket.has("fatal_count")).toBe(true);
      expect(bucket.get("fatal_count")).toBeNull();

      const evaluated = evaluateFormula("audited_passed - fatal_count", Object.fromEntries(bucket));
      expect(evaluated.value).toBeNull();
      expect(evaluated.error).toBeUndefined();
      expect(evaluated.nullReason).toContain("fatal_count");
    });
  });

  it("resolves a field supplied by two sources deterministically and reports it", () => {
    // Validation forbids this at save time. If it reaches here anyway the first source in read order
    // wins — deterministic, and visibly reported rather than depending on which query returned first.
    mockDb([{ __employee_key: EMPLOYEE, __score_date: DATE, total_calls: 999 }]);
    fetchSheetCsv.mockResolvedValue({
      headers: ["Employee Code", "Audit Date", "total_calls"],
      rows: [{ "Employee Code": "MAS001", "Audit Date": DATE, total_calls: "240" }],
    });

    return readMergedSourceValues(
      [
        { source: sheetSource as any, fields: [{ field_name: "total_calls", aggregate_fn: "SUM" }] },
        { source: localSource as any, fields: [{ field_name: "total_calls", source_column: "total_calls", aggregate_fn: "SUM" }] },
      ],
      [EMPLOYEE],
      DATE,
      DATE,
    ).then((merged) => {
      expect(merged.values.get(`${EMPLOYEE}|${DATE}`)?.get("total_calls")).toBe(240);
      expect(merged.failures.some((failure) => failure.error.includes('"total_calls"'))).toBe(true);
      expect(merged.failures.some((failure) => failure.error.includes("QA_SHEET"))).toBe(true);
    });
  });

  it("reports a collision once, not once per employee-day", () => {
    mockDb([
      { __employee_key: EMPLOYEE, __score_date: DATE, total_calls: 1 },
      { __employee_key: EMPLOYEE, __score_date: "2026-08-20", total_calls: 2 },
    ]);
    fetchSheetCsv.mockResolvedValue({
      headers: ["Employee Code", "Audit Date", "total_calls"],
      rows: [
        { "Employee Code": "MAS001", "Audit Date": DATE, total_calls: "10" },
        { "Employee Code": "MAS001", "Audit Date": "2026-08-20", total_calls: "20" },
      ],
    });

    return readMergedSourceValues(
      [
        { source: sheetSource as any, fields: [{ field_name: "total_calls", aggregate_fn: "SUM" }] },
        { source: localSource as any, fields: [{ field_name: "total_calls", source_column: "total_calls", aggregate_fn: "SUM" }] },
      ],
      [EMPLOYEE],
      "2026-08-20",
      DATE,
    ).then((merged) => {
      const collisionReports = merged.failures.filter((failure) => failure.error.includes('"total_calls"'));
      expect(collisionReports).toHaveLength(1);
    });
  });

  it("keeps a reachable source's data when another source fails", () => {
    // One unreachable external system must not discard what the others returned. The formula's own
    // null handling then decides whether a result is possible.
    mockDb([{ __employee_key: EMPLOYEE, __score_date: DATE, total_calls: 240 }]);
    fetchSheetCsv.mockResolvedValue({ headers: [], rows: [], error: "The sheet took too long to respond." });

    return readMergedSourceValues(
      [
        { source: sheetSource as any, fields: [{ field_name: "audited_passed", aggregate_fn: "SUM" }] },
        { source: localSource as any, fields: [{ field_name: "total_calls", source_column: "total_calls", aggregate_fn: "SUM" }] },
      ],
      [EMPLOYEE],
      DATE,
      DATE,
    ).then((merged) => {
      expect(merged.values.get(`${EMPLOYEE}|${DATE}`)?.get("total_calls")).toBe(240);
      expect(merged.failures).toHaveLength(1);
      expect(merged.failures[0].source_code).toBe("QA_SHEET");
      expect(merged.failures[0].error).toContain("too long");
    });
  });

  it("reports the failure when a connector is unreachable", () => {
    mockDb();
    return readMergedSourceValues(
      [
        {
          source: {
            id: "src-ext",
            source_code: "APR",
            source_name: "APR",
            source_type: "integration_connector",
            integration_key: "apr_productivity",
            source_object: "apr",
            employee_key_column: "UserID",
            date_column: "ReportDate",
          } as any,
          fields: [{ field_name: "talk_seconds", source_column: "talk_sec", aggregate_fn: "SUM" }],
        },
      ],
      [EMPLOYEE],
      DATE,
      DATE,
    ).then((merged) => {
      expect(merged.failures).toHaveLength(1);
      expect(merged.failures[0].source_code).toBe("APR");
      expect(merged.values.size).toBe(0);
    });
  });

  it("skips a source with no fields rather than querying it", () => {
    mockDb();
    return readMergedSourceValues([{ source: sheetSource as any, fields: [] }], [EMPLOYEE], DATE, DATE).then(
      (merged) => {
        expect(fetchSheetCsv).not.toHaveBeenCalled();
        expect(merged.values.size).toBe(0);
        expect(merged.failures).toEqual([]);
      },
    );
  });

  it("names the missing column when a sheet field has no matching header", () => {
    // The single likeliest cause of a KPI silently going empty: somebody renamed a column in the
    // sheet. It must be reported, not absorbed.
    mockDb();
    fetchSheetCsv.mockResolvedValue({
      headers: ["Employee Code", "Audit Date", "passed"],
      rows: [{ "Employee Code": "MAS001", "Audit Date": DATE, passed: "12" }],
    });

    return readMergedSourceValues(
      [
        {
          source: sheetSource as any,
          fields: [
            { field_name: "passed", aggregate_fn: "SUM" },
            { field_name: "audited_total", aggregate_fn: "SUM" },
          ],
        },
      ],
      [EMPLOYEE],
      DATE,
      DATE,
    ).then((merged) => {
      expect(merged.failures[0].error).toContain("audited_total");
      // The field that DOES match still comes through.
      expect(merged.values.get(`${EMPLOYEE}|${DATE}`)?.get("passed")).toBe(12);
    });
  });

  it("matches sheet headers regardless of case and spacing", () => {
    // Headers are typed by humans into a spreadsheet; "Employee  Code" and "employee_code" are the
    // same intent.
    mockDb();
    fetchSheetCsv.mockResolvedValue({
      headers: ["employee code", "audit date", "Audited Passed"],
      rows: [{ "employee code": "MAS001", "audit date": DATE, "Audited Passed": "12" }],
    });

    return readMergedSourceValues(
      [{ source: sheetSource as any, fields: [{ field_name: "audited_passed", aggregate_fn: "SUM" }] }],
      [EMPLOYEE],
      DATE,
      DATE,
    ).then((merged) => {
      expect(merged.values.get(`${EMPLOYEE}|${DATE}`)?.get("audited_passed")).toBe(12);
    });
  });

  it("ignores sheet rows outside the requested date range", () => {
    mockDb();
    fetchSheetCsv.mockResolvedValue({
      headers: ["Employee Code", "Audit Date", "audited_passed"],
      rows: [
        { "Employee Code": "MAS001", "Audit Date": "2026-01-01", audited_passed: "99" },
        { "Employee Code": "MAS001", "Audit Date": DATE, audited_passed: "12" },
      ],
    });

    return readMergedSourceValues(
      [{ source: sheetSource as any, fields: [{ field_name: "audited_passed", aggregate_fn: "SUM" }] }],
      [EMPLOYEE],
      DATE,
      DATE,
    ).then((merged) => {
      expect(merged.values.get(`${EMPLOYEE}|${DATE}`)?.get("audited_passed")).toBe(12);
      expect(merged.values.has(`${EMPLOYEE}|2026-01-01`)).toBe(false);
    });
  });

  it("skips a sheet row for somebody this system does not know", () => {
    // Attributing an unknown code to the wrong person would be worse than losing the row.
    mockDb();
    fetchSheetCsv.mockResolvedValue({
      headers: ["Employee Code", "Audit Date", "audited_passed"],
      rows: [{ "Employee Code": "WHO-IS-THIS", "Audit Date": DATE, audited_passed: "12" }],
    });

    return readMergedSourceValues(
      [{ source: sheetSource as any, fields: [{ field_name: "audited_passed", aggregate_fn: "SUM" }] }],
      [EMPLOYEE],
      DATE,
      DATE,
    ).then((merged) => {
      expect(merged.values.size).toBe(0);
      expect(merged.rowsRead).toBe(0);
    });
  });
});

describe("readConfigJson", () => {
  it("reads an already-parsed JSON column", () => {
    expect(readConfigJson({ config_json: { csv_url: "x" } } as any)).toEqual({ csv_url: "x" });
  });

  it("parses the string older drivers return", () => {
    expect(readConfigJson({ config_json: '{"csv_url":"x"}' } as any)).toEqual({ csv_url: "x" });
  });

  it("returns an empty object for null or malformed JSON rather than throwing", () => {
    expect(readConfigJson({ config_json: null } as any)).toEqual({});
    expect(readConfigJson({} as any)).toEqual({});
    expect(readConfigJson({ config_json: "not json" } as any)).toEqual({});
  });
});
