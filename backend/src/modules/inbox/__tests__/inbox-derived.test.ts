import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Work Inbox's "derived" items (LEAVE_APPROVAL_PENDING / FF_CLEARANCE_PENDING /
 * BGV_PENDING) had NO completion action at all — completeTask() in NativeWorkInbox.tsx
 * threw before calling anything. decideDerivedItem() is the real Approve/Reject: it must
 * dispatch to the SAME service/scope functions the item's own real page uses, not a
 * parallel implementation, and must never let a rejection through with no reason.
 */

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));

const { hasAnyRole } = vi.hoisted(() => ({ hasAnyRole: vi.fn() }));
vi.mock("../../../shared/scopeAccess.js", () => ({ hasAnyRole }));

const { canViewEmployee } = vi.hoisted(() => ({ canViewEmployee: vi.fn() }));
vi.mock("../../../shared/enterpriseScope.js", () => ({ canViewEmployee }));

const { canReviewLeave } = vi.hoisted(() => ({ canReviewLeave: vi.fn() }));
vi.mock("../../leave/leave.secure.routes.js", () => ({ canReviewLeave }));

const { reviewRequest } = vi.hoisted(() => ({ reviewRequest: vi.fn() }));
vi.mock("../../leave/leave.service.js", () => ({ leaveService: { reviewRequest } }));

const { manualReview } = vi.hoisted(() => ({ manualReview: vi.fn() }));
vi.mock("../../ats/bgv-verification.service.js", () => ({ manualReview }));

const { decideDerivedItem, getDerivedItemDetail } = await import("../inbox-derived.service.js");

const ACTOR_ID = "actor-1";

beforeEach(() => {
  dbExecute.mockReset();
  hasAnyRole.mockReset().mockResolvedValue(true);
  canViewEmployee.mockReset().mockResolvedValue(true);
  canReviewLeave.mockReset().mockResolvedValue(true);
  reviewRequest.mockReset().mockResolvedValue({ id: "leave-1", status: "approved" });
  manualReview.mockReset().mockResolvedValue({ status: "clear" });
});

describe("decideDerivedItem — reject always requires a reason", () => {
  it("rejects a leave without remarks with a 400, before touching canReviewLeave", async () => {
    await expect(decideDerivedItem("leave_request", "leave-1", "reject", "", ACTOR_ID))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(canReviewLeave).not.toHaveBeenCalled();
  });

  it("rejects an exit clearance without remarks with a 400", async () => {
    await expect(decideDerivedItem("exit_clearance_task", "task-1", "reject", "   ", ACTOR_ID))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects a BGV check without remarks with a 400", async () => {
    await expect(decideDerivedItem("candidate_bgv_check", "check-1", "reject", undefined, ACTOR_ID))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("decideDerivedItem — leave_request", () => {
  it("approve dispatches to the real leaveService.reviewRequest, after the real canReviewLeave scope check", async () => {
    const result = await decideDerivedItem("leave_request", "leave-1", "approve", "looks fine", ACTOR_ID);
    expect(canReviewLeave).toHaveBeenCalledWith(ACTOR_ID, "leave-1");
    expect(reviewRequest).toHaveBeenCalledWith("leave-1", { status: "approved", remarks: "looks fine" }, ACTOR_ID);
    expect(result).toEqual({ id: "leave-1", status: "approved" });
  });

  it("403s when canReviewLeave says the request is out of scope, and never calls reviewRequest", async () => {
    canReviewLeave.mockResolvedValue(false);
    await expect(decideDerivedItem("leave_request", "leave-1", "approve", "", ACTOR_ID))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(reviewRequest).not.toHaveBeenCalled();
  });

  it("reject passes status 'rejected' with the mandatory remarks", async () => {
    await decideDerivedItem("leave_request", "leave-1", "reject", "insufficient balance", ACTOR_ID);
    expect(reviewRequest).toHaveBeenCalledWith("leave-1", { status: "rejected", remarks: "insufficient balance" }, ACTOR_ID);
  });
});

describe("decideDerivedItem — exit_clearance_task", () => {
  it("approve looks up the task's employee_id, checks canViewEmployee, and writes status='cleared'", async () => {
    dbExecute.mockResolvedValueOnce([[{ exit_request_id: "exit-1", employee_id: "emp-1" }], []]);
    dbExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    const result = await decideDerivedItem("exit_clearance_task", "task-1", "approve", "cleared by IT", ACTOR_ID);

    expect(canViewEmployee).toHaveBeenCalledWith(ACTOR_ID, "emp-1");
    const updateSql = String(dbExecute.mock.calls[1][0]);
    expect(updateSql).toContain("UPDATE exit_clearance_task");
    const updateParams = dbExecute.mock.calls[1][1];
    expect(updateParams).toContain("cleared");
    expect(result).toEqual({ id: "task-1", status: "cleared" });
  });

  it("reject writes status='blocked'", async () => {
    dbExecute.mockResolvedValueOnce([[{ exit_request_id: "exit-1", employee_id: "emp-1" }], []]);
    dbExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    const result = await decideDerivedItem("exit_clearance_task", "task-1", "reject", "documents missing", ACTOR_ID);
    expect(result).toEqual({ id: "task-1", status: "blocked" });
  });

  it("404s when the task does not exist", async () => {
    dbExecute.mockResolvedValueOnce([[], []]);
    await expect(decideDerivedItem("exit_clearance_task", "missing", "approve", "", ACTOR_ID))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it("403s when the task's employee is outside the actor's scope", async () => {
    dbExecute.mockResolvedValueOnce([[{ exit_request_id: "exit-1", employee_id: "emp-1" }], []]);
    canViewEmployee.mockResolvedValue(false);
    await expect(decideDerivedItem("exit_clearance_task", "task-1", "approve", "", ACTOR_ID))
      .rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("decideDerivedItem — candidate_bgv_check", () => {
  it("approve dispatches to manualReview with status='verified'", async () => {
    dbExecute.mockResolvedValueOnce([[{ candidate_id: "cand-1", check_type: "pan" }], []]);
    await decideDerivedItem("candidate_bgv_check", "check-1", "approve", "matches", ACTOR_ID);
    expect(manualReview).toHaveBeenCalledWith(
      "cand-1",
      { checkId: "check-1", status: "verified", remarks: "matches" },
      ACTOR_ID,
    );
  });

  it("reject dispatches to manualReview with status='failed'", async () => {
    dbExecute.mockResolvedValueOnce([[{ candidate_id: "cand-1", check_type: "pan" }], []]);
    await decideDerivedItem("candidate_bgv_check", "check-1", "reject", "name mismatch", ACTOR_ID);
    expect(manualReview).toHaveBeenCalledWith(
      "cand-1",
      { checkId: "check-1", status: "failed", remarks: "name mismatch" },
      ACTOR_ID,
    );
  });

  it("403s when the actor holds none of the BGV-eligible roles", async () => {
    hasAnyRole.mockResolvedValue(false);
    await expect(decideDerivedItem("candidate_bgv_check", "check-1", "approve", "", ACTOR_ID))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(manualReview).not.toHaveBeenCalled();
  });
});

describe("getDerivedItemDetail", () => {
  it("leave_request: 404 when the request does not exist, checked before the scope 403", async () => {
    canReviewLeave.mockResolvedValue(false);
    dbExecute.mockResolvedValueOnce([[], []]); // the "does it exist at all" check
    await expect(getDerivedItemDetail("leave_request", "missing", ACTOR_ID))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it("exit_clearance_task: returns the joined record when in scope", async () => {
    dbExecute.mockResolvedValueOnce([[{ id: "task-1", employee_id: "emp-1", exit_type: "voluntary" }], []]);
    const detail = await getDerivedItemDetail("exit_clearance_task", "task-1", ACTOR_ID);
    expect(detail).toMatchObject({ id: "task-1", exit_type: "voluntary" });
  });
});
