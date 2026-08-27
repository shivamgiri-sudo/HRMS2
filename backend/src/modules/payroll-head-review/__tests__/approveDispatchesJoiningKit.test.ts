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
} = vi.hoisted(() => ({
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
vi.mock("../../employees/employee-bgv.service.js", () => ({ getEmployeeBgvStatus }));
vi.mock("../../payroll/bank-payment-readiness.service.js", () => ({ buildBankReadinessReport }));
vi.mock("../../payroll-masters/payrollMasters.service.js", () => ({ createPackage: vi.fn(), getPackageById: vi.fn() }));
vi.mock("../../inbox/inbox.service.js", () => ({ inboxService: { createItem } }));
vi.mock("../../../shared/scopeAccess.js", () => ({ hasAnyRole, buildScopeWhereClause }));
vi.mock("../../employees/joiningKitDispatch.service.js", () => ({ queueJoiningKit, dispatchJoiningKit }));

import { approve } from "../payroll-head-review.service.js";

/** The seven queries approve() issues, in order, for a clean pending_review -> approved run. */
function primeApprovableReview() {
  execute
    .mockResolvedValueOnce([[{ id: "review-1", status: "pending_review", package_accepted: 1 }]]) // getReviewRow
    .mockResolvedValueOnce([{ affectedRows: 1 }])                                                 // UPDATE -> approved
    .mockResolvedValueOnce(undefined)                                                             // audit
    .mockResolvedValueOnce(undefined)                                                             // writeHistory
    .mockResolvedValueOnce([[]])                                                                  // notify targets
    .mockResolvedValueOnce([[{ full_name: "Jane Doe", employee_code: "E123", user_id: "user-emp-1", ctc_annual: 600000 }]])
    .mockResolvedValueOnce([[{ id: "review-1", status: "approved" }]]);                           // final getReviewRow
}

/** The dispatch is fire-and-forget, so let the microtask queue drain before asserting. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("approve() releases the blocked joining kit", () => {
  beforeEach(() => {
    execute.mockReset();
    createItem.mockClear();
    queueJoiningKit.mockReset().mockResolvedValue({ kitId: "kit-1" });
    dispatchJoiningKit.mockReset().mockResolvedValue({ kitId: "kit-1", status: "sent" });
  });

  it("queues and dispatches the kit for the approved employee", async () => {
    primeApprovableReview();

    await approve("emp-1", "actor-1");
    await settle();

    expect(queueJoiningKit).toHaveBeenCalledTimes(1);
    expect(queueJoiningKit).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: "emp-1",
      actorUserId: "actor-1",
      triggerSource: "payroll_head_approved",
    }));
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
    execute.mockResolvedValueOnce([[{ id: "review-1", status: "approved", package_accepted: 1 }]]);

    await expect(approve("emp-1", "actor-1")).rejects.toThrow(/Cannot approve/);
    await settle();

    expect(queueJoiningKit).not.toHaveBeenCalled();
    expect(dispatchJoiningKit).not.toHaveBeenCalled();
  });
});
