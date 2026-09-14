/**
 * Employee-initiated salary-advance request — POST /api/payroll/loans/request.
 *
 * The approval gate (pending_approval -> approve/reject, self-approval blocked) already
 * existed, but there was no way for an employee to originate a request: POST / requires
 * admin/payroll_head/finance/super_admin, so an advance could only be raised FOR an
 * employee, never BY one, and the "My Loans" tab was read-only. This is the coverage for
 * that entry point, and specifically for the fields a requester must NOT control:
 *
 *   - the employee is resolved from the caller's own user_id; a foreign employee_id in
 *     the body is ignored rather than honoured (privilege-escalation guard);
 *   - deduction_per_month is derived server-side as amount/installments, so a requester
 *     cannot stretch repayment indefinitely by sending deduction_per_month = 1;
 *   - start_date is server-derived (1st of next month), never client-supplied, so a
 *     request cannot be backdated into a closed payroll month;
 *   - the row lands in 'pending_approval' with approved_by/approved_at left NULL;
 *   - only self-requestable advance types are accepted (Personal Loan is not);
 *   - a second open request is refused with 409.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OWN_EMPLOYEE_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const OTHER_EMPLOYEE_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const LOAN_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

const { execute, hasAnyRole, logSensitiveAction } = vi.hoisted(() => ({
  execute: vi.fn(),
  hasAnyRole: vi.fn(),
  logSensitiveAction: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/scopeAccess.js", () => ({ hasAnyRole }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: { id: string; role: string } }).authUser = {
      id: USER_ID,
      role: "employee",
    };
    next();
  },
}));

const { loansRouter } = await import("../loans.routes.js");

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/payroll/loans", loansRouter);
  return a;
}

/** employee lookup -> open-request check (none) -> INSERT -> SELECT * */
function mockHappyPath() {
  execute
    .mockResolvedValueOnce([[{ id: OWN_EMPLOYEE_ID, employee_code: "MAS00001", branch_name: "HQ" }]])
    .mockResolvedValueOnce([[]])
    .mockResolvedValueOnce([{}])
    .mockResolvedValueOnce([[{
      id: LOAN_ID,
      employee_id: OWN_EMPLOYEE_ID,
      status: "pending_approval",
      approved_by: null,
      approved_at: null,
    }]]);
}

const insertCall = () =>
  execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO employee_loans"));

beforeEach(() => {
  execute.mockReset();
  hasAnyRole.mockReset().mockResolvedValue(false);
  logSensitiveAction.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/payroll/loans/request — employee self-service entry point", () => {
  it("creates a pending_approval request without needing any payroll role", async () => {
    mockHappyPath();

    const res = await request(app())
      .post("/api/payroll/loans/request")
      .send({ loan_type: "Salary Advance", amount: 12000, installments: 3 });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("pending_approval");
    expect(res.body.data.approved_by).toBeNull();
    expect(res.body.data.approved_at).toBeNull();

    // No role check gates this route — an ordinary employee must be able to reach it.
    expect(hasAnyRole).not.toHaveBeenCalled();

    const sql = String(insertCall()![0]);
    expect(sql).toContain("'pending_approval'");
    expect(sql).not.toMatch(/\bapproved_by\b/);
    expect(sql).not.toMatch(/\bapproved_at\b/);
  });

  it("resolves the employee from the caller's own login and IGNORES a foreign employee_id", async () => {
    mockHappyPath();

    await request(app())
      .post("/api/payroll/loans/request")
      .send({
        employee_id: OTHER_EMPLOYEE_ID, // attempt to raise against someone else
        loan_type: "Salary Advance",
        amount: 9000,
        installments: 3,
      });

    // The employee lookup keys on user_id, not on anything from the body.
    const lookup = execute.mock.calls[0];
    expect(String(lookup[0])).toContain("user_id = ?");
    expect(lookup[1]).toEqual([USER_ID]);

    // The inserted row belongs to the caller, never to the employee_id they sent.
    const params = insertCall()![1] as unknown[];
    expect(params).toContain(OWN_EMPLOYEE_ID);
    expect(params).not.toContain(OTHER_EMPLOYEE_ID);
  });

  it("derives deduction_per_month server-side and ignores a client-supplied one", async () => {
    mockHappyPath();

    await request(app())
      .post("/api/payroll/loans/request")
      .send({
        loan_type: "Salary Advance",
        amount: 12000,
        installments: 4,
        deduction_per_month: 1, // would stretch repayment to 12,000 months
        start_date: "2020-01-01", // would backdate into a long-closed month
      });

    const params = insertCall()![1] as unknown[];
    expect(params).toContain(3000); // 12000 / 4, not the 1 that was sent
    expect(params).not.toContain(1);
    expect(params).not.toContain("2020-01-01");

    // start_date is the 1st of next month, derived from the server clock.
    const now = new Date();
    const expectedStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const ymd = `${expectedStart.getFullYear()}-${String(expectedStart.getMonth() + 1).padStart(2, "0")}-01`;
    expect(params).toContain(ymd);
  });

  it("refuses a loan type an employee may not raise for themselves", async () => {
    execute.mockResolvedValueOnce([[{ id: OWN_EMPLOYEE_ID, employee_code: "MAS00001", branch_name: "HQ" }]]);

    const res = await request(app())
      .post("/api/payroll/loans/request")
      .send({ loan_type: "Personal Loan", amount: 50000, installments: 10 });

    expect(res.status).toBe(400);
    expect(insertCall()).toBeUndefined();
  });

  it("refuses a second request while one is still awaiting approval", async () => {
    execute
      .mockResolvedValueOnce([[{ id: OWN_EMPLOYEE_ID, employee_code: "MAS00001", branch_name: "HQ" }]])
      .mockResolvedValueOnce([[{ id: LOAN_ID }]]); // an open pending_approval row exists

    const res = await request(app())
      .post("/api/payroll/loans/request")
      .send({ loan_type: "Salary Advance", amount: 5000, installments: 2 });

    expect(res.status).toBe(409);
    expect(insertCall()).toBeUndefined();
  });

  it("refuses a login not linked to an active employee record", async () => {
    execute.mockResolvedValueOnce([[]]); // no employee for this user_id

    const res = await request(app())
      .post("/api/payroll/loans/request")
      .send({ loan_type: "Salary Advance", amount: 5000, installments: 2 });

    expect(res.status).toBe(403);
    expect(insertCall()).toBeUndefined();
  });

  it.each([
    ["zero amount", { loan_type: "Salary Advance", amount: 0, installments: 3 }],
    ["negative amount", { loan_type: "Salary Advance", amount: -5000, installments: 3 }],
    ["zero installments", { loan_type: "Salary Advance", amount: 5000, installments: 0 }],
    ["installments over cap", { loan_type: "Salary Advance", amount: 5000, installments: 25 }],
    ["fractional installments", { loan_type: "Salary Advance", amount: 5000, installments: 2.5 }],
  ])("rejects %s", async (_label, body) => {
    execute.mockResolvedValueOnce([[{ id: OWN_EMPLOYEE_ID, employee_code: "MAS00001", branch_name: "HQ" }]]);

    const res = await request(app()).post("/api/payroll/loans/request").send(body);

    expect(res.status).toBe(400);
    expect(insertCall()).toBeUndefined();
  });
});
