import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { branchHealthSheets, headcountProcessRows, humanize, sectionSheets } from "../excelExport";
import { HeadcountTable, headcountRows } from "../sections/peopleParts";
import type { PeopleData } from "../panelTypes";
import * as fx from "./fixtures";

const withLobs: PeopleData = {
  ...fx.people,
  byProcess: fx.people.byProcess.map((p, i) => (i === 0 ? { ...p, lobs: [{ lob: "Telecom", active: 35 }, { lob: "Banking", active: 25 }] } : p)),
};

describe("headcount LOB split", () => {
  it("puts each process's LOB rows right under it", () => {
    const rows = headcountRows(withLobs.byProcess, true);
    expect(rows.map((r) => (r.kind === "process" ? r.r.process : `> ${r.lob}`))).toEqual(["Alpha Voice", "> Telecom", "> Banking", "Beta Chat", "Gamma Back Office"]);
    expect(headcountRows(withLobs.byProcess, false)).toHaveLength(3);
  });
  it("the page table shows the LOB rows under their process", () => {
    const html = renderToStaticMarkup(<HeadcountTable d={withLobs} onProcess={() => {}} />);
    expect(html).toContain("LOB: Telecom");
    expect(html).toContain("LOB split");
    expect(html.indexOf("Alpha Voice")).toBeLessThan(html.indexOf("LOB: Telecom"));
  });
  it("shows no LOB rows when no process carries a LOB split", () => {
    expect(renderToStaticMarkup(<HeadcountTable d={fx.people} onProcess={() => {}} />)).not.toContain("LOB:");
  });
});

describe("branch health Excel", () => {
  it("headcount process-wise sheet has LOB sub-rows and a total", () => {
    const rows = headcountProcessRows(withLobs);
    expect(rows.map((r) => r["Process / LOB"])).toEqual(["Alpha Voice", "    LOB: Telecom", "    LOB: Banking", "Beta Chat", "Gamma Back Office", "Total"]);
    expect(rows[1].Active).toBe(35);
    expect(rows[1]["Joined MTD"]).toBeNull();
    expect(rows.at(-1)?.Active).toBe(120);
  });
  it("one workbook carries the summary, headcount and every loaded section", () => {
    const ov = fx.overviewOf({ people: fx.ok(withLobs) });
    const sheets = branchHealthSheets(fx.payloadOf(ov).branches[0]);
    const names = sheets.filter((s) => s.rows.length).map((s) => s.name);
    for (const n of ["Summary", "Headcount process-wise", "Headcount LOB-wise", "Attendance", "Hiring", "Finance"]) expect(names).toContain(n);
    const summary = sheets[0].rows;
    expect(summary.find((r) => r.Field === "Branch code")?.Value).toBe(ov.branch.branchCode);
  });
  it("flattens a section into fields and one sheet per list", () => {
    const s = sectionSheets("Hiring", { openPositions: 4, offers: { last30: { offered: 40 } }, batches: [{ process: "A", requested: 2 }] });
    expect(s[0].rows).toEqual([{ Field: "Open positions", Value: 4 }, { Field: "Offers · Last30 · Offered", Value: 40 }]);
    expect(s[1].rows).toEqual([{ Process: "A", Requested: 2 }]);
    expect(humanize("attritionMtdPct")).toBe("Attrition MTD %");
  });
});
