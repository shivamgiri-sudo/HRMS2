import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Production 2026-10-17: "Assign package" 500'd with ER_LOCK_DEADLOCK on the INSERT into salary_component_assignments
 * (reference 5e72bb73; 1,968 deadlock lines in the backend log). Two requests for the same employee interleaved their
 * UPDATE ... status='active' index locks and then both INSERTed.
 *
 * The write now (1) locks the employee's review row first and (2) retries the WHOLE transaction when MySQL picks it as
 * a deadlock victim. It must not retry anything else (a real error, or a 50 s lock-wait timeout).
 */

const { execute, getConnection, getPackageById, prepareSalaryStartDate, commitSalaryStartDate } = vi.hoisted(() => ({
  execute: vi.fn(),
  getConnection: vi.fn(),
  getPackageById: vi.fn(),
  prepareSalaryStartDate: vi.fn(),
  commitSalaryStartDate: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection } }));
vi.mock("../../employees/employee-bgv.service.js", () => ({ getEmployeeBgvStatus: vi.fn() }));
vi.mock("../../payroll/bank-payment-readiness.service.js", () => ({ buildBankReadinessForEmployees: vi.fn() }));
vi.mock("../../payroll-masters/payrollMasters.service.js", () => ({ createPackage: vi.fn(), getPackageById }));
vi.mock("../../inbox/inbox.service.js", () => ({ inboxService: { createItem: vi.fn() } }));
vi.mock("../../../shared/scopeAccess.js", () => ({
  hasAnyRole: vi.fn().mockResolvedValue(true),
  buildScopeWhereClause: vi.fn().mockResolvedValue({ sql: "1=1", params: [] }),
}));
vi.mock("../../payroll/salary-start-date.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../payroll/salary-start-date.service.js")>()),
  prepareSalaryStartDate,
  commitSalaryStartDate,
}));

import { assignPackage } from "../payroll-head-review.service.js";

const deadlock = () => Object.assign(new Error("Deadlock found when trying to get lock; try restarting transaction"), { code: "ER_LOCK_DEADLOCK", errno: 1213 });
const lockWait = () => Object.assign(new Error("Lock wait timeout exceeded"), { code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205 });

function fakeConnection(insertFailures: Error[]) {
  const stmts: string[] = [];
  const conn = {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    execute: vi.fn(async (sql: string) => {
      stmts.push(sql.replace(/\s+/g, " ").trim().slice(0, 100));
      if (/INSERT INTO salary_component_assignments/.test(sql) && insertFailures.length) throw insertFailures.shift()!;
      return [[], []];
    }),
  };
  return { conn, stmts };
}

const PKG = { id: "pkg-1", basic: 1, hra: 1, conveyance: 1, gross: 3, ctc: 3, net_in_hand: 3 };

describe("assignPackage under concurrent writers", () => {
  beforeEach(() => {
    execute.mockReset();
    getConnection.mockReset();
    getPackageById.mockReset().mockResolvedValue(PKG);
    prepareSalaryStartDate.mockReset().mockResolvedValue({ prepared: true });
    commitSalaryStartDate.mockReset().mockResolvedValue({ changed: false });
    // getReviewRow x2 (before and after) and audit/sync writes all go through db.execute
    execute.mockResolvedValue([[{ id: "review-1", status: "pending_review", candidate_id: null }], []]);
  });

  it("locks the review row before any other statement in the transaction", async () => {
    const { conn, stmts } = fakeConnection([]);
    getConnection.mockResolvedValue(conn);
    await assignPackage("emp-1", "pkg-1", "2026-10-17", "user-1");
    expect(stmts[0]).toMatch(/^SELECT id FROM employee_payroll_head_review WHERE employee_id = \? FOR UPDATE/);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it("retries the whole transaction after a deadlock and then succeeds", async () => {
    const { conn, stmts } = fakeConnection([deadlock()]);
    getConnection.mockResolvedValue(conn);
    const out = await assignPackage("emp-1", "pkg-1", "2026-10-17", "user-1");
    expect(out).toBeTruthy();
    expect(conn.beginTransaction).toHaveBeenCalledTimes(2);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.release).toHaveBeenCalledTimes(2);
    // each attempt starts from the lock, i.e. nothing is replayed mid-transaction
    expect(stmts.filter((s) => s.startsWith("SELECT id FROM employee_payroll_head_review"))).toHaveLength(2);
  });

  it("gives up after 3 deadlocks and surfaces the error", async () => {
    const { conn } = fakeConnection([deadlock(), deadlock(), deadlock()]);
    getConnection.mockResolvedValue(conn);
    await expect(assignPackage("emp-1", "pkg-1", "2026-10-17", "user-1")).rejects.toMatchObject({ errno: 1213 });
    expect(conn.beginTransaction).toHaveBeenCalledTimes(3);
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("does not retry a lock-wait timeout (it already waited ~50 s)", async () => {
    const { conn } = fakeConnection([lockWait()]);
    getConnection.mockResolvedValue(conn);
    await expect(assignPackage("emp-1", "pkg-1", "2026-10-17", "user-1")).rejects.toMatchObject({ errno: 1205 });
    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
  });

  it("does not retry a real error", async () => {
    const boom = Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR", errno: 1054 });
    const { conn } = fakeConnection([boom]);
    getConnection.mockResolvedValue(conn);
    await expect(assignPackage("emp-1", "pkg-1", "2026-10-17", "user-1")).rejects.toBe(boom);
    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
  });
});
