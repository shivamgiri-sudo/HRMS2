/**
 * The db_bill statutory sync must not import placeholders as statutory numbers.
 *
 * syncEmployeeStatutoryData backfills UAN / EPF / PAN / ESIC / bank details into
 * `employees` wherever the column is empty. Its only filter was `isEmpty`, which treats
 * the exact string '0' as blank and nothing else — so every other placeholder in the
 * legacy system was copied across as though it were a real number.
 *
 * Measured against the table the sync actually reads — db_bill.masjclrentry, 33,144
 * rows, MySQL 5.5, matched on EmpCode:
 *
 *   PanNo   19,248 non-blank, of which only 15,323 are a valid PAN. The guard blocks
 *           3,925: 'NA' 2,477, 'N/A' 907, 'AN' 32, 'NO' 24, 'N' 8, '-' 8, 'NAN' 2
 *   ESICNo  4 blocked      AcNo  5 blocked      IFSCCode  8 blocked
 *   UAN and EPFNo are clean in this table
 *
 * A placeholder is worse than a NULL. NULL reads as "still to collect"; 'NA' reads as
 * collected, satisfies any presence check, and reaches Form 16 and the TDS return —
 * where an unusable PAN means deduction at the higher rate under §206AA. mas_hrms
 * already holds four active employees whose PAN is the single character '0', shared
 * across four different people in two branches, carrying 60-65 payroll lines each.
 *
 * This guards the source filter only. Widening isEmpty would also change the target
 * test and let the sync overwrite values it currently leaves alone.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { isUsable } from "../syncStatutoryDataFromDbBill.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(__dirname, "../syncStatutoryDataFromDbBill.ts"), "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("db_bill statutory sync — placeholder rejection", () => {
  it("rejects the placeholder tokens db_bill actually contains", () => {
    // Every one of these was observed in db_bill.employee_master.
    for (const token of ["NA", "N/A", "NAN", "NIL", "NONE", "0", "-", ".", ",", "A", "N", "AN", "X"]) {
      expect(isUsable(token), `${token} must not be imported as a statutory number`).toBe(false);
    }
  });

  it("rejects them regardless of case or surrounding whitespace", () => {
    // ' 0 ' matters specifically: the original isEmpty compared the UNTRIMMED value
    // against '0', so a padded zero slipped past the one check that existed.
    for (const token of [" 0 ", "na", "n/a", "  NIL", "None  "]) {
      expect(isUsable(token), `${JSON.stringify(token)} must not be imported`).toBe(false);
    }
  });

  it("still accepts genuine identifiers", () => {
    for (const value of ["ABCDE1234F", "100200300400", "GJ/AHD/1234567/000/0000001", "1013210000123456"]) {
      expect(isUsable(value), `${value} is a real identifier and must sync`).toBe(true);
    }
  });

  it("treats null, undefined and empty as unusable", () => {
    for (const value of [null, undefined, "", "   "]) {
      expect(isUsable(value)).toBe(false);
    }
  });

  it("format-checks PAN rather than only screening placeholders", () => {
    // A token list alone still admits db_bill's malformed 8- and 9-character PANs, so
    // the PAN branch must also test PAN_REGEX before writing.
    const branch = code.slice(code.indexOf("isEmpty(employee.pan_number)"));
    const body = branch.slice(0, branch.indexOf("// Check ESIC"));
    expect(body).toContain("PAN_REGEX.test(pan)");
    expect(code).toContain("import { PAN_REGEX }");
  });

  it("uses the placeholder filter on every legacy field it reads", () => {
    // isEmpty on a legacy.* value is the bug this test exists to prevent; the target
    // (employee.*) checks are expected to keep using isEmpty.
    expect(code).not.toMatch(/isEmpty\(\s*legacy\./);
    expect(code).not.toMatch(/isEmpty\(\s*epfValue\s*\)/);
  });
});
