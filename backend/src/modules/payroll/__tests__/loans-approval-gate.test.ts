/**
 * employee_loans approval gate (2026-08-19).
 *
 * POST /api/payroll/loans previously inserted status='active' directly — immediately
 * deduction-eligible in payroll — and self-stamped approved_by/approved_at with the
 * creator's own id at INSERT time, which is fake provenance (it recorded who created
 * the row, not who approved it). This is the test coverage for the fix:
 *   - creation now lands in 'pending_approval', with approved_by/approved_at left NULL
 *     and a real created_by recorded instead;
 *   - POST /:id/approve activates it, but refuses the row's own creator (403,
 *     code: LOAN_SELF_APPROVAL — mirrors payroll.service.ts's PAYROLL_SELF_APPROVAL);
 *   - a genuinely different head-tier approver succeeds and the row becomes 'active'
 *     with real approved_by/approved_at;
 *   - the UPDATE ... WHERE status='pending_approval' optimistic lock returns 409 on a
 *     double-approve race, mirroring leave.service.ts::reviewRequest's affected-rows
 *     pattern;
 *   - PATCH /:id cannot be used as a backdoor around the gate to flip
 *     pending_approval -> active directly;
 *   - the pre-existing payrollCalculate.service.ts / running-salary.service.ts loan-EMI
 *     reads already filter WHERE status='active', so 'pending_approval' rows are
 *     excluded automatically — asserted read-only against the shipped SQL, no payroll
 *     arithmetic touched or exercised here.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CREATOR_ID = "11111111-1111-1111-1111-111111111111";
const APPROVER_ID = "22222222-2222-2222-2222-222222222222";
const LOAN_ID = "33333333-3333-3333-3333-333333333333";
const EMPLOYEE_ID = "44444444-4444-4444-4444-444444444444";

const { execute, hasAnyRole, logSensitiveAction } = vi.hoisted(() => ({
  execute: vi.fn(),
  hasAnyRole: vi.fn(),
  logSensitiveAction: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/scopeAccess.js", () => ({ hasAnyRole }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));

/** Mutable so each test can act as a different authenticated user. */
let currentActorId = CREATOR_ID;
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: { id: string; role: string } }).authUser = {
      id: currentActorId,
      role: "finance_head",
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

beforeEach(() => {
  execute.mockReset();
  hasAnyRole.mockReset();
  logSensitiveAction.mockReset().mockResolvedValue(undefined);
  currentActorId = CREATOR_ID;
});

describe("POST /api/payroll/loans — create no longer self-activates or self-approves", () => {
  it("inserts status='pending_approval', records created_by, and does not stamp approved_by/approved_at", async () => {
    hasAnyRole.mockResolvedValue(true);
    execute
      .mockResolvedValueOnce([[{ id: EMPLOYEE_ID, employee_code: "MAS00001", branch_name: "HQ" }]]) // employee lookup
      .mockResolvedValueOnce([{}]) // INSERT employee_loans
      .mockResolvedValueOnce([[{ // SELECT * (return row)
        id: LOAN_ID,
        status: "pending_approval",
        created_by: CREATOR_ID,
        approved_by: null,
        approved_at: null,
      }]]);

    const res = await request(app())
      .post("/api/payroll/loans")
      .send({
        employee_id: EMPLOYEE_ID,
        loan_type: "Personal Loan",
        amount: 50000,
        start_date: "2026-09-01",
        installments: 10,
        deduction_per_month: 5000,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("pending_approval");
    expect(res.body.data.approved_by).toBeNull();
    expect(res.body.data.approved_at).toBeNull();

    const insertCall = execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO employee_loans"));
    expect(insertCall).toBeTruthy();
    expect(String(insertCall![0])).toContain("'pending_approval'");
    expect(String(insertCall![0])).not.toContain("'active'");
    expect(String(insertCall![0])).toContain("created_by");
    // approved_by/approved_at are no longer part of the INSERT column list at all.
    expect(String(insertCall![0])).not.toMatch(/\bapproved_by\b/);
    expect(String(insertCall![0])).not.toMatch(/\bapproved_at\b/);
    // created_by is bound to the actual creator (CREATOR_ID), not baked into approved_by.
    expect(insertCall![1]).toContain(CREATOR_ID);
  });
});

describe("POST /api/payroll/loans/:id/approve", () => {
  it("blocks the loan's own creator with 403 LOAN_SELF_APPROVAL", async () => {
    hasAnyRole.mockResolvedValue(true); // approver role tier check passes
    currentActorId = CREATOR_ID; // the same person who created it is now trying to approve it
    execute.mockResolvedValueOnce([[{
      id: LOAN_ID,
      status: "pending_approval",
      created_by: CREATOR_ID,
    }]]);

    const res = await request(app()).post(`/api/payroll/loans/${LOAN_ID}/approve`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("LOAN_SELF_APPROVAL");
    // No UPDATE was issued — only the initial SELECT ran.
    expect(execute).toHaveBeenCalledTimes(1);
    expect(logSensitiveAction).not.toHaveBeenCalled();
  });

  it("activates the loan for a genuinely different approver, with real approved_by/approved_at", async () => {
    hasAnyRole.mockResolvedValue(true);
    currentActorId = APPROVER_ID; // different from created_by
    execute
      .mockResolvedValueOnce([[{ id: LOAN_ID, status: "pending_approval", created_by: CREATOR_ID }]]) // SELECT existing
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE ... WHERE status='pending_approval'
      .mockResolvedValueOnce([[{ // SELECT updated
        id: LOAN_ID,
        status: "active",
        approved_by: APPROVER_ID,
        approved_at: "2026-08-19T10:00:00.000Z",
      }]]);

    const res = await request(app()).post(`/api/payroll/loans/${LOAN_ID}/approve`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("active");
    expect(res.body.data.approved_by).toBe(APPROVER_ID);
    expect(res.body.data.approved_at).toBeTruthy();

    const updateCall = execute.mock.calls.find((c) => String(c[0]).includes("UPDATE employee_loans"));
    expect(updateCall).toBeTruthy();
    expect(String(updateCall![0])).toContain("status = 'active'");
    expect(String(updateCall![0])).toContain("WHERE id = ? AND status = 'pending_approval'");
    expect(updateCall![1]).toEqual([APPROVER_ID, LOAN_ID]);

    expect(logSensitiveAction).toHaveBeenCalledTimes(1);
    expect(logSensitiveAction.mock.calls[0][0].action_type).toBe("loan_approved");
  });

  it("returns 409 on a double-approve race (optimistic lock, zero affected rows)", async () => {
    hasAnyRole.mockResolvedValue(true);
    currentActorId = APPROVER_ID;
    execute
      .mockResolvedValueOnce([[{ id: LOAN_ID, status: "pending_approval", created_by: CREATOR_ID }]]) // SELECT still shows pending
      .mockResolvedValueOnce([{ affectedRows: 0 }]); // but another approver already flipped it — 0 rows matched

    const res = await request(app()).post(`/api/payroll/loans/${LOAN_ID}/approve`);

    expect(res.status).toBe(409);
    expect(logSensitiveAction).not.toHaveBeenCalled();
  });

  it("refuses with 403 when the caller lacks the head-level role tier", async () => {
    hasAnyRole.mockResolvedValue(false);
    const res = await request(app()).post(`/api/payroll/loans/${LOAN_ID}/approve`);
    expect(res.status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("POST /api/payroll/loans/:id/reject", () => {
  it("rejects with rejected_by/rejected_at/rejection_reason and blocks self-review", async () => {
    hasAnyRole.mockResolvedValue(true);
    currentActorId = CREATOR_ID;
    execute.mockResolvedValueOnce([[{ id: LOAN_ID, status: "pending_approval", created_by: CREATOR_ID }]]);

    const selfRes = await request(app())
      .post(`/api/payroll/loans/${LOAN_ID}/reject`)
      .send({ reason: "not needed" });
    expect(selfRes.status).toBe(403);
    expect(selfRes.body.code).toBe("LOAN_SELF_APPROVAL");

    execute.mockReset();
    currentActorId = APPROVER_ID;
    execute
      .mockResolvedValueOnce([[{ id: LOAN_ID, status: "pending_approval", created_by: CREATOR_ID }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{
        id: LOAN_ID,
        status: "rejected",
        rejected_by: APPROVER_ID,
        rejected_at: "2026-08-19T10:05:00.000Z",
        rejection_reason: "budget exceeded",
      }]]);

    const res = await request(app())
      .post(`/api/payroll/loans/${LOAN_ID}/reject`)
      .send({ reason: "budget exceeded" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("rejected");
    expect(res.body.data.rejected_by).toBe(APPROVER_ID);
    expect(res.body.data.rejection_reason).toBe("budget exceeded");
  });
});

describe("PATCH /api/payroll/loans/:id — no backdoor around the approval gate", () => {
  it("refuses to move status pending_approval -> active directly (409)", async () => {
    hasAnyRole.mockResolvedValue(true);
    execute.mockResolvedValueOnce([[{ id: LOAN_ID, status: "pending_approval" }]]); // SELECT existing

    const res = await request(app())
      .patch(`/api/payroll/loans/${LOAN_ID}`)
      .send({ status: "active" });

    expect(res.status).toBe(409);
    // Only the initial SELECT ran — no UPDATE was issued.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("refuses to move status pending_approval -> rejected directly (409)", async () => {
    hasAnyRole.mockResolvedValue(true);
    execute.mockResolvedValueOnce([[{ id: LOAN_ID, status: "pending_approval" }]]); // SELECT existing

    const res = await request(app())
      .patch(`/api/payroll/loans/${LOAN_ID}`)
      .send({ status: "rejected" });

    expect(res.status).toBe(409);
    // Only the initial SELECT ran — no UPDATE was issued, and rejected_by/rejected_at/
    // rejection_reason are never written by this route.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("still allows PATCH to move a pending_approval loan to cancelled", async () => {
    hasAnyRole.mockResolvedValue(true);
    execute
      .mockResolvedValueOnce([[{ id: LOAN_ID, status: "pending_approval" }]])
      .mockResolvedValueOnce([{}]) // UPDATE
      .mockResolvedValueOnce([[{ id: LOAN_ID, status: "cancelled" }]]);

    const res = await request(app())
      .patch(`/api/payroll/loans/${LOAN_ID}`)
      .send({ status: "cancelled" });

    expect(res.status).toBe(200);
  });
});

describe("payroll deduction reads already exclude pending_approval (read-only, no logic touched)", () => {
  const CALC_SRC = readFileSync(
    resolve(process.cwd(), "src/modules/payroll/payrollCalculate.service.ts"),
    "utf8",
  );
  const RUNNING_SRC = readFileSync(
    resolve(process.cwd(), "src/modules/payroll/running-salary.service.ts"),
    "utf8",
  );

  it("payrollCalculate.service.ts's loan EMI query filters status='active' only", () => {
    const idx = CALC_SRC.indexOf("FROM employee_loans");
    expect(idx, "employee_loans query not found in payrollCalculate.service.ts").toBeGreaterThan(-1);
    const clause = CALC_SRC.slice(idx, idx + 200);
    expect(clause).toContain("status = 'active'");
    expect(clause).not.toContain("pending_approval");
  });

  it("running-salary.service.ts's loan EMI query filters status='active' only", () => {
    const idx = RUNNING_SRC.indexOf("FROM employee_loans");
    expect(idx, "employee_loans query not found in running-salary.service.ts").toBeGreaterThan(-1);
    const clause = RUNNING_SRC.slice(idx, idx + 200);
    expect(clause).toContain("status = 'active'");
    expect(clause).not.toContain("pending_approval");
  });
});
