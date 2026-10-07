import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseReportFile, parseReportText, type XlsxLike } from "../superbotReportParse";

const X = XLSX as unknown as XlsxLike;
const HEAD = ["Phone Number", "Name", "Reference ID", "Status"];
const DATA = [["9625349792", "Abdulla", "HRMS-188", "answered"], ["8955312159", "Sunil", "HRMS-185", "answered"]];
const book = (sheets: Record<string, unknown[][]>) => { const wb = XLSX.utils.book_new(); for (const [n, g] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(g), n); return wb; };
const buf = (wb: XLSX.WorkBook, type: "xlsx" | "xls") => { const b = XLSX.write(wb, { type: "array", bookType: type }) as ArrayBuffer; return b; };

describe("Superbot report reader", () => {
  it("plain xlsx", () => {
    const rows = parseReportFile(X, buf(book({ Sheet1: [HEAD, ...DATA] }), "xlsx"), "report.xlsx");
    expect(rows).toHaveLength(2); expect(rows[0]["Reference ID"]).toBe("HRMS-188");
  });
  it("data on the second sheet, first sheet empty", () => {
    expect(parseReportFile(X, buf(book({ Summary: [[""]], Calls: [HEAD, ...DATA] }), "xlsx"), "r.xlsx")).toHaveLength(2);
  });
  it("title rows above the header", () => {
    const rows = parseReportFile(X, buf(book({ S: [["Call report"], ["Generated 7 Oct"], [""], HEAD, ...DATA] }), "xlsx"), "r.xlsx");
    expect(rows).toHaveLength(2); expect(rows[1].Name).toBe("Sunil");
  });
  it("legacy xls", () => {
    expect(parseReportFile(X, buf(book({ S: [HEAD, ...DATA] }), "xls"), "r.xls")).toHaveLength(2);
  });
  it("tab separated file", () => {
    const t = [HEAD, ...DATA].map((r) => r.join("\t")).join("\r\n");
    expect(parseReportFile(X, new TextEncoder().encode(t).buffer as ArrayBuffer, "r.xls")).toHaveLength(2);
  });
  it("csv file with BOM", () => {
    const t = "﻿" + [HEAD, ...DATA].map((r) => r.join(",")).join("\n");
    expect(parseReportFile(X, new TextEncoder().encode(t).buffer as ArrayBuffer, "r.csv")).toHaveLength(2);
  });
  it("html table saved as .xls", () => {
    const html = `<html><body><table><tr>${HEAD.map((h) => `<th>${h}</th>`).join("")}</tr>${DATA.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table></body></html>`;
    expect(parseReportFile(X, new TextEncoder().encode(html).buffer as ArrayBuffer, "r.xls")).toHaveLength(2);
  });
  it("text pasted from Excel", () => {
    const rows = parseReportText(X, [HEAD, ...DATA].map((r) => r.join("\t")).join("\n"));
    expect(rows).toHaveLength(2); expect(rows[0]["Phone Number"]).toBe("9625349792");
  });
  it("a truly empty file gives no rows", () => {
    expect(parseReportFile(X, buf(book({ S: [[""]] }), "xlsx"), "r.xlsx")).toHaveLength(0);
    expect(parseReportText(X, "   ")).toHaveLength(0);
  });
});
