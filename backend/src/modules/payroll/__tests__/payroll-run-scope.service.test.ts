/**
 * The rules that keep a scoped payroll run from paying the wrong people.
 *
 * Three failure modes are worth a test each, because none of them announces itself:
 *
 *   1. An empty selection falling through to "no filter", which is the whole company — a screen
 *      that says it is paying nobody paying 1,037 people.
 *   2. A branch taken from the client rather than resolved from the cost centre, so the scope row
 *      every later query trusts disagrees with reality.
 *   3. Two runs claiming the same cost centre in one month, which pays those people twice.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { resolveCostCentreScope, assertCostCentresFree, insertRunScope, ScopeError } =
  await import("../payroll-run-scope.service.js");

beforeEach(() => execute.mockReset());

describe("resolveCostCentreScope", () => {
  it("refuses an empty selection rather than silently meaning 'everyone'", async () => {
    await expect(resolveCostCentreScope([])).rejects.toMatchObject({ code: "CC_REQUIRED" });
    // Must not even reach the database — there is nothing to look up, and a query with an empty
    // IN () list is a syntax error rather than a clean refusal.
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses a selection that is only blank strings", async () => {
    await expect(resolveCostCentreScope(["", "  "])).rejects.toMatchObject({ code: "CC_REQUIRED" });
  });

  it("refuses a cost centre that is not active", async () => {
    execute.mockResolvedValueOnce([[], []]);
    await expect(resolveCostCentreScope(["cc-1"])).rejects.toMatchObject({ code: "CC_NOT_FOUND" });
  });

  it("names which cost centres were rejected, not just that some were", async () => {
    execute.mockResolvedValueOnce([[{ id: "cc-1", branch_id: "br-1" }], []]);
    await expect(resolveCostCentreScope(["cc-1", "cc-gone"])).rejects.toMatchObject({
      message: expect.stringContaining("cc-gone"),
    });
  });

  it("resolves the branch from the cost centre, never from the caller", async () => {
    execute.mockResolvedValueOnce([[{ id: "cc-1", branch_id: "br-1" }], []]);
    await expect(resolveCostCentreScope(["cc-1"])).resolves.toEqual([
      { costCentreId: "cc-1", branchId: "br-1" },
    ]);
  });

  it("requires the branch to be active too", async () => {
    // A cost centre under a deactivated branch must not be runnable; the join enforces it.
    execute.mockResolvedValueOnce([[], []]);
    await expect(resolveCostCentreScope(["cc-1"])).rejects.toMatchObject({ code: "CC_NOT_FOUND" });
    expect(String(execute.mock.calls[0][0])).toContain("bm.active_status = 1");
  });

  it("de-duplicates a repeated id instead of counting it twice", async () => {
    execute.mockResolvedValueOnce([[{ id: "cc-1", branch_id: "br-1" }], []]);
    // Without de-duplication the length comparison against the row count would fail spuriously.
    await expect(resolveCostCentreScope(["cc-1", "cc-1"])).resolves.toHaveLength(1);
  });
});

describe("assertCostCentresFree", () => {
  const conn = (rows: unknown[]) => ({ execute: vi.fn().mockResolvedValue([rows, []]) }) as never;

  it("refuses a cost centre already claimed by another run that month", async () => {
    await expect(
      assertCostCentresFree(conn([{ cost_centre_id: "cc-1", run_id: "run-9", cost_centre_code: "IT/SYSTEM" }]), "2026-08", ["cc-1"]),
    ).rejects.toMatchObject({ code: "CC_ALREADY_IN_RUN", statusCode: 409 });
  });

  it("names the cost centre in the refusal so the user can act on it", async () => {
    await expect(
      assertCostCentresFree(conn([{ cost_centre_id: "cc-1", run_id: "run-9", cost_centre_code: "IT/SYSTEM" }]), "2026-08", ["cc-1"]),
    ).rejects.toMatchObject({ message: expect.stringContaining("IT/SYSTEM") });
  });

  it("allows cost centres no live run holds", async () => {
    await expect(assertCostCentresFree(conn([]), "2026-08", ["cc-1"])).resolves.toBeUndefined();
  });

  it("ignores cancelled runs, which release their claim", async () => {
    const c = conn([]);
    await assertCostCentresFree(c, "2026-08", ["cc-1"]);
    expect(String((c as never as { execute: { mock: { calls: unknown[][] } } }).execute.mock.calls[0][0]))
      .toContain("cancelled");
  });

  it("runs on the caller's connection, not the pool", async () => {
    /*
     * The check must share the advisory lock and transaction with the insert that follows. Checking
     * on a pooled connection and inserting on another is exactly how two concurrent creations both
     * pass the check and both write.
     */
    const c = conn([]);
    await assertCostCentresFree(c, "2026-08", ["cc-1"]);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("insertRunScope", () => {
  it("writes the whole scope in one statement", async () => {
    // Row-at-a-time would let a failure halfway leave a run covering some of its cost centres.
    const c = { execute: vi.fn().mockResolvedValue([{}, []]) };
    await insertRunScope(c as never, "run-1", "2026-08", [
      { costCentreId: "cc-1", branchId: "br-1" },
      { costCentreId: "cc-2", branchId: "br-1" },
    ]);
    expect(c.execute).toHaveBeenCalledTimes(1);
    expect(String(c.execute.mock.calls[0][0])).toContain("(?, ?, ?, ?, ?), (?, ?, ?, ?, ?)");
  });

  it("does nothing for a company run", async () => {
    const c = { execute: vi.fn() };
    await insertRunScope(c as never, "run-1", "2026-08", []);
    expect(c.execute).not.toHaveBeenCalled();
  });
});

describe("ScopeError", () => {
  it("carries a code and an HTTP status so routes need no string matching", () => {
    const err = new ScopeError("CC_REQUIRED", "nope");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("CC_REQUIRED");
    // statusCode, not status: errorHandler.ts reads statusCode and masks anything else as a 500.
    expect(err.statusCode).toBe(400);
  });
});
