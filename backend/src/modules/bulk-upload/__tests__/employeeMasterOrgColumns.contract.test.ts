/**
 * The employee bulk importer must write the org columns its own template advertises.
 *
 * EMPLOYEE_MASTER's template lists branch_code, department_code, designation_code,
 * process_code, lob_code and cost_centre_code as accepted columns. The importer resolved
 * only the first three: an operator filling process_code or lob_code in good faith got an
 * employee with neither set and no error explaining why, and cost_centre_id was not written
 * by this or any other creation path — which is how 185 active employees ended up with no
 * cost centre at all.
 *
 * Source-text inspection, matching this repo's established contract-test style.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SERVICE = "src/modules/bulk-upload/employee-master-bulk.service.ts";
const src = readFileSync(resolve(process.cwd(), SERVICE), "utf8");

/** Strip comments so a column merely DISCUSSED in prose never counts as written. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The column list and VALUES list of the INSERT INTO employees. */
function insertLists(): { columns: string[]; values: string[] } {
  const m = /INSERT INTO employees\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)/.exec(code);
  expect(m, "no INSERT INTO employees found").toBeTruthy();
  const split = (s: string) => s.split(",").map(x => x.trim()).filter(Boolean);
  return { columns: split(m![1]), values: split(m![2]) };
}

describe("employee master bulk import writes the org columns it advertises", () => {
  const { columns, values } = insertLists();

  it("INSERTs cost_centre_id, process_id and lob_id alongside branch/department/designation", () => {
    for (const col of ["branch_id", "department_id", "designation_id", "cost_centre_id", "process_id", "lob_id"]) {
      expect(columns, `${col} is missing from the bulk INSERT`).toContain(col);
    }
  });

  it("has one value per column", () => {
    // Adding a column here without its placeholder breaks every bulk import at once.
    expect(
      values.length,
      `INSERT names ${columns.length} columns but supplies ${values.length} values`,
    ).toBe(columns.length);
  });

  it("resolves each code against its master table before inserting", () => {
    expect(code).toMatch(/FROM cost_centre_master WHERE cost_centre_code = \?/);
    expect(code).toMatch(/FROM process_master WHERE process_code = \?/);
    expect(code).toMatch(/FROM lob_master WHERE lob_code = \?/);
  });

  it("only attaches employees to ACTIVE master records", () => {
    // A closed cost centre or process must not collect new staff through a spreadsheet.
    for (const table of ["cost_centre_master", "process_master", "lob_master"]) {
      const m = new RegExp(`FROM ${table} WHERE \\w+ = \\?[^\`]*?active_status = 1`).exec(code);
      expect(m, `${table} lookup does not filter on active_status = 1`).toBeTruthy();
    }
  });

  it("an upload that omits an org column does not blank the existing value", () => {
    // The upsert runs on every re-upload. Without COALESCE, a sheet that leaves the cost
    // centre column out would wipe the 184 values recovered by hand from db_bill.
    for (const col of ["cost_centre_id", "process_id", "lob_id", "branch_id", "department_id"]) {
      expect(
        code,
        `${col} must be COALESCEd in ON DUPLICATE KEY UPDATE or a re-upload erases it`,
      ).toMatch(new RegExp(`${col} = COALESCE\\(VALUES\\(${col}\\), ${col}\\)`));
    }
  });
});
