import { describe, expect, it } from "vitest";
import {
  assertAllowedGoogleSheetUrl,
  assertConnectorType,
  assertReadOnlyQuery,
} from "../performance-source-adapters.js";

describe("assertReadOnlyQuery", () => {
  it("allows SELECT and CTE-based reporting queries", () => {
    expect(() => assertReadOnlyQuery("SELECT employee_code FROM reporting_view WHERE report_date BETWEEN ? AND ?")).not.toThrow();
    expect(() => assertReadOnlyQuery("WITH daily AS (SELECT 1 AS ok) SELECT * FROM daily")).not.toThrow();
    expect(() => assertReadOnlyQuery("SELECT 'DROP TABLE is only text' AS label FROM reporting_view")).not.toThrow();
  });

  it.each([
    "UPDATE employees SET active_status = 0",
    "SELECT * FROM x; DELETE FROM x",
    "EXEC rebuild_reporting_table",
    "SELECT /*!50000 UPDATE employees SET active_status = 0 */ 1",
    "WITH unsafe AS (SELECT 1) SELECT * FROM unsafe; TRUNCATE TABLE x",
    "CREATE TABLE unsafe(id INT)",
  ])("blocks mutating or multi-statement SQL: %s", (query) => {
    expect(() => assertReadOnlyQuery(query)).toThrow();
  });
});

describe("assertAllowedGoogleSheetUrl", () => {
  it("accepts approved Google Sheet export hosts", () => {
    expect(assertAllowedGoogleSheetUrl(
      "https://docs.google.com/spreadsheets/d/example/export?format=csv&gid=0",
    ).hostname).toBe("docs.google.com");
  });

  it.each([
    "http://docs.google.com/spreadsheets/d/example/export?format=csv",
    "https://127.0.0.1/internal.csv",
    "https://example.com/report.csv",
    "https://user:password@docs.google.com/report.csv",
  ])("rejects unsafe or non-Google export URLs: %s", (url) => {
    expect(() => assertAllowedGoogleSheetUrl(url)).toThrow();
  });
});

describe("assertConnectorType", () => {
  it("allows a dataset to use the matching database connector", () => {
    expect(() => assertConnectorType("mysql", "mysql")).not.toThrow();
    expect(() => assertConnectorType("mssql", "mssql")).not.toThrow();
  });

  it("rejects accidental cross-database connector configuration", () => {
    expect(() => assertConnectorType("mssql", "mysql")).toThrow(/does not match/);
    expect(() => assertConnectorType("mysql", "mssql")).toThrow(/does not match/);
  });
});
