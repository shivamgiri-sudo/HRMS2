import { describe, expect, it } from "vitest";
import { cellView, filterRows, funnelFor, matrixPath, matrixSummary, rowHeader, type MatrixCellData, type MatrixRowData } from "../command/campaignMatrixModel";

const cell = (o: Partial<MatrixCellData> = {}): MatrixCellData => ({ kind: "meta_live", state: "running", reason: null, reasonText: "3 contacted in 48 h", activity48h: 3,
  streamId: "s1", streamStatus: "open", mapIt: null, relink: false, ...o });
const row = (o: Partial<MatrixRowData> = {}, cells: Partial<Record<"meta_live" | "meta_old" | "he", Partial<MatrixCellData>>> = {}): MatrixRowData => ({
  key: "c1|r1", campaign: { id: "c1", name: "AHM SBI Oct", status: "active", hasForm: true },
  requisition: { id: "r1", code: "AHM-SBI-01", branch: "AHMEDABAD", closedReason: null, endDate: "2026-12-31", endDatePassed: false, seatsLeft: 32, bmiLinkPresent: true,
    completeness: { score: 45, label: "partial", missing: ["age", "night_shift"], enrolmentReady: false } },
  cells: { meta_live: cell(cells.meta_live), meta_old: cell({ kind: "meta_old", ...cells.meta_old }), he: cell({ kind: "he", ...cells.he }) },
  ...o,
});

describe("cellView", () => {
  it("running: icon + word + people, never colour alone", () => {
    expect(cellView(cell(), { canWrite: true })).toMatchObject({ word: "Running", icon: "running", people: "3 contacted in 48 h", action: null });
  });
  it("not mapped offers Map it with the prefill to writers only", () => {
    const c = cell({ state: "not_mapped", activity48h: 0, streamId: null, streamStatus: null, mapIt: { requisitionId: "r1", sourceType: "meta_live", originId: "c1" } });
    expect(cellView(c, { canWrite: true }).action).toEqual({ kind: "map_it", label: "Map it", prefill: { requisitionId: "r1", sourceType: "meta_live", originId: "c1" } });
    expect(cellView(c, { canWrite: false }).action).toBeNull();
    expect(cellView(c, { canWrite: true }).word).toBe("Not mapped");
  });
  it("idle on a paused / draft / closed stream offers Open stream; a K7BK cell offers the relink", () => {
    expect(cellView(cell({ state: "idle", reason: "stream_paused", streamStatus: "paused" }), { canWrite: true }).action).toEqual({ kind: "open_stream", label: "Open stream", streamId: "s1" });
    expect(cellView(cell({ state: "idle", reason: "requisition_closed", relink: true, streamId: null, streamStatus: null }), { canWrite: true }).action)
      .toEqual({ kind: "relink", label: "Relink to an open requisition" });
    expect(cellView(cell({ state: "idle", reason: "requisition_closed", relink: true }), { canWrite: false }).action).toBeNull();
  });
  it("not applicable reads as a dash with words for screen readers", () => {
    expect(cellView(cell({ state: "not_applicable", activity48h: 0 }), { canWrite: true })).toMatchObject({ word: "Not used", icon: "na", people: "" });
  });
});

describe("rowHeader", () => {
  it("end date chip says ended when past; seats left; criteria label with the missing rules in words", () => {
    const h = rowHeader(row({ requisition: { ...row().requisition, endDate: "2026-10-01", endDatePassed: true } }));
    expect(h.title).toBe("AHM SBI Oct");
    expect(h.endDate).toEqual({ text: "Ended 1 Oct 2026", ended: true });
    expect(h.seats).toBe("32 seats left");
    expect(h.criteria).toBe("Criteria partial (missing: age, night shift)");
    expect(rowHeader(row({ campaign: null })).title).toBe("No campaign: Hiring Engine only");
    expect(rowHeader(row({ requisition: { ...row().requisition, endDate: null } })).endDate).toEqual({ text: "No end date", ended: false });
  });
});

describe("filterRows and summary", () => {
  const rows = [row(), row({ key: "c2|r2", requisition: { ...row().requisition, id: "r2", branch: "NOIDA-2" } }, { meta_live: { state: "idle", reason: "requisition_closed" }, meta_old: { state: "not_mapped" }, he: { state: "idle", reason: "no_contact_48h" } })];
  it("branch, state and only-problems filters", () => {
    expect(filterRows(rows, { branch: "NOIDA-2", state: "all", onlyProblems: false }).map((r) => r.key)).toEqual(["c2|r2"]);
    expect(filterRows(rows, { branch: "", state: "not_mapped", onlyProblems: false }).map((r) => r.key)).toEqual(["c2|r2"]);
    expect(filterRows(rows, { branch: "", state: "all", onlyProblems: true }).map((r) => r.key)).toEqual(["c2|r2"]);
  });
  it("summary counts cells by state", () => {
    expect(matrixSummary(rows)).toEqual({ running: 3, idle: 2, notMapped: 1, rows: 2 });
  });
});

describe("funnelFor (drill-down from the analytics read)", () => {
  const analytics = {
    campaigns: [{ campaignId: "c1", campaignName: "x", campaignStatus: "active", campaignRequisitionCode: "AHM-SBI-01", requisitionId: "r1", requisitionCode: "AHM-SBI-01", branch: "AHMEDABAD", sourceType: "meta_live" as const,
      stages: { leads: 40, fills: 40, screened: 38, qualified: 20, contacted: 18, invited: 10, replied: 6, confirmed: 5, arrived: 3, selected: 2, joined: 1 } }],
    byRequisition: [{ requisitionId: "r1", code: "AHM-SBI-01", branch: "AHMEDABAD", sourceType: "he" as const,
      stages: { leads: 12, fills: 0, screened: 0, qualified: 0, contacted: 9, invited: 4, replied: 2, confirmed: 2, arrived: 1, selected: 1, joined: 0 } }],
  };
  it("Meta cells read the campaign x requisition row; the Hiring Engine cell the requisition row and starts at leads", () => {
    const live = funnelFor(row(), "meta_live", analytics);
    expect(live!.map((s) => [s.label, s.n])).toEqual([["Leads", 40], ["Form fills", 40], ["Screened", 38], ["Qualified", 20], ["Contacted", 18], ["Invited", 10], ["Replied", 6], ["Confirmed", 5], ["Arrived", 3], ["Selected", 2], ["Joined", 1]]);
    const he = funnelFor(row(), "he", analytics);
    expect(he!.map((s) => s.label)).toEqual(["Leads", "Contacted", "Invited", "Replied", "Confirmed", "Arrived", "Selected", "Joined"]);
    expect(funnelFor(row(), "meta_old", analytics)).toEqual([]);
    expect(funnelFor(row(), "meta_live", null)).toBeNull();
  });
});

describe("matrixPath", () => {
  it("passes branch and requisition filters", () => {
    expect(matrixPath({ branch: "AHMEDABAD", requisitionId: null })).toBe("/api/he/campaign-matrix?branch=AHMEDABAD");
    expect(matrixPath({ branch: null, requisitionId: "r1" })).toBe("/api/he/campaign-matrix?requisitionId=r1");
    expect(matrixPath({ branch: null, requisitionId: null })).toBe("/api/he/campaign-matrix");
  });
});
