/**
 * employee_bank_detail.account_number is VARBINARY(500). Selected raw it serialises
 * to JSON as {"type":"Buffer","data":[...]}, not a usable account number. Confirmed
 * live at 4 sites in this file that had no CAST: bank-change-requests,
 * neft-transfer-file, and the payroll statutory export (ac_no). A 4th site,
 * cheque-name-mismatch-report, also reads this column raw but references other
 * nonexistent columns (verification_status, penny_drop_name, mismatch_reason) and
 * needs a separate redesign — deliberately not covered here.
 *
 * Positive tripwire (assert the fix is present) rather than a negative regex trying
 * to exclude the one legitimate bare `GROUP BY ebd.account_number` reference, which
 * is far more fragile than asserting the known-good CAST count directly.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/modules/reporting/report-suite.routes.ts"), "utf8");

describe("report-suite.routes.ts casts account_number to CHAR before it reaches JSON", () => {
  it("CAST(ebd.account_number AS CHAR) appears at the 3 fixed report sites", () => {
    const count = (source.match(/CAST\(ebd\.account_number AS CHAR\)/g) ?? []).length;
    expect(
      count,
      "bank-change-requests, neft-transfer-file, and the payroll statutory export " +
        "(ac_no) should each CAST account_number. If this count changed, confirm " +
        "whether a site was added/removed deliberately.",
    ).toBeGreaterThanOrEqual(3);
  });

  it("neft-transfer-file's GROUP BY still includes the raw column (functional dependency, not a leak)", () => {
    expect(source).toMatch(/GROUP BY[\s\S]*?ebd\.account_number/);
  });
});
