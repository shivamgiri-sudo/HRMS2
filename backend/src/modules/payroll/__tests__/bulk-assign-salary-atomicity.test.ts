import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A bulk salary assignment must be all-or-nothing.
 *
 * bulkAssignSalary deactivated every target employee's assignment in a single
 * UPDATE and then inserted the replacements in a loop, with no transaction. A
 * failure partway — a governance column rejecting a value, a dropped connection,
 * a restart — left those employees with their previous assignment switched off
 * and no new one, and nothing retried or reported it.
 *
 * That state is worse than a wrong figure. The payroll engine joins employees to
 * their salary assignment, so an employee with none is not paid incorrectly: they
 * drop out of the run entirely and no line is produced for them. assignSalary has
 * always been transactional for this reason; the bulk path, which can put
 * hundreds of employees into that state at once, was not.
 */

const { execute, getConnection, connExecute, beginTransaction, commit, rollback, release } =
  vi.hoisted(() => ({
    execute: vi.fn(),
    getConnection: vi.fn(),
    connExecute: vi.fn(),
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  }));

vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection } }));
vi.mock("../salary-governance.guard.js", () => ({
  assertSalaryAssignmentAllowed: vi.fn().mockResolvedValue({
    allowed: true, mode: "slab", salarySlabId: "slab-1", salaryProposalId: null,
  }),
}));
vi.mock("../../customization/customization-engine.js", () => ({ getEffectiveConfig: vi.fn() }));
vi.mock("../../leave/leave.service.js", () => ({ leaveService: { lapseUnresolvedLeaves: vi.fn() } }));
vi.mock("../payroll.notifications.js", () => ({
  notifyPayrollRunStatus: vi.fn(), notifyPayslipsReady: vi.fn(),
}));

import { payrollService } from "../payroll.service.js";

const INPUT = {
  structureId: "22222222-2222-2222-2222-222222222222",
  ctcAnnual: 480000,
  effectiveFrom: "2026-09-01",
};

const TWO_EMPLOYEES = [[{ id: "emp-1" }, { id: "emp-2" }]];

beforeEach(() => {
  [execute, getConnection, connExecute, beginTransaction, commit, rollback, release].forEach((m) => m.mockReset());
  getConnection.mockResolvedValue({
    execute: connExecute, beginTransaction, commit, rollback, release,
  });
  // getStructure, then the eligible-employee lookup.
  execute
    .mockResolvedValueOnce([[{ id: INPUT.structureId, structure_name: "Std" }]])
    .mockResolvedValueOnce(TWO_EMPLOYEES);
});

describe("bulkAssignSalary is atomic", () => {
  it("runs the deactivate and every insert inside one transaction", async () => {
    connExecute.mockResolvedValue([{ affectedRows: 1 }]);

    const res = await payrollService.bulkAssignSalary(INPUT as never, "user-1", ["payroll"]);

    expect(beginTransaction).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(rollback).not.toHaveBeenCalled();
    // 1 deactivate + 1 insert per employee, all on the transaction connection.
    expect(connExecute).toHaveBeenCalledTimes(3);
    expect(res.assigned).toBe(2);
  });

  it("rolls back when an insert fails partway, rather than leaving employees with no assignment", async () => {
    connExecute
      .mockResolvedValueOnce([{ affectedRows: 2 }])            // deactivate both
      .mockResolvedValueOnce([{ affectedRows: 1 }])            // first insert ok
      .mockRejectedValueOnce(new Error("governance_mode rejected")); // second fails

    await expect(
      payrollService.bulkAssignSalary(INPUT as never, "user-1", ["payroll"]),
    ).rejects.toThrow(/governance_mode rejected/);

    // The critical assertion: the deactivation must not survive the failure, or
    // emp-2 is left with no active salary assignment and silently disappears from
    // the next payroll run.
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
  });

  it("releases the connection whether it commits or rolls back", async () => {
    connExecute.mockResolvedValue([{ affectedRows: 1 }]);
    await payrollService.bulkAssignSalary(INPUT as never, "user-1", ["payroll"]);
    expect(release).toHaveBeenCalledTimes(1);

    release.mockClear();
    execute
      .mockResolvedValueOnce([[{ id: INPUT.structureId, structure_name: "Std" }]])
      .mockResolvedValueOnce(TWO_EMPLOYEES);
    connExecute.mockReset();
    connExecute.mockRejectedValueOnce(new Error("boom"));

    await expect(
      payrollService.bulkAssignSalary(INPUT as never, "user-1", ["payroll"]),
    ).rejects.toThrow();
    expect(release, "a leaked connection on the failure path exhausts the pool").toHaveBeenCalledTimes(1);
  });

  it("does no write at all when no employee matches the filters", async () => {
    execute.mockReset();
    execute
      .mockResolvedValueOnce([[{ id: INPUT.structureId, structure_name: "Std" }]])
      .mockResolvedValueOnce([[]]); // no eligible employees

    const res = await payrollService.bulkAssignSalary(INPUT as never, "user-1", ["payroll"]);

    expect(res).toEqual({ assigned: 0, skipped: 0 });
    // Returning before opening a transaction matters: an empty batch should not
    // deactivate anybody, and an IN () with no ids is a syntax error besides.
    expect(getConnection).not.toHaveBeenCalled();
  });
});
