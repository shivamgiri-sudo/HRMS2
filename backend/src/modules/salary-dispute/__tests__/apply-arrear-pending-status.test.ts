/**
 * applyArrear()'s status branch (2026-08-25).
 *
 * Was unconditionally 'closed' once a dispute was approved, even when no open payroll run
 * existed yet to attach the arrear to — payroll runs in arrears, so this was the common case,
 * not the edge one. An approved dispute always looked fully resolved whether or not the
 * differential had actually landed in a payslip. Now writes 'arrear_pending' instead when no
 * line was found, 'closed' only when the arrear was genuinely applied.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const DISPUTE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EMPLOYEE_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { createWorkItem } = vi.hoisted(() => ({ createWorkItem: vi.fn().mockResolvedValue("wi-1") }));
vi.mock("../../work-inbox/work-inbox.service.js", () => ({ createWorkItem }));

const { salaryDisputeService } = await import("../salary-dispute.service.js");

function disputeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: DISPUTE_ID,
    employee_id: EMPLOYEE_ID,
    run_month: "2026-07",
    dispute_type: "WRONG_DEDUCTION",
    affected_dates: "[]",
    differential_amount: "1500.00",
    status: "pending_payroll_head",
    ...overrides,
  };
}

beforeEach(() => {
  execute.mockReset();
  createWorkItem.mockReset().mockResolvedValue("wi-1");
});

describe("applyArrear — status outcome", () => {
  it("writes 'arrear_pending', not 'closed', when no open run exists to attach the arrear to", async () => {
    execute
      .mockResolvedValueOnce([[disputeRow()]]) // getById
      .mockResolvedValueOnce([[]]) // no draft/processing run found
      .mockResolvedValueOnce([{}]) // UPDATE salary_dispute
      .mockResolvedValueOnce([[{ user_id: null }]]); // _notifyEmployee's employee lookup

    await salaryDisputeService.applyArrear(DISPUTE_ID);

    const updateCall = execute.mock.calls.find((c) =>
      String(c[0]).includes("UPDATE salary_dispute SET arrear_run_month"),
    );
    expect(updateCall).toBeTruthy();
    expect(updateCall![1]).toEqual([null, null, "arrear_pending", DISPUTE_ID]);
  });

  it("writes 'closed' when an open run and line are found and the arrear is actually applied", async () => {
    const runId = "run-1";
    const lineId = "line-1";
    execute
      .mockResolvedValueOnce([[disputeRow()]]) // getById
      .mockResolvedValueOnce([[{ id: runId, run_month: "2026-08" }]]) // open run found
      .mockResolvedValueOnce([[{ id: lineId }]]) // matching line found
      .mockResolvedValueOnce([{}]) // INSERT salary_prep_line_component
      .mockResolvedValueOnce([{}]) // UPDATE salary_prep_line gross/net
      .mockResolvedValueOnce([{}]) // UPDATE salary_dispute
      .mockResolvedValueOnce([[{ user_id: null }]]); // _notifyEmployee's employee lookup

    await salaryDisputeService.applyArrear(DISPUTE_ID);

    const updateCall = execute.mock.calls.find((c) =>
      String(c[0]).includes("UPDATE salary_dispute SET arrear_run_month"),
    );
    expect(updateCall).toBeTruthy();
    expect(updateCall![1]).toEqual(["2026-08", expect.any(String), "closed", DISPUTE_ID]);
  });

  it("is a no-op when the dispute has no differential_amount", async () => {
    execute.mockResolvedValueOnce([[disputeRow({ differential_amount: null })]]);

    await salaryDisputeService.applyArrear(DISPUTE_ID);

    expect(execute).toHaveBeenCalledTimes(1); // only getById — no further writes
  });
});
