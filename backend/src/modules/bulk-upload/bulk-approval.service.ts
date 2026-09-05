/**
 * Shared machinery for approval-gated bulk uploads.
 *
 * The existing 15 upload types apply the moment they are imported. These four —
 * attendance regularization, leave, incentive, deduction — must not: they move money
 * and leave balances, so a branch head has to approve them first.
 *
 * The design constraint that shapes everything here: an uploaded row is not a new
 * kind of record. It is the SAME record the single-employee screen creates, in the
 * SAME table, in the SAME pending state — the upload just creates many at once
 * instead of one. Approval then runs the SAME domain engine the manual approver
 * runs. Nothing in this module re-implements a leave-balance deduction or an
 * attendance correction; it only decides which rows to hand to the engine that owns
 * those rules.
 */
import { randomUUID } from "crypto";
import type { Request } from "express";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { hasAnyRole, hasScopedAccess } from "../../shared/scopeAccess.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { emailService } from "../communication/email.service.js";
import { withBulkLockRetry } from "./lock-retry.js";

/** Upload types that must not apply until a branch head approves them. */
export const APPROVAL_GATED_TYPES = new Set([
  "ATTENDANCE_REGULARIZATION_BULK",
  "LEAVE_APPLICATION_BULK",
  "INCENTIVE_BULK",
  "DEDUCTION_BULK",
]);

/**
 * Types that need a SECOND approval, by the HO Payroll Head, before anything applies.
 *
 * Only the two that move money. For an incentive the Branch Head's approval used to BE
 * the payment: applyIncentiveBatch sets incentive_upload_batch.status = 'approved', and
 * payrollCalculate.service.ts §5f pays on exactly that status with no further step. The
 * same is true of a deduction reaching status = 'active'. Putting the HO stage in front
 * of the apply — rather than after it — is what makes the second approval real rather
 * than decorative.
 *
 * Attendance regularization and leave stay single-stage on purpose. They correct a
 * record rather than paying one, and routing every branch's daily corrections through
 * HO would stall branch operations for no control benefit.
 */
export const TWO_STAGE_TYPES = new Set(["INCENTIVE_BULK", "DEDUCTION_BULK"]);

/**
 * Who may upload. Branch WFM, Payroll HR and Super Admin, per the approved design.
 * wfm_spoc / wfm_analyst appear in older route guards but hold zero live accounts
 * (user_roles, verified 2026-08-21); they are kept so an existing grant keeps working.
 *
 * payroll_hr was named as an uploader in the original design and already holds
 * BULK_UPLOAD with can_create = 1, so the page has always been open to them — this
 * list was the only thing refusing the import itself.
 */
export const UPLOADER_ROLES = ["super_admin", "wfm", "wfm_spoc", "wfm_analyst", "payroll_hr"];

/**
 * Who may approve at stage 1. Deliberately NOT the uploader roles — a branch WFM must
 * not be able to approve their own upload, which is the entire point of the gate.
 * admin is excluded for the same reason: several live admin holders also hold wfm
 * (the branch-roles-carry-global-grants finding), so admitting admin here would
 * quietly reopen self-approval.
 */
export const APPROVER_ROLES = ["branch_head"];

/**
 * Who may approve at stage 2 — the HO Payroll Head, and nobody else.
 *
 * payroll_hr is NOT here even though it sounds adjacent: it is an uploader role, so
 * admitting it would let the same person originate and finally release a payment.
 */
export const PAYROLL_APPROVER_ROLES = ["payroll_head"];

export type BulkApprovalStatus =
  | "pending_branch_head"
  | "pending_payroll_head"
  | "approved"
  | "rejected"
  | "partially_applied";

/** Which approval step a batch is sitting on. */
export type ApprovalStage = "branch" | "payroll";

interface StageRule {
  /** The approval_status a batch must hold to be decided at this stage. */
  from: BulkApprovalStatus;
  /** Where an approval at this stage sends it. */
  to: BulkApprovalStatus;
  roles: string[];
  label: string;
  /** Does approving here run the domain engine (i.e. move money)? */
  applies: boolean;
}

/**
 * The state machine, in one place.
 *
 * Stage 1 does NOT apply: it only parks the batch in the Payroll Head's queue. That is
 * the whole point — see TWO_STAGE_TYPES above. For a single-stage type there is no
 * 'payroll' entry and stage 1 goes straight to 'approved', applying as it always did.
 */
export const STAGE_RULES: Record<ApprovalStage, StageRule> = {
  branch: {
    from: "pending_branch_head",
    to: "pending_payroll_head",
    roles: APPROVER_ROLES,
    label: "Branch Head",
    applies: false,
  },
  payroll: {
    from: "pending_payroll_head",
    to: "approved",
    roles: PAYROLL_APPROVER_ROLES,
    label: "Payroll Head",
    applies: true,
  },
};

/**
 * Which stage is this batch waiting on? Derived from the batch itself, never from the
 * client — a caller that could name its own stage could approve stage 2 on a batch no
 * branch head had seen.
 */
export function resolveStage(batch: {
  approval_status: string | null;
  upload_type_code: string;
}): ApprovalStage | null {
  if (batch.approval_status === "pending_branch_head") return "branch";
  if (batch.approval_status === "pending_payroll_head") {
    // Only reachable for a two-stage type, but check anyway: if the type set is ever
    // narrowed, a batch already parked at that status must not become undecidable.
    return "payroll";
  }
  return null;
}

/**
 * Where does an approval at `stage` leave this batch?
 *
 * For a single-stage type the branch decision is final, so it goes straight to
 * 'approved' and the domain engine runs — exactly the behaviour before this change.
 */
export function stageOutcome(
  stage: ApprovalStage,
  uploadTypeCode: string,
): { next: BulkApprovalStatus; applies: boolean } {
  if (stage === "branch" && !TWO_STAGE_TYPES.has(uploadTypeCode)) {
    return { next: "approved", applies: true };
  }
  const rule = STAGE_RULES[stage];
  return { next: rule.to, applies: rule.applies };
}

export interface StagedRow {
  rowId: string;
  rowNo: number;
  data: Record<string, string>;
}

export interface RowOutcome {
  rowId: string;
  rowNo: number;
  employeeCode: string;
  ok: boolean;
  entityId?: string;
  message?: string;
}

export interface ImportOutcome {
  staged: number;
  failed: number;
  /**
   * Rows that needed no work and were correctly left alone — see markRowSkipped. Optional
   * because only the leave importer can currently produce them; a caller that does not set it
   * has none rather than an unknown number.
   */
  skipped?: number;
  branchId: string | null;
  errors: string[];
}

export interface ApplyOutcome {
  applied: number;
  failed: number;
  errors: string[];
}

export class BulkUploadError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** Load the rows a batch staged, normalising the JSON column shape. */
export async function loadStagedRows(batchId: string): Promise<StagedRow[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, row_no, normalized_data, raw_data
       FROM upload_batch_row
      WHERE upload_batch_id = ? AND row_status IN ('valid','pending')
      ORDER BY row_no ASC`,
    [batchId],
  );
  return (rows as RowDataPacket[]).map((r) => {
    const source = r.normalized_data ?? r.raw_data;
    const parsed = typeof source === "string" ? JSON.parse(source) : source;
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries((parsed ?? {}) as Record<string, unknown>)) {
      data[String(k).trim().toLowerCase()] = v === null || v === undefined ? "" : String(v).trim();
    }
    return { rowId: String(r.id), rowNo: Number(r.row_no), data };
  });
}

export interface ResolvedEmployee {
  id: string;
  employee_code: string;
  branch_id: string | null;
  process_id: string | null;
  first_name: string | null;
  last_name: string | null;
}

/**
 * How recently an employee must appear in attendance to be treated as still on staff.
 *
 * WHY ACTIVITY AND NOT `employment_status`
 *
 * This gate was `employment_status = 'active'`, then briefly a denylist of
 * ('Resigned','terminated'). Both were wrong, because that column does not describe reality
 * in either direction. Counted live 2026-09-02, with attendance in the preceding 90 days:
 *
 *     status       employees   still attending
 *     Active           1,115             1,112
 *     inactive        27,052               586
 *     Resigned        30,309               195
 *     terminated         499                38
 *
 * So 'inactive' contains 586 people who are at work — that is the bug HR hit, where 86 rows
 * of BATCH-1788287542227 were refused as "not active" for employees recording 43-45
 * attendance days in the previous 60. And 'Resigned'/'terminated' contain another 233 who
 * are also still attending, which a denylist would have gone on refusing. Nothing
 * corroborates any of it: `date_of_leaving` is NULL for 30,307 of the 30,309 Resigned, and
 * the exit tables hold 8 rows against ~57,000 supposed leavers.
 *
 * Attendance is the honest signal. The nightly engine writes a row per employee it still
 * treats as staff — present or absent — so recent rows mean the system considers them
 * employed, independently of who last edited a status field. Being absent, or never enrolled
 * on biometric, does not exclude anyone: the row still exists. Verified on the batch that
 * prompted this — all 164 employees behind its imported rows had attendance, and so did all
 * 46 behind its rejected ones.
 *
 * 180 days, not 90, because an upload legitimately corrects months in the past; a narrower
 * window would refuse a correction for someone who left after the month being fixed.
 *
 * Net effect measured live: 1,935 employees may appear in a batch, against 1,115 under the
 * original rule (it refused 820 working people) and 28,167 under the denylist (which
 * admitted 26,232 with no sign of employment at all).
 */
const ACTIVITY_WINDOW_DAYS = 180;

/**
 * Resolve employee codes in one query rather than one per row — a branch-month
 * upload is thousands of rows, and a per-row SELECT is what made earlier bulk
 * imports exceed the frontend request timeout.
 */
export async function resolveEmployees(
  codes: string[],
  options?: { includeInactive?: boolean },
): Promise<Map<string, ResolvedEmployee>> {
  const unique = [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
  const map = new Map<string, ResolvedEmployee>();
  if (unique.length === 0) return map;

  const CHUNK = 500;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const placeholders = slice.map(() => "?").join(",");
    // includeInactive: admit any employee in the master regardless of status or
    // attendance — needed for leave/deduction uploads that legitimately target
    // resigned/inactive staff (e.g. back-dated leave, F&F deductions).
    const sql = options?.includeInactive
      ? `SELECT id, employee_code, branch_id, process_id, first_name, last_name
           FROM employees e
          WHERE employee_code IN (${placeholders})`
      : // The status test is a fast path only — 'active' means admit without looking
        // further. date_of_joining covers recently joined staff whose first attendance
        // record has not yet been created. EXISTS stops at the first match and is
        // covered by idx_adr_emp_date (employee_id, record_date).
        `SELECT id, employee_code, branch_id, process_id, first_name, last_name
           FROM employees e
          WHERE employee_code IN (${placeholders})
            AND (
              LOWER(employment_status) = 'active'
              OR date_of_joining >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
              OR EXISTS (
                   SELECT 1
                     FROM attendance_daily_record a
                    WHERE a.employee_id = e.id
                      AND a.record_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                 )
            )`;
    const params = options?.includeInactive
      ? slice
      : [...slice, ACTIVITY_WINDOW_DAYS, ACTIVITY_WINDOW_DAYS];
    const [rows] = await db.execute<RowDataPacket[]>(sql, params);
    for (const r of rows as RowDataPacket[]) {
      map.set(String(r.employee_code).trim().toUpperCase(), {
        id: String(r.id),
        employee_code: String(r.employee_code),
        branch_id: r.branch_id ? String(r.branch_id) : null,
        process_id: r.process_id ? String(r.process_id) : null,
        first_name: r.first_name ? String(r.first_name) : null,
        last_name: r.last_name ? String(r.last_name) : null,
      });
    }
  }
  return map;
}

/**
 * A batch belongs to exactly one branch — the branch of the employees in it, not of
 * whoever uploaded it. A super_admin uploading for Noida produces a Noida batch that
 * the Noida branch head approves.
 *
 * A file spanning two branches is refused rather than stored under an arbitrary
 * branch_id, because there is no single branch head who could legitimately approve
 * it and picking one silently would route half the rows past their own approver.
 */
export function resolveSingleBranch(
  employees: ResolvedEmployee[],
): { branchId: string | null; error?: string } {
  const branches = new Set(employees.map((e) => e.branch_id).filter(Boolean) as string[]);
  if (branches.size === 0) return { branchId: null };
  if (branches.size > 1) {
    return {
      branchId: null,
      error:
        `This file covers ${branches.size} branches. A batch is approved by one branch head, ` +
        `so it must contain one branch only — split the file per branch and upload again.`,
    };
  }
  return { branchId: [...branches][0] };
}

/**
 * Record which domain row a spreadsheet line produced, both directions traceable.
 *
 * Retries transient lock contention on upload_batch_row itself — a busy batch writes
 * this row on every single line, so it is exactly as likely to collide as the
 * bookkeeping in {@link lockEntity}. This call sits in the SUCCESS path of the
 * per-row loop in every import*Batch function, with no catch of its own around it:
 * if it threw, a row whose domain record had already been created (submitRegularization
 * / submitRequest already committed) would escape the loop uncaught, abort the whole
 * concurrency group, and leave every row after it — and every row in a sibling group
 * still in flight — stuck at row_status='pending' forever, indistinguishable from a row
 * that was never looked at. That is the exact shape of BATCH-1788438594771's 17 silently
 * lost rows and BATCH-1788166312651's 11. See also reconcileStuckRows below, which is
 * the second line of defence for whatever this retry still cannot save.
 */
export async function linkRowToEntity(
  rowId: string,
  entityType: string,
  entityId: string,
): Promise<void> {
  await withBulkLockRetry(() =>
    db.execute(
      `UPDATE upload_batch_row
          SET created_entity_type = ?, created_entity_id = ?, row_status = 'imported'
        WHERE id = ?`,
      [entityType, entityId, rowId],
    ),
  );
}

/**
 * Mark a staged row as failed, keeping the reason on the row itself.
 *
 * Retried the same way as {@link linkRowToEntity} and for the same reason: this is
 * called FROM a catch block, so if it throws too, the original error is lost and the
 * row is abandoned mid-batch with no trace of either failure. It still does not swallow
 * on exhaustion — if it truly cannot write after retrying, the row is left exactly where
 * it was (still 'pending'/'valid'), and reconcileStuckRows closes that gap once the batch
 * finishes rather than pretending here that the write succeeded.
 */
export async function markRowFailed(rowId: string, message: string): Promise<void> {
  await withBulkLockRetry(() =>
    db.execute(
      `UPDATE upload_batch_row
          SET row_status = 'error', error_messages = ?
        WHERE id = ?`,
      [JSON.stringify([message.slice(0, 500)]), rowId],
    ),
  );
}

/**
 * The row needed no work, and that is the correct outcome — not a failure.
 *
 * A leave row whose every date falls on the employee's roster week-off or a company holiday is
 * the case this exists for. Creating the request would deduct entitlement for a day nobody was
 * due to work; failing the row tells the uploader their file was wrong when it was not, and a
 * file of 29 rows reporting 28 "errors" reads as a broken upload rather than as 28 days that
 * simply did not need charging.
 *
 * The reason is still recorded, so a skipped row can always be explained.
 */
export async function markRowSkipped(rowId: string, reason: string): Promise<void> {
  await withBulkLockRetry(() =>
    db.execute(
      `UPDATE upload_batch_row
          SET row_status = 'skipped', error_messages = ?
        WHERE id = ?`,
      [JSON.stringify([reason.slice(0, 500)]), rowId],
    ),
  );
}

/**
 * Register an approved row as immutable.
 *
 * There is no hard DELETE against any of the four target tables anywhere in the
 * backend (verified 2026-08-21) — the only removal path is the discard module, which
 * soft-sets status='discarded' and reverses the balance. So this registry plus the
 * guard in discard.service.ts is a complete lock, not a partial one.
 *
 * NEVER THROWS. This used to be a bare INSERT called right after the real domain
 * write (reviewRegularization / reviewRequest / the incentive & deduction status
 * UPDATEs) — those already committed and corrected attendance/leave/pay before this
 * ran. Live evidence this was reporting real successes as failures: batch
 * BATCH-1788272069769 rows 13 and 55 both show attendance_regularization approved
 * AND attendance_daily_record actually corrected, yet the row is recorded 'error'
 * with "Lock wait timeout exceeded" — because THIS insert, not the correction, hit
 * the lock contention (bulk_upload_locked_entity is written by every row of every
 * concurrent batch). For deduction the effect was worse: lockEntity used to run
 * INSIDE the same withBulkLockRetry closure as the status UPDATE, so a failure here
 * re-ran the (idempotency-guarded) UPDATE on retry, which then failed with the
 * unrelated "no longer pending approval" and buried the real error entirely.
 *
 * The lock's job is to stop a SECOND edit of an already-applied row — a missing
 * lock row is a much smaller, and later auditable, risk than telling a branch head
 * their correction failed when it did not. So this retries the transient lock
 * conflicts exactly like the domain call does, and if it still cannot write after
 * that, it logs loudly and returns rather than failing the row.
 */
export async function lockEntity(params: {
  entityType: string;
  entityId: string;
  batchId: string;
  batchNo: string | null;
  employeeId: string | null;
  lockedBy: string;
  reason?: string;
}): Promise<void> {
  try {
    await withBulkLockRetry(() =>
      db.execute(
        `INSERT INTO bulk_upload_locked_entity
           (id, entity_type, entity_id, upload_batch_id, upload_batch_no, employee_id, locked_by, lock_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE locked_at = locked_at`,
        [
          randomUUID(), params.entityType, params.entityId, params.batchId,
          params.batchNo, params.employeeId, params.lockedBy,
          params.reason ?? "Created by an approved bulk upload",
        ],
      ),
    );
  } catch (err) {
    console.error(
      `[bulk-upload] lockEntity failed for ${params.entityType} ${params.entityId} ` +
        `(batch ${params.batchNo ?? params.batchId}) — the underlying record was still ` +
        `updated; only the re-edit lock is missing. Reason: ${(err as Error)?.message ?? String(err)}`,
    );
  }
}

/**
 * Lock many entities in one statement instead of one statement per row.
 *
 * `lockEntity` above is right where the lock is written inside a per-row transaction that
 * has other work to do anyway. It is the wrong shape where a batch locks every row it just
 * applied as a final step: that is a bare INSERT per row, so a 1,000-row batch paid 1,000
 * sequential round trips for what is a single write. At the measured ~1.8 ms round trip to
 * this database that alone is most of a minute of pure waiting, and - worse - it holds a
 * pooled connection for the whole of it and keeps re-entering `bulk_upload_locked_entity`,
 * widening the window in which a concurrent batch can collide with it.
 *
 * Chunked rather than one enormous statement so a very large batch cannot exceed
 * `max_allowed_packet` or hold a single lock long enough to stall other writers.
 *
 * Semantics are identical to calling `lockEntity` per row, including the
 * `ON DUPLICATE KEY UPDATE locked_at = locked_at` no-op that makes a re-approval idempotent.
 */
const LOCK_INSERT_CHUNK = 500;

/**
 * NEVER THROWS, same rationale as {@link lockEntity}. `applyIncentiveBatch` calls
 * this AFTER every incentive_upload_batch row has already been flipped to
 * 'approved' — a failure here used to reject the whole function and lose the
 * `applied` count for every incentive in the batch, even though the money-moving
 * status change had already committed. One chunk failing is now logged and
 * skipped rather than discarding every chunk's already-applied result.
 */
export async function lockEntities(
  entries: readonly {
    entityType: string;
    entityId: string;
    batchId: string;
    batchNo: string | null;
    employeeId: string | null;
    lockedBy: string;
    reason?: string;
  }[],
): Promise<void> {
  if (entries.length === 0) return;

  for (let i = 0; i < entries.length; i += LOCK_INSERT_CHUNK) {
    const slice = entries.slice(i, i + LOCK_INSERT_CHUNK);
    const values: unknown[] = [];
    for (const e of slice) {
      values.push(
        randomUUID(), e.entityType, e.entityId, e.batchId,
        e.batchNo, e.employeeId, e.lockedBy,
        e.reason ?? "Created by an approved bulk upload",
      );
    }
    try {
      await withBulkLockRetry(() =>
        db.query(
          `INSERT INTO bulk_upload_locked_entity
             (id, entity_type, entity_id, upload_batch_id, upload_batch_no, employee_id, locked_by, lock_reason)
           VALUES ${slice.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}
           ON DUPLICATE KEY UPDATE locked_at = locked_at`,
          values,
        ),
      );
    } catch (err) {
      console.error(
        `[bulk-upload] lockEntities chunk failed (${slice.length} rows, entityType ` +
          `${slice[0]?.entityType}) — the underlying records were still updated; only the ` +
          `re-edit lock is missing for this chunk. Reason: ${(err as Error)?.message ?? String(err)}`,
      );
    }
  }
}

export interface EntityLock {
  upload_batch_id: string;
  upload_batch_no: string | null;
  locked_at: Date | string;
  entity_type: string;
}

/**
 * Is this row locked by an approved bulk upload? Called by the discard path.
 *
 * Returns the lock rather than a boolean so the caller can name the batch in its
 * refusal — "locked by BATCH-1787..." is actionable, "locked" is not. Also
 * returns `upload_batch_id` (not just the display `upload_batch_no`) so a caller
 * discarding rows FROM a specific batch (discard.service.ts's `discardBatchRows`)
 * can verify server-side that the row it is about to unpick genuinely belongs to
 * that batch, rather than trusting a batch id the client sent.
 */
export async function getEntityLock(
  entityType: string,
  entityId: string,
): Promise<EntityLock | null> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT entity_type, upload_batch_id, upload_batch_no, locked_at
         FROM bulk_upload_locked_entity
        WHERE entity_type = ? AND entity_id = ?
        LIMIT 1`,
      [entityType, entityId],
    );
    const row = (rows as RowDataPacket[])[0];
    return row ? (row as unknown as EntityLock) : null;
  } catch (err: unknown) {
    // The table arrives with migration 1522. Before it is applied nothing is locked,
    // so fail open rather than breaking the discard path on a database without it.
    const code = String((err as { code?: unknown })?.code ?? "");
    if (code === "ER_NO_SUCH_TABLE") return null;
    throw err;
  }
}

export interface BatchRecord extends RowDataPacket {
  id: string;
  upload_batch_no: string;
  upload_type_code: string;
  batch_status: string;
  approval_status: string | null;
  branch_id: string | null;
  uploaded_by: string;
  total_rows: number;
  valid_rows: number;
  branch_head_approved_by?: string | null;
  branch_head_approved_at?: Date | string | null;
  branch_head_remarks?: string | null;
  payroll_head_approved_by?: string | null;
  payroll_head_approved_at?: Date | string | null;
  payroll_head_remarks?: string | null;
  last_rejected_by?: string | null;
  last_rejected_at?: Date | string | null;
  last_rejected_stage?: string | null;
  last_rejected_reason?: string | null;
}

export async function getBatch(batchId: string): Promise<BatchRecord> {
  const [rows] = await db.execute<BatchRecord[]>(
    "SELECT * FROM upload_batch WHERE id = ? LIMIT 1",
    [batchId],
  );
  const batch = (rows as BatchRecord[])[0];
  if (!batch) throw new BulkUploadError("Upload batch not found", 404);
  return batch;
}

/**
 * Can this user act on this batch, at this stage?
 *
 * Four independent conditions, all required:
 *  1. They hold the approver role FOR THAT STAGE (branch_head / payroll_head).
 *  2. At stage 1, the batch branch is inside their assignment scope.
 *  3. They are not the person who uploaded it.
 *  4. At stage 2, they are not the person who approved it at stage 1.
 *
 * (3) and (4) are checked first and separately because they are what a role check
 * cannot express: a branch head who also holds wfm could otherwise upload and approve
 * the same file, and hasAnyRole returns true for super_admin unconditionally.
 *
 * WHY STAGE 2 HAS NO BRANCH-SCOPE TEST
 *
 * The Payroll Head is an HO role that decides for every branch. Live check 2026-09-03:
 * payroll_head holds no user_assignment_scope rows at all, and hasScopedAccess with
 * requireScopeForNonAdmin:true fails CLOSED on zero scopes — so applying the stage-1
 * scope test here would refuse every stage-2 approval that exists. The branch
 * restriction has already done its job one stage earlier.
 */
export async function assertCanApprove(
  userId: string,
  batch: BatchRecord,
  stage: ApprovalStage = "branch",
): Promise<void> {
  // super_admin is both maker and checker — can approve their own uploads and
  // any batch regardless of branch scope.
  if (await hasAnyRole(userId, "super_admin")) return;

  const rule = STAGE_RULES[stage];

  if (batch.uploaded_by && batch.uploaded_by === userId) {
    throw new BulkUploadError(
      `You uploaded this batch, so you cannot approve it. A different ${rule.label} must review it.`,
      403,
    );
  }

  // Separation of duties across the two stages: whoever released this at branch level
  // must not also be the one who finally releases the money. This is a real overlap —
  // a user can hold both branch_head and payroll_head.
  if (stage === "payroll" && batch.branch_head_approved_by === userId) {
    throw new BulkUploadError(
      "You approved this batch as Branch Head, so you cannot also give it final Payroll Head approval.",
      403,
    );
  }

  const isApprover = await hasAnyRole(userId, ...rule.roles);
  if (!isApprover) {
    throw new BulkUploadError(
      stage === "payroll"
        ? "Only the Payroll Head can give final approval to an incentive or deduction batch."
        : "Only a Branch Head can approve a bulk upload of leave, regularization, incentive or deduction.",
      403,
    );
  }

  if (stage === "branch") {
    const inScope = await hasScopedAccess(
      userId,
      rule.roles,
      { branchId: batch.branch_id },
      { allowAdminBypass: false, requireScopeForNonAdmin: true },
    );
    if (!inScope) {
      throw new BulkUploadError("This batch belongs to a branch outside your scope.", 403);
    }
  }
}

export interface ReconcileResult {
  totalRows: number;
  importedRows: number;
  errorRows: number;
  discardedRows: number;
  /**
   * Rows that needed no work and were correctly left alone — not a success, not a failure.
   * A leave day falling entirely on a roster week-off is the case this exists for: there is
   * nothing to charge, so creating a request would deduct entitlement for a non-working day,
   * but failing the row tells the uploader their file was wrong when it was not.
   */
  skippedRows: number;
  /** Rows THIS call had to force-resolve because they were never reached. */
  recoveredRows: number;
}

/**
 * Second line of defence for the staging phase. No row may ever be left invisible.
 *
 * importRegularizationBatch / importLeaveBatch / etc. process every row through a
 * per-employee concurrency group and are supposed to always call either
 * linkRowToEntity (success) or markRowFailed (failure) — but a batch is only as
 * reliable as its slowest write, and every write above this now retries, not
 * guarantees. If a row is STILL sitting at 'pending'/'valid' by the time the batch
 * is declared decided, that row was silently dropped: nothing was created for it and
 * no one was told. Two live batches did exactly this — BATCH-1788166312651 (11/11
 * rows, labelled "Approved") and BATCH-1788438594771 (17 of 614 rows, invisible
 * inside a batch that otherwise looked like a clean "Imported").
 *
 * Called at the end of markPendingApproval, before the batch's own imported_rows /
 * error_rows are written — so the counts on the batch are always the TRUE count of
 * what upload_batch_row actually holds, not just what the caller's own in-memory
 * tally happened to observe before something crashed.
 */
export async function reconcileStuckRows(batchId: string): Promise<ReconcileResult> {
  const [strayResult] = await db.execute<ResultSetHeader>(
    `UPDATE upload_batch_row
        SET row_status = 'error',
            error_messages = ?
      WHERE upload_batch_id = ?
        AND row_status NOT IN ('imported', 'error', 'discarded', 'skipped')`,
    [
      JSON.stringify([
        "This row never reached a final outcome — the batch finished processing without " +
          "it. Nothing was created or changed for it. Re-upload this row to try again.",
      ]),
      batchId,
    ],
  );
  const recoveredRows = strayResult.affectedRows;
  if (recoveredRows > 0) {
    console.error(
      `[bulk-upload] reconcileStuckRows recovered ${recoveredRows} orphaned row(s) on batch ${batchId} ` +
        `that were never resolved during import.`,
    );
  }

  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total,
            SUM(row_status = 'imported')  AS imported,
            SUM(row_status = 'error')     AS error_count,
            SUM(row_status = 'discarded') AS discarded,
            SUM(row_status = 'skipped')   AS skipped
       FROM upload_batch_row
      WHERE upload_batch_id = ?`,
    [batchId],
  );
  const c = (countRows as RowDataPacket[])[0] ?? {};
  return {
    totalRows: Number(c.total ?? 0),
    importedRows: Number(c.imported ?? 0),
    errorRows: Number(c.error_count ?? 0),
    discardedRows: Number(c.discarded ?? 0),
    skippedRows: Number(c.skipped ?? 0),
    recoveredRows,
  };
}

/**
 * The target table + the status value that means "this row's correction is really
 * in effect", one entry per approval-gated entity type.
 */
const APPLIED_CHECK: Record<string, { sql: string; appliedValues: string[] }> = {
  attendance_regularization: {
    sql: `SELECT id, status FROM attendance_regularization WHERE id IN (%IDS%)`,
    appliedValues: ["approved"],
  },
  leave_request: {
    sql: `SELECT id, status FROM leave_request WHERE id IN (%IDS%)`,
    appliedValues: ["approved"],
  },
  employee_deduction_entries: {
    sql: `SELECT id, status FROM employee_deduction_entries WHERE id IN (%IDS%)`,
    appliedValues: ["active"],
  },
  incentive_upload_line: {
    sql: `SELECT iul.id AS id, iub.status AS status
            FROM incentive_upload_line iul
            JOIN incentive_upload_batch iub ON iub.id = iul.batch_id
           WHERE iul.id IN (%IDS%)`,
    appliedValues: ["approved"],
  },
};

export interface VerifyResult {
  checked: number;
  confirmed: number;
  /** Rows this call had to flip from 'imported' to 'error' because the record they
   *  point at does not actually show the applied status. */
  mismatched: number;
}

/**
 * Second line of defence for the APPLY phase. row_status alone cannot prove a
 * correction actually landed: on success, apply*Batch never touches
 * upload_batch_row at all (it was already 'imported' from staging), so a row whose
 * concurrency group crashed mid-apply is INDISTINGUISHABLE, by row_status, from one
 * that genuinely succeeded. The only honest answer is to go and look at the record
 * the row actually points to.
 *
 * Call this immediately after apply*Batch returns, before the outcome is reported —
 * so "Imported" on screen means what it says, not "row_status says imported."
 * Every row it flips is subtracted from the caller's own applied/failed tally.
 */
export async function verifyRowsActuallyApplied(
  batchId: string,
  entityType: string,
): Promise<VerifyResult> {
  const cfg = APPLIED_CHECK[entityType];
  if (!cfg) return { checked: 0, confirmed: 0, mismatched: 0 };

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, created_entity_id
       FROM upload_batch_row
      WHERE upload_batch_id = ? AND created_entity_type = ? AND row_status = 'imported'
        AND created_entity_id IS NOT NULL`,
    [batchId, entityType],
  );
  const rowsArr = rows as RowDataPacket[];
  if (rowsArr.length === 0) return { checked: 0, confirmed: 0, mismatched: 0 };

  const ids = rowsArr.map((r) => String(r.created_entity_id));
  const placeholders = ids.map(() => "?").join(",");
  const [statusRows] = await db.execute<RowDataPacket[]>(
    cfg.sql.replace("%IDS%", placeholders),
    ids,
  );
  const statusMap = new Map<string, string>();
  for (const s of statusRows as RowDataPacket[]) statusMap.set(String(s.id), String(s.status));

  let confirmed = 0;
  let mismatched = 0;
  for (const r of rowsArr) {
    const status = statusMap.get(String(r.created_entity_id));
    if (status && cfg.appliedValues.includes(status)) {
      confirmed++;
      continue;
    }
    mismatched++;
    await markRowFailed(
      String(r.id),
      `This row's record was created but the batch finished without it actually being ` +
        `approved (current status: ${status ?? "record not found"}). The correction was ` +
        `NOT applied — re-run approval for this row.`,
    );
  }
  if (mismatched > 0) {
    console.error(
      `[bulk-upload] verifyRowsActuallyApplied caught ${mismatched} row(s) on batch ${batchId} ` +
        `(${entityType}) marked 'imported' whose underlying record was never actually applied.`,
    );
  }
  return { checked: rowsArr.length, confirmed, mismatched };
}

/**
 * The "View Rows" data, with the ground truth attached to each row instead of just
 * upload_batch_row's own (sometimes wrong) row_status — this is what lets a user see
 * which entries are actually recorded in the database rather than trusting a status
 * word. `entity_created` is a plain existence check; `entity_status` is the live
 * value read from the real table right now (attendance_regularization.status,
 * leave_request.status, the incentive batch's status, the deduction entry's status) —
 * 'pending' legitimately means "created, not yet approved", not a fault.
 */
export interface RowWithLiveStatus extends RowDataPacket {
  entity_created: boolean;
  entity_status: string | null;
}

export async function loadRowsWithLiveStatus(batchId: string): Promise<RowWithLiveStatus[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM upload_batch_row WHERE upload_batch_id = ? ORDER BY row_no ASC",
    [batchId],
  );
  const rowsArr = rows as RowWithLiveStatus[];

  const byType = new Map<string, string[]>();
  for (const r of rowsArr) {
    if (r.created_entity_id && r.created_entity_type) {
      const key = String(r.created_entity_type);
      if (!byType.has(key)) byType.set(key, []);
      byType.get(key)!.push(String(r.created_entity_id));
    }
  }

  const statusByEntity = new Map<string, string>();
  for (const [entityType, ids] of byType) {
    const cfg = APPLIED_CHECK[entityType];
    if (!cfg || ids.length === 0) continue;
    const placeholders = ids.map(() => "?").join(",");
    const [statusRows] = await db.execute<RowDataPacket[]>(
      cfg.sql.replace("%IDS%", placeholders),
      ids,
    );
    for (const s of statusRows as RowDataPacket[]) statusByEntity.set(String(s.id), String(s.status));
  }

  for (const r of rowsArr) {
    const entityId = r.created_entity_id ? String(r.created_entity_id) : null;
    r.entity_created = Boolean(entityId);
    r.entity_status = entityId ? statusByEntity.get(entityId) ?? null : null;
  }
  return rowsArr;
}

/**
 * Move a batch into the branch-head queue after its rows have been staged.
 *
 * A batch where NOTHING staged does not go into the queue. Every caller used to call this
 * unconditionally, so a file whose rows all failed validation still arrived in the Branch
 * Head's queue with nothing in it to approve — and because an approver cannot approve zero
 * rows, it sat there for good. Live example: LEAVE_APPLICATION_BULK batch
 * BATCH-1788439883458-R1481-R6759, 17 rows, 0 staged, still listed as awaiting approval
 * alongside the resubmit of the very same file, which is what "two bulk approvals pending"
 * turned out to be.
 *
 * approval_status is set to NULL rather than a new terminal value so the queue's own
 * `approval_status IN (...)` filters exclude it without any of them having to change.
 */
export async function markPendingApproval(
  batchId: string,
  branchId: string | null,
  staged: number,
  failed: number,
): Promise<void> {
  // Recompute from upload_batch_row itself rather than trusting the caller's own
  // staged/failed tally — that tally is accumulated in-memory as each concurrency
  // group finishes, and a group that crashed partway (see reconcileStuckRows' own
  // comment) never contributes to it at all, so it can silently undercount. Any row
  // still unresolved at this point is force-closed here, before the batch is ever
  // shown to a branch head as ready for decision.
  const reconciled = await reconcileStuckRows(batchId);
  const trueStaged = reconciled.importedRows;
  const trueFailed = reconciled.errorRows;

  if (trueStaged <= 0) {
    await db.execute<ResultSetHeader>(
      `UPDATE upload_batch
          SET batch_status = 'validation_failed',
              approval_status = NULL,
              branch_id = ?,
              imported_rows = 0,
              error_rows = ?,
              updated_at = NOW()
        WHERE id = ?`,
      [branchId, trueFailed, batchId],
    );
    return;
  }

  await db.execute<ResultSetHeader>(
    `UPDATE upload_batch
        SET batch_status = 'pending_approval',
            approval_status = 'pending_branch_head',
            branch_id = ?,
            submitted_for_approval_at = NOW(),
            imported_rows = ?,
            error_rows = ?,
            updated_at = NOW()
      WHERE id = ?`,
    [branchId, trueStaged, trueFailed, batchId],
  );

  // staged/failed are kept as parameters (not removed) so callers' own return
  // values (ImportOutcome, shown to the uploader immediately after upload) still
  // reflect what THAT request itself did — only the persisted batch row uses the
  // reconciled truth. A mismatch between the two now means "something was silently
  // dropped and has been auto-recovered", which is exactly what recoveredRows is for.
  void staged;
  void failed;
}

export async function markDecided(
  batchId: string,
  status: BulkApprovalStatus,
  userId: string,
  remarks: string | null,
  summary: string,
  // Optional: lets the caller's real applied/failed counts pick an honest label
  // instead of blindly writing 'imported' for a decided batch. Without this,
  // BATCH-1788264204600 (217/217 rows errored during apply) still displayed as
  // "Imported" — technically true of the DECISION, misleading about the OUTCOME.
  counts?: { applied: number; failed: number },
): Promise<void> {
  const batchStatus =
    status === "rejected"
      ? "rejected"
      : counts && counts.applied === 0 && counts.failed > 0
        ? "failed"
        : counts && counts.failed > 0
          ? "imported_with_errors"
          : "imported";

  await db.execute(
    `UPDATE upload_batch
        SET batch_status = ?,
            approval_status = ?,
            approved_by = ?,
            approved_at = NOW(),
            approval_remarks = ?,
            error_summary = ?,
            updated_at = NOW()
      WHERE id = ?`,
    [batchStatus, status, userId, remarks, summary.slice(0, 1000), batchId],
  );
}

/**
 * Record a decision at one stage of the chain.
 *
 * Guarded on the status the batch is expected to hold, so two approvers pressing the
 * button at the same moment cannot both advance it — the loser gets affectedRows 0 and
 * is told the state changed, rather than silently double-advancing a payment.
 *
 * `approved_by` / `approved_at` / `approval_remarks` keep their existing meaning as the
 * LATEST decision, so every existing reader (the history endpoint, the approvals page,
 * the audit export) keeps working untouched. The per-stage columns are additive.
 */
export async function markStageDecided(params: {
  batchId: string;
  stage: ApprovalStage;
  next: BulkApprovalStatus;
  expectedFrom: BulkApprovalStatus;
  batchStatus: string;
  userId: string;
  remarks: string | null;
  summary: string;
}): Promise<boolean> {
  const stageColumns =
    params.stage === "branch"
      ? "branch_head_approved_by = ?, branch_head_approved_at = NOW(), branch_head_remarks = ?"
      : "payroll_head_approved_by = ?, payroll_head_approved_at = NOW(), payroll_head_remarks = ?";

  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE upload_batch
        SET batch_status = ?,
            approval_status = ?,
            approved_by = ?,
            approved_at = NOW(),
            approval_remarks = ?,
            error_summary = ?,
            ${stageColumns},
            updated_at = NOW()
      WHERE id = ? AND approval_status = ?`,
    [
      params.batchStatus, params.next, params.userId, params.remarks,
      params.summary.slice(0, 1000),
      params.userId, params.remarks,
      params.batchId, params.expectedFrom,
    ],
  );
  return res.affectedRows > 0;
}

/** Record a rejection, naming the stage that refused it and why. */
export async function markStageRejected(params: {
  batchId: string;
  stage: ApprovalStage;
  expectedFrom: BulkApprovalStatus;
  userId: string;
  reason: string;
  summary: string;
}): Promise<boolean> {
  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE upload_batch
        SET batch_status = 'rejected',
            approval_status = 'rejected',
            approved_by = ?,
            approved_at = NOW(),
            approval_remarks = ?,
            error_summary = ?,
            last_rejected_by = ?,
            last_rejected_at = NOW(),
            last_rejected_stage = ?,
            last_rejected_reason = ?,
            updated_at = NOW()
      WHERE id = ? AND approval_status = ?`,
    [
      params.userId, params.reason, params.summary.slice(0, 1000),
      params.userId, params.stage, params.reason,
      params.batchId, params.expectedFrom,
    ],
  );
  return res.affectedRows > 0;
}

/**
 * Claim the batch before a long-running apply, so a client retry after a false
 * timeout cannot run the domain engines twice and double-deduct a leave balance.
 * Mirrors the claim the existing import dispatcher uses.
 */
// A claim older than this is assumed to be from a crashed server and is safe to release.
const STALE_CLAIM_MINUTES = 5;

export async function claimForDecision(
  batchId: string,
  expectedStatus: BulkApprovalStatus = "pending_branch_head",
): Promise<boolean> {
  // Auto-release any claim that has been stuck in 'approving' for more than
  // STALE_CLAIM_MINUTES — this happens when the server restarts mid-approval.
  await db.execute(
    `UPDATE upload_batch
        SET batch_status = 'pending_approval', updated_at = NOW()
      WHERE id = ? AND batch_status = 'approving'
        AND updated_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
    [batchId, STALE_CLAIM_MINUTES],
  );
  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE upload_batch
        SET batch_status = 'approving', updated_at = NOW()
      WHERE id = ? AND approval_status = ? AND batch_status <> 'approving'`,
    [batchId, expectedStatus],
  );
  return res.affectedRows > 0;
}

export async function releaseClaim(batchId: string): Promise<void> {
  await db.execute(
    `UPDATE upload_batch SET batch_status = 'pending_approval', updated_at = NOW()
      WHERE id = ? AND batch_status = 'approving'`,
    [batchId],
  );
}

/** Force-releases a stuck claim regardless of age. Super-admin only. */
export async function releaseStuckClaim(batchId: string): Promise<boolean> {
  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE upload_batch SET batch_status = 'pending_approval', updated_at = NOW()
      WHERE id = ? AND batch_status = 'approving'`,
    [batchId],
  );
  return res.affectedRows > 0;
}

export async function auditBatchAction(params: {
  userId: string;
  actionType: string;
  batch: BatchRecord;
  reason?: string;
  detail?: Record<string, unknown>;
  req?: Request;
}): Promise<void> {
  void logSensitiveAction({
    actor_user_id: params.userId,
    action_type: params.actionType,
    module_key: "bulk_upload",
    entity_type: "upload_batch",
    entity_id: params.batch.id,
    reason: params.reason,
    new_value_json: {
      upload_batch_no: params.batch.upload_batch_no,
      upload_type_code: params.batch.upload_type_code,
      branch_id: params.batch.branch_id,
      ...params.detail,
    },
    req: params.req,
  });
}

interface FailedRowForEmail {
  row_no: number;
  raw_data: Record<string, unknown>;
  error_messages: string[];
}

/**
 * Sends an email to the batch uploader listing the rows that failed during
 * partial approval, so they can fix and re-upload only the failed records.
 */
export async function sendPartialApplyEmail(params: {
  batch: BatchRecord;
  appliedCount: number;
  failedCount: number;
  approverName: string;
  remarks: string | null;
}): Promise<void> {
  if (!emailService.isConfigured()) return;

  // Fetch uploader email
  const [userRows] = await db.execute<RowDataPacket[]>(
    // auth_user has no full_name column — verified live 2026-09-03, its columns are id,
    // email, password_hash and login bookkeeping. This selected one, so every execution
    // raised ER_BAD_FIELD_ERROR and the partial-approval email has never been sent since
    // it was written. The display name lives on employees, joined via employees.user_id.
    `SELECT au.email,
            COALESCE(NULLIF(TRIM(e.full_name), ''),
                     NULLIF(TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))), ''),
                     au.email) AS full_name
       FROM auth_user au
       LEFT JOIN employees e ON e.user_id = au.id
      WHERE au.id = ? LIMIT 1`,
    [params.batch.uploaded_by],
  );
  const uploader = (userRows as RowDataPacket[])[0];
  if (!uploader?.email) return;

  // Fetch failed rows
  const [rowData] = await db.execute<RowDataPacket[]>(
    `SELECT row_no, raw_data, error_messages
       FROM upload_batch_row
      WHERE upload_batch_id = ?
        AND (row_status = 'error' OR row_status = 'failed')
      ORDER BY row_no ASC
      LIMIT 200`,
    [params.batch.id],
  );
  const failedRows = (rowData as RowDataPacket[]).map((r) => ({
    row_no: r.row_no as number,
    raw_data: (typeof r.raw_data === "string" ? JSON.parse(r.raw_data) : r.raw_data) as Record<string, unknown>,
    error_messages: (typeof r.error_messages === "string" ? JSON.parse(r.error_messages) : r.error_messages ?? []) as string[],
  })) as FailedRowForEmail[];

  if (!failedRows.length) return;

  // Derive column headers from the first row's keys
  const dataKeys = Object.keys(failedRows[0].raw_data);

  const tableRows = failedRows.map((row) => {
    const cells = dataKeys.map(
      (k) => `<td style="padding:6px 10px;border:1px solid #e2e8f0;white-space:nowrap">${String(row.raw_data[k] ?? "")}</td>`,
    ).join("");
    const errors = (row.error_messages || []).map((e) => `<li>${e}</li>`).join("");
    return `<tr>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;font-weight:600;color:#64748b">${row.row_no}</td>
      ${cells}
      <td style="padding:6px 10px;border:1px solid #e2e8f0;color:#dc2626"><ul style="margin:0;padding-left:14px">${errors}</ul></td>
    </tr>`;
  }).join("");

  const headerCells = [`<th style="padding:6px 10px;border:1px solid #cbd5e1;background:#f8fafc;text-align:left">Row #</th>`,
    ...dataKeys.map((k) => `<th style="padding:6px 10px;border:1px solid #cbd5e1;background:#f8fafc;text-align:left">${k}</th>`),
    `<th style="padding:6px 10px;border:1px solid #cbd5e1;background:#f8fafc;text-align:left;color:#dc2626">Errors (fix & re-upload)</th>`,
  ].join("");

  const typeLabel: Record<string, string> = {
    LEAVE_APPLICATION_BULK: "Leave Application",
    ATTENDANCE_REGULARIZATION_BULK: "Attendance Regularization",
    INCENTIVE_BULK: "Incentive",
    DEDUCTION_BULK: "Deduction",
  };

  const html = `
<div style="font-family:Inter,Arial,sans-serif;max-width:900px;margin:0 auto;color:#1e293b">
  <div style="background:#1e293b;padding:20px 28px;border-radius:12px 12px 0 0">
    <h2 style="margin:0;color:#fff;font-size:18px">MAS Callnet PeopleOS — Partial Approval Notice</h2>
  </div>
  <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;padding:24px 28px;border-radius:0 0 12px 12px">
    <p>Hi ${uploader.full_name || uploader.email},</p>
    <p>Your bulk upload batch <strong>${params.batch.upload_batch_no}</strong> (${typeLabel[params.batch.upload_type_code] ?? params.batch.upload_type_code}) has been <strong>partially approved</strong> by ${params.approverName}.</p>

    <table style="border-collapse:collapse;width:100%;margin:12px 0">
      <tr>
        <td style="padding:6px 12px;background:#f0fdf4;border-radius:6px;font-weight:600;color:#16a34a">✓ ${params.appliedCount} row(s) applied successfully</td>
      </tr>
      <tr><td style="height:6px"></td></tr>
      <tr>
        <td style="padding:6px 12px;background:#fef2f2;border-radius:6px;font-weight:600;color:#dc2626">✗ ${params.failedCount} row(s) failed — listed below</td>
      </tr>
    </table>

    ${params.remarks ? `<p style="background:#f8fafc;border-left:3px solid #94a3b8;padding:8px 12px;margin:12px 0;font-size:13px"><strong>Approver remarks:</strong> ${params.remarks}</p>` : ""}

    <h3 style="font-size:14px;margin:20px 0 8px;color:#dc2626">Failed Rows — Fix and Re-Upload</h3>
    <p style="font-size:13px;color:#64748b;margin:0 0 10px">Correct the highlighted errors in each row below and submit a new upload batch.</p>

    <div style="overflow-x:auto">
      <table style="border-collapse:collapse;font-size:12px;width:100%">
        <thead><tr>${headerCells}</tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>

    <p style="margin-top:20px;font-size:13px;color:#64748b">
      Log in to <a href="https://mcnhrms.teammas.in/bulk-upload" style="color:#4f46e5">PeopleOS Bulk Upload</a>, create a new batch with only the failed rows above (corrected), and submit for re-approval.
    </p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
    <p style="font-size:11px;color:#94a3b8">MAS Callnet PeopleOS · Automated notification — do not reply</p>
  </div>
</div>`;

  // Build CSV attachment — headers + data + errors column
  const csvHeaders = ["Row No", ...dataKeys, "Errors"];
  const csvLines = [
    csvHeaders.map((h) => `"${h}"`).join(","),
    ...failedRows.map((row) => {
      const cells = [
        row.row_no,
        ...dataKeys.map((k) => `"${String(row.raw_data[k] ?? "").replace(/"/g, '""')}"`),
        `"${(row.error_messages || []).join("; ").replace(/"/g, '""')}"`,
      ];
      return cells.join(",");
    }),
  ];
  const csvContent = csvLines.join("\n");

  await emailService.send({
    to: uploader.email as string,
    subject: `[PeopleOS] Partial Approval — ${params.batch.upload_batch_no} (${params.failedCount} row(s) need correction)`,
    html,
    text: `Hi ${uploader.full_name || uploader.email},\n\nYour batch ${params.batch.upload_batch_no} was partially approved.\n${params.appliedCount} row(s) succeeded, ${params.failedCount} row(s) failed.\n\nFailed rows are attached as a CSV. Fix the errors and re-upload a new batch.\n\nMAS Callnet PeopleOS`,
    attachments: [
      {
        filename: `failed_rows_${params.batch.upload_batch_no}.csv`,
        content: Buffer.from(csvContent, "utf8"),
        contentType: "text/csv",
      },
    ],
  }).catch(() => { /* email failure must not block the approval response */ });
}

/**
 * Normalise a spreadsheet date cell to YYYY-MM-DD.
 *
 * Three shapes have to be accepted, because all three genuinely arrive:
 *  - YYYY-MM-DD, what the sample template ships and what the DB stores.
 *  - DD-MM-YYYY / DD/MM/YYYY, what the Bulk Upload Hub's own template guide tells
 *    users to type, and what an Indian-locale Excel writes.
 *  - A serial number like 46234, what a real .xlsx gives when the cell is formatted
 *    as a date rather than text — the failure that broke the roster import on live
 *    files, where every date silently became a number.
 *
 * Returns null for anything unrecognised, so the caller reports a row error instead
 * of writing a wrong date.
 */
export function normalizeDate(raw: string | undefined | null): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const dmy = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    // Day-first, not month-first: the template guide specifies DD-MM-YYYY and the
    // users are in India. An ambiguous 05-06-2026 must resolve the same way the
    // guide told the uploader it would.
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  if (/^\d{5}$/.test(value)) {
    // Excel serial: day 1 is 1900-01-01, offset by the famous phantom 1900 leap day.
    const serial = Number(value);
    const ms = (serial - 25_569) * 86_400_000;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }

  return null;
}

/** Normalise a month cell to YYYY-MM, accepting MM-YYYY and a full date too. */
export function normalizeMonth(raw: string | undefined | null): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (/^\d{4}-\d{2}$/.test(value)) return value;
  const mmyyyy = value.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (mmyyyy) return `${mmyyyy[2]}-${mmyyyy[1].padStart(2, "0")}`;
  const asDate = normalizeDate(value);
  return asDate ? asDate.slice(0, 7) : null;
}
