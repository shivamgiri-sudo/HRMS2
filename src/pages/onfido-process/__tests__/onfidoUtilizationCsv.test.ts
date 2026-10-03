import { describe, expect, it } from "vitest";
import { UTILIZATION_TEMPLATE_HEADERS, cleanNumericCell, normaliseImportDate, parseUtilizationCsv, splitCsvLine, utilizationTemplateCsv } from "../onfidoUtilizationCsv";
import { bucketAxisLabel, fmtDate, fmtHc, fmtInt, fmtRatioPct, presetRange } from "../onfidoReportShared";

describe("utilization CSV import", () => {
  it("reads the hand-entered columns and ignores report columns", () => {
    const csv = [
      "Date,Month,WC,Forecasted Task,Forecasted Task POA,Utilization Forecaste,Actual Task,Manual FAR Case,Adhoc Time,Analyst QC,Facial checks,Cross training task POA,POA Live Audits / POA PQ Audits",
      '01/07/2026,Jul-26,29-Jun,"35626.99",5734.42,52447,29580,335,7885,2143,,0,662',
      "2026-07-02,Jul-26,29-Jun,35463.45,5722.94,52000,29808,320,7895,2563,10,0,702",
    ].join("\n");
    const { rows, errors } = parseUtilizationCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ inputDate: "2026-07-01", forecastTask: "35626.99", forecastTaskPoa: "5734.42", manualFarCases: "335", adhocTime: "7885", analystQc: "2143", facialChecks: "", crossTrainingTaskPoa: "0", poaLiveAuditsPq: "662" });
    expect(rows[1].inputDate).toBe("2026-07-02");
  });

  it("stores the sheet's calculated columns as uploaded static values, stripping %", () => {
    const csv = [
      "Date,Adhoc Time,Utilization Forecaste,Utilization with Adhoc,Utilization without Adhoc,Utilization with Adhoc %,Utilization without Adhoc %,POA Answering,Escalated %",
      "01/07/2026,7885,52447,60000,55000,114.4%,104.9%,88.25%,0.31%",
    ].join("\n");
    const { rows, errors } = parseUtilizationCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      fixedUtilizationForecast: "52447", fixedUtilizationWithAdhoc: "60000", fixedUtilizationWithoutAdhoc: "55000",
      fixedUtilizationWithAdhocPct: "114.4", fixedUtilizationWithoutAdhocPct: "104.9", fixedPoaAnsweringPct: "88.25", fixedEscalatedPct: "0.31",
    });
  });

  it("skips the MTD totals row and reports genuinely bad dates", () => {
    const csv = ["Date,Adhoc Time", "MTD,999", "31/02/2026,5", "01-07-2026,7"].join("\n");
    const { rows, errors } = parseUtilizationCsv(csv);
    expect(rows.map((r) => r.inputDate)).toEqual(["2026-07-01"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("31/02/2026");
  });

  it("refuses files with no Date column or no input columns", () => {
    expect(parseUtilizationCsv("Forecasted Task\n5").errors.length).toBeGreaterThan(0);
    expect(parseUtilizationCsv("Date,Actual Task\n01/07/2026,5").errors.length).toBeGreaterThan(0);
    expect(parseUtilizationCsv("Date").errors.length).toBeGreaterThan(0);
  });

  it("splits quoted fields and normalises dates", () => {
    expect(splitCsvLine('a,"b,c","d ""e"""')).toEqual(["a", "b,c", 'd "e"']);
    expect(normaliseImportDate("1/7/2026")).toBe("2026-07-01");
    expect(normaliseImportDate("2026-13-01")).toBeNull();
  });
});

describe("report formatting helpers", () => {
  it("uses Indian grouping and DD/MM/YYYY", () => {
    expect(fmtInt(1502591)).toBe("15,02,591");
    expect(fmtDate("2026-07-31")).toBe("31/07/2026");
    expect(fmtHc(54)).toBe("54");
    expect(fmtHc(56.4)).toBe("56.4");
    expect(fmtRatioPct(0.927)).toBe("92.7%");
    expect(fmtInt(null)).toBe("-");
  });

  it("labels chart buckets and builds range presets", () => {
    expect(bucketAxisLabel("2026-07", "monthly")).toBe("Jul-26");
    expect(bucketAxisLabel("2026-07-13", "weekly")).toBe("WC 13/07");
    expect(bucketAxisLabel("2026-07-13", "daily")).toBe("13/07");
    expect(presetRange("2026-07-15", "daily")).toEqual({ from: "2026-07-15", to: "2026-07-15" });
    expect(presetRange("2026-07-15", "weekly")).toEqual({ from: "2026-07-09", to: "2026-07-15" });
    expect(presetRange("2026-07-15", "monthly")).toEqual({ from: "2026-07-01", to: "2026-07-15" });
  });
});

describe("utilization CSV numeric cells and template", () => {
  it("cleans percent strings, commas and placeholders without calculating", () => {
    expect(cleanNumericCell("85%")).toBe("85");
    expect(cleanNumericCell("0.85")).toBe("0.85");
    expect(cleanNumericCell("1,234")).toBe("1234");
    expect(cleanNumericCell("-")).toBe("");
    expect(cleanNumericCell("N/A")).toBe("");
    expect(cleanNumericCell("")).toBe("");
    expect(cleanNumericCell("(5)")).toBe("-5");
    expect(cleanNumericCell("abc")).toBe("abc"); // left for the server to reject with a clear message
  });

  it("accepts % in non-percent columns and keeps blanks blank (never 0)", () => {
    const csv = ["Date,Utilization with Adhoc,Utilization with Adhoc %,Analyst QC,Facial checks", '01/07/2026,"1,234.5",85%,2143.5,'].join("\n");
    const { rows, errors } = parseUtilizationCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ fixedUtilizationWithAdhoc: "1234.5", fixedUtilizationWithAdhocPct: "85", analystQc: "2143.5", facialChecks: "" });
  });

  it("template headers round-trip through the parser", () => {
    expect(UTILIZATION_TEMPLATE_HEADERS[0]).toBe("Date");
    const { errors } = parseUtilizationCsv(`${utilizationTemplateCsv()}01/07/2026${",".repeat(UTILIZATION_TEMPLATE_HEADERS.length - 1)}`);
    expect(errors).toEqual([]);
    expect(new Set(UTILIZATION_TEMPLATE_HEADERS).size).toBe(UTILIZATION_TEMPLATE_HEADERS.length);
  });
});
