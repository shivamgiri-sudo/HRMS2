import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { raiseRosterRequest, resetConflictCoalescing, CONFLICT_COALESCE_WINDOW_MS, type RaiseDeps } from "../roster-requests.raise.js";

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

describe("conflict coalescing", () => {
  beforeEach(() => { vi.useFakeTimers(); resetConflictCoalescing(); });
  afterEach(() => { resetConflictCoalescing(); vi.useRealTimers(); });
  const c = (id: string, branchId = "b1") => ({ kind: "conflict" as const, sourceId: id, employeeId: "e1", branchId, date: "2026-10-05", summary: `Roster conflict ${id}` });

  it("notifies the first conflict per branch, suppresses the rest, then sends one summary with the count", async () => {
    const d = deps();
    for (const id of ["c1", "c2", "c3", "c4"]) await raiseRosterRequest(c(id), d);
    expect(d.notify).toHaveBeenCalledTimes(1);
    expect(d.notify).toHaveBeenLastCalledWith(expect.objectContaining({ sourceId: "c1" }));
    await vi.advanceTimersByTimeAsync(CONFLICT_COALESCE_WINDOW_MS + 1);
    expect(d.notify).toHaveBeenCalledTimes(2);
    expect((d.notify as any).mock.calls[1][0].summary).toMatch(/^3 more roster conflicts/);
  });
  it("sends no summary when nothing was suppressed, and opens a fresh window afterwards", async () => {
    const d = deps();
    await raiseRosterRequest(c("c1"), d);
    await vi.advanceTimersByTimeAsync(CONFLICT_COALESCE_WINDOW_MS + 1);
    expect(d.notify).toHaveBeenCalledTimes(1);
    await raiseRosterRequest(c("c2"), d);
    expect(d.notify).toHaveBeenCalledTimes(2);
  });
  it("keeps branches independent", async () => {
    const d = deps();
    await raiseRosterRequest(c("c1", "b1"), d);
    await raiseRosterRequest(c("c2", "b2"), d);
    expect(d.notify).toHaveBeenCalledTimes(2);
  });
  it("resolves the branch from the employee when the producer did not pass one", async () => {
    const d = deps({ db: { execute: vi.fn(async () => [[{ branch_id: "b9" }], []]) } });
    const { branchId: _b, ...noBranch } = c("c1");
    await raiseRosterRequest(noBranch, d);
    await raiseRosterRequest({ ...noBranch, sourceId: "c2" }, d);
    expect(d.notify).toHaveBeenCalledTimes(1);
  });
  it("does not coalesce other kinds", async () => {
    const d = deps();
    await raiseRosterRequest({ kind: "swap", sourceId: "s1", employeeId: "e1", branchId: "b1", date: "2026-10-05", summary: "x" }, d);
    await raiseRosterRequest({ kind: "swap", sourceId: "s2", employeeId: "e1", branchId: "b1", date: "2026-10-05", summary: "x" }, d);
    expect(d.notify).toHaveBeenCalledTimes(2);
  });
});
