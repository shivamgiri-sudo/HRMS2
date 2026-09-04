import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A Branch Head approval no longer runs inside the HTTP request.
 *
 * Approving applies every row through its domain engine — reviewRegularization alone
 * opens a transaction and runs ~8 queries per row — so a 217-row batch took minutes.
 * That exceeded nginx's 60s proxy_read_timeout, and the approver was shown a 502 Bad
 * Gateway while the server carried on applying rows perfectly well. The rows landed;
 * only the answer was lost, and the batch stayed claimed in 'approving' with nothing
 * left to tell the queue how it ended.
 *
 * The route now validates, claims, answers 202 and runs the decision in the
 * background, and the page polls /approvals/batches/:id/job-status for the outcome.
 * These tests pin that: the answer is immediate, the work still happens, a failure
 * still releases the claim, and the result is readable afterwards.
 */

const BATCH_ID = "batch-1";
const ACTOR = "approver-1";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: ACTOR }; next(); },
}));
vi.mock("../../../shared/scopeAccess.js", () => ({
  hasAnyRole: vi.fn().mockResolvedValue(true),
  getUserAssignmentScopes: vi.fn().mockResolvedValue([{ scope_type: "all" }]),
}));

const batch = {
  id: BATCH_ID,
  upload_batch_no: "BATCH-9",
  upload_type_code: "ATTENDANCE_REGULARIZATION_BULK",
  batch_status: "pending_approval",
  approval_status: "pending_branch_head",
  branch_id: "branch-1",
  uploaded_by: "uploader-1",
  total_rows: 217,
  imported_rows: 217,
  error_summary: null as string | null,
};

const {
  getBatch, assertCanApprove, markDecided, markStageDecided, markStageRejected,
  claimForDecision, releaseClaim, releaseStuckClaim, auditBatchAction, sendPartialApplyEmail,
} = vi.hoisted(() => ({
  getBatch: vi.fn(),
  assertCanApprove: vi.fn(),
  markDecided: vi.fn(),
  markStageDecided: vi.fn().mockResolvedValue(true),
  markStageRejected: vi.fn().mockResolvedValue(true),
  claimForDecision: vi.fn(),
  releaseClaim: vi.fn(),
  releaseStuckClaim: vi.fn(),
  auditBatchAction: vi.fn(),
  sendPartialApplyEmail: vi.fn(),
}));

// The stage machine is mocked with its REAL shape rather than stubbed, because the route
// reads STAGE_RULES[stage].from to place its claim and its optimistic guard — a stub that
// returned a bare object would let a broken guard pass these tests.
const STAGE_RULES = {
  branch: { from: "pending_branch_head", to: "pending_payroll_head", roles: ["branch_head"], label: "Branch Head", applies: false },
  payroll: { from: "pending_payroll_head", to: "approved", roles: ["payroll_head"], label: "Payroll Head", applies: true },
};
const TWO_STAGE_TYPES = new Set(["INCENTIVE_BULK", "DEDUCTION_BULK"]);

vi.mock("../bulk-approval.service.js", () => ({
  APPROVAL_GATED_TYPES: new Set([
    "ATTENDANCE_REGULARIZATION_BULK", "LEAVE_APPLICATION_BULK",
    "INCENTIVE_BULK", "DEDUCTION_BULK",
  ]),
  APPROVER_ROLES: ["branch_head"],
  PAYROLL_APPROVER_ROLES: ["payroll_head"],
  TWO_STAGE_TYPES,
  STAGE_RULES,
  resolveStage: (b: { approval_status: string | null }) =>
    b.approval_status === "pending_branch_head" ? "branch"
      : b.approval_status === "pending_payroll_head" ? "payroll"
        : null,
  stageOutcome: (stage: "branch" | "payroll", typeCode: string) =>
    stage === "branch" && !TWO_STAGE_TYPES.has(typeCode)
      ? { next: "approved", applies: true }
      : { next: STAGE_RULES[stage].to, applies: STAGE_RULES[stage].applies },
  // A real class: the route's error handler branches on `instanceof`.
  BulkUploadError: class BulkUploadError extends Error {
    statusCode: number;
    constructor(message: string, statusCode = 400) { super(message); this.statusCode = statusCode; }
  },
  getBatch, assertCanApprove, markDecided, markStageDecided, markStageRejected,
  claimForDecision, releaseClaim, releaseStuckClaim, auditBatchAction, sendPartialApplyEmail,
  // Present only so the route's named import resolves under vi.mock — see the same
  // note in bulk-approval-two-stage.contract.test.ts.
  verifyRowsActuallyApplied: vi.fn().mockResolvedValue({ checked: 0, confirmed: 0, mismatched: 0 }),
}));

// Collaborators the two-stage chain added. None of them may influence the decision path,
// so they are stubbed to no-ops here and asserted properly in the two-stage suite.
vi.mock("../bulk-approval-review.service.js", () => ({
  getBatchReview: vi.fn(), getBatchEmployees: vi.fn(), discardRows: vi.fn(),
  isReviewable: (t: string) => t === "INCENTIVE_BULK" || t === "DEDUCTION_BULK",
  BATCH_ENTITY_TYPE: "bulk_upload_batch",
}));
vi.mock("../bulk-approval-notify.service.js", () => ({ notifyBatchCreator: vi.fn().mockResolvedValue({}) }));
vi.mock("../../work-inbox/work-inbox.triggers.js", () => ({ triggerBulkBatchApproval: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../../shared/financeApprovalEvent.js", () => ({
  recordFinanceApprovalEvent: vi.fn().mockResolvedValue(undefined),
  listFinanceApprovalEvents: vi.fn().mockResolvedValue([]),
}));

const { applyRegularizationBatch } = vi.hoisted(() => ({ applyRegularizationBatch: vi.fn() }));
vi.mock("../attendance-regularization-bulk.service.js", () => ({
  applyRegularizationBatch,
  rejectRegularizationBatch: vi.fn(),
}));
vi.mock("../leave-application-bulk.service.js", () => ({ applyLeaveBatch: vi.fn(), rejectLeaveBatch: vi.fn() }));
vi.mock("../incentive-bulk.service.js", () => ({ applyIncentiveBatch: vi.fn(), rejectIncentiveBatch: vi.fn() }));
vi.mock("../deduction-bulk.service.js", () => ({ applyDeductionBatch: vi.fn(), rejectDeductionBatch: vi.fn() }));

const { bulkApprovalRouter } = await import("../bulk-approval.routes.js");

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/bulk-upload", bulkApprovalRouter);
  return a;
}

beforeEach(() => {
  batch.batch_status = "pending_approval";
  batch.approval_status = "pending_branch_head";
  getBatch.mockReset().mockImplementation(async () => ({ ...batch }));
  assertCanApprove.mockReset().mockResolvedValue(undefined);
  markDecided.mockReset().mockResolvedValue(undefined);
  claimForDecision.mockReset().mockResolvedValue(true);
  releaseClaim.mockReset().mockResolvedValue(undefined);
  auditBatchAction.mockReset().mockResolvedValue(undefined);
  applyRegularizationBatch.mockReset().mockResolvedValue({ applied: 217, failed: 0, errors: [] });

  // Route the progress/approver queries by SQL rather than by call order, so the
  // tests do not have to know how many statements each path issues.
  execute.mockReset().mockImplementation(async (sql: string) => {
    if (/FROM bulk_upload_locked_entity/.test(sql)) return [[{ n: 217 }], []];
    if (/FROM upload_batch_row/.test(sql)) return [[{ total: 217, failed: 0, succeeded: 217 }], []];
    return [[{ display: "Branch Head" }], []];
  });
});

describe("POST /approvals/batches/:id/approve", () => {
  it("answers 202 immediately and applies the rows afterwards", async () => {
    const res = await request(app())
      .post(`/api/bulk-upload/approvals/batches/${BATCH_ID}/approve`)
      .send({ remarks: "Checked against the branch register" });

    expect(res.status).toBe(202);
    expect(res.body.processing).toBe(true);
    expect(res.body.total_rows).toBe(217);

    // Claimed before the answer — a retry must not be able to apply the batch twice.
    // Claimed against the stage the batch is ON, not just its id. Without the second
    // argument a stage-2 approval could claim a batch still sitting at stage 1.
    expect(claimForDecision).toHaveBeenCalledWith(BATCH_ID, "pending_branch_head");

    await vi.waitFor(() => expect(applyRegularizationBatch).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(markDecided).toHaveBeenCalledWith(
        BATCH_ID, "approved", ACTOR, expect.any(String), expect.stringContaining("217 row(s) applied"),
      ),
    );
  });

  it("still refuses a batch that is already being decided, before starting any work", async () => {
    claimForDecision.mockResolvedValue(false);

    const res = await request(app())
      .post(`/api/bulk-upload/approvals/batches/${BATCH_ID}/approve`)
      .send({ remarks: "" });

    expect(res.status).toBe(409);
    expect(applyRegularizationBatch).not.toHaveBeenCalled();
  });

  it("releases the claim when the decision fails, instead of leaving the batch stuck", async () => {
    applyRegularizationBatch.mockRejectedValue(new Error("connection lost"));

    // The request is answered before the failure happens, so the claim release is
    // the only thing that can put the batch back in the queue.
    const res = await request(app())
      .post(`/api/bulk-upload/approvals/batches/${BATCH_ID}/approve`)
      .send({ remarks: "" });
    expect(res.status).toBe(202);

    await vi.waitFor(() => expect(releaseClaim).toHaveBeenCalledWith(BATCH_ID));
    expect(markDecided).not.toHaveBeenCalled();
  });

  it("keeps rejecting a rejection with no usable remark", async () => {
    const res = await request(app())
      .post(`/api/bulk-upload/approvals/batches/${BATCH_ID}/reject`)
      .send({ remarks: "too short" });

    expect(res.status).toBe(400);
    expect(claimForDecision).not.toHaveBeenCalled();
  });
});

describe("GET /approvals/batches/:id/job-status", () => {
  it("reports progress while the decision is running", async () => {
    batch.batch_status = "approving";
    execute.mockImplementation(async (sql: string) => {
      if (/FROM bulk_upload_locked_entity/.test(sql)) return [[{ n: 128 }], []];
      if (/FROM upload_batch_row/.test(sql)) return [[{ total: 217, failed: 0 }], []];
      return [[], []];
    });

    const res = await request(app()).get(`/api/bulk-upload/approvals/batches/${BATCH_ID}/job-status`);

    expect(res.status).toBe(200);
    expect(res.body.phase).toBe("running");
    expect(res.body.progress).toMatchObject({ total: 217, processed: 128, succeeded: 128 });
  });

  it("reports the outcome once the batch has been decided", async () => {
    batch.batch_status = "imported";
    batch.approval_status = "approved";

    const res = await request(app()).get(`/api/bulk-upload/approvals/batches/${BATCH_ID}/job-status`);

    expect(res.status).toBe(200);
    expect(res.body.phase).toBe("done");
    expect(res.body.approval_status).toBe("approved");
  });

  /**
   * Polling deliberately uses the LOOSER check, not assertCanApprove.
   *
   * With two stages, the Branch Head who released a batch at stage 1 can no longer
   * approve it — but they must still be able to watch stage 2 finish, and so must the
   * person who uploaded it. Gating the poll on the stage-specific approval check would
   * blank the progress bar for both of them the moment the batch moved on. A caller who
   * is neither an approver nor the uploader still gets 403, which is what this pins.
   */
  it("still refuses a caller who is neither an approver nor the uploader", async () => {
    const { hasAnyRole } = await import("../../../shared/scopeAccess.js");
    (hasAnyRole as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const res = await request(app()).get(`/api/bulk-upload/approvals/batches/${BATCH_ID}/job-status`);

    expect(res.status).toBe(403);
  });

  it("lets the Branch Head who released it keep watching after it moves to stage 2", async () => {
    getBatch.mockResolvedValue({ ...batch, approval_status: "pending_payroll_head" });
    // Holds branch_head only — assertCanApprove for the payroll stage would refuse them.
    const { hasAnyRole } = await import("../../../shared/scopeAccess.js");
    (hasAnyRole as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const res = await request(app()).get(`/api/bulk-upload/approvals/batches/${BATCH_ID}/job-status`);

    expect(res.status).toBe(200);
  });
});
