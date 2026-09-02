/**
 * Async approval job runner — prevents 504 timeouts on large batches.
 *
 * Pattern:
 * 1. Endpoint calls queueApprovalJob() → returns jobId immediately (202 Accepted)
 * 2. Background worker runs approval in parallel, updates batch status
 * 3. Frontend polls GET /approvals/batches/:id/status
 */

import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import {
  getBatch, markDecided, releaseClaim, auditBatchAction,
  BulkUploadError, type BatchRecord,
  APPROVAL_GATED_TYPES,
} from "./bulk-approval.service.js";
import { applyRegularizationBatch, rejectRegularizationBatch } from "./attendance-regularization-bulk.service.js";
import { applyLeaveBatch, rejectLeaveBatch } from "./leave-application-bulk.service.js";
import { applyIncentiveBatch, rejectIncentiveBatch } from "./incentive-bulk.service.js";
import { applyDeductionBatch, rejectDeductionBatch } from "./deduction-bulk.service.js";

export interface ApprovalJob {
  id: string;
  batch_id: string;
  decision: "approve" | "reject";
  user_id: string;
  remarks: string | null;
  status: "queued" | "running" | "completed" | "failed";
  error?: string;
  result?: {
    applied: number;
    failed: number;
    final_status: string;
  };
}

const jobMap = new Map<string, ApprovalJob>();

/**
 * Queue approval job → returns immediately, job runs in background.
 * Caller must call claimForDecision() first to set batch_status='approving'.
 */
export async function queueApprovalJob(
  batch: BatchRecord,
  userId: string,
  decision: "approve" | "reject",
  remarks: string | null,
): Promise<string> {
  const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const job: ApprovalJob = { id: jobId, batch_id: batch.id, decision, user_id: userId, remarks, status: "queued" };

  jobMap.set(jobId, job);

  // Fire and forget — run approval in background
  runApprovalAsync(job, batch).catch(err => {
    job.status = "failed";
    job.error = (err as Error)?.message ?? String(err);
  });

  return jobId;
}

export function getApprovalJob(jobId: string): ApprovalJob | undefined {
  return jobMap.get(jobId);
}

/**
 * Run approval asynchronously, update batch and job state.
 */
async function runApprovalAsync(job: ApprovalJob, batch: BatchRecord): Promise<void> {
  job.status = "running";

  try {
    let outcome;
    if (job.decision === "approve") {
      switch (batch.upload_type_code) {
        case "ATTENDANCE_REGULARIZATION_BULK":
          outcome = await applyRegularizationBatch(batch, job.user_id, job.remarks); break;
        case "LEAVE_APPLICATION_BULK":
          outcome = await applyLeaveBatch(batch, job.user_id, job.remarks); break;
        case "INCENTIVE_BULK":
          outcome = await applyIncentiveBatch(batch, job.user_id, job.remarks); break;
        case "DEDUCTION_BULK":
          outcome = await applyDeductionBatch(batch, job.user_id, job.remarks); break;
        default:
          throw new BulkUploadError(`No apply handler for ${batch.upload_type_code}`, 501);
      }
    } else {
      switch (batch.upload_type_code) {
        case "ATTENDANCE_REGULARIZATION_BULK":
          outcome = await rejectRegularizationBatch(batch, job.user_id, job.remarks ?? ""); break;
        case "LEAVE_APPLICATION_BULK":
          outcome = await rejectLeaveBatch(batch, job.user_id, job.remarks ?? ""); break;
        case "INCENTIVE_BULK":
          outcome = await rejectIncentiveBatch(batch, job.user_id, job.remarks ?? ""); break;
        case "DEDUCTION_BULK":
          outcome = await rejectDeductionBatch(batch, job.user_id, job.remarks ?? ""); break;
        default:
          throw new BulkUploadError(`No reject handler for ${batch.upload_type_code}`, 501);
      }
    }

    const finalStatus =
      job.decision === "reject" ? "rejected" : outcome.failed > 0 ? "partially_applied" : "approved";
    const summary =
      job.decision === "reject"
        ? `Rejected by Branch Head: ${outcome.applied} row(s) cancelled. ${job.remarks}`
        : `${outcome.applied} row(s) applied, ${outcome.failed} failed.` +
          (outcome.errors.length ? ` First error: ${outcome.errors[0]}` : "");

    await markDecided(batch.id, finalStatus, job.user_id, job.remarks ?? null, summary);
    await auditBatchAction({
      userId: job.user_id,
      actionType: job.decision === "approve" ? "BULK_UPLOAD_APPROVED" : "BULK_UPLOAD_REJECTED",
      batch,
      reason: job.remarks ?? undefined,
      detail: { applied: outcome.applied, failed: outcome.failed, final_status: finalStatus },
      req: undefined as never,
    });

    job.status = "completed";
    job.result = { applied: outcome.applied, failed: outcome.failed, final_status: finalStatus };
  } catch (err) {
    job.status = "failed";
    job.error = (err as Error)?.message ?? String(err);
    await releaseClaim(batch.id);
    throw err;
  }
}
