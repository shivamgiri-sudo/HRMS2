import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Returning a GRN instead of killing it (Requirement 9).
 *
 * Rejection was terminal: a voucher rejected by Finance had to be raised again from scratch,
 * and the reason lived in a column the next transition overwrote. For imprest that is
 * unusable — a Branch Head is expected to correct and resubmit.
 *
 * Three properties are load-bearing:
 *
 *   1. The reservation is RELEASED on return. Holding budget while the GRN sits with somebody
 *      freezes headroom indefinitely and starves the line; the money is not committed until it
 *      comes back and is approved again.
 *   2. History is APPENDED. A GRN returned twice must show both reasons, so nothing overwrites
 *      an earlier one.
 *   3. Resubmission goes to 'submitted', not straight back to branch_head_approved — the
 *      Branch Head approves again through the normal path, which is what re-reserves the
 *      budget. Skipping it would advance the GRN with no reservation behind it.
 */

vi.setConfig({ testTimeout: 20_000 });

const { execute, getConnection } = vi.hoisted(() => ({ execute: vi.fn(), getConnection: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection } }));

const { release } = vi.hoisted(() => ({ release: vi.fn() }));
vi.mock("../../process-pnl/budget-consumption.service.js", () => ({
  budgetConsumptionService: { release, reserve: vi.fn(), consume: vi.fn(), reverseConsumption: vi.fn() },
}));

let grnService: typeof import("../grn.service.js")["grnService"];
beforeAll(async () => {
  ({ grnService } = await import("../grn.service.js"));
}, 120_000);

/** A stub connection returning a scripted GRN row and recording every statement. */
function makeConnection(grn: Record<string, unknown>, affectedRows = 1) {
  const statements: string[] = [];
  return {
    statements,
    execute: vi.fn(async (sql: string) => {
      statements.push(String(sql).replace(/\s+/g, " ").trim());
      if (/SELECT \* FROM grn_request|SELECT id, status FROM grn_request/.test(sql)) {
        return [grn.__missing ? [] : [grn], []];
      }
      if (/^\s*UPDATE grn_request/.test(sql)) return [{ affectedRows }, []];
      return [[], []];
    }),
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    release: vi.fn(() => {}),
  };
}

beforeEach(() => {
  execute.mockReset();
  getConnection.mockReset();
  release.mockReset();
});

const APPROVED = {
  id: "g1", status: "branch_head_approved", budget_line_id: "bl1",
  amount_with_tax: 5000, amount: 5000, quantity: 1,
};

describe("returnGrn", () => {
  it("sends a Finance-stage GRN back to the Branch Head", async () => {
    const conn = makeConnection(APPROVED);
    getConnection.mockResolvedValue(conn);
    const out = await grnService.returnGrn("g1", "branch_head", "Missing invoice copy", "u1", "finance_head");
    expect(out.status).toBe("returned_to_branch_head");
  });

  it("releases the budget reservation on the way back", async () => {
    // Otherwise headroom stays frozen for as long as the GRN sits with someone.
    const conn = makeConnection(APPROVED);
    getConnection.mockResolvedValue(conn);
    await grnService.returnGrn("g1", "branch_head", "Wrong cost centre", "u1", "finance_head");
    expect(release).toHaveBeenCalledOnce();
    expect(release.mock.calls[0][1]).toBe("bl1");
    expect(release.mock.calls[0][2]).toBe(5000);
  });

  it("does NOT release from 'submitted', which holds no reservation", async () => {
    // Budget is reserved at Branch Head approval, so a GRN still awaiting that has nothing to
    // give back. Releasing anyway would credit the line twice.
    const conn = makeConnection({ ...APPROVED, status: "submitted" });
    getConnection.mockResolvedValue(conn);
    await grnService.returnGrn("g1", "raiser", "Please attach the bill", "u1", "branch_head");
    expect(release).not.toHaveBeenCalled();
  });

  it("appends an approval event carrying its own reason", async () => {
    const conn = makeConnection(APPROVED);
    getConnection.mockResolvedValue(conn);
    await grnService.returnGrn("g1", "branch_head", "Amount does not match the bill", "u1", "finance_head");
    const event = conn.execute.mock.calls.find(([s]) => /INSERT INTO finance_approval_event/.test(String(s)));
    expect(event, "a return must be recorded in the history").toBeTruthy();
    expect(event?.[1]).toContain("return");
    expect(event?.[1]).toContain("branch_head_approved");
    expect(event?.[1]).toContain("returned_to_branch_head");
    expect(event?.[1]).toContain("Amount does not match the bill");
  });

  it("insists on a reason", async () => {
    // A return with no reason is indistinguishable from a silent bounce.
    getConnection.mockResolvedValue(makeConnection(APPROVED));
    await expect(grnService.returnGrn("g1", "branch_head", "   ", "u1", "finance_head"))
      .rejects.toThrow(/reason is required/i);
  });

  it("refuses to reopen a GRN that has moved past review", async () => {
    for (const status of ["paid", "partially_paid", "cancelled", "draft"]) {
      const conn = makeConnection({ ...APPROVED, status });
      getConnection.mockResolvedValue(conn);
      await expect(grnService.returnGrn("g1", "branch_head", "why", "u1", "finance_head"))
        .rejects.toThrow(/cannot be returned/i);
    }
  });

  it("rolls back when another reviewer moved it first", async () => {
    // The optimistic guard: UPDATE ... WHERE status = <what we read> matches nothing.
    const conn = makeConnection(APPROVED, 0);
    getConnection.mockResolvedValue(conn);
    await expect(grnService.returnGrn("g1", "branch_head", "why", "u1", "finance_head"))
      .rejects.toThrow(/changed during review/i);
    expect(conn.rollback).toHaveBeenCalled();
  });

  it("never writes 'draft' as the returned state", async () => {
    // draft means "never submitted", and saveAllocations gates on it — a returned GRN parked
    // there could silently rewrite its allocations after having been through approval.
    const conn = makeConnection(APPROVED);
    getConnection.mockResolvedValue(conn);
    await grnService.returnGrn("g1", "branch_head", "why", "u1", "finance_head");
    const update = conn.execute.mock.calls.find(([s]) => /UPDATE grn_request/.test(String(s)));
    expect(update?.[1]).not.toContain("draft");
  });
});

describe("resubmitReturnedGrn", () => {
  it("returns it to 'submitted' so the Branch Head approves again", async () => {
    // Not straight to branch_head_approved: that path is what re-reserves the budget.
    const conn = makeConnection({ id: "g1", status: "returned_to_branch_head" });
    getConnection.mockResolvedValue(conn);
    const out = await grnService.resubmitReturnedGrn("g1", "u2", "branch_head", "Invoice attached");
    expect(out.status).toBe("submitted");
    expect(release, "resubmission must not touch the budget").not.toHaveBeenCalled();
  });

  it("works from returned_to_raiser too", async () => {
    const conn = makeConnection({ id: "g1", status: "returned_to_raiser" });
    getConnection.mockResolvedValue(conn);
    await expect(grnService.resubmitReturnedGrn("g1", "u2", "branch_admin")).resolves.toMatchObject({ status: "submitted" });
  });

  it("refuses a GRN that was never returned", async () => {
    const conn = makeConnection({ id: "g1", status: "branch_head_approved" });
    getConnection.mockResolvedValue(conn);
    await expect(grnService.resubmitReturnedGrn("g1", "u2", "branch_head"))
      .rejects.toThrow(/Only a returned GRN can be resubmitted/i);
  });

  it("records the resubmission, so a twice-returned GRN shows both hops", async () => {
    const conn = makeConnection({ id: "g1", status: "returned_to_branch_head" });
    getConnection.mockResolvedValue(conn);
    await grnService.resubmitReturnedGrn("g1", "u2", "branch_head", "Corrected");
    const event = conn.execute.mock.calls.find(([s]) => /INSERT INTO finance_approval_event/.test(String(s)));
    expect(event?.[1]).toContain("resubmit");
    expect(event?.[1]).toContain("returned_to_branch_head");
  });
});
