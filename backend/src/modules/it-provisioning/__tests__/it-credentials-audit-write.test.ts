import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression test, 2026-08-14: the employee_documents INSERT that records "IT credentials
 * were issued" (doc_type='it_credentials') — this file's own comment says it exists
 * specifically so IT has a record credentials were issued — used to be
 * `.catch(() => console.warn(...))`, swallowed on the same connection running the whole
 * function's transaction. A failure on just that one INSERT didn't roll back or rethrow:
 * auth_user still got created, employees.user_id still got linked, the task still got
 * marked 'actioned', and the caller still got a clean success — all while the one write
 * meant to prove credentials were issued silently never happened. Same defect class
 * already fixed this session in exit.service.ts, ageVerification.service.ts and
 * epfKycCapture.service.ts.
 *
 * This forces that one INSERT to reject and asserts the whole transaction now rolls back
 * (rollback called, commit never called) and the function throws, instead of completing
 * successfully with the credential record silently missing.
 */

const conn = {
  beginTransaction: vi.fn(async () => undefined),
  execute: vi.fn(async () => [[], []]),
  commit: vi.fn(async () => undefined),
  rollback: vi.fn(async () => undefined),
  release: vi.fn(() => undefined),
};

const dbExecute = vi.fn(async (sql: string) => {
  if (/FROM it_provisioning_request/.test(sql)) {
    return [[{ id: "task-1", employee_id: "emp-1", task_code: "IT_EMAIL_DOMAIN_ASSET", assigned_role: "it", status: "pending" }], []];
  }
  return [[], []];
});

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: dbExecute, getConnection: vi.fn(async () => conn) },
}));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn(async () => undefined) }));
vi.mock("../../employees/employee-activation.service.js", () => ({
  activateIfJoiningDateReached: vi.fn(async () => undefined),
}));
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn(async () => "hashed") } }));

beforeEach(() => {
  conn.beginTransaction.mockClear();
  conn.execute.mockClear();
  conn.commit.mockClear();
  conn.rollback.mockClear();
  conn.release.mockClear();
  dbExecute.mockClear();
});

describe("completeItProvisioningTask — the it_credentials audit write is no longer swallowed", () => {
  it("rolls back the whole transaction and throws when the employee_documents INSERT fails", async () => {
    conn.execute.mockImplementation(async (sql: string) => {
      if (/SELECT user_id, first_name, last_name FROM employees/.test(sql)) {
        return [[{ user_id: null, first_name: "A", last_name: "B" }], []];
      }
      if (/INSERT INTO employee_documents/.test(sql)) {
        throw new Error("Connection lost");
      }
      return [{ affectedRows: 1 }, []];
    });

    const { completeItProvisioningTask } = await import("../task-completion-handlers.service.js");

    await expect(
      completeItProvisioningTask(
        "task-1",
        { official_email: "a.b@teammas.in", domain_account: "a.b" },
        "actor-1",
      )
    ).rejects.toThrow();

    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it("still commits and succeeds when the write works (not a regression on the happy path)", async () => {
    conn.execute.mockImplementation(async (sql: string) => {
      if (/SELECT user_id, first_name, last_name FROM employees/.test(sql)) {
        return [[{ user_id: null, first_name: "A", last_name: "B" }], []];
      }
      return [{ affectedRows: 1 }, []];
    });

    const { completeItProvisioningTask } = await import("../task-completion-handlers.service.js");

    await expect(
      completeItProvisioningTask(
        "task-1",
        { official_email: "a.b@teammas.in", domain_account: "a.b" },
        "actor-1",
      )
    ).resolves.toBeUndefined();

    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
  });
});
