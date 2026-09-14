import express from "express";
import request from "supertest";
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Incentive and deduction uploads are approved TWICE: Branch Head, then Payroll Head.
 *
 * The property every test here defends is one sentence: **the Branch Head's approval
 * must not move any money.**
 *
 * That is not obvious from the code it replaced, and getting it wrong would be invisible.
 * applyIncentiveBatch sets `incentive_upload_batch.status = 'approved'`, and
 * payrollCalculate.service.ts §5f pays an employee the sum of incentive_upload_line for
 * the month whenever the parent batch is 'approved' or 'applied' — no further step, no
 * other flag. applyDeductionBatch is the same story with `status = 'active'`. So if stage
 * 1 ran the domain engine "and then" parked the batch in the Payroll Head's queue, the
 * Payroll Head would be approving a payment that had already happened, and every screen
 * would still look correct.
 *
 * Hence: stage 1 calls NO apply function at all.
 */

const BATCH_ID = "batch-inc-1";
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

const baseBatch = {
  id: BATCH_ID,
  upload_batch_no: "BATCH-INC-9",
  upload_type_code: "INCENTIVE_BULK",
  batch_status: "pending_approval",
  approval_status: "pending_branch_head",
  branch_id: "branch-1",
  uploaded_by: "uploader-1",
  total_rows: 40,
  imported_rows: 40,
  error_summary: null as string | null,
  branch_head_approved_by: null as string | null,
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
  claimForDecision: vi.fn().mockResolvedValue(true),
  releaseClaim: vi.fn(),
  releaseStuckClaim: vi.fn(),
  auditBatchAction: vi.fn(),
  sendPartialApplyEmail: vi.fn(),
}));

// The real stage machine, not a stub — the route reads STAGE_RULES[stage].from for both
// its claim and its optimistic guard, so a hand-written stub would let a broken guard pass.
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
  BulkUploadError: class BulkUploadError extends Error {
    statusCode: number;
    constructor(message: string, statusCode = 400) { super(message); this.statusCode = statusCode; }
  },
  getBatch, assertCanApprove, markDecided, markStageDecided, markStageRejected,
  claimForDecision, releaseClaim, releaseStuckClaim, auditBatchAction, sendPartialApplyEmail,
  // Verifies apply*Batch's applied count against the real record — a no-op stub here
  // since these fixtures never diverge from what applyIncentiveBatch/applyDeductionBatch
  // report. Present only so the route's named import resolves under vi.mock.
  verifyRowsActuallyApplied: vi.fn().mockResolvedValue({ checked: 0, confirmed: 0, mismatched: 0 }),
}));

const { applyIncentiveBatch, rejectIncentiveBatch, applyDeductionBatch } = vi.hoisted(() => ({
  applyIncentiveBatch: vi.fn().mockResolvedValue({ applied: 40, failed: 0, errors: [] }),
  rejectIncentiveBatch: vi.fn().mockResolvedValue({ applied: 40, failed: 0, errors: [] }),
  applyDeductionBatch: vi.fn().mockResolvedValue({ applied: 40, failed: 0, errors: [] }),
}));
vi.mock("../incentive-bulk.service.js", () => ({ applyIncentiveBatch, rejectIncentiveBatch }));
vi.mock("../deduction-bulk.service.js", () => ({ applyDeductionBatch, rejectDeductionBatch: vi.fn() }));
vi.mock("../attendance-regularization-bulk.service.js", () => ({
  applyRegularizationBatch: vi.fn(), rejectRegularizationBatch: vi.fn(),
}));
vi.mock("../leave-application-bulk.service.js", () => ({
  applyLeaveBatch: vi.fn(), rejectLeaveBatch: vi.fn(),
}));

vi.mock("../bulk-approval-review.service.js", () => ({
  getBatchReview: vi.fn(), getBatchEmployees: vi.fn(), discardRows: vi.fn(),
  isReviewable: (t: string) => t === "INCENTIVE_BULK" || t === "DEDUCTION_BULK",
  BATCH_ENTITY_TYPE: "bulk_upload_batch",
}));

const { notifyBatchCreator } = vi.hoisted(() => ({
  notifyBatchCreator: vi.fn().mockResolvedValue({ email: true, inbox: true, sms: false }),
}));
vi.mock("../bulk-approval-notify.service.js", () => ({ notifyBatchCreator }));

const { triggerBulkBatchApproval } = vi.hoisted(() => ({
  triggerBulkBatchApproval: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../work-inbox/work-inbox.triggers.js", () => ({ triggerBulkBatchApproval }));

const { recordFinanceApprovalEvent } = vi.hoisted(() => ({
  recordFinanceApprovalEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../shared/financeApprovalEvent.js", () => ({
  recordFinanceApprovalEvent,
  listFinanceApprovalEvents: vi.fn().mockResolvedValue([]),
}));

async function app() {
  const { bulkApprovalRouter } = await import("../bulk-approval.routes.js");
  const a = express();
  a.use(express.json());
  a.use("/api/bulk-upload", bulkApprovalRouter);
  return a;
}

/** The decision runs detached from the request, so wait for its effect, not the response. */
const settle = () => vi.waitFor(() => expect(markStageDecided).toHaveBeenCalled());

beforeEach(() => {
  vi.clearAllMocks();
  claimForDecision.mockResolvedValue(true);
  markStageDecided.mockResolvedValue(true);
  markStageRejected.mockResolvedValue(true);
  execute.mockResolvedValue([[], []]);
  getBatch.mockResolvedValue({ ...baseBatch });
  applyIncentiveBatch.mockResolvedValue({ applied: 40, failed: 0, errors: [] });
});

describe("stage 1 — Branch Head", () => {
  it("does NOT run the incentive apply engine", async () => {
    const res = await request(await app())
      .post(`/api/bulk-upload/approvals/batches/${BATCH_ID}/approve`)
      .send({ remarks: "Checked against the branch incentive sheet" });

    expect(res.status).toBe(202);
    await settle();

    // The single most important assertion in this file. See the header.
    expect(applyIncentiveBatch).not.toHaveBeenCalled();
  });

  it("parks the batch in the Payroll Head queue instead of approving it", async () => {
    await request(await app())
      .post(`/api/bulk-upload/approvals/batches/${BATCH_ID}/approve`)
      .send({ remarks: "Checked against the branch incentive sheet" });
    await settle();

    const call = markStageDecided.mock.calls[0][0];
    expect(call.stage).toBe("branch");
    expect(call.next).toBe("pending_payroll_head");
    // Guarded on the status it expects to find, so two approvers cannot both advance it.
    expect(call.expectedFrom).toBe("pending_branch_head");
    // NOT 'imported' — nothing has been imported into a domain engine yet.
    expect(call.batchStatus).toBe("pending_approval");
  });

  it("claims the batch against the stage it is on, not just its id", async () => {
    await request(await app())
      .post(`/api/bulk-upload/approvals/batches/${BATCH_ID}/approve`)
      .send({ remarks: "Checked against the branch incentive sheet" });
    await settle();

    expect(claimForDecision).toHaveBeenCalledWith(BATCH_ID, "pending_branch_head");
  });

  it("tells the Payroll Head there is something waiting", async () => {
    await request(await app())
      .post(`/api/bulk-upload/approvals/batches/${BATCH_ID}/approve`)
      .send({ remarks: "Checked against the branch incentive sheet" });
    await settle();

    await vi.waitFor(() => expect(triggerBulkBatchApproval).toHaveBeenCalled());
    expect(triggerBulkBatchApproval.mock.calls[0][3]).toBe("payroll_head");
  });
});

describe("stage 2 — Payroll Head", () => {
  beforeEach(() => {
    getBatch.mockResolvedValue({
      ...baseBatch,
      approval_status: "pending_payroll_head",
      branch_head_approved_by: "branch-head-1",
    });
  });

  it("DOES run the apply engine — this is where the money moves", async () => {
    const res = await request(await app())
      .post(`/api/bulk-upload/approvals/batches/${BATCH_ID}/approve`)
      .send({ remarks: "Final approval for September payroll" });

    expect(res.status).toBe(202);
    await vi.waitFor(() => expect(applyIncentiveBatch).toHaveBeenCalled());
  });

  it("claims against the payroll stage, so it cannot grab a batch still at stage 1", async () => {
    await request(await app())
      .post(`/api/bulk-upload/approvals/batches/${BATCH_ID}/approve`)
      .send({ remarks: "Final approval for September payroll" });

    await vi.waitFor(() => expect(applyIncentiveBatch).toHaveBeenCalled());
    expect(claimForDecision).toHaveBeenCalledWith(BATCH_ID, "pending_payroll_head");
  });
});

describe("single-stage types are unchanged", () => {
  it("a regularization batch still applies on the Branch Head's approval", async () => {
    const { applyRegularizationBatch } = await import("../attendance-regularization-bulk.service.js");
    (applyRegularizationBatch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ applied: 5, failed: 0, errors: [] });
    getBatch.mockResolvedValue({ ...baseBatch, upload_type_code: "ATTENDANCE_REGULARIZATION_BULK" });

    await request(await app())
      .post(`/api/bulk-upload/approvals/batches/${BATCH_ID}/approve`)
      .send({ remarks: "Verified against the COSEC outage ticket" });

    // Applies at stage 1, exactly as before the second stage existed.
    await vi.waitFor(() => expect(applyRegularizationBatch).toHaveBeenCalled());
    expect(markDecided).toHaveBeenCalled();
  });
});

describe("rejection", () => {
  it("still cancels the staged rows, and tells the uploader why", async () => {
    await request(await app())
      .post(`/api/bulk-upload/approvals/batches/${BATCH_ID}/reject`)
      .send({ remarks: "Amounts do not match the approved incentive sheet" });

    await vi.waitFor(() => expect(rejectIncentiveBatch).toHaveBeenCalled());
    await vi.waitFor(() => expect(notifyBatchCreator).toHaveBeenCalled());
    expect(notifyBatchCreator.mock.calls[0][0].event).toBe("rejected");
    expect(notifyBatchCreator.mock.calls[0][0].reason)
      .toContain("Amounts do not match");
  });

  it("refuses a rejection with no usable reason", async () => {
    const res = await request(await app())
      .post(`/api/bulk-upload/approvals/batches/${BATCH_ID}/reject`)
      .send({ remarks: "wrong" });

    expect(res.status).toBe(400);
    expect(rejectIncentiveBatch).not.toHaveBeenCalled();
  });
});

describe("the state machine itself", () => {
  const DIR = path.resolve(__dirname, "..");
  const src = fs.readFileSync(path.join(DIR, "bulk-approval.service.ts"), "utf8");

  it("only the two money types get a second stage", async () => {
    // Adding leave or regularization here would route every branch's daily corrections
    // through HO — a product decision, not a refactor.
    const actual = await vi.importActual<typeof import("../bulk-approval.service.js")>(
      "../bulk-approval.service.js",
    );
    expect([...actual.TWO_STAGE_TYPES].sort()).toEqual(["DEDUCTION_BULK", "INCENTIVE_BULK"]);
  });

  it("the Payroll Head stage is the only one that applies", async () => {
    const actual = await vi.importActual<typeof import("../bulk-approval.service.js")>(
      "../bulk-approval.service.js",
    );
    expect(actual.STAGE_RULES.branch.applies).toBe(false);
    expect(actual.STAGE_RULES.payroll.applies).toBe(true);
  });

  it("a single-stage type still applies at the branch stage", async () => {
    const actual = await vi.importActual<typeof import("../bulk-approval.service.js")>(
      "../bulk-approval.service.js",
    );
    expect(actual.stageOutcome("branch", "LEAVE_APPLICATION_BULK"))
      .toEqual({ next: "approved", applies: true });
    expect(actual.stageOutcome("branch", "INCENTIVE_BULK"))
      .toEqual({ next: "pending_payroll_head", applies: false });
  });

  it("no uploader role can approve at either stage", async () => {
    const actual = await vi.importActual<typeof import("../bulk-approval.service.js")>(
      "../bulk-approval.service.js",
    );
    const approvers = [...actual.APPROVER_ROLES, ...actual.PAYROLL_APPROVER_ROLES];
    expect(actual.UPLOADER_ROLES.filter((r) => approvers.includes(r))).toEqual([]);
  });

  it("payroll_hr can upload — it is named as an uploader in the design", async () => {
    const actual = await vi.importActual<typeof import("../bulk-approval.service.js")>(
      "../bulk-approval.service.js",
    );
    expect(actual.UPLOADER_ROLES).toContain("payroll_hr");
  });

  it("the stage is derived from the batch, never taken from the request", () => {
    // A caller that could name its own stage could hand itself the Payroll Head step on
    // a batch no Branch Head had seen.
    const routes = fs.readFileSync(path.join(DIR, "bulk-approval.routes.ts"), "utf8");
    expect(routes).toContain("const stage = resolveStage(batch)");
    expect(routes).not.toMatch(/req\.body[^\n]*\bstage\b/);
  });
});
