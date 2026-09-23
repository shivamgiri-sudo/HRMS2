import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: (...args: unknown[]) => mockExecute(...args) },
}));

const mockGetLastWorkedDate = vi.fn();
vi.mock("../../employees/awol-detection.service.js", () => ({
  getLastWorkedDate: (...args: unknown[]) => mockGetLastWorkedDate(...args),
}));

const mockCreateExitRequest = vi.fn();
vi.mock("../../exit/exit.service.js", () => ({
  exitService: { createExitRequest: (...args: unknown[]) => mockCreateExitRequest(...args) },
}));

const mockCompleteWorkItem = vi.fn();
vi.mock("../work-inbox.service.js", () => ({
  completeWorkItem: (...args: unknown[]) => mockCompleteWorkItem(...args),
}));

import {
  getAwolContext,
  confirmAwolAbsconding,
  rejectAwolSuspected,
} from "../awol-confirm.service.js";

describe("getAwolContext", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockGetLastWorkedDate.mockReset();
  });

  it("throws 404 when the work item does not exist", async () => {
    mockExecute.mockResolvedValueOnce([[]]);
    await expect(getAwolContext("wi-missing")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("throws 400 when the work item is not an AWOL_SUSPECTED item", async () => {
    mockExecute.mockResolvedValueOnce([
      [{ item_type: "OTHER_TYPE", entity_id: "emp-1", title: "x" }],
    ]);
    await expect(getAwolContext("wi-1")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("returns the employee id, name and a freshly derived last worked date", async () => {
    mockExecute
      .mockResolvedValueOnce([
        [{ item_type: "AWOL_SUSPECTED", entity_id: "emp-1", title: "Confirm absconding: Jane Doe" }],
      ])
      .mockResolvedValueOnce([[{ full_name: "Jane Doe", employee_code: "MAS001" }]]);
    mockGetLastWorkedDate.mockResolvedValueOnce("2026-09-10");

    const result = await getAwolContext("wi-1");

    expect(result).toEqual({
      employeeId: "emp-1",
      employeeName: "Jane Doe",
      lastWorkedDate: "2026-09-10",
    });
    expect(mockGetLastWorkedDate).toHaveBeenCalledWith("emp-1");
  });
});

describe("confirmAwolAbsconding", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockCreateExitRequest.mockReset();
    mockCompleteWorkItem.mockReset();
  });

  it("creates an absconding exit request and resolves both AWOL work items", async () => {
    mockExecute
      .mockResolvedValueOnce([
        [{ item_type: "AWOL_SUSPECTED", entity_id: "emp-1", title: "Confirm absconding: Jane Doe" }],
      ]) // work item lookup
      .mockResolvedValueOnce([[{ id: "wi-payroll" }]]); // sibling AWOL_PAYROLL_NOTICE lookup
    mockCreateExitRequest.mockResolvedValueOnce({ id: "exit-1" });

    const result = await confirmAwolAbsconding("wi-1", "user-1", {
      lastWorkedDate: "2026-09-10",
      remarks: "Confirmed with team lead",
    });

    expect(result).toEqual({ exitRequestId: "exit-1" });
    expect(mockCreateExitRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeId: "emp-1",
        exitDate: "2026-09-10",
        exitType: "involuntary",
        exitSubType: "absconding",
        abscondingSince: "2026-09-10",
        initiatedBy: "manager",
      }),
      "user-1",
    );
    expect(mockCompleteWorkItem).toHaveBeenCalledWith("wi-1", "user-1", "Confirmed with team lead");
    expect(mockCompleteWorkItem).toHaveBeenCalledWith("wi-payroll", "user-1", expect.any(String));
  });

  it("throws 400 when the work item is not AWOL_SUSPECTED", async () => {
    mockExecute.mockResolvedValueOnce([[{ item_type: "OTHER", entity_id: "emp-1", title: "x" }]]);
    await expect(
      confirmAwolAbsconding("wi-1", "user-1", { lastWorkedDate: "2026-09-10" }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockCreateExitRequest).not.toHaveBeenCalled();
  });
});

describe("rejectAwolSuspected", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockCompleteWorkItem.mockReset();
  });

  it("completes both AWOL work items with the rejection reason, without creating an exit", async () => {
    mockExecute
      .mockResolvedValueOnce([[{ item_type: "AWOL_SUSPECTED", entity_id: "emp-1", title: "x" }]])
      .mockResolvedValueOnce([[{ id: "wi-payroll" }]]);

    await rejectAwolSuspected("wi-1", "user-1", "Employee is on unrecorded field duty");

    expect(mockCompleteWorkItem).toHaveBeenCalledWith(
      "wi-1",
      "user-1",
      "Employee is on unrecorded field duty",
    );
    expect(mockCompleteWorkItem).toHaveBeenCalledWith("wi-payroll", "user-1", expect.any(String));
  });

  it("throws 400 when remarks is blank", async () => {
    await expect(rejectAwolSuspected("wi-1", "user-1", "  ")).rejects.toMatchObject({ statusCode: 400 });
  });
});
