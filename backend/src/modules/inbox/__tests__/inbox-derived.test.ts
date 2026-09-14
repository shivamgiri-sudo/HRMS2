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

const { assertFinanceRecordBranch } = vi.hoisted(() => ({ assertFinanceRecordBranch: vi.fn() }));
vi.mock("../../finance/finance-access-scope.js", () => ({ assertFinanceRecordBranch }));

const { resolveFinanceStageRole } = vi.hoisted(() => ({ resolveFinanceStageRole: vi.fn() }));
vi.mock("../../finance/finance-workflow-role.js", () => ({ resolveFinanceStageRole }));

const { getGrn, reviewGrn } = vi.hoisted(() => ({ getGrn: vi.fn(), reviewGrn: vi.fn() }));
vi.mock("../../finance/grn.service.js", () => ({ grnService: { getGrn, reviewGrn } }));

const { getBudget, reviewBudget } = vi.hoisted(() => ({ getBudget: vi.fn(), reviewBudget: vi.fn() }));
vi.mock("../../process-pnl/branch-budget.service.js", () => ({ branchBudgetService: { get: getBudget, review: reviewBudget } }));

const { decideDerivedItem, getDerivedItemDetail } = await import("../inbox-derived.service.js");

const ACTOR_ID = "actor-1";

/** dbExecute is shared across every branch — route by the query's own SQL text, matching
 * this codebase's established test convention (see resignation-fsm.test.ts). */
function mockActorRoles(roles: string[]) {
  dbExecute.mockImplementation((sql: string) => {
    if (String(sql).includes("FROM user_roles")) {
      return Promise.resolve([roles.map((role_key) => ({ role_key })), []]);
    }
    return Promise.resolve([[], []]);
  });
}

beforeEach(() => {
  dbExecute.mockReset();
  hasAnyRole.mockReset().mockResolvedValue(true);
  assertFinanceRecordBranch.mockReset().mockResolvedValue(undefined);
  resolveFinanceStageRole.mockReset().mockReturnValue("branch_head");
  getGrn.mockReset();
  reviewGrn.mockReset().mockResolvedValue({ status: "branch_head_approved" });
  getBudget.mockReset();
  reviewBudget.mockReset().mockResolvedValue({ status: "branch_head_approved" });
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

describe("decideDerivedItem — grn_request", () => {
  it("approve resolves branch scope + stage role, then dispatches to the real grnService.reviewGrn", async () => {
    getGrn.mockResolvedValue({ branch_id: "branch-1", status: "submitted" });
    mockActorRoles(["branch_head"]);
    resolveFinanceStageRole.mockReturnValue("branch_head");

    const result = await decideDerivedItem("grn_request", "grn-1", "approve", "looks correct", ACTOR_ID);

    expect(assertFinanceRecordBranch).toHaveBeenCalledWith({
      userId: ACTOR_ID, primaryRole: "branch_head", userRoles: ["branch_head"], recordBranchId: "branch-1",
    });
    expect(resolveFinanceStageRole).toHaveBeenCalledWith({
      primaryRole: "branch_head", userRoles: ["branch_head"], currentStatus: "submitted", workflow: "grn",
    });
    expect(reviewGrn).toHaveBeenCalledWith(
      "grn-1",
      { decision: "approved", reviewNote: "looks correct" },
      ACTOR_ID,
      "branch_head",
    );
    expect(result).toEqual({ status: "branch_head_approved" });
  });

  it("reject passes decision='rejected' with the mandatory reviewNote", async () => {
    getGrn.mockResolvedValue({ branch_id: "branch-1", status: "branch_head_approved" });
    mockActorRoles(["finance_head"]);

    await decideDerivedItem("grn_request", "grn-1", "reject", "amount mismatch", ACTOR_ID);

    expect(reviewGrn).toHaveBeenCalledWith(
      "grn-1",
      { decision: "rejected", reviewNote: "amount mismatch" },
      ACTOR_ID,
      "branch_head",
    );
  });

  it("404s when the GRN does not exist, and never touches scope or review", async () => {
    getGrn.mockResolvedValue(undefined);
    await expect(decideDerivedItem("grn_request", "missing", "approve", "", ACTOR_ID))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(assertFinanceRecordBranch).not.toHaveBeenCalled();
    expect(reviewGrn).not.toHaveBeenCalled();
  });

  it("wraps a getGrn throw as a 404 rather than a generic 500", async () => {
    getGrn.mockRejectedValue(new Error("GRN not found"));
    await expect(decideDerivedItem("grn_request", "missing", "approve", "", ACTOR_ID))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it("403s when assertFinanceRecordBranch rejects the actor's branch, and never calls reviewGrn", async () => {
    getGrn.mockResolvedValue({ branch_id: "branch-9", status: "submitted" });
    mockActorRoles(["branch_head"]);
    assertFinanceRecordBranch.mockRejectedValue(new Error("Outside your branch scope"));
    await expect(decideDerivedItem("grn_request", "grn-1", "approve", "", ACTOR_ID))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(reviewGrn).not.toHaveBeenCalled();
  });

  it("wraps a reviewGrn rejection (e.g. wrong stage) as a 400", async () => {
    getGrn.mockResolvedValue({ branch_id: "branch-1", status: "submitted" });
    mockActorRoles(["branch_head"]);
    reviewGrn.mockRejectedValue(new Error("GRN is not awaiting this stage"));
    await expect(decideDerivedItem("grn_request", "grn-1", "approve", "", ACTOR_ID))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("decideDerivedItem — finance_budget_header", () => {
  it("approve resolves branch scope + stage role, then dispatches to the real branchBudgetService.review", async () => {
    getBudget.mockResolvedValue({ branch_id: "branch-2", status: "submitted" });
    mockActorRoles(["branch_head"]);
    resolveFinanceStageRole.mockReturnValue("branch_head");

    const result = await decideDerivedItem("finance_budget_header", "budget-1", "approve", "approved as planned", ACTOR_ID);

    expect(assertFinanceRecordBranch).toHaveBeenCalledWith({
      userId: ACTOR_ID, primaryRole: "branch_head", userRoles: ["branch_head"], recordBranchId: "branch-2",
    });
    expect(resolveFinanceStageRole).toHaveBeenCalledWith({
      primaryRole: "branch_head", userRoles: ["branch_head"], currentStatus: "submitted", workflow: "budget",
    });
    expect(reviewBudget).toHaveBeenCalledWith("budget-1", "approve", ACTOR_ID, "branch_head", "approved as planned");
    expect(result).toEqual({ status: "branch_head_approved" });
  });

  it("reject passes action='reject' with the mandatory remarks", async () => {
    getBudget.mockResolvedValue({ branch_id: "branch-2", status: "branch_head_approved" });
    mockActorRoles(["finance_head"]);

    await decideDerivedItem("finance_budget_header", "budget-1", "reject", "over allocation", ACTOR_ID);

    expect(reviewBudget).toHaveBeenCalledWith("budget-1", "reject", ACTOR_ID, "branch_head", "over allocation");
  });

  it("404s when the budget does not exist, and never touches scope or review", async () => {
    getBudget.mockResolvedValue(undefined);
    await expect(decideDerivedItem("finance_budget_header", "missing", "approve", "", ACTOR_ID))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(assertFinanceRecordBranch).not.toHaveBeenCalled();
    expect(reviewBudget).not.toHaveBeenCalled();
  });

  it("403s when assertFinanceRecordBranch rejects the actor's branch, and never calls review", async () => {
    getBudget.mockResolvedValue({ branch_id: "branch-9", status: "submitted" });
    mockActorRoles(["branch_head"]);
    assertFinanceRecordBranch.mockRejectedValue(new Error("Outside your branch scope"));
    await expect(decideDerivedItem("finance_budget_header", "budget-1", "approve", "", ACTOR_ID))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(reviewBudget).not.toHaveBeenCalled();
  });

  it("wraps a review rejection (e.g. wrong stage) as a 400", async () => {
    getBudget.mockResolvedValue({ branch_id: "branch-2", status: "submitted" });
    mockActorRoles(["branch_head"]);
    reviewBudget.mockRejectedValue(new Error("Budget is not awaiting this stage"));
    await expect(decideDerivedItem("finance_budget_header", "budget-1", "approve", "", ACTOR_ID))
      .rejects.toMatchObject({ statusCode: 400 });
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

  it("grn_request: returns the real GRN record (read-only — no reviewGrn call) when in scope", async () => {
    getGrn.mockResolvedValue({ id: "grn-1", branch_id: "branch-1", status: "submitted", grn_number: "GRN-0001" });
    mockActorRoles(["branch_head"]);
    const detail = await getDerivedItemDetail("grn_request", "grn-1", ACTOR_ID);
    expect(assertFinanceRecordBranch).toHaveBeenCalledWith({
      userId: ACTOR_ID, primaryRole: "branch_head", userRoles: ["branch_head"], recordBranchId: "branch-1",
    });
    expect(detail).toMatchObject({ id: "grn-1", grn_number: "GRN-0001" });
    expect(reviewGrn).not.toHaveBeenCalled();
  });

  it("grn_request: 404 when the GRN does not exist", async () => {
    getGrn.mockResolvedValue(undefined);
    await expect(getDerivedItemDetail("grn_request", "missing", ACTOR_ID))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it("grn_request: 403 when the GRN's branch is outside the actor's scope", async () => {
    getGrn.mockResolvedValue({ id: "grn-1", branch_id: "branch-9", status: "submitted" });
    mockActorRoles(["branch_head"]);
    assertFinanceRecordBranch.mockRejectedValue(new Error("Outside your branch scope"));
    await expect(getDerivedItemDetail("grn_request", "grn-1", ACTOR_ID))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it("finance_budget_header: returns the real budget record (read-only — no review call) when in scope", async () => {
    getBudget.mockResolvedValue({ id: "budget-1", branch_id: "branch-2", status: "submitted", budget_number: "BUD-0001" });
    mockActorRoles(["branch_head"]);
    const detail = await getDerivedItemDetail("finance_budget_header", "budget-1", ACTOR_ID);
    expect(assertFinanceRecordBranch).toHaveBeenCalledWith({
      userId: ACTOR_ID, primaryRole: "branch_head", userRoles: ["branch_head"], recordBranchId: "branch-2",
    });
    expect(detail).toMatchObject({ id: "budget-1", budget_number: "BUD-0001" });
    expect(reviewBudget).not.toHaveBeenCalled();
  });

  it("finance_budget_header: 404 when the budget does not exist", async () => {
    getBudget.mockResolvedValue(undefined);
    await expect(getDerivedItemDetail("finance_budget_header", "missing", ACTOR_ID))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it("finance_budget_header: 403 when the budget's branch is outside the actor's scope", async () => {
    getBudget.mockResolvedValue({ id: "budget-1", branch_id: "branch-9", status: "submitted" });
    mockActorRoles(["branch_head"]);
    assertFinanceRecordBranch.mockRejectedValue(new Error("Outside your branch scope"));
    await expect(getDerivedItemDetail("finance_budget_header", "budget-1", ACTOR_ID))
      .rejects.toMatchObject({ statusCode: 403 });
  });
});
