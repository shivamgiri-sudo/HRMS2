/**
 * disbursal.routes.ts's bank-export endpoint reads employee_bank_detail.account_number
 * correctly (CAST, matching live data), but had no check for Excel scientific-notation
 * corruption — confirmed live, 6,070 of 12,768 active accounts (47.5%) are unrecoverable
 * scientific notation. Without a guard, a garbled account number would silently end up
 * in a real NEFT/IMPS/RTGS bank file. Mirrors the classification already established in
 * payrollCompliance.routes.ts.
 *
 * Source-text inspection — this router is described in bank-export-gating.contract.test.ts
 * as "too heavily wired to mount in a unit test," so this follows the same style rather
 * than introducing a different testing pattern.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/modules/payroll/disbursal.routes.ts"), "utf8");

describe("bank-export classifies and excludes corrupted account numbers", () => {
  it("classifies scientific-notation corruption, matching the established pattern", () => {
    expect(source).toMatch(/corrupt_scientific_notation/);
    // The classification moved out of SQL and into TypeScript when bank reads went through
    // resolveAccountNumber for the AES-256-GCM work (851d78ca): the value now arrives already
    // decrypted-or-decoded, so a `REGEXP '[Ee][+-]'` in the query could no longer see it. The
    // rule is unchanged and still enforced a few lines later —
    //   const SCIENTIFIC_RE_D = /[Ee][+-]/;
    //   else if (SCIENTIFIC_RE_D.test(acct)) r.account_number_status = "corrupt_scientific_notation";
    // — so this asserts the live form. Asserting the SQL text made the guard report a lost
    // safety property when only its location had changed.
    expect(source).toMatch(/SCIENTIFIC_RE_D\s*=\s*\/\[Ee\]\[\+-\]\//);
    expect(source).toMatch(/SCIENTIFIC_RE_D\.test\([^)]*\)[^;]*corrupt_scientific_notation/);
  });

  it("builds the CSV only from rows classified 'ok' (excludes corrupt/missing/unrecognised)", () => {
    expect(source).toMatch(/payableRows\s*=\s*rows\.filter\(\(r\)\s*=>\s*r\.account_number_status\s*===\s*"ok"\)/);
    // The two CSV builders (sbi / generic) must iterate the filtered set, not the raw rows.
    expect(source).toMatch(/for \(const r of payableRows\)/);
    expect(source).toMatch(/payableRows\.forEach\(/);
  });

  it("surfaces excluded employees rather than silently dropping them", () => {
    expect(source).toMatch(/unpayableRows/);
    expect(source).toMatch(/unpayableEmployeeCodes/);
  });
});
