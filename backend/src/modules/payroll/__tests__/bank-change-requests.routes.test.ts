/**
 * PATCH /api/payroll/bank-change-requests/:id — the live bank-change approval
 * endpoint (the frontend calls this one, not profile-approval.routes.ts's
 * /api/profile-approval/:id/review, which is never mounted in app.ts).
 *
 * Before this fix the approved branch: (a) never wrote account_number_enc, so
 * the account number an employee submitted for a bank change was silently
 * discarded on approval; (b) hardcoded account_seq = 1, which collides with
 * the UNIQUE KEY (employee_id, account_seq) on any employee's second-ever
 * approved change, since the prior row is archived, not deleted; (c) called
 * no audit-log function at all.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const EMPLOYEE_ID = "22222222-2222-2222-2222-222222222222";
const APPROVAL_ID = "33333333-3333-3333-3333-333333333333";

const { dbExecute, encryptField, logSensitiveAction } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  encryptField: vi.fn((v: string) => `enc(${v})`),
  logSensitiveAction: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../shared/fieldEncryption.js", () => ({ encryptField }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));
vi.mock("../run-status.js", () => ({ isRunClosed: vi.fn().mockResolvedValue(false) }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: { id: string } }).authUser = { id: ACTOR_ID };
    next();
  },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

const { payrollWindowCronRouter } = await import("../payroll-window.routes.js");

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/payroll", payrollWindowCronRouter);
  return a;
}

const PENDING_REQUEST = {
  id: APPROVAL_ID,
  employee_id: EMPLOYEE_ID,
  old_values: JSON.stringify({ bank_name: "Old Bank", account_number: "1111222233334444" }),
  new_values: JSON.stringify({
    bank_name: "New Bank",
    account_holder_name: "Test Employee",
    bank_branch: "MG Road",
    ifsc_code: "HDFC0001234",
    account_type: "savings",
    account_number: "5555666677778888",
  }),
  status: "pending",
};

describe("PATCH /api/payroll/bank-change-requests/:id — approve", () => {
  beforeEach(() => {
    dbExecute.mockReset();
    encryptField.mockClear();
    logSensitiveAction.mockReset().mockResolvedValue(undefined);
  });

  it("encrypts and persists the submitted account number", async () => {
    dbExecute
      .mockResolvedValueOnce([[PENDING_REQUEST]])           // SELECT profile_update_approval
      .mockResolvedValueOnce([[{ run_month: "2026-09" }]])   // SELECT salary_prep_run
      .mockResolvedValueOnce([{}])                            // UPDATE archive old primary
      .mockResolvedValueOnce([[{ next_seq: 2 }]])             // SELECT MAX(account_seq)
      .mockResolvedValueOnce([{}])                            // INSERT new primary
      .mockResolvedValueOnce([{}]);                           // UPDATE profile_update_approval status

    const res = await request(app())
      .patch(`/api/payroll/bank-change-requests/${APPROVAL_ID}`)
      .send({ decision: "approved", note: "verified with employee" });

    expect(res.status).toBe(200);
    expect(encryptField).toHaveBeenCalledWith("5555666677778888");

    const insertCall = dbExecute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO employee_bank_detail"));
    expect(insertCall).toBeTruthy();
    expect(insertCall![1]).toContain("enc(5555666677778888)");
  });

  it("computes account_seq from the employee's existing rows instead of hardcoding 1", async () => {
    dbExecute
      .mockResolvedValueOnce([[PENDING_REQUEST]])
      .mockResolvedValueOnce([[{ run_month: "2026-09" }]])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([[{ next_seq: 3 }]])  // employee already has seq 1 and 2 archived
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{}]);

    await request(app())
      .patch(`/api/payroll/bank-change-requests/${APPROVAL_ID}`)
      .send({ decision: "approved" });

    const insertCall = dbExecute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO employee_bank_detail"));
    expect(insertCall![1]).toContain(3); // nextSeq param, not hardcoded 1
  });

  it("archives the old primary as fully inactive (is_primary=0, active_status=0)", async () => {
    dbExecute
      .mockResolvedValueOnce([[PENDING_REQUEST]])
      .mockResolvedValueOnce([[{ run_month: "2026-09" }]])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([[{ next_seq: 2 }]])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{}]);

    await request(app())
      .patch(`/api/payroll/bank-change-requests/${APPROVAL_ID}`)
      .send({ decision: "approved" });

    const archiveCall = dbExecute.mock.calls.find((c) => String(c[0]).includes("UPDATE employee_bank_detail SET is_primary = 0"));
    expect(String(archiveCall![0])).toContain("active_status = 0");
  });

  it("writes an audit log with masked account numbers, never the raw value", async () => {
    dbExecute
      .mockResolvedValueOnce([[PENDING_REQUEST]])
      .mockResolvedValueOnce([[{ run_month: "2026-09" }]])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([[{ next_seq: 2 }]])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{}]);

    await request(app())
      .patch(`/api/payroll/bank-change-requests/${APPROVAL_ID}`)
      .send({ decision: "approved", note: "ok" });

    expect(logSensitiveAction).toHaveBeenCalledTimes(1);
    const entry = logSensitiveAction.mock.calls[0][0];
    expect(entry.action_type).toBe("BANK_DETAILS_APPROVED");
    expect(entry.employee_id).toBe(EMPLOYEE_ID);
    expect(entry.reason).toBe("ok");
    expect(JSON.stringify(entry.new_value_json)).not.toContain("5555666677778888");
    expect(entry.new_value_json.masked_account_number).toBe("****8888");
    expect(JSON.stringify(entry.old_value_json)).not.toContain("1111222233334444");
    expect(entry.old_value_json.masked_account_number).toBe("****4444");
  });

  it("rejects with a reason and still writes an audit log, without touching employee_bank_detail", async () => {
    dbExecute
      .mockResolvedValueOnce([[PENDING_REQUEST]]) // SELECT
      .mockResolvedValueOnce([{}]);                // UPDATE status = rejected

    const res = await request(app())
      .patch(`/api/payroll/bank-change-requests/${APPROVAL_ID}`)
      .send({ decision: "rejected", note: "IFSC does not match branch" });

    expect(res.status).toBe(200);
    expect(dbExecute.mock.calls.some((c) => String(c[0]).includes("INSERT INTO employee_bank_detail"))).toBe(false);
    expect(logSensitiveAction).toHaveBeenCalledTimes(1);
    expect(logSensitiveAction.mock.calls[0][0].action_type).toBe("BANK_DETAILS_REJECTED");
    expect(logSensitiveAction.mock.calls[0][0].reason).toBe("IFSC does not match branch");
  });

  it("refuses to re-process an already-decided request (409)", async () => {
    dbExecute.mockResolvedValueOnce([[{ ...PENDING_REQUEST, status: "approved" }]]);

    const res = await request(app())
      .patch(`/api/payroll/bank-change-requests/${APPROVAL_ID}`)
      .send({ decision: "approved" });

    expect(res.status).toBe(409);
    expect(logSensitiveAction).not.toHaveBeenCalled();
  });
});
