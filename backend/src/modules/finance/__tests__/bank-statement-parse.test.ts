import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { bankStatementImportService, parseStatementRows, toIsoDate, toNumber } from "../bank-statement-import.service.js";

describe("toIsoDate (Indian bank exports are day-first)", () => {
  it.each([
    ["03/10/2026", "2026-10-03"], ["3-10-26", "2026-10-03"], ["03.10.2026", "2026-10-03"],
    ["03-Oct-2026", "2026-10-03"], ["03 Oct 26", "2026-10-03"], ["3 Sept 2026", "2026-09-03"],
    ["2026-10-03", "2026-10-03"], ["03/10/2026 14:22:05", "2026-10-03"], [46298, "2026-10-03"],
  ])("%s -> %s", (input, out) => expect(toIsoDate(input)).toBe(out));
  it("Excel date cell read by SheetJS (1 ms before local midnight) keeps its day", () => {
    const ws = XLSX.utils.aoa_to_sheet([["Date"], [new Date(2026, 9, 3)]], { cellDates: true });
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "S");
    const back = XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), { type: "buffer", raw: true, cellDates: true });
    const cell = XLSX.utils.sheet_to_json<unknown[]>(back.Sheets.S, { header: 1, raw: true })[1][0];
    expect(toIsoDate(cell)).toBe("2026-10-03");
  });
  it("non-dates are rejected (headers, footers)", () => {
    for (const v of ["Txn Date", "Opening Balance", "", "Total", "31/31"]) expect(toIsoDate(v)).toBeNull();
  });
});

describe("toNumber", () => {
  it.each([
    ["1,23,456.00", 123456], ["₹ 500", 500], ["500.00 Cr", 500], ["250.00 Dr", -250], ["(250.00)", -250],
    ["-75.5", -75.5], [1234.567, 1234.57], ["", 0], ["-", 0], ["Rs. 1,000", 1000],
  ])("%s -> %s", (input, out) => expect(toNumber(input)).toBe(out));
});

describe("CSV statement end to end", () => {
  it("keeps day-first text dates and reads Indian-grouped amounts", () => {
    const csv = 'Txn Date,Narration,Ref,Withdrawal,Deposit\n03/10/2026,RTGS VENDOR,UTR111,"20,000.00",\n06/10/2026,NEFT CLIENT,UTR222,,"50,000.00 Cr"\nTotal,,,20000,50000\n';
    const { headers, rows } = bankStatementImportService.parseWorkbook(Buffer.from(csv));
    const lines = parseStatementRows(headers, rows, { date: "Txn Date", description: "Narration", reference: "Ref", debit: "Withdrawal", credit: "Deposit" });
    expect(lines).toEqual([
      { txn_date: "2026-10-03", description: "RTGS VENDOR", reference: "UTR111", debit_amount: 20000, credit_amount: 0 },
      { txn_date: "2026-10-06", description: "NEFT CLIENT", reference: "UTR222", debit_amount: 0, credit_amount: 50000 },
    ]);
  });
});
