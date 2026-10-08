/**
 * The single writer for a branch head's decision on a candidate.
 *
 * Two screens approve candidates and only one of them ever recorded the
 * decision. `/ats/offer-approvals` — the screen in the nav menu — calls
 * approveOffer, which goes straight to createEmployeeFromCandidate without
 * writing an ats_branch_head_approval row. validateSalaryLock then refuses to
 * create the employee because no approval exists, so every approval from that
 * screen failed with "Branch Head approval pending". The other screen,
 * /ats/branch-head-approval, has no nav entry at all.
 *
 * This module is what both paths now call. It lives on its own because
 * branch-head-approval.service.ts already imports approveOffer from
 * ats.onboarding.service.ts; putting the writer in either of those files would
 * close an ESM import cycle.
 *
 * The candidate is reached through payroll_validation_id, never through
 * ats_branch_head_approval.candidate_id: production built this table from
 * migration 141, which omits that column entirely (138 declares it). Migration
 * 1056 adds it, but SKIP_MIGRATIONS=true in production means nothing here may
 * depend on 1056 having run.
 */
import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { db } from "../../db/mysql.js";

export type BranchHeadDecision = "approved" | "rejected";

export type DecisionOutcome = {
  /** A decision now exists for this candidate — either we wrote it, or one was already there. */
  recorded: boolean;
  /** Someone had already decided. We wrote nothing; the caller must not repeat side effects. */
  alreadyDecided: boolean;
  approvalId: string | null;
  payrollValidationId: string | null;
  /** Present when alreadyDecided, so a caller can report what the standing decision is. */
  existingStatus: string | null;
};

/**
 * Anything that can run a statement — the pool or an open transaction.
 *
 * Declared structurally rather than as Pick<PoolConnection,'execute'>: mysql2
 * types execute() with overloads whose parameter type does not match the pool
 * wrapper's, so the two are not mutually assignable even though both work.
 */
type Executor = {
  execute<T>(sql: string, params?: unknown[]): Promise<[T, unknown]>;
};

const asExecutor = (e: unknown): Executor => e as Executor;

/**
 * Record a branch head decision exactly once.
 *
 * Idempotent by construction: the UPDATE is guarded on approval_status =
 * 'pending', so a second caller changes zero rows and is told the decision was
 * already made. That is what makes it safe for processBranchHeadApproval to
 * write at its line 186 and then call approveOffer, which calls this again —
 * the nested call finds nothing pending and does nothing.
 *
 * Returns recorded:false rather than throwing when the candidate has no payroll
 * validation. A throw here would be a dead end: the branch head cannot create
 * the missing validation, and blocking the click tells them nothing. The queue
 * surfaces that state on the row instead, before it is clicked.
 */
export async function recordBranchHeadDecision(params: {
  candidateId: string;
  branchHeadEmployeeId: string | null;
  decision: BranchHeadDecision;
  remarks?: string | null;
  /** Pass an open connection to join an existing transaction. */
  conn?: Executor;
}): Promise<DecisionOutcome> {
  const exec = asExecutor(params.conn ?? db);
  const remarks = params.remarks ?? null;

  const empty: DecisionOutcome = {
    recorded: false, alreadyDecided: false,
    approvalId: null, payrollValidationId: null, existingStatus: null,
  };

  // Latest validation for this candidate. Ordered by created_at because
  // validated_at is NULL on rows that have not been validated yet.
  const [pvRows] = await exec.execute<RowDataPacket[]>(
    `SELECT id FROM ats_payroll_hr_validation
      WHERE candidate_id = ?
      ORDER BY COALESCE(validated_at, created_at) DESC
      LIMIT 1`,
    [params.candidateId],
  );
  const payrollValidationId = pvRows[0]?.id ? String(pvRows[0].id) : null;
  if (!payrollValidationId) return empty;

  // Guarded on 'pending' — this is the double-approve guard.
  const [upd] = await exec.execute<ResultSetHeader>(
    `UPDATE ats_branch_head_approval
        SET branch_head_id = ?, approval_status = ?, remarks = ?,
            approved_at = NOW(), updated_at = NOW()
      WHERE payroll_validation_id = ? AND approval_status = 'pending'`,
    [params.branchHeadEmployeeId, params.decision, remarks, payrollValidationId],
  );

  if (upd.affectedRows > 0) {
    const [row] = await exec.execute<RowDataPacket[]>(
      `SELECT id FROM ats_branch_head_approval WHERE payroll_validation_id = ? LIMIT 1`,
      [payrollValidationId],
    );
    return {
      recorded: true, alreadyDecided: false,
      approvalId: row[0]?.id ? String(row[0].id) : null,
      payrollValidationId, existingStatus: null,
    };
  }

  // Nothing pending: either a decision already stands, or no row exists at all
  // (an offer that never went through notifyBranchHeadForApproval).
  const [existing] = await exec.execute<RowDataPacket[]>(
    `SELECT id, approval_status FROM ats_branch_head_approval
      WHERE payroll_validation_id = ? LIMIT 1`,
    [payrollValidationId],
  );

  if (existing[0]) {
    return {
      recorded: true, alreadyDecided: true,
      approvalId: String(existing[0].id),
      payrollValidationId,
      existingStatus: String(existing[0].approval_status),
    };
  }

  const id = randomUUID();
  await exec.execute(
    `INSERT INTO ats_branch_head_approval
       (id, payroll_validation_id, branch_head_id, approval_status, remarks, approved_at, notified_at)
     VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
    [id, payrollValidationId, params.branchHeadEmployeeId, params.decision, remarks],
  );
  return {
    recorded: true, alreadyDecided: false,
    approvalId: id, payrollValidationId, existingStatus: null,
  };
}

/**
 * Undo a decision this caller wrote, after downstream work failed.
 *
 * createEmployeeFromCandidate can fail for reasons that have nothing to do with
 * the branch head's judgement — an inactive reporting manager, a missing
 * statutory field. Without this the offer would be permanently marked approved
 * with no employee behind it and no way for anyone to decide it again.
 *
 * Only ever called when we were the writer (recorded && !alreadyDecided), so it
 * cannot revert a colleague's standing decision.
 */
export async function revertBranchHeadDecision(params: {
  payrollValidationId: string;
  conn?: Executor;
}): Promise<void> {
  const exec = asExecutor(params.conn ?? db);
  await exec.execute(
    `UPDATE ats_branch_head_approval
        SET approval_status = 'pending', approved_at = NULL, updated_at = NOW()
      WHERE payroll_validation_id = ?`,
    [params.payrollValidationId],
  );
}
