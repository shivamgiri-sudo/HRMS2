/**
 * Loan EMI payroll write-back (2026-08-25).
 *
 * salary_prep_line.loan_emi is a real deduction the calculator already put on the
 * payslip, but nothing wrote it back to employee_loans.deducted_amount/pending_amount
 * — confirmed live: SUM(loan_emi) across all 103 historical runs is 0 everywhere.
 * This is the test coverage for loans.service.ts::applyPayrollDeductions, which
 * reconciles the ledger at the point a run reaches 'disbursed'.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const RUN_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ACTOR_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const EMPLOYEE_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const LOAN_1 = "11111111-1111-1111-1111-111111111111";
const LOAN_2 = "22222222-2222-2222-2222-222222222222";

const { execute, logSensitiveAction, connExecute, beginTransaction, commit, rollback, release } =
  vi.hoisted(() => ({
    execute: vi.fn(),
    logSensitiveAction: vi.fn(),
    connExecute: vi.fn(),
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  }));

vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute,
    getConnection: vi.fn().mockResolvedValue({
      execute: connExecute,
      beginTransaction,
      commit,
      rollback,
      release,
    }),
  },
}));

const { applyPayrollDeductions } = await import("../loans.service.js");

beforeEach(() => {
  execute.mockReset();
  connExecute.mockReset();
  beginTransaction.mockReset();
  commit.mockReset();
  rollback.mockReset();
  release.mockReset();
  logSensitiveAction.mockReset().mockResolvedValue(undefined);
});

describe("applyPayrollDeductions", () => {
  it("no-ops when the run has no positive loan_emi lines", async () => {
    execute.mockResolvedValueOnce([[]]);
    await applyPayrollDeductions(RUN_ID, ACTOR_ID);
    expect(connExecute).not.toHaveBeenCalled();
    expect(beginTransaction).not.toHaveBeenCalled();
  });

  it("applies EMI to a single active loan: deducts, decrements pending, stays active if not exhausted", async () => {
    execute.mockResolvedValueOnce([[{ employee_id: EMPLOYEE_ID, loan_emi: 5000 }]]);
    connExecute
      .mockResolvedValueOnce([[{
        id: LOAN_1, deducted_amount: 10000, pending_amount: 40000, status: "active",
      }]]) // SELECT active loans
      .mockResolvedValueOnce([{}]); // UPDATE

    await applyPayrollDeductions(RUN_ID, ACTOR_ID);

    expect(beginTransaction).toHaveBeenCalledTimes(1);
    expect(connExecute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("UPDATE employee_loans"),
      [15000, 35000, "active", LOAN_1],
    );
    expect(commit).toHaveBeenCalledTimes(1);
    expect(rollback).not.toHaveBeenCalled();
    expect(logSensitiveAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: "loan_payroll_deduction_applied",
        module_key: "payroll_loans",
        entity_id: LOAN_1,
      }),
    );
  });

  it("flips a loan to completed when the EMI exhausts its pending balance", async () => {
    execute.mockResolvedValueOnce([[{ employee_id: EMPLOYEE_ID, loan_emi: 5000 }]]);
    connExecute
      .mockResolvedValueOnce([[{
        id: LOAN_1, deducted_amount: 45000, pending_amount: 5000, status: "active",
      }]])
      .mockResolvedValueOnce([{}]);

    await applyPayrollDeductions(RUN_ID, ACTOR_ID);

    expect(connExecute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("UPDATE employee_loans"),
      [50000, 0, "completed", LOAN_1],
    );
  });

  it("apportions EMI across multiple active loans, oldest first per the SQL ORDER BY", async () => {
    execute.mockResolvedValueOnce([[{ employee_id: EMPLOYEE_ID, loan_emi: 6000 }]]);
    connExecute
      .mockResolvedValueOnce([[
        { id: LOAN_1, deducted_amount: 9000, pending_amount: 1000, status: "active" }, // oldest — exhausted first
        { id: LOAN_2, deducted_amount: 0, pending_amount: 20000, status: "active" },
      ]])
      .mockResolvedValueOnce([{}]) // UPDATE loan 1
      .mockResolvedValueOnce([{}]); // UPDATE loan 2

    await applyPayrollDeductions(RUN_ID, ACTOR_ID);

    expect(connExecute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("UPDATE employee_loans"),
      [10000, 0, "completed", LOAN_1], // absorbs 1000 of the 6000, completes
    );
    expect(connExecute).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("UPDATE employee_loans"),
      [5000, 15000, "active", LOAN_2], // absorbs the remaining 5000
    );
    expect(logSensitiveAction).toHaveBeenCalledTimes(2);
  });

  it("is a no-op for an employee with loan_emi but no active loan row — does not throw", async () => {
    execute.mockResolvedValueOnce([[{ employee_id: EMPLOYEE_ID, loan_emi: 5000 }]]);
    connExecute.mockResolvedValueOnce([[]]); // SELECT active loans — none

    await expect(applyPayrollDeductions(RUN_ID, ACTOR_ID)).resolves.toBeUndefined();

    expect(commit).toHaveBeenCalledTimes(1);
    expect(connExecute).toHaveBeenCalledTimes(1); // only the SELECT, no UPDATE
    expect(logSensitiveAction).not.toHaveBeenCalled();
  });

  it("rolls back the whole transaction on a mid-loop DB error, applying nothing partially", async () => {
    execute.mockResolvedValueOnce([[{ employee_id: EMPLOYEE_ID, loan_emi: 5000 }]]);
    connExecute
      .mockResolvedValueOnce([[{
        id: LOAN_1, deducted_amount: 0, pending_amount: 20000, status: "active",
      }]])
      .mockRejectedValueOnce(new Error("connection lost"));

    await expect(applyPayrollDeductions(RUN_ID, ACTOR_ID)).rejects.toThrow("connection lost");

    expect(rollback).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });
});
