/**
 * The off-cycle/arrears payment ledger (arrears-payment.service.ts) is the first real mechanism
 * to pay money owed from a closed payroll run — see sql/1692_payroll_arrears_payment.sql for the
 * full rationale. Every scenario below is asserted in both directions per this module's own
 * testing convention: a valid transition must succeed, and each guard that exists to prevent a
 * bad one must actually refuse it, not merely be present in the code.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, logSensitiveAction } = vi.hoisted(() => ({
  execute: vi.fn(),
  logSensitiveAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));

import { arrearsPaymentService, ArrearsPaymentError } from "../arrears-payment.service.js";

const ROW = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: "pay-1",
  employee_id: "emp-1",
  source_run_id: "run-july",
  target_run_id: "run-aug",
  amount: "2429.00",
  reason: "July arrears",
  basis_note: null,
  status: "pending_approval",
  requested_by: "actor-req",
  requested_at: "2026-09-08 10:00:00",
  approved_by: null,
  approved_at: null,
  rejected_by: null,
  rejected_at: null,
  rejection_reason: null,
  paid_by: null,
  paid_at: null,
  payment_reference: null,
  ...overrides,
});

beforeEach(() => {
  execute.mockReset();
  logSensitiveAction.mockClear();
});

describe("create", () => {
  it("rejects a non-positive amount before touching the database", async () => {
    await expect(
      arrearsPaymentService.create({ employeeId: "emp-1", amount: 0, reason: "x" }, "actor-1"),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects a missing reason before touching the database", async () => {
    await expect(
      arrearsPaymentService.create({ employeeId: "emp-1", amount: 100, reason: "  " }, "actor-1"),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects an employee that does not exist", async () => {
    execute.mockResolvedValueOnce([[]]); // employee lookup: no rows
    await expect(
      arrearsPaymentService.create({ employeeId: "ghost", amount: 100, reason: "x" }, "actor-1"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("creates a pending_approval row and audits the request, for a valid input", async () => {
    execute
      .mockResolvedValueOnce([[{ id: "emp-1" }]]) // employee lookup
      .mockResolvedValueOnce([{}]) // insert
      .mockResolvedValueOnce([[ROW()]]); // getById after insert

    const result = await arrearsPaymentService.create(
      { employeeId: "emp-1", amount: 2429, reason: "July arrears" },
      "actor-req",
    );

    expect(result.status).toBe("pending_approval");
    const insertSql = execute.mock.calls[1][0] as string;
    expect(insertSql).toMatch(/INSERT INTO payroll_arrears_payment/);
    expect(insertSql).toMatch(/'pending_approval'/);
    expect(logSensitiveAction).toHaveBeenCalledWith(
      expect.objectContaining({ action_type: "ARREARS_PAYMENT_REQUESTED", employee_id: "emp-1" }),
    );
  });
});

describe("approve", () => {
  it("approves a pending_approval row and audits it", async () => {
    execute
      .mockResolvedValueOnce([[ROW({ status: "pending_approval" })]]) // getById (pre-check)
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE
      .mockResolvedValueOnce([[ROW({ status: "approved", approved_by: "approver-1" })]]); // getById (post)

    const result = await arrearsPaymentService.approve("pay-1", "approver-1");
    expect(result.status).toBe("approved");
    expect(logSensitiveAction).toHaveBeenCalledWith(
      expect.objectContaining({ action_type: "ARREARS_PAYMENT_APPROVED" }),
    );
  });

  it("refuses to approve a row that is not pending_approval", async () => {
    execute.mockResolvedValueOnce([[ROW({ status: "approved" })]]); // already approved
    await expect(arrearsPaymentService.approve("pay-1", "approver-1")).rejects.toMatchObject({
      statusCode: 409,
    });
    // Must not attempt the UPDATE at all once the pre-check fails.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("refuses a concurrent double-approval (replay guard: UPDATE matches zero rows)", async () => {
    execute
      .mockResolvedValueOnce([[ROW({ status: "pending_approval" })]]) // pre-check sees pending
      .mockResolvedValueOnce([{ affectedRows: 0 }]); // but someone else won the race
    await expect(arrearsPaymentService.approve("pay-1", "approver-1")).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("404s on an unknown id", async () => {
    execute.mockResolvedValueOnce([[]]);
    await expect(arrearsPaymentService.approve("ghost", "approver-1")).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe("reject", () => {
  it("requires a reason", async () => {
    await expect(arrearsPaymentService.reject("pay-1", "approver-1", "  ")).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects a pending_approval row and audits it", async () => {
    execute
      .mockResolvedValueOnce([[ROW({ status: "pending_approval" })]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[ROW({ status: "rejected", rejection_reason: "wrong employee" })]]);

    const result = await arrearsPaymentService.reject("pay-1", "approver-1", "wrong employee");
    expect(result.status).toBe("rejected");
    expect(logSensitiveAction).toHaveBeenCalledWith(
      expect.objectContaining({ action_type: "ARREARS_PAYMENT_REJECTED", reason: "wrong employee" }),
    );
  });

  it("refuses to reject an already-approved row", async () => {
    execute.mockResolvedValueOnce([[ROW({ status: "approved" })]]);
    await expect(arrearsPaymentService.reject("pay-1", "approver-1", "too late")).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});

describe("markPaid", () => {
  it("requires a payment reference", async () => {
    await expect(arrearsPaymentService.markPaid("pay-1", "finance-1", "")).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("marks an approved row paid and audits it", async () => {
    execute
      .mockResolvedValueOnce([[ROW({ status: "approved" })]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[ROW({ status: "paid", payment_reference: "UTR123" })]]);

    const result = await arrearsPaymentService.markPaid("pay-1", "finance-1", "UTR123");
    expect(result.status).toBe("paid");
    expect(logSensitiveAction).toHaveBeenCalledWith(
      expect.objectContaining({ action_type: "ARREARS_PAYMENT_MARKED_PAID" }),
    );
  });

  it("refuses to mark paid a row that was never approved", async () => {
    execute.mockResolvedValueOnce([[ROW({ status: "pending_approval" })]]);
    await expect(arrearsPaymentService.markPaid("pay-1", "finance-1", "UTR123")).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("refuses to mark an already-paid row paid again", async () => {
    execute.mockResolvedValueOnce([[ROW({ status: "paid" })]]);
    await expect(arrearsPaymentService.markPaid("pay-1", "finance-1", "UTR456")).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});

describe("list / getById", () => {
  it("getById returns null for an unknown id rather than throwing", async () => {
    execute.mockResolvedValueOnce([[]]);
    expect(await arrearsPaymentService.getById("ghost")).toBeNull();
  });

  it("list filters by status and employeeId when supplied", async () => {
    execute.mockResolvedValueOnce([[ROW()]]);
    await arrearsPaymentService.list({ employeeId: "emp-1", status: "approved" });
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toMatch(/WHERE employee_id = \? AND status = \?/);
    expect(params).toEqual(["emp-1", "approved"]);
  });

  it("list with no filter queries unconditionally", async () => {
    execute.mockResolvedValueOnce([[]]);
    await arrearsPaymentService.list();
    const [sql, params] = execute.mock.calls[0];
    expect(sql).not.toMatch(/WHERE/);
    expect(params).toEqual([]);
  });
});

describe("never touches payroll calculation tables", () => {
  it("no query in this service references salary_prep_line or salary_prep_run as a write target", async () => {
    // Exercise every mutating path once, then inspect every SQL statement issued across the run.
    execute
      .mockResolvedValueOnce([[{ id: "emp-1" }]])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([[ROW()]]);
    await arrearsPaymentService.create({ employeeId: "emp-1", amount: 10, reason: "x" }, "actor-1");

    execute
      .mockResolvedValueOnce([[ROW({ status: "pending_approval" })]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[ROW({ status: "approved" })]]);
    await arrearsPaymentService.approve("pay-1", "approver-1");

    execute
      .mockResolvedValueOnce([[ROW({ status: "approved" })]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[ROW({ status: "paid" })]]);
    await arrearsPaymentService.markPaid("pay-1", "finance-1", "UTR1");

    for (const [sql] of execute.mock.calls) {
      expect(String(sql)).not.toMatch(/\bUPDATE\s+salary_prep_line\b/i);
      expect(String(sql)).not.toMatch(/\bUPDATE\s+salary_prep_run\b/i);
    }
  });
});
