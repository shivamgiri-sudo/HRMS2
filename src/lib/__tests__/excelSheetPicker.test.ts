import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { describeCampaignRead, dropBlankRows, pickSheetWithHeader, readCampaignSheets } from "../excelSheetPicker";

const norm = (c: string) => c.toLowerCase().replace(/[^a-z0-9]/g, "");
const expected = new Set(["date", "dials", "connects", "campaign"].map(norm));

function wb(): XLSX.WorkBook {
  const w = XLSX.utils.book_new();
  const dialer = (rows: unknown[][]) => XLSX.utils.aoa_to_sheet([["DIALER MIS"], ["Date", "Dials", "Connects"], ["", "", "", "Count Of Agents"], ...rows]);
  XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet([[]]), "-");
  XLSX.utils.book_append_sheet(w, dialer([["2026-09-01", 10, 4], ["2026-09-02", 12, 5]]), "SBI_1_4_");
  XLSX.utils.book_append_sheet(w, dialer([["2026-09-01", 7, 2]]), "SBI_5_6");
  XLSX.utils.book_append_sheet(w, dialer([]), "EMPTY_CAMPAIGN");
  XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet([["foo", "bar"], [1, 2]]), "Notes");
  return w;
}

describe("excelSheetPicker", () => {
  it("finds a header that is not on row 1 and skips the empty '-' sheet", () => {
    const p = pickSheetWithHeader(wb(), expected, norm);
    expect(p.name).toBe("SBI_1_4_");
    expect(p.headerRow).toBe(1);
  });

  it("reads every matching sheet, tags Campaign with the verbatim sheet name, drops sub-header rows", () => {
    const res = readCampaignSheets(wb(), expected, norm, ["Date"]);
    expect(res.rows).toHaveLength(3);
    expect(res.rows.map((r) => r.Campaign)).toEqual(["SBI_1_4_", "SBI_1_4_", "SBI_5_6"]);
    expect(res.campaigns).toBe(2);
    expect(res.sheetsSkipped).toBe(3); // '-', EMPTY_CAMPAIGN, Notes
    expect(res.blankRowsDropped).toBe(3); // one "Count Of Agents" row per dialer sheet
    expect(describeCampaignRead(res)).toContain("3 rows from 2 campaign(s)");
  });

  it("dropBlankRows keeps rows with any required value, and ignores injected columns", () => {
    const out = dropBlankRows([{ A: "x", B: "" }, { A: "", B: "y" }, { A: " ", B: "", Campaign: "S" }], ["A"], norm, ["Campaign"]);
    expect(out.rows).toHaveLength(1);
    expect(out.dropped).toBe(2);
    expect(dropBlankRows([{ A: "", B: "", Campaign: "S" }, { A: "", B: "z" }], [], norm, ["Campaign"]).rows).toHaveLength(1);
  });
});

describe("dialer export helpers", () => {
  const csv = [
    "Agent Time Detail                        2026-09-29 18:24:56,,",
    "Time range: 2026-09-28 00:00:00 to 2026-09-28 23:59:59,,",
    ",,",
    "USER,ID,CALLS",
    "ABC,MAS1,5",
  ].join("\n");
  const wb = XLSX.read(csv, { type: "string" });
  it("reads the report day from the Time range line and still finds the header on row 4", async () => {
    const { detectTimeRangeDate, pickSheetWithHeader } = await import("../excelSheetPicker");
    expect(detectTimeRangeDate(wb.Sheets[wb.SheetNames[0]!]!)).toBe("2026-09-28");
    const norm = (c: string) => c.toLowerCase().replace(/[^a-z0-9]/g, "");
    expect(pickSheetWithHeader(wb, new Set(["user", "id", "calls"]), norm).headerRow).toBe(3);
  });
  it("converts Excel serials to date-times and picks the latest day", async () => {
    const { serialToDateTime, latestDay } = await import("../excelSheetPicker");
    expect(serialToDateTime(46285.81805555556)).toBe("2026-09-20 19:38:00");
    expect(serialToDateTime(12)).toBeNull();
    expect(latestDay(["2026-09-20 19:36:00", null, "2026-09-25 09:37:00", "x"])).toBe("2026-09-25");
  });
});

describe("SBI day-end export names and PII", () => {
  it("reads the report day and flow from the file name", async () => {
    const { parseExportName } = await import("../excelSheetPicker");
    expect(parseExportName("MAS_AHM_FLOW_NEW_28092026.csv")).toEqual({ date: "2026-09-28", flow: "NEW" });
    expect(parseExportName("MAS_AHM_FLOW_MANUAL_28092026.xlsx")).toEqual({ date: "2026-09-28", flow: "MANUAL" });
    expect(parseExportName("Collection_Export_Dump.xlsx")).toEqual({ date: null, flow: null });
    expect(parseExportName("AGENT_TIME20260929-182456.csv").date).toBeNull(); // yyyymmdd-hhmmss is not a ddmmyyyy stamp
  });
  it("spots unmasked contact numbers but not masked ones", async () => {
    const { countUnmaskedPhones } = await import("../excelSheetPicker");
    expect(countUnmaskedPhones([{ MOBILE_NO: "9419865903" }, { MOBILE_NO: "XXXXXX5903" }, { MOBILE_NO: "" }, { ACCOUNT_NO: "9419865903" }])).toBe(1);
  });
});
