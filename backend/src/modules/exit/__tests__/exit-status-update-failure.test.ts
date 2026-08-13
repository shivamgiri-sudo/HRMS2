import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Regression test, 2026-08-13: updateExitStatus's "exited" branch used to swallow the
 * one write that actually matters — UPDATE employees SET active_status = 0 — behind
 * `.catch(() => null)`. exit_request.status was already committed to 'exited' by an
 * earlier, unprotected write in the same function, so a failure on the employees UPDATE
 * (deadlock, dropped connection, pool exhaustion — this codebase has a documented DB-pool
 * -starvation history) let the function fall through to session revocation, F&F creation
 * and deprovisioning, then return success. HR saw "Exit request status updated to
 * exited" while the employee stayed active_status=1 forever — the exact 93-employee
 * mismatch a comment in this same function already documents having happened once before,
 * from a different cause.
 *
 * This test forces that UPDATE to reject and asserts updateExitStatus now throws instead
 * of resolving, and that nothing downstream of the failed write (session revocation,
 * deprovisioning) runs against an employee who was never actually deactivated.
 */

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute, query: dbExecute, getConnection: vi.fn() } }));

const { revokeSessionsForEmployee, deprovisionEmployeeAccess } = vi.hoisted(() => ({
  revokeSessionsForEmployee: vi.fn(async () => ({ refreshTokensRevoked: 0, deviceSessionsRevoked: 0 })),
  deprovisionEmployeeAccess: vi.fn(async () => ({ lmsMappingsRevoked: 0, leaveRequestsCancelled: 0, openAssetAssignments: 0, failures: [] })),
}));
vi.mock("../../../shared/sessionRevocation.js", () => ({ revokeSessionsForEmployee }));
vi.mock("../../../shared/employeeDeprovisioning.js", () => ({ deprovisionEmployeeAccess }));

vi.mock("../exit-intelligence.service.js", () => ({
  createDefaultClearanceTasks: vi.fn(async () => undefined),
  createExitHealthSnapshot: vi.fn(async () => undefined),
}));
vi.mock("../exit.notifications.js", () => ({
  notifyResignationSubmitted: vi.fn(async () => undefined),
  notifyResignationDecision: vi.fn(async () => undefined),
}));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: vi.fn() }) } }));

const EXIT_ROW = {
  id: "exit-1",
  employee_id: "emp-1",
  status: "admin_review",
  exit_type: "resignation",
  exit_sub_type: null,
  last_working_day_proposed: "2026-08-20",
};

function mockDb(employeesUpdateFails: boolean) {
  dbExecute.mockReset();
  dbExecute.mockImplementation(async (sql: string) => {
    if (/FROM exit_request er/.test(sql)) return [[EXIT_ROW], []];
    if (/UPDATE exit_request SET status/.test(sql)) return [{ affectedRows: 1 }, []];
    if (/INSERT INTO exit_approval_log/.test(sql)) return [{ affectedRows: 1 }, []];
    if (/UPDATE employees SET active_status = 0/.test(sql)) {
      if (employeesUpdateFails) throw new Error("Connection lost");
      return [{ affectedRows: 1 }, []];
    }
    return [[], []];
  });
}

beforeEach(() => {
  revokeSessionsForEmployee.mockClear();
  deprovisionEmployeeAccess.mockClear();
});

describe("updateExitStatus('exited') — the active_status write is no longer swallowed", () => {
  it("throws when the employees UPDATE fails, instead of returning a false success", async () => {
    mockDb(true);
    const { exitService } = await import("../exit.service.js");

    await expect(
      exitService.updateExitStatus("exit-1", "exited", "confirming", "actor-1")
    ).rejects.toThrow();
  });

  it("does not revoke sessions or deprovision access when the deactivation write itself failed", async () => {
    mockDb(true);
    const { exitService } = await import("../exit.service.js");

    await expect(
      exitService.updateExitStatus("exit-1", "exited", "confirming", "actor-1")
    ).rejects.toThrow();

    expect(revokeSessionsForEmployee).not.toHaveBeenCalled();
    expect(deprovisionEmployeeAccess).not.toHaveBeenCalled();
  });

  it("still succeeds end-to-end when the employees UPDATE works (not a regression on the happy path)", async () => {
    mockDb(false);
    const { exitService } = await import("../exit.service.js");

    await expect(
      exitService.updateExitStatus("exit-1", "exited", "confirming", "actor-1")
    ).resolves.toBeDefined();

    expect(revokeSessionsForEmployee).toHaveBeenCalledWith("emp-1", "employee_exit");
  });
});
