/**
 * Every payroll line records where the person was paid.
 *
 * WHY THE STAMP EXISTS. employees.cost_centre_id is current-state only — the effective-dated
 * employee_cost_centre_allocation table exists but holds 0 rows — so a salary register that derives
 * cost centre by joining to the employee changes retroactively when somebody transfers. A closed
 * month's register would move, and a cost centre that was paid could later read as unpaid. The
 * branch and cost centre are therefore captured onto salary_prep_line at calculation.
 *
 * WHY ARITY IS TESTED. The insert is a batched multi-row statement whose column list, placeholder
 * string and value array are three separate literals that must agree. Adding a column to one and
 * forgetting the others shifts every subsequent value one field left — gross_salary landing in
 * working_days — and MySQL accepts it silently because the types are all numeric. Counting them
 * here is the only cheap way to catch that.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(DIR, "../payrollCalculate.service.ts"), "utf8");

/** The `INSERT INTO salary_prep_line (...)` column list, comments stripped. */
function insertColumns(): string[] {
  const start = source.indexOf("INSERT INTO salary_prep_line\n");
  expect(start, "salary_prep_line insert not found").toBeGreaterThan(-1);
  const open = source.indexOf("(", start);
  const close = source.indexOf(")\n       VALUES", start);
  expect(close).toBeGreaterThan(open);
  return source
    .slice(open + 1, close)
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join(" ")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

/**
 * The single-row placeholder tuple, e.g. "(?, ?, …, 'calculated', ?, …)".
 *
 * The tuple is a single-quoted JS string containing escaped quotes around the hardcoded status, so
 * the pattern has to consume `\'` rather than stopping at the first apostrophe it meets.
 */
function placeholderTuple(): string {
  const m = source.match(/batchPrepLines\.map\(\(\) => '((?:[^'\\]|\\.)*)'\)/);
  expect(m, "placeholder tuple not found").toBeTruthy();
  return m![1].replace(/\\'/g, "'");
}

describe("the line carries its branch and cost centre", () => {
  it("selects the employee's cost centre at calculation time", () => {
    expect(source).toContain("e.process_id, e.branch_id, e.cost_centre_id,");
  });

  it("writes both columns into salary_prep_line", () => {
    const cols = insertColumns();
    expect(cols).toContain("branch_id");
    expect(cols).toContain("cost_centre_id");
  });

  it("stamps them immediately after employee_code, where the values are pushed", () => {
    // Position matters: the value array is positional, so the column's place in the list is the
    // contract. Asserting the position keeps the three literals anchored to each other.
    const cols = insertColumns();
    expect(cols.slice(0, 6)).toEqual([
      "id", "run_id", "employee_id", "employee_code", "branch_id", "cost_centre_id",
    ]);
  });

  it("refreshes the stamp on recalculation instead of leaving the first pass's value", () => {
    /*
     * The insert is an upsert. If a cost centre is corrected and the run recomputed, the line must
     * record where the employee is paid this time — otherwise the correction never reaches the
     * register, which is the whole point of stamping.
     */
    // Anchored to THIS insert: the file contains more than one ON DUPLICATE KEY UPDATE, and the
    // first one belongs to a different statement entirely.
    const insertStart = source.indexOf("INSERT INTO salary_prep_line\n");
    const upsert = source.slice(source.indexOf("ON DUPLICATE KEY UPDATE", insertStart));
    expect(upsert.slice(0, 600)).toContain("cost_centre_id = VALUES(cost_centre_id)");
    expect(upsert.slice(0, 600)).toContain("branch_id = VALUES(branch_id)");
  });
});

describe("the insert's three literals agree", () => {
  it("has one placeholder per column", () => {
    /*
     * The column list, the placeholder tuple and the pushed value array are three separate literals
     * in three places. If they disagree, every value after the mismatch lands one column early and
     * MySQL accepts it without complaint, because the columns are almost all numeric. This is the
     * defect that would put a gross salary into a working-days field.
     */
    const columns = insertColumns().length;
    const tuple = placeholderTuple();
    const questionMarks = (tuple.match(/\?/g) ?? []).length;
    const literals = (tuple.match(/'[^']*'/g) ?? []).length; // e.g. the hardcoded 'calculated'
    expect(questionMarks + literals).toBe(columns);
  });

  it("still hardcodes exactly one status literal", () => {
    // If status ever became a bound parameter, the count above would need to change with it.
    expect(placeholderTuple()).toContain("'calculated'");
    expect((placeholderTuple().match(/'[^']*'/g) ?? []).length).toBe(1);
  });
});
