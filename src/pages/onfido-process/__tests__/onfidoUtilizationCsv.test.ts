import { describe, expect, it } from "vitest";
import { normaliseImportDate, parseUtilizationCsv, splitCsvLine } from "../onfidoUtilizationCsv";
import { bucketAxisLabel, fmtDate, fmtHc, fmtInt, fmtRatioPct, presetRange } from "../onfidoReportShared";

describe("utilization CSV import", () => {
  it("reads only the hand-entered columns and ignores report and formula columns", () => {
    const csv = [
      "Date,Month,WC,Forecasted Task,Forecasted Task POA,Utilization Forecaste,Actual Task,Manual FAR Case,Adhoc Time,Analyst QC,Facial checks,Cross training task POA,POA Live Audits / POA PQ Audits",
      '01/07/2026,Jul-26,29-Jun,"35,626.99",5734.42,52447,29580,335,7885,2143,,0,662',
      "2026-07-02,Jul-26,29-Jun,35463.45,5722.94,52000,29808,320,7895,2563,10,0,702",
    ].join("\n");
    const { rows, errors } = parseUtilizationCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ inputDate: "2026-07-01", forecastTask: "35,626.99", forecastTaskPoa: "5734.42", manualFarCases: "335", adhocTime: "7885", analystQc: "2143", facialChecks: "", crossTrainingTaskPoa: "0", poaLiveAuditsPq: "662" });
    expect(rows[1].inputDate).toBe("2026-07-02");
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
