import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface WithdrawalFilters {
  status?: string;
  branchId?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRef(): string {
  return `WDRAW-${Date.now().toString(36).toUpperCase()}`;
}

async function insertAuditLog(
  withdrawalId: string,
  action: string,
  performedBy: string,
  remarks?: string
): Promise<void> {
  await db.execute(
    `INSERT INTO dpdp_withdrawal_audit_log
       (id, withdrawal_id, action, performed_by, remarks, performed_at)
     VALUES (UUID(), ?, ?, ?, ?, NOW())`,
    [withdrawalId, action, performedBy, remarks ?? null]
  );
}

// ── Service functions ─────────────────────────────────────────────────────────

/**
 * Employee (or HR on behalf) submits a withdrawal request.
 */
export async function submitRequest(
  requesterId: string,
  requesterType: string,
  scopeJson: unknown,
  reason: string,
  channel: string
): Promise<{ id: string; request_ref: string }> {
  const id = randomUUID();
  const requestRef = makeRef();

  await db.execute(
    `INSERT INTO dpdp_consent_withdrawal
       (id, requester_id, requester_type, withdrawal_scope_json, withdrawal_reason,
        request_channel, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'submitted', NOW())`,
    [
      id,
      requesterId,
      requesterType ?? "employee",
      scopeJson ? JSON.stringify(scopeJson) : null,
      reason,
      channel ?? "self",
    ]
  );

  await insertAuditLog(id, "submitted", requesterId, "Request submitted by principal");

  // Work item for HR/DPO to pick up
  await db.execute(
    `INSERT INTO work_items
       (id, item_type, reference_id, assigned_role, title, status, created_by, created_at)
     VALUES (UUID(), 'dpdp_withdrawal', ?, 'hr', 'DPDP Withdrawal pending review', 'open', ?, NOW())`,
    [id, requesterId]
  ).catch(() => {
    // work_items table may not exist in all environments — non-fatal
  });

  return { id, request_ref: requestRef };
}

/**
 * Employee views their own requests.
 */
export async function getMyRequests(requesterId: string): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM dpdp_consent_withdrawal
     WHERE requester_id = ?
     ORDER BY created_at DESC`,
    [requesterId]
  );
  return rows;
}

/**
 * HR/compliance views all requests with optional filters.
 */
export async function listAll(filters: WithdrawalFilters): Promise<RowDataPacket[]> {
  const conditions: string[] = ["1=1"];
  const params: unknown[] = [];

  if (filters.status) {
    conditions.push("dcw.status = ?");
    params.push(filters.status);
  }
  if (filters.branchId) {
    conditions.push("e.branch_id = ?");
    params.push(filters.branchId);
  }

  const where = conditions.join(" AND ");

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT dcw.*, u.full_name AS requester_name
     FROM dpdp_consent_withdrawal dcw
     LEFT JOIN users u ON u.id = dcw.requester_id
     WHERE ${where}
     ORDER BY dcw.created_at DESC
     LIMIT 500`,
    params
  );
  return rows;
}

/**
 * Get single request. Non-HR callers may only see their own.
 */
export async function getById(
  id: string,
  requesterId?: string,
  isHr = false
): Promise<RowDataPacket | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT dcw.*, u.full_name AS requester_name
     FROM dpdp_consent_withdrawal dcw
     LEFT JOIN users u ON u.id = dcw.requester_id
     WHERE dcw.id = ?
     LIMIT 1`,
    [id]
  );
  if (!rows.length) return null;
  const record = rows[0];
  if (!isHr && requesterId && record.requester_id !== requesterId) return null;
  return record;
}

/**
 * HR starts review: status → in_review, insert processing hold.
 */
export async function startReview(id: string, reviewedBy: string): Promise<void> {
  await db.execute(
    `UPDATE dpdp_consent_withdrawal
     SET status = 'in_review', reviewed_by = ?, reviewed_at = NOW(),
         processing_hold_active = 1, hold_applied_at = NOW()
     WHERE id = ? AND status = 'submitted'`,
    [reviewedBy, id]
  );

  await db.execute(
    `INSERT INTO dpdp_processing_hold
       (id, withdrawal_id, held_by, hold_reason, is_active, held_at)
     VALUES (UUID(), ?, ?, 'Withdrawal review in progress', 1, NOW())`,
    [id, reviewedBy]
  ).catch(() => {});

  await insertAuditLog(id, "review_started", reviewedBy, "Review started; processing hold applied");
}

/**
 * HR/DPO approves request.
 */
export async function approve(
  id: string,
  approvedBy: string,
  remarks?: string
): Promise<void> {
  await db.execute(
    `UPDATE dpdp_consent_withdrawal
     SET status = 'approved',
         reviewed_by = COALESCE(reviewed_by, ?),
         reviewed_at = COALESCE(reviewed_at, NOW()),
         review_remarks = ?,
         processing_hold_active = 0,
         hold_released_at = NOW(),
         data_restriction_applied = 1,
         data_restriction_at = NOW(),
         restricted_by = ?
     WHERE id = ?`,
    [approvedBy, remarks ?? null, approvedBy, id]
  );

  // Release any active hold record
  await db.execute(
    `UPDATE dpdp_processing_hold
     SET is_active = 0, released_at = NOW(), released_by = ?, release_reason = 'Withdrawal approved'
     WHERE withdrawal_id = ? AND is_active = 1`,
    [approvedBy, id]
  ).catch(() => {});

  await insertAuditLog(id, "approved", approvedBy, remarks ?? "Withdrawal approved");

  // Notification work item for requester
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT requester_id FROM dpdp_consent_withdrawal WHERE id = ? LIMIT 1",
    [id]
  );
  if (rows.length) {
    await db.execute(
      `INSERT INTO work_items
         (id, item_type, reference_id, assigned_user, title, status, created_by, created_at)
       VALUES (UUID(), 'dpdp_withdrawal_notification', ?, ?, 'Your data withdrawal request was approved', 'open', ?, NOW())`,
      [id, rows[0].requester_id, approvedBy]
    ).catch(() => {});
  }
}

/**
 * HR/DPO rejects request.
 */
export async function reject(
  id: string,
  rejectedBy: string,
  reason: string
): Promise<void> {
  await db.execute(
    `UPDATE dpdp_consent_withdrawal
     SET status = 'rejected',
         reviewed_by = COALESCE(reviewed_by, ?),
         reviewed_at = COALESCE(reviewed_at, NOW()),
         review_remarks = ?,
         processing_hold_active = 0,
         hold_released_at = NOW()
     WHERE id = ?`,
    [rejectedBy, reason, id]
  );

  await db.execute(
    `UPDATE dpdp_processing_hold
     SET is_active = 0, released_at = NOW(), released_by = ?, release_reason = 'Withdrawal rejected'
     WHERE withdrawal_id = ? AND is_active = 1`,
    [rejectedBy, id]
  ).catch(() => {});

  await insertAuditLog(id, "rejected", rejectedBy, reason);
}

/**
 * Manually release a processing hold without full approval/rejection.
 */
export async function releaseHold(id: string, releasedBy: string): Promise<void> {
  await db.execute(
    `UPDATE dpdp_processing_hold
     SET is_active = 0, released_at = NOW(), released_by = ?, release_reason = 'Manual hold release'
     WHERE withdrawal_id = ? AND is_active = 1`,
    [releasedBy, id]
  ).catch(() => {});

  await db.execute(
    `UPDATE dpdp_consent_withdrawal
     SET processing_hold_active = 0, hold_released_at = NOW()
     WHERE id = ?`,
    [id]
  );

  await insertAuditLog(id, "hold_released", releasedBy, "Processing hold manually released");
}

/**
 * Return full audit trail for a withdrawal request.
 */
export async function getAudit(id: string): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT dwal.*, u.full_name AS performed_by_name
     FROM dpdp_withdrawal_audit_log dwal
     LEFT JOIN users u ON u.id = dwal.performed_by
     WHERE dwal.withdrawal_id = ?
     ORDER BY dwal.performed_at DESC`,
    [id]
  );
  return rows;
}
