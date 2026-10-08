import { describe, expect, it } from "vitest";
import { applyBranchChange, applyDateChange, applyRequisitionChange, branchOptions, createRequestSequencer, dateBounds, describeError, unusableMessage, requisitionOptions } from "../command/commandData";

const now = new Date("2026-10-07T06:00:00Z"); // 2026-10-07 IST
const f = { from: "2026-09-24", to: "2026-10-07", requisitionId: null, branch: null };

describe("createRequestSequencer", () => {
  it("only the latest ticket is current and the previous one is aborted", () => {
    const s = createRequestSequencer();
    const a = s.begin();
    expect(a.isCurrent()).toBe(true);
    const b = s.begin();
    expect(a.isCurrent()).toBe(false);
    expect(a.signal.aborted).toBe(true);
    expect(b.isCurrent()).toBe(true);
    expect(b.signal.aborted).toBe(false);
  });
  it("a slow old response resolving after a newer one is not applied", async () => {
    const s = createRequestSequencer();
    const applied: string[] = [];
    const load = async (name: string, delay: number) => {
      const t = s.begin();
      await new Promise((r) => setTimeout(r, delay));
      if (t.isCurrent()) applied.push(name);
    };
    await Promise.all([load("old", 30), load("new", 5)]);
    expect(applied).toEqual(["new"]);
  });
  it("cancel invalidates the in-flight ticket", () => {
    const s = createRequestSequencer();
    const t = s.begin();
    s.cancel();
    expect(t.isCurrent()).toBe(false);
    expect(t.signal.aborted).toBe(true);
  });
});

describe("describeError", () => {
  it("uses the message, else a default", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
    expect(describeError({ message: "  " })).toBe("Request failed");
    expect(describeError(null)).toBe("Request failed");
  });
});

describe("options", () => {
  const rows = [{ id: 7, requisition_code: "R-7", designation_name: "Agent", branch_name: "Pune" }, { id: 8, branch_name: "Delhi" }, { requisition_code: "x" }, { id: 9, requisition_code: "R-9", branch_name: "Pune" }];
  it("maps rows, skips rows without id, tolerates non-arrays", () => {
    const o = requisitionOptions(rows);
    expect(o.map((x) => x.id)).toEqual(["7", "8", "9"]);
    expect(o[0].label).toBe("R-7 - Agent");
    expect(o[1].label).toBe("#8");
    expect(requisitionOptions(null)).toEqual([]);
  });
  it("branches are distinct and sorted", () => { expect(branchOptions(requisitionOptions(rows))).toEqual(["Delhi", "Pune"]); });
});

describe("filter edits", () => {
  it("date bounds follow the 92 day and today+14 limits", () => {
    const b = dateBounds(f, now);
    expect(b.from).toEqual({ min: "2026-07-08", max: "2026-10-07" });
    expect(b.to).toEqual({ min: "2026-09-24", max: "2026-10-21" });
  });
  it("moving from past to keeps the window valid; invalid input is ignored", () => {
    expect(applyDateChange(f, "from", "2026-10-10", now)).toMatchObject({ from: "2026-10-10", to: "2026-10-10" });
    expect(applyDateChange(f, "to", "2026-09-01", now)).toMatchObject({ from: "2026-09-01", to: "2026-09-01" });
    expect(applyDateChange(f, "from", "", now)).toBe(f);
    expect(applyDateChange(f, "to", "2026-02-30", now)).toBe(f);
  });
  it("caps the span and the future", () => {
    expect(applyDateChange(f, "from", "2026-01-01", now)).toMatchObject({ from: "2026-01-01", to: "2026-04-02" });
    expect(applyDateChange(f, "to", "2027-01-01", now).to).toBe("2026-10-21");
  });
  it("branch change clears a requisition from another branch; requisition change maps empty to null", () => {
    const reqs = requisitionOptions([{ id: 7, branch_name: "Pune" }, { id: 8, branch_name: "Delhi" }]);
    expect(applyBranchChange({ ...f, requisitionId: "7" }, "Delhi", reqs).requisitionId).toBeNull();
    expect(applyBranchChange({ ...f, requisitionId: "7" }, "Pune", reqs).requisitionId).toBe("7");
    expect(applyBranchChange({ ...f, branch: "Pune" }, "", reqs).branch).toBeNull();
    expect(applyRequisitionChange(f, "")).toMatchObject({ requisitionId: null });
    expect(applyRequisitionChange(f, "8").requisitionId).toBe("8");
  });
});

describe("unusableMessage", () => {
  it("prefers the body's error, then message, else the generic line", () => {
    expect(unusableMessage({ error: " Bad window " })).toBe("Bad window");
    expect(unusableMessage({ message: "Try later" })).toBe("Try later");
    expect(unusableMessage({ success: false })).toBe("Unexpected response from the server");
    expect(unusableMessage(null)).toBe("Unexpected response from the server");
  });
});
