/**
 * expenseReport.service.ts's exportForPayment selected ebd.account_number raw — a
 * VARBINARY column that serialises as {"type":"Buffer","data":[...]} in the expense-
 * payment export response rather than a usable account number. `r.account_number ||
 * 'N/A'` didn't catch it: a populated Buffer is truthy, so it passed straight through.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/modules/expenses/expenseReport.service.ts"), "utf8");

describe("expenseReport.service.ts casts account_number to CHAR before it reaches JSON", () => {
  it("exportForPayment's query CASTs ebd.account_number", () => {
    // The CAST moved into TypeScript with 851d78ca: exportForPayment now selects
    // account_number_enc alongside the legacy column and unwraps both through
    // resolveAccountNumber(), which is typed `Buffer | string | null` and calls
    // .toString("utf8") on a Buffer. The VARBINARY therefore never reaches JSON raw, which is
    // the property this test exists to hold — asserting the SQL text made it fail on correct
    // code. Either mechanism is fine; neither is the defect.
    expect(source).toMatch(/CAST\(ebd\.account_number AS CHAR\)|resolveAccountNumber\s*\(/);
    // And the decoded value must actually be what the export emits, not a parallel unused call.
    expect(source).toMatch(/account_number:\s*resolveAccountNumber\s*\(|CAST\(ebd\.account_number AS CHAR\)/);
  });
});
