import { describe, expect, it, vi } from "vitest";
import { raiseRosterRequest, type RaiseDeps } from "../roster-requests.raise.js";

function deps(over: Partial<RaiseDeps> = {}): RaiseDeps {
  return {
    db: { execute: vi.fn(async () => [[{ d: "2026-10-07" }], []]) },
    notify: vi.fn(async () => {}),
    autoApprove: vi.fn(),
    ...over,
  };
}

describe("raiseRosterRequest", () => {
  it("notifies approvers, then triggers auto-approve for swaps", async () => {
    const d = deps();
    await raiseRosterRequest({ kind: "swap", sourceId: "s1", employeeId: "e1", date: "2026-10-05", summary: "Shift swap requested" }, d);
    expect(d.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "swap", sourceId: "s1", date: "2026-10-05" }));
    expect(d.autoApprove).toHaveBeenCalledWith("swap", "s1");
    expect((d.notify as any).mock.invocationCallOrder[0]).toBeLessThan((d.autoApprove as any).mock.invocationCallOrder[0]);
  });

  it("does not trigger auto-approve for disputes or conflicts", async () => {
    const d = deps();
    await raiseRosterRequest({ kind: "dispute", sourceId: "r1", employeeId: "e1", date: "2026-10-05", summary: "x" }, d);
    await raiseRosterRequest({ kind: "conflict", sourceId: "c1", employeeId: "e1", date: "2026-10-05", summary: "x" }, d);
    expect(d.notify).toHaveBeenCalledTimes(2);
    expect(d.autoApprove).not.toHaveBeenCalled();
  });

  it("resolves a missing week-off date from the assignment", async () => {
    const d = deps();
    await raiseRosterRequest({ kind: "weekoff_rejection", sourceId: "a1", employeeId: "e1", summary: "x" }, d);
    expect((d.db.execute as any).mock.calls[0][0]).toMatch(/FROM wfm_roster_assignment/);
    expect(d.notify).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-10-07" }));
  });

  it("normalises a Date object", async () => {
    const d = deps();
    await raiseRosterRequest({ kind: "dispute", sourceId: "r1", employeeId: "e1", date: new Date("2026-10-09T00:00:00Z"), summary: "x" }, d);
    expect(d.notify).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-10-09" }));
  });

  it("never throws", async () => {
    const d = deps({ notify: vi.fn(async () => { throw new Error("boom"); }) });
    await expect(raiseRosterRequest({ kind: "swap", sourceId: "s1", employeeId: "e1", date: "2026-10-05", summary: "x" }, d)).resolves.toBeUndefined();
  });
});
