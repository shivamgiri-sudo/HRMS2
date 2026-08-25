import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * New "Salary Change Center" module: Payroll Head changes an already-active employee's
 * salary directly (they're already the final approver — per explicit confirmation this takes
 * effect immediately, not through a second approval step). Verifies: the new package is
 * inserted active, the old one is superseded (never both active at once), the audit log table
 * records old→new + who requested/who submitted, and logSensitiveAction is called.
 */

const { execute, getPackageById, logSensitiveAction } = vi.hoisted(() => ({
  execute: vi.fn(),
  getPackageById: vi.fn(),
  logSensitiveAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../payroll-masters/payrollMasters.service.js", () => ({ getPackageById }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));

import { changeSalary } from "../salary-change.service.js";

describe("changeSalary()", () => {
  beforeEach(() => { execute.mockReset(); getPackageById.mockReset(); logSensitiveAction.mockClear(); });

  it("inserts the new active assignment, supersedes the old one, and writes the audit trail", async () => {
    execute
      .mockResolvedValueOnce([[{ id: "e1" }]]) // employee active check
      .mockResolvedValueOnce([[{ id: "old-assign-1", ctc: 40000 }]]) // current active assignment
      .mockResolvedValueOnce([{ affectedRows: 1 } as unknown]) // INSERT new assignment
      .mockResolvedValueOnce([{ affectedRows: 1 } as unknown]) // UPDATE old -> superseded
      .mockResolvedValueOnce([{ affectedRows: 1 } as unknown]) // sync employee_salary_assignment
      .mockResolvedValueOnce([{ affectedRows: 1 } as unknown]) // INSERT employee_salary_change_log
      .mockResolvedValueOnce([[{ id: "e1", full_name: "Jane" }]]) // getEmployeeSalaryProfile: employee
      .mockResolvedValueOnce([[{ ctc: 50000 }]]) // getEmployeeSalaryProfile: salary_components
      .mockResolvedValueOnce([[]]); // getEmployeeSalaryProfile: change_history

    getPackageById.mockResolvedValueOnce({
      id: "pkg-1", basic: 25000, hra: 10000, conveyance: 1600, special_allowance: 3400,
      gross: 40000, epf_employee: 3000, esic_employee: 0, epf_employer: 3000, esic_employer: 0,
      ctc: 50000, net_in_hand: 37000,
    });

    await changeSalary({
      employeeId: "e1", packageId: "pkg-1", effectiveDate: "2026-09-01",
      reason: "Annual increment", requestedByUserId: "req-1", requestedByName: "Manager X",
      actorUserId: "actor-1",
    });

    const insertAssignmentCall = execute.mock.calls[2];
    expect(insertAssignmentCall[0]).toContain("INSERT INTO salary_component_assignments");
    expect(insertAssignmentCall[0]).toContain("'active'");

    const supersedeCall = execute.mock.calls[3];
    expect(supersedeCall[0]).toContain("status = 'superseded'");
    expect(supersedeCall[1]).toEqual(["old-assign-1"]);

    const logCall = execute.mock.calls[5];
    expect(logCall[0]).toContain("INSERT INTO employee_salary_change_log");
    expect(logCall[1]).toEqual(
      expect.arrayContaining(["e1", "old-assign-1", "req-1", "Manager X", "actor-1", "Annual increment", 40000, 50000, "2026-09-01"])
    );

    expect(logSensitiveAction).toHaveBeenCalledWith(expect.objectContaining({
      action_type: "SALARY_CHANGED",
      module_key: "payroll",
      entity_id: "e1",
    }));
  });

  it("rejects a missing reason before touching the database write path", async () => {
    execute.mockResolvedValueOnce([[{ id: "e1" }]]);
    getPackageById.mockResolvedValueOnce({ id: "pkg-1" });

    await expect(changeSalary({
      employeeId: "e1", packageId: "pkg-1", effectiveDate: "2026-09-01",
      reason: "   ", requestedByUserId: null, requestedByName: null, actorUserId: "actor-1",
    })).rejects.toThrow(/reason/i);
  });
});
