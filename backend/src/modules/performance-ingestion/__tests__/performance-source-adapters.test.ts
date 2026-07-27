import { describe, expect, it } from "vitest";
import { assertReadOnlyQuery } from "../performance-source-adapters.js";

describe("assertReadOnlyQuery", () => {
  it("allows SELECT and CTE-based reporting queries", () => {
    expect(() => assertReadOnlyQuery("SELECT employee_code FROM reporting_view WHERE report_date BETWEEN ? AND ?")).not.toThrow();
    expect(() => assertReadOnlyQuery("WITH daily AS (SELECT 1 AS ok) SELECT * FROM daily")).not.toThrow();
  });

  it.each([
    "UPDATE employees SET active_status = 0",
    "SELECT * FROM x; DELETE FROM x",
    "EXEC rebuild_reporting_table",
    "CREATE TABLE unsafe(id INT)",
  ])("blocks mutating or multi-statement SQL: %s", (query) => {
    expect(() => assertReadOnlyQuery(query)).toThrow();
  });
});
