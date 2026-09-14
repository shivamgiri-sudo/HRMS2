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
 *
 * Updated when the importer was rewritten to bulk-prefetch its six lookups (one query per
 * table instead of up to six SELECTs per row) and chunk-batch the INSERT — the VALUES clause
 * is now built from a `${placeholders}` template instead of one literal tuple, so the regexes
 * below match the new shape. The underlying guarantees this test protects are unchanged.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SERVICE = "src/modules/bulk-upload/employee-master-bulk.service.ts";
const src = readFileSync(resolve(process.cwd(), SERVICE), "utf8");

/** Strip comments so a column merely DISCUSSED in prose never counts as written. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The column list of the INSERT INTO employees, and the placeholder count in its VALUES tuple. */
function insertLists(): { columns: string[]; placeholderCount: number } {
  const m = /INSERT INTO employees\s*\(([\s\S]*?)\)\s*VALUES/.exec(code);
  expect(m, "no INSERT INTO employees found").toBeTruthy();
  const columns = m![1].split(",").map((x) => x.trim()).filter(Boolean);

  // The single-row fallback tuple, e.g. "(?,?,?,...,1,'active',?)" — used both
  // for the per-row retry path and as the shape of each row in the chunked
  // multi-row VALUES list, so its placeholder count must match the column count.
  const tupleMatch = /VALUES\s*\("\(\?,[?,]*\)"\)|insertSql\("(\([^"]*\))"\)/.exec(code);
  expect(tupleMatch, "no single-row VALUES tuple literal found").toBeTruthy();
  const tuple = (tupleMatch![1] ?? tupleMatch![2])!;
  // "1" and 'active' are literal (not bound params); every other slot is a "?".
  const placeholderCount = (tuple.match(/\?/g) ?? []).length + 2;

  return { columns, placeholderCount };
}

describe("employee master bulk import writes the org columns it advertises", () => {
  const { columns, placeholderCount } = insertLists();

  it("INSERTs cost_centre_id, process_id and lob_id alongside branch/department/designation", () => {
    for (const col of ["branch_id", "department_id", "designation_id", "cost_centre_id", "process_id", "lob_id"]) {
      expect(columns, `${col} is missing from the bulk INSERT`).toContain(col);
    }
  });

  it("has one value per column", () => {
    // Adding a column here without its placeholder breaks every bulk import at once.
    expect(
      placeholderCount,
      `INSERT names ${columns.length} columns but its VALUES tuple supplies ${placeholderCount}`,
    ).toBe(columns.length);
  });

  it("resolves each code against its master table before inserting", () => {
    expect(code).toMatch(/FROM cost_centre_master WHERE active_status = 1 AND cost_centre_code/);
    expect(code).toMatch(/FROM process_master WHERE active_status = 1 AND process_code/);
    expect(code).toMatch(/FROM lob_master WHERE active_status = 1 AND lob_code/);
  });

  it("only attaches employees to ACTIVE master records", () => {
    // A closed cost centre or process must not collect new staff through a spreadsheet.
    for (const table of ["cost_centre_master", "process_master", "lob_master"]) {
      const m = new RegExp(`FROM ${table} WHERE active_status = 1 AND \\w+`).exec(code);
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
