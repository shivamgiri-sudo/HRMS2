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
    expect(source).toMatch(/CAST\(ebd\.account_number AS CHAR\)/);
  });
});
