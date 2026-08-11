import { describe, it, expect } from "vitest";
import { rethrowReportSchemaError, ReportSourceUnavailableError } from "../types.js";

/**
 * Regression coverage for reports answering "0" when their source query is broken.
 *
 * exit.executor caught ER_BAD_FIELD_ERROR / ER_NO_SUCH_TABLE at four sites and returned
 * `{ rows: [], rowCount: 0, isTruncated: false }`. operations.executor did the same, and its
 * count() returned a literal 0. For a report those are indistinguishable from a true answer
 * — "nobody left and nothing is owed", "no fatal errors" — and they are the reassuring
 * reading, so nobody investigates.
 *
 * Verified against production 2026-08-11 before changing the behaviour: exit_request,
 * exit_clearance_checklist and full_final_calculation all exist, all 22 columns the exit
 * executor references exist, and db_audit.call_quality_assessment holds 442,270 rows. So
 * these paths are unreachable today and this change alters no current output — it only
 * decides what happens the next time the schema drifts.
 */

const mysqlError = (code: string, sqlMessage = "detail from mysql") =>
  Object.assign(new Error(code), { code, sqlMessage });

describe("rethrowReportSchemaError", () => {
  it("never returns — every path throws", () => {
    for (const code of ["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR", "ER_PARSE_ERROR", "ECONNREFUSED"]) {
      expect(() => rethrowReportSchemaError("exit", mysqlError(code), "SELECT 1 FROM t")).toThrow();
    }
  });

  it("reports a missing table as ReportSourceUnavailableError, naming the table", () => {
    try {
      rethrowReportSchemaError("exit", mysqlError("ER_NO_SUCH_TABLE"), "SELECT * FROM exit_request er WHERE 1=1");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ReportSourceUnavailableError);
      expect((e as ReportSourceUnavailableError).missingTable).toBe("exit_request");
      expect((e as Error).message).toContain("does not exist");
    }
  });

  it("extracts a schema-qualified table name too", () => {
    try {
      rethrowReportSchemaError("operations", mysqlError("ER_NO_SUCH_TABLE"), "SELECT * FROM db_audit.call_quality_assessment q");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as ReportSourceUnavailableError).missingTable).toBe("db_audit.call_quality_assessment");
    }
  });

  it("does NOT claim a missing table when only a column is missing", () => {
    // Borrowing the "table does not exist" wording would send the reader looking for the
    // wrong thing — the table is present, the column is not.
    try {
      rethrowReportSchemaError("operations", mysqlError("ER_BAD_FIELD_ERROR", "Unknown column 'q.foo'"), "SELECT q.foo FROM db_audit.call_quality_assessment q");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).not.toBeInstanceOf(ReportSourceUnavailableError);
      expect((e as Error).message).toContain("The table exists");
      expect((e as Error).message).toContain("Unknown column 'q.foo'");
      expect((e as Error).message).toContain("operations");
    }
  });

  it("treats ER_BAD_TABLE_ERROR as a missing source, not a missing column", () => {
    try {
      rethrowReportSchemaError("leave", mysqlError("ER_BAD_TABLE_ERROR"), "SELECT * FROM leave_encashment_request x");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ReportSourceUnavailableError);
    }
  });

  it("rethrows an unrelated error untouched, so a connection fault is not relabelled", () => {
    const original = mysqlError("ECONNREFUSED");
    expect(() => rethrowReportSchemaError("exit", original, "SELECT 1 FROM t")).toThrow(original);
  });

  it("still throws when the SQL has no parseable FROM clause", () => {
    try {
      rethrowReportSchemaError("exit", mysqlError("ER_NO_SUCH_TABLE"), "WITH x AS (SELECT 1) SELECT * FROM x");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ReportSourceUnavailableError);
      // "unknown" is honest when the table cannot be identified; it must not silently pass.
      expect((e as ReportSourceUnavailableError).missingTable).toBeTruthy();
    }
  });
});

describe("the executors no longer swallow schema errors", () => {
  it("exit.executor has no empty-result fallback left", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../exit.executor.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toContain("return { rows: [], rowCount: 0, isTruncated: false };");
    expect(src).toContain("rethrowReportSchemaError");
  });

  it("operations.executor no longer returns a literal 0 on a schema error", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../operations.executor.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toContain("OPS_SCHEMA_ERRORS");
    expect(src).toContain("rethrowReportSchemaError");
  });
});
