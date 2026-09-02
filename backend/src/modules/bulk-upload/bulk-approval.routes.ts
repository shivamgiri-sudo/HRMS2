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
  APPROVAL_GATED_TYPES, APPROVER_ROLES, BulkUploadError,
  getBatch, assertCanApprove, markDecided, claimForDecision, releaseClaim,
  auditBatchAction,
} from "./bulk-approval.service.js";
import { applyRegularizationBatch, rejectRegularizationBatch } from "./attendance-regularization-bulk.service.js";
import { applyLeaveBatch, rejectLeaveBatch } from "./leave-application-bulk.service.js";
import { applyIncentiveBatch, rejectIncentiveBatch } from "./incentive-bulk.service.js";
import { applyDeductionBatch, rejectDeductionBatch } from "./deduction-bulk.service.js";
import { queueApprovalJob, getApprovalJob } from "./bulk-approval-async.js";

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
            bm.branch_name,
            COALESCE(NULLIF(TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))), ''), au.email)
              AS uploaded_by_name
       FROM upload_batch ub
       LEFT JOIN branch_master bm ON bm.id = ub.branch_id
       LEFT JOIN auth_user au ON au.id = ub.uploaded_by
       LEFT JOIN employees e ON e.user_id = ub.uploaded_by
      WHERE ub.approval_status = 'pending_branch_head'
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
            ub.error_summary, bm.branch_name
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
    await assertCanApprove(req.authUser!.id, batch);

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
        `SELECT emp_code, TRIM(CONCAT(first_name, ' ', COALESCE(last_name, ''))) AS full_name
           FROM employees
          WHERE emp_code IN (${codes.map(() => "?").join(",")})`,
        codes,
      );
      for (const e of empRows) nameMap.set(String(e.emp_code), String(e.full_name));
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
  if (batch.approval_status !== "pending_branch_head") {
    return res.status(409).json({
      success: false,
      message: `This batch is already '${batch.approval_status ?? batch.batch_status}'. Refresh the queue.`,
    });
  }

  await assertCanApprove(userId, batch);

  // Claim before running the domain engines. Without this a client retry after a
  // false timeout could approve the same leave batch twice and deduct every balance
  // in it a second time.
  if (!(await claimForDecision(batch.id))) {
    return res.status(409).json({
      success: false,
      message: "This batch is already being decided. Wait for it to finish, then refresh — do not resubmit.",
    });
  }

  try {
    // Queue job and return 202 Accepted immediately
    const jobId = await queueApprovalJob(batch, userId, decision, remarks || null);

    return res.status(202).json({
      success: true,
      status: "queued",
      job_id: jobId,
      batch_id: batch.id,
      message: `Approval queued. Poll /approvals/jobs/${jobId} for status.`,
    });
  } catch (err) {
    // Put the batch back in the queue rather than leaving it stuck in 'approving'.
    await releaseClaim(batch.id);
    return fail(res, err);
  }
}

bulkApprovalRouter.post("/approvals/batches/:id/approve", h((req, res) => runDecision("approve", req, res)));
bulkApprovalRouter.post("/approvals/batches/:id/reject", h((req, res) => runDecision("reject", req, res)));

// GET /approvals/jobs/:jobId — poll job status
bulkApprovalRouter.get("/approvals/jobs/:jobId", h(async (req, res) => {
  const job = getApprovalJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ success: false, message: "Job not found." });
  }
  return res.json({
    success: true,
    job_id: job.id,
    status: job.status,
    error: job.error,
    result: job.result,
  });
}));
