/**
 * The importer must find the roster wherever it lives in the workbook.
 *
 * It used to read `sheets: [0]` and use SheetNames[0] unconditionally. Real weekly WFM workbooks
 * are not shaped that way — the file that surfaced this has a 'Planning' grid first and the roster
 * on a later tab — so every upload was refused with "could not detect header row" no matter how
 * correct the roster tab was. Reported from production 2026-08-20.
 *
 * These build real XLSX buffers with the same library the importer uses and drive analyzeHeaders,
 * the function the sheet scan decides on. That covers the actual decision — "does this sheet look
 * like a roster" — without needing a database, which createImportBatch would.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { analyzeHeaders } from "../header-alias.service.js";

/** Build a workbook from {sheetName: rows} and read it back the way the importer does. */
function build(sheets: Record<string, unknown[][]>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), { type: "buffer" });
}

const readRows = (wb: XLSX.WorkBook, name: string): unknown[][] =>
  XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" }) as unknown[][];

/** A sheet that looks like a roster: identity columns plus several dated columns. */
const ROSTER_ROWS: unknown[][] = [
  ["Emp Code", "Name", "01-Aug-26", "02-Aug-26", "03-Aug-26"],
  ["MAS001", "A Person", "10:00 - 19:00", "WO", "10:00 - 19:00"],
  ["MAS002", "B Person", "07:00pm-04:00am", "10:00 - 19:00", "WO"],
];

/** A sheet that does NOT: a capacity grid with no date columns. This is the real first tab. */
const PLANNING_ROWS: unknown[][] = [
  ["Process", "Required HC", "Available HC"],
  ["Onfido", 42, 39],
  ["Housing", 18, 18],
];

/** Mirrors the importer's scan: first sheet, then every other sheet until one has a header row. */
function pickRosterSheet(wb: XLSX.WorkBook): { sheetName: string | null } {
  const first = wb.SheetNames[0];
  if (analyzeHeaders(readRows(wb, first)).headerRowIndex !== -1) return { sheetName: first };
  for (const name of wb.SheetNames) {
    if (name === first) continue;
    if (analyzeHeaders(readRows(wb, name)).headerRowIndex !== -1) return { sheetName: name };
  }
  return { sheetName: null };
}

describe("roster import — sheet selection", () => {
  it("uses the first sheet when it is the roster", () => {
    const wb = build({ Roster: ROSTER_ROWS, Notes: PLANNING_ROWS });
    expect(pickRosterSheet(wb).sheetName).toBe("Roster");
  });

  it("finds the roster when a non-roster tab comes first", () => {
    // The exact reported shape: 'Planning' first, roster later. This failed outright before.
    const wb = build({ Planning: PLANNING_ROWS, Roster: ROSTER_ROWS });
    expect(pickRosterSheet(wb).sheetName).toBe("Roster");
  });

  it("finds the roster several tabs in", () => {
    const wb = build({
      Planning: PLANNING_ROWS,
      Summary: PLANNING_ROWS,
      Shrinkage: PLANNING_ROWS,
      "Aug Roster": ROSTER_ROWS,
    });
    expect(pickRosterSheet(wb).sheetName).toBe("Aug Roster");
  });

  it("reports nothing found when no tab is a roster, so the error can name them all", () => {
    const wb = build({ Planning: PLANNING_ROWS, Summary: PLANNING_ROWS });
    expect(pickRosterSheet(wb).sheetName).toBeNull();
    expect(wb.SheetNames).toEqual(["Planning", "Summary"]);
  });

  it("still handles Excel date cells, which arrive as numbers not strings", () => {
    // The regression that crashed the first real file: sheet_to_json returns genuine date cells
    // as Excel serials, and every header helper assumed a string.
    const wb = build({
      Planning: PLANNING_ROWS,
      Roster: [
        ["Emp Code", "Name", new Date("2026-08-01"), new Date("2026-08-02"), new Date("2026-08-03")],
        ["MAS001", "A Person", "10:00 - 19:00", "WO", "10:00 - 19:00"],
      ],
    });
    expect(() => pickRosterSheet(wb)).not.toThrow();
    expect(pickRosterSheet(wb).sheetName).toBe("Roster");
  });
});

describe("roster import — the scan is load-bearing", () => {
  it("first-sheet-only would have refused the reported file", () => {
    // Guards against someone "optimising" the scan back to SheetNames[0]. Under the old
    // behaviour this exact workbook produced "could not detect header row" and the roster tab
    // was never even opened.
    const wb = build({ Planning: PLANNING_ROWS, Roster: ROSTER_ROWS });
    const firstSheetOnly = analyzeHeaders(readRows(wb, wb.SheetNames[0]));
    expect(firstSheetOnly.headerRowIndex, "first sheet must NOT look like a roster").toBe(-1);
    expect(pickRosterSheet(wb).sheetName, "the scan must still find it").toBe("Roster");
  });

  it("the service scans beyond the first sheet", () => {
    // The behaviour above lives in createImportBatch, which needs a database to call. Assert the
    // scan exists in the source so this file cannot pass while the service regresses.
    const src = readFileSync(resolve(__dirname, "../roster-import.service.ts"), "utf8");
    expect(src).toMatch(/for \(const candidate of probe\.SheetNames\)/);
    // Detection is bounded to the header band: reading all sheets in full OOMs Node on a 7.6 MB
    // 12-tab workbook.
    expect(src).toMatch(/sheetRows: 25/);
  });
});
