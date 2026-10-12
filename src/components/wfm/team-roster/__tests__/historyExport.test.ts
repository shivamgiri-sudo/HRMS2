import { describe, expect, it } from "vitest";
import type { HistoryExportRow } from "@/hooks/useTeamRoster";
import { detailRows, summaryRows } from "../historyExport";

const row = (o: Partial<HistoryExportRow>): HistoryExportRow => ({
  branch: "Kolkata", process: "SBI", submissionNo: "TR-1", status: "applied", raisedBy: "Asha", raisedByCode: "M1", raisedAt: "",
  periodFrom: "", periodTo: "", managerApprover: "", managerDecision: "approved", managerDecidedBy: "", managerDecidedAt: "", managerRemarks: "",
  wfmDecision: "approved", wfmDecidedBy: "", wfmDecidedAt: "", wfmRemarks: "", appliedAt: "", employeeCode: "E1", employeeName: "Ravi",
  rosterDate: "2026-10-12", kind: "CHANGE", oldAssignment: "", newAssignment: "WEEK_OFF", reason: "", lineResult: "applied", skipReason: "", submissionNote: "",
  ...o,
});

describe("history export", () => {
  it("detail has a header and one row per cell", () => {
    const out = detailRows([row({}), row({ employeeCode: "E2" })]);
    expect(out).toHaveLength(3);
    expect(out[0][0]).toBe("Branch");
    expect(out[0]).toHaveLength(out[1].length);
  });

  it("summary rolls up per branch, process and manager", () => {
    const out = summaryRows([
      row({}),
      row({ employeeCode: "E2", lineResult: "skipped" }),
      row({ submissionNo: "TR-2", status: "rejected", lineResult: "pending" }),
      row({ submissionNo: "TR-3", status: "pending_wfm", lineResult: "pending" }),
      row({ raisedBy: "Bela" }),
    ]);
    expect(out[1]).toEqual(["Kolkata", "SBI", "Asha", 3, 4, 1, 1, 1, 1]);
    expect(out[2].slice(2, 5)).toEqual(["Bela", 1, 1]);
  });
});
