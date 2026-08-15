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
    // The payable filter moved from account-status-only to a combined verdict on
    // 2026-08-15, when IFSC validation was added alongside the existing account checks
    // (an employee with a good account and a broken IFSC was previously written into the
    // file). payability_reason is null ONLY when the account status is "ok" AND the IFSC
    // is "ok", so this is strictly narrower than the account-only filter it replaced —
    // nothing that was excluded before is included now.
    expect(source).toMatch(/payableRows\s*=\s*rows\.filter\(\(r\)\s*=>\s*r\.payability_reason\s*===\s*null\)/);
    // Account-number corruption must still be what drives the verdict for its own class —
    // this is the assertion that would catch the account checks being dropped or bypassed
    // while the combined filter kept the test green.
    expect(source).toMatch(/r\.account_number_status\s*!==\s*"ok"\s*\?\s*`account:\$\{r\.account_number_status\}`/);
    // The two CSV builders (sbi / generic) must iterate the filtered set, not the raw rows.
    expect(source).toMatch(/for \(const r of payableRows\)/);
    expect(source).toMatch(/payableRows\.forEach\(/);
  });

  it("surfaces excluded employees rather than silently dropping them", () => {
    expect(source).toMatch(/unpayableRows/);
    expect(source).toMatch(/unpayableEmployeeCodes/);
  });
});
