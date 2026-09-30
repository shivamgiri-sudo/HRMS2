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
