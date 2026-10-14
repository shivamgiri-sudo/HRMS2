import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildRawWorkbook, rawWorkbookFilename } from "../rawWorkbook.js";

const report: any = {
  branch: "NOIDA-2",
  reportDate: "2026-10-14",
  overallStatus: "critical",
  criticalPoints: [{ severity: "critical", label: "L", detail: "D" }],
  escalations: [{ key: "k", label: "Esc", detail: "d", owner: "HR", days: 2, since: "2026-10-13", source: "src" }],
  raw: {
    branchId: "b1",
    budget: { totalBudget: 100, consumed: 40 },
    recentGrns: [{ id: 1, amount: 5 }, { id: 2, amount: 7, extra: "x" }],
    headcount: { joinedNames: ["A", "B"], byProcess: [] },
  },
};

describe("buildRawWorkbook", () => {
  it("dumps every scalar and every list row", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildRawWorkbook(report));
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual(expect.arrayContaining(["README", "Escalations", "Metrics", "recentGrns", "headcount.joinedNames"]));
    const metrics = wb.getWorksheet("Metrics")!;
    const vals = new Map<string, unknown>();
    metrics.eachRow((r) => vals.set(String(r.getCell(1).value), r.getCell(2).value));
    expect(vals.get("budget.totalBudget")).toBe(100);
    expect(wb.getWorksheet("recentGrns")!.rowCount).toBe(3);
    expect(wb.getWorksheet("headcount.joinedNames")!.rowCount).toBe(3);
  });
  it("names the file by branch and date", () => {
    expect(rawWorkbookFilename("NOIDA-2", "2026-10-14")).toBe("branch-health-raw-data_NOIDA-2_2026-10-14.xlsx");
  });
});
