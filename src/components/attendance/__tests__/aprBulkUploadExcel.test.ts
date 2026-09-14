import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { sheetRowsToCsvText, excelFileToCsvText } from "../AprBulkUpload";

/**
 * The APR bulk upload is the one Bulk Upload Hub screen that is CSV-only — every
 * user report of "quote reference <hex>" traced back to an Excel file hitting that
 * multer fileFilter (see aprBulkUploadRejection.test.ts on the backend). Rather than
 * relax the server's tested CSV contract, Excel is converted to CSV client-side
 * before the network call. These tests exercise that conversion directly.
 */
describe("sheetRowsToCsvText", () => {
  it("converts a well-formed sheet to the exact CSV the backend parses", () => {
    const rows = [
      ["employee_code", "attendance_date", "net_login_minutes"],
      ["MAS001", "01-06-2026", "490"],
      ["MAS002", "01-06-2026", "250"],
    ];
    expect(sheetRowsToCsvText(rows)).toBe(
      "employee_code,attendance_date,net_login_minutes\nMAS001,01-06-2026,490\nMAS002,01-06-2026,250",
    );
  });

  it("accepts a reordered header, matching the backend's own header.indexOf() lookup", () => {
    const rows = [
      ["net_login_minutes", "employee_code", "attendance_date"],
      ["490", "MAS001", "01-06-2026"],
    ];
    expect(sheetRowsToCsvText(rows)).toBe(
      "employee_code,attendance_date,net_login_minutes\nMAS001,01-06-2026,490",
    );
  });

  it("is case-insensitive and trims header whitespace", () => {
    const rows = [
      [" Employee_Code ", "Attendance_Date", "NET_LOGIN_MINUTES"],
      ["MAS001", "01-06-2026", "490"],
    ];
    expect(sheetRowsToCsvText(rows)).toBe(
      "employee_code,attendance_date,net_login_minutes\nMAS001,01-06-2026,490",
    );
  });

  it("skips fully blank rows", () => {
    const rows = [
      ["employee_code", "attendance_date", "net_login_minutes"],
      ["MAS001", "01-06-2026", "490"],
      ["", "", ""],
      ["MAS002", "01-06-2026", "250"],
    ];
    const csv = sheetRowsToCsvText(rows);
    expect(csv.split("\n")).toHaveLength(3); // header + 2 data rows, blank dropped
  });

  it("normalises a genuine Excel date serial to YYYY-MM-DD regardless of the cell's display format", () => {
    // 46174 is 2026-06-01 as an Excel serial (1900 date system) — the raw form
    // sheet_to_json({raw:true}) returns for a real date-typed cell, independent
    // of whatever format string Excel happened to display it with.
    const rows = [
      ["employee_code", "attendance_date", "net_login_minutes"],
      ["MAS001", 46174, "490"],
    ];
    expect(sheetRowsToCsvText(rows)).toBe(
      "employee_code,attendance_date,net_login_minutes\nMAS001,2026-06-01,490",
    );
  });

  it("normalises a slash-typed date to the dash form the backend accepts", () => {
    const rows = [
      ["employee_code", "attendance_date", "net_login_minutes"],
      ["MAS001", "01/06/2026", "490"],
    ];
    expect(sheetRowsToCsvText(rows)).toBe(
      "employee_code,attendance_date,net_login_minutes\nMAS001,01-06-2026,490",
    );
  });

  it("leaves an already dash-formatted date untouched", () => {
    const rows = [
      ["employee_code", "attendance_date", "net_login_minutes"],
      ["MAS001", "01-06-2026", "490"],
    ];
    expect(sheetRowsToCsvText(rows)).toBe(
      "employee_code,attendance_date,net_login_minutes\nMAS001,01-06-2026,490",
    );
  });

  it("rejects a sheet missing a required column, naming exactly which one", () => {
    const rows = [
      ["employee_code", "net_login_minutes"], // attendance_date missing
      ["MAS001", "490"],
    ];
    expect(() => sheetRowsToCsvText(rows)).toThrow(/Missing: attendance_date/);
  });

  it("rejects an empty sheet", () => {
    expect(() => sheetRowsToCsvText([])).toThrow(/empty/i);
  });

  it("rejects a header-only sheet with no data rows", () => {
    const rows = [["employee_code", "attendance_date", "net_login_minutes"]];
    expect(() => sheetRowsToCsvText(rows)).toThrow(/No data rows/i);
  });
});

describe("excelFileToCsvText — real workbook end to end", () => {
  function buildXlsxFile(aoa: unknown[][], filename = "apr.xlsx"): File {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "APR");
    const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    return new File([buf], filename, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }

  it("parses a real .xlsx workbook into the expected CSV", async () => {
    const file = buildXlsxFile([
      ["employee_code", "attendance_date", "net_login_minutes"],
      ["MAS001", "01-06-2026", 490],
      ["MAS002", "01-06-2026", 250],
    ]);

    const csv = await excelFileToCsvText(file);
    expect(csv).toBe(
      "employee_code,attendance_date,net_login_minutes\nMAS001,01-06-2026,490\nMAS002,01-06-2026,250",
    );
  });

  it("formats a genuine Excel date cell as YYYY-MM-DD regardless of its own display format", async () => {
    // A real Date object in the AOA becomes a date-typed cell with Excel's own
    // locale-default number format (observed: m/d/yy) — exactly the case a
    // hand-typed DD-MM-YYYY string cell does not exercise, and the one a naive
    // formatted read got wrong (see normaliseExcelDateCell's comment).
    const file = buildXlsxFile([
      ["employee_code", "attendance_date", "net_login_minutes"],
      ["MAS001", new Date(Date.UTC(2026, 5, 1)), 490],
    ]);

    const csv = await excelFileToCsvText(file);
    const dataLine = csv.split("\n")[1];
    expect(dataLine).toBe("MAS001,2026-06-01,490");
  });

  it("rejects a corrupted or non-Excel file with a clear error, not a crash", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], "not-really-excel.xlsx");
    await expect(excelFileToCsvText(file)).rejects.toThrow();
  });
});
