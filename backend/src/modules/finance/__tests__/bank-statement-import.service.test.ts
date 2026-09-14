import { describe, expect, it } from "vitest";
import { parseStatementRows } from "../bank-statement-import.service.js";

describe("bank-statement-import.service parseStatementRows", () => {
  it("maps a debit/credit-pair layout to ParsedStatementLine[]", () => {
    const headers = ["Txn Date", "Narration", "Chq/Ref No", "Debit", "Credit"];
    const rows = [
      ["02/09/2026", "NEFT to Vendor Payables", "UTR123", "50000", ""],
      ["05/09/2026", "Interest Credited", "", "", "120.50"],
    ];
    const lines = parseStatementRows(headers, rows, {
      date: "Txn Date", description: "Narration", reference: "Chq/Ref No", debit: "Debit", credit: "Credit",
    });
    expect(lines).toEqual([
      { txn_date: "2026-09-02", description: "NEFT to Vendor Payables", reference: "UTR123", debit_amount: 50000, credit_amount: 0 },
      { txn_date: "2026-09-05", description: "Interest Credited", reference: null, debit_amount: 0, credit_amount: 120.5 },
    ]);
  });

  it("maps a single signed-amount layout (negative = debit, positive = credit)", () => {
    const headers = ["Date", "Description", "Amount"];
    const rows = [["2026-09-02", "NEFT to Vendor Payables", "-50000"], ["2026-09-05", "Interest Credited", "120.50"]];
    const lines = parseStatementRows(headers, rows, { date: "Date", description: "Description", amount: "Amount" });
    expect(lines).toEqual([
      { txn_date: "2026-09-02", description: "NEFT to Vendor Payables", reference: null, debit_amount: 50000, credit_amount: 0 },
      { txn_date: "2026-09-05", description: "Interest Credited", reference: null, debit_amount: 0, credit_amount: 120.5 },
    ]);
  });

  it("skips rows with no parseable date and rows with zero amount on both sides", () => {
    const headers = ["Date", "Description", "Debit", "Credit"];
    const rows = [["not a date", "junk", "", ""], ["2026-09-02", "zero row", "0", "0"], ["2026-09-03", "real", "10", ""]];
    const lines = parseStatementRows(headers, rows, { date: "Date", description: "Description", debit: "Debit", credit: "Credit" });
    expect(lines).toHaveLength(1);
    expect(lines[0].description).toBe("real");
  });

  it("throws if a mapped column name isn't actually in the headers", () => {
    expect(() => parseStatementRows(["Date", "Description"], [["2026-09-02", "x"]], {
      date: "Date", description: "Description", debit: "Missing Column",
    })).toThrow(/Missing Column/);
  });
});
