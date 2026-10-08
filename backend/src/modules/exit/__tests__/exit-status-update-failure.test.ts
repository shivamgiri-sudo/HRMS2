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

/**
 * 2026-08-16: the three core writes now run inside one transaction on a pooled
 * connection, so the mock has to supply a real connection object. Its execute() is
 * routed through the same dbExecute stub, keeping every SQL expectation below
 * unchanged — the point of the harness is still which statements run and in what
 * order, not which handle issued them.
 */
const { dbExecute, connCommit, connRollback, connRelease, connBegin } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  connCommit: vi.fn(async () => undefined),
  connRollback: vi.fn(async () => undefined),
  connRelease: vi.fn(() => undefined),
  connBegin: vi.fn(async () => undefined),
}));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: dbExecute,
    query: dbExecute,
    getConnection: vi.fn(async () => ({
      execute: dbExecute,
      query: dbExecute,
      beginTransaction: connBegin,
      commit: connCommit,
      rollback: connRollback,
      release: connRelease,
    })),
  },
}));

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

function mockDb(
  employeesUpdateFails: boolean,
  opts: { lockedStatus?: string; statusUpdateAffectedRows?: number } = {}
) {
  dbExecute.mockReset();
  dbExecute.mockImplementation(async (sql: string) => {
    if (/FROM exit_request er/.test(sql)) return [[EXIT_ROW], []];
    // The row lock taken at the top of the transaction.
    if (/SELECT status FROM exit_request WHERE id = \? FOR UPDATE/.test(sql)) {
      return [[{ status: opts.lockedStatus ?? EXIT_ROW.status }], []];
    }
    if (/UPDATE exit_request SET status/.test(sql)) {
      return [{ affectedRows: opts.statusUpdateAffectedRows ?? 1 }, []];
    }
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
  connCommit.mockClear();
  connRollback.mockClear();
  connRelease.mockClear();
  connBegin.mockClear();
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

/**
 * 2026-08-16 — Rule 6 atomicity.
 *
 * Throwing on the employees UPDATE stopped the downstream steps, but it did NOT undo the
 * exit_request UPDATE, which had already committed on its own connection. The split state
 * the suite above exists to prevent — exit_request 'exited' while the employee is still
 * active_status=1 — therefore survived the earlier fix in a quieter form. All three writes
 * now share one transaction.
 */
describe("the core exit state change is atomic", () => {
  it("rolls back, so exit_request cannot be left 'exited' with the employee still active", async () => {
    mockDb(true);
    const { exitService } = await import("../exit.service.js");

    await expect(
      exitService.updateExitStatus("exit-1", "exited", "confirming", "actor-1")
    ).rejects.toThrow();

    expect(connBegin).toHaveBeenCalled();
    expect(connRollback).toHaveBeenCalled();
    expect(connCommit).not.toHaveBeenCalled();
  });

  it("always returns the pooled connection — 45 workers share it", async () => {
    mockDb(true);
    const { exitService } = await import("../exit.service.js");
    await expect(
      exitService.updateExitStatus("exit-1", "exited", "confirming", "actor-1")
    ).rejects.toThrow();
    expect(connRelease).toHaveBeenCalled();
  });

  it("commits once on the happy path and does not roll back", async () => {
    mockDb(false);
    const { exitService } = await import("../exit.service.js");
    await exitService.updateExitStatus("exit-1", "exited", "confirming", "actor-1");
    expect(connCommit).toHaveBeenCalledTimes(1);
    expect(connRollback).not.toHaveBeenCalled();
  });

  it("refuses with 409 when another approver moved the request first", async () => {
    // Caller validated the FSM against 'admin_review'; by the time the lock is taken the
    // row says 'exited'. Without the expected-state check both approvers would succeed.
    mockDb(false, { lockedStatus: "exited" });
    const { exitService } = await import("../exit.service.js");

    await expect(
      exitService.updateExitStatus("exit-1", "exited", "confirming", "actor-1", "admin_review")
    ).rejects.toMatchObject({ statusCode: 409, code: "EXIT_STATE_CHANGED" });

    expect(connRollback).toHaveBeenCalled();
  });

  it("refuses when the status UPDATE matches no row, rather than reporting success", async () => {
    mockDb(false, { statusUpdateAffectedRows: 0 });
    const { exitService } = await import("../exit.service.js");

    await expect(
      exitService.updateExitStatus("exit-1", "exited", "confirming", "actor-1")
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(connCommit).not.toHaveBeenCalled();
  });

  it("carries a statusCode, so production does not replace the message with a generic 500", async () => {
    mockDb(false, { lockedStatus: "revoked" });
    const { exitService } = await import("../exit.service.js");

    await exitService
      .updateExitStatus("exit-1", "exited", "confirming", "actor-1", "admin_review")
      .then(
        () => { throw new Error("should have rejected"); },
        (err: any) => {
          expect(err.statusCode).toBe(409);
          expect(String(err.message)).toMatch(/revoked/);
        }
      );
  });
});
