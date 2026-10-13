import { describe, expect, it } from "vitest";
import {
  canonicalizeRowKeys, describeSalesImport, describeSalesPreview, displayUploadTypeName, missingRequiredHeaders,
} from "@/lib/bbbSalesUpload";

describe("Blabli Blu sales upload (hub helpers)", () => {
  it("shows the Blabli Blu spelling without touching other names", () => {
    expect(displayUploadTypeName("Bla Bli Blu — Overall Sales Raw")).toBe("Blabli Blu — Overall Sales Raw");
    expect(displayUploadTypeName("Clovia — Chat")).toBe("Clovia — Chat");
  });

  it("finds mandatory columns under any spelling and only reports truly missing ones", () => {
    expect(missingRequiredHeaders(["Order ID", "date", "Extra column"], ["OrderID", "Date"])).toEqual([]);
    expect(missingRequiredHeaders(["Order ID", "Sales Day"], ["OrderID", "Date"])).toEqual(["Date"]);
  });

  it("re-keys a row onto the template's header names and keeps extra columns", () => {
    expect(canonicalizeRowKeys({ "Order ID": "A1", "emp id": "MAS1", Diff: "x" }, ["OrderID", "EMP ID"]))
      .toEqual({ OrderID: "A1", "EMP ID": "MAS1", Diff: "x" });
  });

  it("warns before updating existing orders and states the duplicate count", () => {
    const text = describeSalesPreview({
      processConfigured: true, totalRows: 10, acceptedRows: 8, rejectedRows: 2, successPct: 80, duplicateInFile: 1,
      updatedOrders: 5, newOrders: 3, reasons: [{ label: "Invalid date", rows: 1, category: "business" }],
      dates: [{ reportDate: "2026-08-01", existingCount: 6, uploadCount: 5, updatedCount: 5, variance: -1 }],
    });
    expect(text).toContain("WARNING: 5 order(s) already exist and will be UPDATED");
    expect(text).toContain("Duplicate count: 1");
    expect(text).toContain("2026-08-01: 6 -> 5 (-1)");
  });

  it("summarises the import as Total / Accepted / Rejected / Success %", () => {
    expect(describeSalesImport("BATCH-1", { totalRows: 4, acceptedRows: 3, rejectedRows: 1, successPct: 75, rejectionPct: 25 }))
      .toContain("Total rows 4 · Accepted 3 · Rejected 1 · Success 75% · Rejection 25%.");
  });
});
