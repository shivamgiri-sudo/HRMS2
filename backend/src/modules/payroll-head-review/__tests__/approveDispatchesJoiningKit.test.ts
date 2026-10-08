import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Approving a salary must release the joining kit that approval was blocking.
 *
 * dispatchJoiningKit refuses to send while employee_payroll_head_review.status is not
 * 'approved' — correctly, since the contract appendix prints the final remuneration. But
 * nothing re-ran dispatch once the gate opened: all three dispatch call sites (ats.convert,
 * the creation orchestrator, the manual send route) fire at or before employee creation, and
 * no cron retries a blocked kit. So a kit blocked with 'payroll_head_not_approved' stayed
 * blocked forever, and a Payroll Head approving a batch of salaries saw no kits go out at all
 * — the reported symptom this covers.
 *
 * Pinned here:
 *   1. approve() queues and dispatches the kit  (fails without the fix)
 *   2. a dispatch failure does NOT fail the approval, which is already committed
 *   3. approve() still returns the review row unchanged
 */

const {
  execute, getEmployeeBgvStatus, buildBankReadinessReport, createItem,
  hasAnyRole, buildScopeWhereClause, queueJoiningKit, dispatchJoiningKit,
  generateEmploymentContractForEmployee,
} = vi.hoisted(() => ({
  generateEmploymentContractForEmployee: vi.fn(),
  execute: vi.fn(),
  getEmployeeBgvStatus: vi.fn(),
  buildBankReadinessReport: vi.fn(),
  createItem: vi.fn().mockResolvedValue(undefined),
  hasAnyRole: vi.fn().mockResolvedValue(true),
  buildScopeWhereClause: vi.fn().mockResolvedValue({ sql: "1=1", params: [] }),
  queueJoiningKit: vi.fn(),
  dispatchJoiningKit: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../employees/employee-bgv.service.js", () => ({
  getEmployeeBgvStatus,
}));
vi.mock("../../payroll/bank-payment-readiness.service.js", () => ({
  buildBankReadinessReport,
}));
vi.mock("../../payroll-masters/payrollMasters.service.js", () => ({
  createPackage: vi.fn(),
  getPackageById: vi.fn(),
}));
vi.mock("../../inbox/inbox.service.js", () => ({
  inboxService: { createItem },
}));
vi.mock("../../../shared/scopeAccess.js", () => ({
  hasAnyRole,
  buildScopeWhereClause,
}));
// approve() now refuses a review whose salary start date differs across the employee's records.
// These tests are about notification / kit dispatch, so the dates are stipulated consistent here;
// the gate itself is covered in salaryStartDateGate.test.ts.
vi.mock(
  "../../payroll/salary-start-date.service.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../payroll/salary-start-date.service.js")
    >()),
    getSalaryStartDateConsistency: vi
      .fn()
      .mockResolvedValue({ consistent: true, expected: null, problems: [] }),
  }),
);
vi.mock("../../employees/joiningKitDispatch.service.js", () => ({
  queueJoiningKit,
  dispatchJoiningKit,
}));
vi.mock("../../employees/joiningKitDispatch.service.js", () => ({ queueJoiningKit, dispatchJoiningKit }));
// Since 21ad388fa approval first generates the EMPLOYMENT_CONTRACT (its appendix prints the
// approved remuneration, so it cannot exist earlier) and only then releases the kit, in one
// sequential fire-and-forget block. Unmocked, the real generator ran against the mocked db and
// the kit step had not been reached by the time these assertions ran.
vi.mock("../../employees/employeeJoiningDocuments.service.js", () => ({ generateEmploymentContractForEmployee }));

import { approve } from "../payroll-head-review.service.js";

/** The seven queries approve() issues, in order, for a clean pending_review -> approved run. */
function primeApprovableReview() {
  // Routed by query, not by position: approval notifications run after approve() returns, so
  // their queries interleave with the final review read.
  let reviewReads = 0;
  execute.mockImplementation(async (sql: string) => {
    if (/FROM employee_payroll_head_review WHERE employee_id/.test(sql)) {
      reviewReads++;
      return [[reviewReads === 1
        ? { id: "review-1", status: "pending_review", package_accepted: 1 }
        : { id: "review-1", status: "approved" }]];
    }
    if (/UPDATE employee_payroll_head_review SET status = 'approved'/.test(sql)) return [{ affectedRows: 1 }];
    if (/sca\.net_estimate AS net_in_hand/.test(sql)) {
      return [[{ full_name: "Jane Doe", employee_code: "E123", user_id: "user-emp-1", ctc_annual: 600000 }]];
    }
    return [[]];
  });
}

/**
 * The dispatch is fire-and-forget behind two dynamic imports, so a single macrotask is not enough
 * to reach it. Drain a few turns of the event loop before asserting.
 */
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

describe("approve() releases the blocked joining kit", () => {
  beforeEach(() => {
    execute.mockReset();
    createItem.mockClear();
    queueJoiningKit.mockReset().mockResolvedValue({ kitId: "kit-1" });
    dispatchJoiningKit.mockReset().mockResolvedValue({ kitId: "kit-1", status: "sent" });
    generateEmploymentContractForEmployee.mockReset().mockResolvedValue(undefined);
  });

  it("queues and dispatches the kit for the approved employee", async () => {
    primeApprovableReview();

    await approve("emp-1", "actor-1");
    await settle();

    expect(queueJoiningKit).toHaveBeenCalledTimes(1);
    expect(queueJoiningKit).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeId: "emp-1",
        actorUserId: "actor-1",
        triggerSource: "payroll_head_approved",
      }),
    );
    expect(dispatchJoiningKit).toHaveBeenCalledWith("kit-1", "actor-1");
    // The contract is generated for the same employee, and before the kit is queued.
    expect(generateEmploymentContractForEmployee).toHaveBeenCalledWith("emp-1", "actor-1");
    expect(generateEmploymentContractForEmployee.mock.invocationCallOrder[0])
      .toBeLessThan(queueJoiningKit.mock.invocationCallOrder[0]);
  });

  it("still releases the kit when contract generation fails", async () => {
    primeApprovableReview();
    generateEmploymentContractForEmployee.mockRejectedValue(new Error("template missing"));

    await approve("emp-1", "actor-1");
    await settle();

    // dispatchJoiningKit itself blocks on 'draft_missing' in that case; approve() must still ask.
    expect(queueJoiningKit).toHaveBeenCalledTimes(1);
    expect(dispatchJoiningKit).toHaveBeenCalledWith("kit-1", "actor-1");
  });

  it("does not fail the approval when kit dispatch throws", async () => {
    primeApprovableReview();
    dispatchJoiningKit.mockRejectedValue(new Error("esign provider down"));

    // The status UPDATE is already committed by this point; an approval must not be
    // reported as failed because an outbound provider is unavailable.
    await expect(approve("emp-1", "actor-1")).resolves.toEqual({
      review: { id: "review-1", status: "approved" },
    });
    await settle();
  });

  it("does not dispatch when the review is not pending_review", async () => {
    execute.mockResolvedValueOnce([
      [{ id: "review-1", status: "approved", package_accepted: 1 }],
    ]);

    await expect(approve("emp-1", "actor-1")).rejects.toThrow(/Cannot approve/);
    await settle();

    expect(queueJoiningKit).not.toHaveBeenCalled();
    expect(dispatchJoiningKit).not.toHaveBeenCalled();
  });
});
