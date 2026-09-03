/**
 * Branch Head approval queue for the four approval-gated bulk uploads.
 *
 * Mounted on the same /api/bulk-upload base as bulkUploadRouter and BEFORE it, so a
 * more specific path here is never shadowed by a looser one there.
 */
import { Router, type NextFunction, type Response } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { hasAnyRole, getUserAssignmentScopes } from "../../shared/scopeAccess.js";
import {
  APPROVAL_GATED_TYPES, APPROVER_ROLES, PAYROLL_APPROVER_ROLES, TWO_STAGE_TYPES,
  STAGE_RULES, BulkUploadError,
  getBatch, assertCanApprove, markDecided, markStageDecided, markStageRejected,
  claimForDecision, releaseClaim, releaseStuckClaim, auditBatchAction,
  sendPartialApplyEmail, resolveStage, stageOutcome,
  type ApprovalStage, type BulkApprovalStatus,
} from "./bulk-approval.service.js";
import {
  getBatchReview, getBatchEmployees, discardRows, isReviewable,
  BATCH_ENTITY_TYPE,
} from "./bulk-approval-review.service.js";
import { notifyBatchCreator } from "./bulk-approval-notify.service.js";
import { triggerBulkBatchApproval } from "../work-inbox/work-inbox.triggers.js";
import { recordFinanceApprovalEvent, listFinanceApprovalEvents } from "../../shared/financeApprovalEvent.js";
import { applyRegularizationBatch, rejectRegularizationBatch } from "./attendance-regularization-bulk.service.js";
import { applyLeaveBatch, rejectLeaveBatch } from "./leave-application-bulk.service.js";
import { applyIncentiveBatch, rejectIncentiveBatch } from "./incentive-bulk.service.js";
import { applyDeductionBatch, rejectDeductionBatch } from "./deduction-bulk.service.js";
import {
  startBatchJob, getBatchJob, readBatchProgress, type BatchJobKind,
} from "./batch-job.js";

export const bulkApprovalRouter = Router();
bulkApprovalRouter.use(requireAuth);

const h =
  (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: import("express").Request, res: Response, next: NextFunction) =>
    fn(req as AuthenticatedRequest, res).catch(next);

function fail(res: Response, err: unknown): Response {
  if (err instanceof BulkUploadError) {
    return res.status(err.statusCode).json({ success: false, message: err.message });
  }
  throw err;
}

/**
 * Which branches can this approver see?
 *
 * super_admin sees every branch. Everyone else is limited to the branch ids on their
 * assignment scopes — a branch head must not see another branch's pending payroll
 * deductions, which are salary data for people they do not manage.
 */
async function approverBranchFilter(
  userId: string,
): Promise<{ sql: string; params: unknown[] } | null> {
  if (await hasAnyRole(userId, "super_admin")) return { sql: "1=1", params: [] };

  // The Payroll Head decides stage 2 for every branch — they are an HO role and hold no
  // user_assignment_scope rows at all (verified live 2026-09-03), so the branch filter
  // below would fail closed and hide every batch they are supposed to act on.
  if (await hasAnyRole(userId, ...PAYROLL_APPROVER_ROLES)) return { sql: "1=1", params: [] };

  if (!(await hasAnyRole(userId, ...APPROVER_ROLES))) return null;

  const scopes = await getUserAssignmentScopes(userId, APPROVER_ROLES);
  if (scopes.some((s) => s.scope_type === "all")) return { sql: "1=1", params: [] };

  const branchIds = [...new Set(scopes.map((s) => s.branch_id).filter(Boolean))] as string[];
  if (branchIds.length === 0) {
    // A branch_head with no assignment scope row sees nothing rather than everything.
    // Failing closed matters here: the alternative silently grants org-wide approval
    // over salary deductions.
    return { sql: "1=0", params: [] };
  }
  return {
    sql: `ub.branch_id IN (${branchIds.map(() => "?").join(",")})`,
    params: branchIds,
  };
}

// GET /approvals/pending — the branch head's queue
bulkApprovalRouter.get("/approvals/pending", h(async (req, res) => {
  const filter = await approverBranchFilter(req.authUser!.id);
  if (!filter) {
    return res.status(403).json({
      success: false,
      message: "Only a Branch Head can view the bulk upload approval queue.",
    });
  }

  const types = [...APPROVAL_GATED_TYPES];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ub.id, ub.upload_batch_no, ub.upload_type_code, ub.original_file_name,
            ub.total_rows, ub.imported_rows, ub.error_rows, ub.batch_status,
            ub.approval_status, ub.branch_id, ub.submitted_for_approval_at, ub.created_at,
            ub.uploaded_by,
            ub.branch_head_approved_by, ub.branch_head_approved_at, ub.branch_head_remarks,
            ub.payroll_head_approved_by, ub.payroll_head_approved_at,
            bm.branch_name,
            COALESCE(NULLIF(TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))), ''), au.email)
              AS uploaded_by_name
       FROM upload_batch ub
       LEFT JOIN branch_master bm ON bm.id = ub.branch_id
       LEFT JOIN auth_user au ON au.id = ub.uploaded_by
       LEFT JOIN employees e ON e.user_id = ub.uploaded_by
      WHERE ub.approval_status IN ('pending_branch_head', 'pending_payroll_head')
        AND ub.upload_type_code IN (${types.map(() => "?").join(",")})
        AND ${filter.sql}
      ORDER BY ub.submitted_for_approval_at DESC, ub.created_at DESC
      LIMIT 200`,
    [...types, ...filter.params],
  );

  res.json({ success: true, data: rows });
}));

// GET /approvals/history — decided batches, same branch scope
bulkApprovalRouter.get("/approvals/history", h(async (req, res) => {
  const filter = await approverBranchFilter(req.authUser!.id);
  if (!filter) {
    return res.status(403).json({ success: false, message: "Not an approver." });
  }
  const types = [...APPROVAL_GATED_TYPES];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ub.id, ub.upload_batch_no, ub.upload_type_code, ub.total_rows, ub.imported_rows,
            ub.error_rows, ub.approval_status, ub.approved_at, ub.approval_remarks,
            ub.error_summary, bm.branch_name,
            ub.last_rejected_stage, ub.last_rejected_reason, ub.last_rejected_at,
            ub.branch_head_approved_at, ub.payroll_head_approved_at
       FROM upload_batch ub
       LEFT JOIN branch_master bm ON bm.id = ub.branch_id
      WHERE ub.approval_status IN ('approved','rejected','partially_applied')
        AND ub.upload_type_code IN (${types.map(() => "?").join(",")})
        AND ${filter.sql}
      ORDER BY ub.approved_at DESC
      LIMIT 100`,
    [...types, ...filter.params],
  );
  res.json({ success: true, data: rows });
}));

/**
 * GET /approvals/batches/:id/preview — what the approver is actually agreeing to.
 *
 * A branch head approving a leave batch is deducting real balances from real people.
 * The queue therefore has to show the per-employee detail, not just a row count.
 */
bulkApprovalRouter.get("/approvals/batches/:id/preview", h(async (req, res) => {
  try {
    const batch = await getBatch(req.params.id);
    // Reading is gated by assertCanView, NOT assertCanApprove.
    //
    // assertCanApprove is stage-specific, and its default stage is 'branch' — which
    // applies the BRANCH SCOPE test. The Payroll Head is an HO role whose scope is Head
    // Office, so opening a Noida batch at stage 2 was refused with "This batch belongs to
    // a branch outside your scope" on the very queue that had just listed it to them. The
    // decision endpoints below still resolve the real stage and enforce it properly; this
    // one only decides who may LOOK.
    await assertCanView(req.authUser!.id, batch);

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT row_no, normalized_data, raw_data, row_status, error_messages,
              created_entity_type, created_entity_id
         FROM upload_batch_row
        WHERE upload_batch_id = ?
        ORDER BY row_no ASC
        LIMIT 1000`,
      [req.params.id],
    );

    // Resolve employee codes → names so the approver sees who they are deciding for.
    // normalized_data keys vary by upload type; try the common variants.
    const EMP_CODE_KEYS = ["emp_code", "employee_code", "EmpCode", "employeeCode"];
    const codeSet = new Set<string>();
    for (const row of rows) {
      const nd: Record<string, unknown> =
        typeof row.normalized_data === "string"
          ? (JSON.parse(row.normalized_data) as Record<string, unknown>)
          : (row.normalized_data as Record<string, unknown>) ?? {};
      for (const key of EMP_CODE_KEYS) {
        if (nd[key]) { codeSet.add(String(nd[key])); break; }
      }
    }

    const nameMap = new Map<string, string>();
    if (codeSet.size > 0) {
      const codes = [...codeSet];
      const [empRows] = await db.execute<RowDataPacket[]>(
        `SELECT employee_code, TRIM(CONCAT(first_name, ' ', COALESCE(last_name, ''))) AS full_name
           FROM employees
          WHERE employee_code IN (${codes.map(() => "?").join(",")})`,
        codes,
      );
      for (const e of empRows) nameMap.set(String(e.employee_code), String(e.full_name));
    }

    const enriched = rows.map((row) => {
      const nd: Record<string, unknown> =
        typeof row.normalized_data === "string"
          ? (JSON.parse(row.normalized_data) as Record<string, unknown>)
          : (row.normalized_data as Record<string, unknown>) ?? {};
      let empCode: string | null = null;
      for (const key of EMP_CODE_KEYS) {
        if (nd[key]) { empCode = String(nd[key]); break; }
      }
      return {
        ...row,
        employee_name: empCode ? (nameMap.get(empCode) ?? null) : null,
      };
    });

    return res.json({ success: true, batch, data: enriched });
  } catch (err) {
    return fail(res, err);
  }
}));

type Decision = "approve" | "reject";

/**
 * Run the decision itself — everything that used to happen after the claim.
 *
 * This is the part that takes minutes on a real batch, so it no longer runs inside
 * the request (see batch-job.ts). It returns exactly the payload the route used to
 * send, which the browser now collects from the status endpoint instead.
 */
async function performDecision(
  decision: Decision,
  batch: Awaited<ReturnType<typeof getBatch>>,
  userId: string,
  remarks: string,
  req: AuthenticatedRequest,
  stage: ApprovalStage = "branch",
): Promise<Record<string, unknown>> {
  const stageRule = STAGE_RULES[stage];
  const { next, applies } = stageOutcome(stage, batch.upload_type_code);

  // ── Stage 1 of a two-stage type: hand it on, do not apply ──────────────────
  //
  // This is the whole point of the second stage. Running the domain engine here would
  // set incentive_upload_batch.status = 'approved' (or the deduction to 'active'), and
  // payrollCalculate pays on exactly that — so the Payroll Head would be approving money
  // that had already moved. The staged rows stay 'pending_approval' and simply change
  // queue.
  if (decision === "approve" && !applies) {
    const summary =
      `Approved by ${stageRule.label}; awaiting ${STAGE_RULES.payroll.label} final approval. ` +
      `${batch.imported_rows ?? batch.total_rows ?? 0} row(s) held.`;

    const moved = await markStageDecided({
      batchId: batch.id,
      stage,
      next,
      expectedFrom: stageRule.from,
      // Not 'imported': nothing has been imported into the domain engines yet. It stays
      // in the approval queue, one stage further along.
      batchStatus: "pending_approval",
      userId,
      remarks: remarks || null,
      summary,
    });
    if (!moved) {
      throw new BulkUploadError(
        "This batch moved on while you were deciding. Refresh the queue and look again.",
        409,
      );
    }

    await auditBatchAction({
      userId,
      actionType: "BULK_UPLOAD_BRANCH_APPROVED",
      batch,
      reason: remarks || undefined,
      detail: { stage, next_status: next, applied: 0 },
      req,
    });
    await recordFinanceApprovalEvent({
      entityType: BATCH_ENTITY_TYPE,
      entityId: batch.id,
      action: "approve",
      fromStatus: stageRule.from,
      toStatus: next,
      decision: "approved",
      actorUserId: userId,
      actorRole: stageRule.roles[0],
      remarks: remarks || null,
      details: { upload_batch_no: batch.upload_batch_no, stage },
    }).catch(() => { /* the timeline must never fail a committed decision */ });

    // The Payroll Head has work now — put it in their inbox.
    void triggerBulkBatchApproval(
      batch.id,
      batch.upload_batch_no,
      batch.upload_type_code,
      STAGE_RULES.payroll.roles[0],
      batch.branch_id,
    ).catch(() => { /* a missing inbox item must not fail the approval */ });

    return {
      success: true,
      approval_status: next,
      applied: 0,
      failed: 0,
      errors: [],
      message: summary,
    };
  }

  let outcome;
  if (decision === "approve") {
    switch (batch.upload_type_code) {
      case "ATTENDANCE_REGULARIZATION_BULK":
        outcome = await applyRegularizationBatch(batch, userId, remarks || null); break;
      case "LEAVE_APPLICATION_BULK":
        outcome = await applyLeaveBatch(batch, userId, remarks || null); break;
      case "INCENTIVE_BULK":
        outcome = await applyIncentiveBatch(batch, userId, remarks || null); break;
      case "DEDUCTION_BULK":
        outcome = await applyDeductionBatch(batch, userId, remarks || null); break;
      default:
        throw new BulkUploadError(`No apply handler for ${batch.upload_type_code}`, 501);
    }
  } else {
    switch (batch.upload_type_code) {
      case "ATTENDANCE_REGULARIZATION_BULK":
        outcome = await rejectRegularizationBatch(batch, userId, remarks); break;
      case "LEAVE_APPLICATION_BULK":
        outcome = await rejectLeaveBatch(batch, userId, remarks); break;
      case "INCENTIVE_BULK":
        outcome = await rejectIncentiveBatch(batch, userId, remarks); break;
      case "DEDUCTION_BULK":
        outcome = await rejectDeductionBatch(batch, userId, remarks); break;
      default:
        throw new BulkUploadError(`No reject handler for ${batch.upload_type_code}`, 501);
    }
  }

  const finalStatus: BulkApprovalStatus =
    decision === "reject" ? "rejected" : outcome.failed > 0 ? "partially_applied" : "approved";
  const summary =
    decision === "reject"
      ? `Rejected by ${stageRule.label}: ${outcome.applied} row(s) cancelled. ${remarks}`
      : `${outcome.applied} row(s) applied, ${outcome.failed} failed.` +
        (outcome.errors.length ? ` First error: ${outcome.errors[0]}` : "");

  if (decision === "reject") {
    // Guarded on the status the batch was in, so two approvers cannot both record a
    // rejection — and so the stage that refused, and its reason, are stored where the
    // uploader's notification and the history view can read them back.
    const recorded = await markStageRejected({
      batchId: batch.id,
      stage,
      expectedFrom: stageRule.from,
      userId,
      reason: remarks,
      summary,
    });
    if (!recorded) {
      throw new BulkUploadError(
        "This batch moved on while you were deciding. Refresh the queue and look again.",
        409,
      );
    }
  } else {
    await markDecided(batch.id, finalStatus, userId, remarks || null, summary);
    // Record the final stage too, so "who released the money" survives.
    await markStageDecided({
      batchId: batch.id,
      stage,
      next: finalStatus,
      expectedFrom: finalStatus,
      batchStatus: "imported",
      userId,
      remarks: remarks || null,
      summary,
    }).catch(() => { /* markDecided already wrote the authoritative status */ });
  }

  await auditBatchAction({
    userId,
    actionType: decision === "approve" ? "BULK_UPLOAD_APPROVED" : "BULK_UPLOAD_REJECTED",
    batch,
    reason: remarks || undefined,
    detail: {
      stage, applied: outcome.applied, failed: outcome.failed, final_status: finalStatus,
    },
    req,
  });

  await recordFinanceApprovalEvent({
    entityType: BATCH_ENTITY_TYPE,
    entityId: batch.id,
    action: decision === "approve" ? "approve" : "reject",
    fromStatus: stageRule.from,
    toStatus: finalStatus,
    decision: decision === "approve" ? "approved" : "rejected",
    actorUserId: userId,
    actorRole: stageRule.roles[0],
    remarks: remarks || null,
    details: { upload_batch_no: batch.upload_batch_no, stage, applied: outcome.applied },
  }).catch(() => { /* the timeline must never fail a committed decision */ });

  // The creator hears about every outcome that needs them to act — a rejection above
  // all, which previously told nobody anything.
  if (decision === "reject" || finalStatus === "partially_applied") {
    void notifyBatchCreator({
      batch,
      event: decision === "reject" ? "rejected" : "partially_applied",
      stage,
      actorUserId: userId,
      reason: remarks || null,
    }).catch(() => { /* never fails a committed decision */ });
  }

  // Notify uploader of failed rows so they can fix and re-submit
  if (finalStatus === "partially_applied" && outcome.failed > 0) {
    const [approverRows] = await db.execute<RowDataPacket[]>(
      // auth_user.full_name does not exist (live schema, 2026-09-03). This query threw
      // ER_BAD_FIELD_ERROR, and because it is awaited inside performDecision it failed the
      // whole approval job for any batch that ended partially_applied.
      `SELECT COALESCE(NULLIF(TRIM(e.full_name), ''),
                       NULLIF(TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))), ''),
                       au.email) AS display
         FROM auth_user au
         LEFT JOIN employees e ON e.user_id = au.id
        WHERE au.id = ? LIMIT 1`,
      [userId],
    );
    const approverName = String((approverRows as RowDataPacket[])[0]?.display ?? "Branch Head").trim();
    void sendPartialApplyEmail({
      batch,
      appliedCount: outcome.applied,
      failedCount: outcome.failed,
      approverName,
      remarks: remarks || null,
    });
  }

  return {
    success: outcome.failed === 0,
    approval_status: finalStatus,
    applied: outcome.applied,
    failed: outcome.failed,
    errors: outcome.errors.slice(0, 100),
    message: summary,
  };
}

/**
 * Start a decision. Answers in milliseconds, whatever the batch size.
 *
 * Every check that can reject the request — type, state, permission, the claim —
 * still runs here, so a caller that gets 202 knows the decision is genuinely under
 * way. Only the row work is detached, and its result is collected from
 * GET /approvals/batches/:id/job-status.
 */
async function runDecision(
  decision: Decision,
  req: AuthenticatedRequest,
  res: Response,
): Promise<Response> {
  const userId = req.authUser!.id;
  const remarks = String((req.body as { remarks?: string })?.remarks ?? "").trim();

  if (decision === "reject" && remarks.length < 10) {
    return res.status(400).json({
      success: false,
      message: "A rejection needs a remark of at least 10 characters — it is what the uploader has to act on.",
    });
  }

  const batch = await getBatch(req.params.id);

  if (!APPROVAL_GATED_TYPES.has(batch.upload_type_code)) {
    return res.status(400).json({
      success: false,
      message: `${batch.upload_type_code} is not an approval-gated upload type.`,
    });
  }
  // The stage comes from the batch, never from the request — a caller that could name
  // its own stage could hand itself the Payroll Head step on a batch no Branch Head has
  // seen.
  const stage = resolveStage(batch);
  if (!stage) {
    return res.status(409).json({
      success: false,
      message: `This batch is already '${batch.approval_status ?? batch.batch_status}'. Refresh the queue.`,
    });
  }

  await assertCanApprove(userId, batch, stage);

  // Claim before running the domain engines. Without this a client retry after a
  // false timeout could approve the same leave batch twice and deduct every balance
  // in it a second time.
  if (!(await claimForDecision(batch.id, STAGE_RULES[stage].from))) {
    return res.status(409).json({
      success: false,
      message: "This batch is already being decided. Wait for it to finish, then refresh — do not resubmit.",
    });
  }

  startBatchJob(
    batch.id,
    decision === "approve" ? "approve" : "reject",
    () => performDecision(decision, batch, userId, remarks, req, stage),
    // Put the batch back in the queue rather than leaving it stuck in 'approving'.
    // The request has already been answered, so this is the only place left to do it.
    async () => { await releaseClaim(batch.id); },
  );

  return res.status(202).json({
    success: true,
    processing: true,
    job: decision,
    batch_id: batch.id,
    total_rows: batch.imported_rows ?? batch.total_rows ?? null,
    stage,
    message:
      decision !== "approve"
        ? "Rejection started — the screen will keep itself updated."
        : stageOutcome(stage, batch.upload_type_code).applies
          ? "Final approval started. This runs one row at a time and can take a few minutes on a large batch — the screen will keep itself updated."
          : `Branch Head approval started. Nothing is paid yet — the batch moves to the ${STAGE_RULES.payroll.label} for final approval.`,
  });
}

/**
 * GET /approvals/batches/:id/job-status — where the browser collects the result.
 *
 * Terminal state is read from upload_batch, not from the in-process job map, so an
 * approval that finished before an API restart still reports correctly afterwards.
 */
bulkApprovalRouter.get("/approvals/batches/:id/job-status", h(async (req, res) => {
  try {
    const batch = await getBatch(req.params.id);
    // A decided batch has no stage left to resolve, and the Branch Head who released it
    // at stage 1 must still be able to watch stage 2 finish — so polling uses the looser
    // view check, not the stage-specific approval check.
    await assertCanView(req.authUser!.id, batch);

    const job = getBatchJob(batch.id);
    const kind: BatchJobKind = job?.kind ?? "approve";
    const progress = await readBatchProgress(batch.id, kind);

    const decided = ["approved", "rejected", "partially_applied"].includes(
      String(batch.approval_status ?? ""),
    );
    const running = batch.batch_status === "approving";

    // The batch itself is the authority, and it is read in that order: decided beats
    // everything, and a batch still claimed as 'approving' is running even if the job
    // map holds a failure — that failure belongs to an earlier attempt, not this one.
    // The map is only consulted for the richer payload and for a failure that never
    // made it onto the batch.
    const phase = decided ? "done" : running ? "running" : job?.phase === "failed" ? "failed" : "idle";

    let errors: string[] = [];
    if (phase === "done" || phase === "failed") {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT row_no, error_messages FROM upload_batch_row
          WHERE upload_batch_id = ? AND row_status IN ('error','failed')
          ORDER BY row_no ASC LIMIT 100`,
        [batch.id],
      );
      errors = (rows as RowDataPacket[]).map((r) => {
        const parsed = typeof r.error_messages === "string"
          ? (JSON.parse(r.error_messages) as string[])
          : ((r.error_messages as string[]) ?? []);
        return `Row ${r.row_no}: ${(parsed ?? []).join("; ")}`;
      });
    }

    return res.json({
      success: true,
      phase,
      job: kind,
      batch_status: batch.batch_status,
      approval_status: batch.approval_status,
      progress,
      errors,
      error: job?.phase === "failed" ? job.error : undefined,
      message: job?.phase === "failed" ? job.error : (batch.error_summary ?? null),
      result: job?.phase === "done" ? job.result : undefined,
    });
  } catch (err) {
    return fail(res, err);
  }
}));

/**
 * Can this user LOOK at this batch?
 *
 * Deliberately looser than assertCanApprove: a batch sitting at stage 2 must still be
 * readable by the Branch Head who released it, and by the creator watching it move. Only
 * the decision endpoints enforce the stage.
 */
async function assertCanView(
  userId: string,
  batch: Awaited<ReturnType<typeof getBatch>>,
): Promise<void> {
  if (await hasAnyRole(userId, "super_admin")) return;
  if (batch.uploaded_by === userId) return;
  if (await hasAnyRole(userId, ...APPROVER_ROLES, ...PAYROLL_APPROVER_ROLES)) return;
  throw new BulkUploadError("You do not have access to this upload batch.", 403);
}

/** Guard the two review endpoints: only the money types have a cost-centre view. */
async function loadReviewableBatch(req: AuthenticatedRequest) {
  const batch = await getBatch(req.params.id);
  await assertCanView(req.authUser!.id, batch);
  if (!isReviewable(batch.upload_type_code)) {
    throw new BulkUploadError(
      `${batch.upload_type_code} has no cost-centre view — only incentive and deduction batches do.`,
      400,
    );
  }
  return batch;
}

/**
 * GET /approvals/batches/:id/cost-centres
 *
 * The cost-centre-wise summary the approver sees first: one row per cost centre, one
 * column per incentive/deduction type present, and a total. Discarded rows are counted
 * but excluded from every amount — the decision is about what would actually be paid.
 */
bulkApprovalRouter.get("/approvals/batches/:id/cost-centres", h(async (req, res) => {
  try {
    const batch = await loadReviewableBatch(req);
    const review = await getBatchReview(batch);
    return res.json({ success: true, batch, data: review });
  } catch (err) {
    return fail(res, err);
  }
}));

/**
 * GET /approvals/batches/:id/employees?costCentreId=…
 *
 * The drill-down. Employee name, code, cost centre, process and reporting manager, then
 * one column per type and a total — the grid the approved design specifies. Omit
 * costCentreId for the whole batch (used by the CSV export).
 */
bulkApprovalRouter.get("/approvals/batches/:id/employees", h(async (req, res) => {
  try {
    const batch = await loadReviewableBatch(req);
    const costCentreId = typeof req.query.costCentreId === "string" ? req.query.costCentreId : null;
    const { types, rows } = await getBatchEmployees(batch, costCentreId);
    return res.json({ success: true, batch, types, data: rows });
  } catch (err) {
    return fail(res, err);
  }
}));

/**
 * GET /approvals/batches/:id/timeline — every stage transition and row discard.
 *
 * Reads finance_approval_event, the same polymorphic timeline the cost-centre attendance
 * sign-off uses, so no new audit table was needed.
 */
bulkApprovalRouter.get("/approvals/batches/:id/timeline", h(async (req, res) => {
  try {
    const batch = await getBatch(req.params.id);
    await assertCanView(req.authUser!.id, batch);
    const events = await listFinanceApprovalEvents(BATCH_ENTITY_TYPE, batch.id);
    return res.json({ success: true, data: events });
  } catch (err) {
    return fail(res, err);
  }
}));

/**
 * POST /approvals/batches/:id/rows/discard — drop individual employees, with a reason.
 *
 * Available at BOTH stages, to whoever owns the stage the batch is currently on. The rest
 * of the batch stays in the queue and can still be approved: a 500-row branch file must
 * not bounce because one employee's amount is wrong.
 */
bulkApprovalRouter.post("/approvals/batches/:id/rows/discard", h(async (req, res) => {
  try {
    const userId = req.authUser!.id;
    const body = (req.body ?? {}) as { rowIds?: unknown; reason?: unknown };
    const rowIds = Array.isArray(body.rowIds) ? body.rowIds.map((r) => String(r)) : [];
    const reason = String(body.reason ?? "").trim();

    const batch = await getBatch(req.params.id);
    if (!isReviewable(batch.upload_type_code)) {
      return res.status(400).json({
        success: false,
        message: "Single-line discard is available for incentive and deduction uploads only.",
      });
    }

    // Which stage the batch is on decides who may discard from it — the same rule as
    // approving. A batch that is no longer pending cannot be edited here at all; a row
    // inside an approved batch is locked in bulk_upload_locked_entity and belongs to the
    // discard module.
    const stage = resolveStage(batch);
    if (!stage) {
      return res.status(409).json({
        success: false,
        message:
          `This batch is '${batch.approval_status ?? batch.batch_status}' and can no longer be edited here. ` +
          "An approved row is reversed through the Discard screen.",
      });
    }
    await assertCanApprove(userId, batch, stage);

    const result = await discardRows({
      batch,
      rowIds,
      stage,
      actorRole: STAGE_RULES[stage].roles[0],
      userId,
      reason,
    });

    // One notification for the whole action, not one per row.
    const delivery = result.discarded.length
      ? await notifyBatchCreator({
          batch,
          event: "rows_discarded",
          stage,
          actorUserId: userId,
          reason,
          lines: result.discarded,
        }).catch(() => ({ email: false, inbox: false, sms: false }))
      : { email: false, inbox: false, sms: false };

    return res.json({
      success: true,
      discarded: result.discarded.length,
      remaining: result.remaining,
      remaining_amount: result.remainingAmount,
      creator_notified: delivery,
      message:
        `${result.discarded.length} row(s) discarded. ${result.remaining} row(s) remain in this batch` +
        (delivery.email || delivery.inbox
          ? " and the uploader has been told why."
          : ". The uploader could not be notified — check their email and mobile on file."),
    });
  } catch (err) {
    return fail(res, err);
  }
}));

bulkApprovalRouter.post("/approvals/batches/:id/approve", h((req, res) => runDecision("approve", req, res)));
bulkApprovalRouter.post("/approvals/batches/:id/reject", h((req, res) => runDecision("reject", req, res)));

// Force-release a batch stuck in 'approving' — super_admin / admin only.
// Used when the server restarted mid-approval and claimForDecision's auto-release
// (5-minute staleness window) hasn't fired yet.
bulkApprovalRouter.post("/approvals/batches/:id/release-claim", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const isSuperAdmin = await hasAnyRole(userId, "super_admin", "admin");
  if (!isSuperAdmin) {
    return res.status(403).json({ success: false, message: "Only super_admin or admin can force-release a stuck batch claim." });
  }
  const released = await releaseStuckClaim(req.params.id);
  return res.json({
    success: released,
    message: released ? "Batch claim released — it is back in the approval queue." : "Batch was not in approving state.",
  });
}));
