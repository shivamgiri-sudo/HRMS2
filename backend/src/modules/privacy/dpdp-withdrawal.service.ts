import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface WithdrawalFilters {
  status?: string;
  branchId?: string;
  dateFrom?: string;
  dateTo?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRef(): string {
  return `WDRAW-${Date.now().toString(36).toUpperCase()}`;
}

async function insertAuditLog(
  withdrawalId: string,
  action: string,
  performedBy: string,
  opts?: { fromStatus?: string; toStatus?: string; remarks?: string }
): Promise<void> {
  await db.execute(
    `INSERT INTO dpdp_withdrawal_audit_log
       (id, withdrawal_id, action, from_status, to_status, performed_by, remarks, performed_at)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, NOW())`,
    [
      withdrawalId,
      action,
      opts?.fromStatus ?? null,
      opts?.toStatus ?? null,
      performedBy,
      opts?.remarks ?? null,
    ]
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
  channel: string,
  extras?: { requester_ip?: string; requester_ua?: string }
): Promise<{ id: string; request_ref: string }> {
  const id = randomUUID();
  const requestRef = `WDR-${id.slice(0, 8).toUpperCase()}`;

  await db.execute(
    `INSERT INTO dpdp_consent_withdrawal
       (id, requester_id, requester_type, withdrawal_scope_json, withdrawal_reason,
        request_channel, status, sla_due_at, reference_number, requester_ip, requester_ua, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'submitted', DATE_ADD(NOW(), INTERVAL 72 HOUR), ?, ?, ?, NOW())`,
    [
      id,
      requesterId,
      requesterType ?? "employee",
      scopeJson ? JSON.stringify(scopeJson) : null,
      reason,
      channel ?? "self",
      requestRef,
      extras?.requester_ip ?? null,
      extras?.requester_ua ?? null,
    ]
  );

  await insertAuditLog(id, "DPDP_WITHDRAWAL_SUBMITTED", requesterId, {
    toStatus: "submitted",
    remarks: "Request submitted by principal",
  });

  // Work item for compliance/DPO to pick up (DPDP Act §13 — 72-hour review SLA)
  await db.execute(
    `INSERT INTO work_item
       (id, item_type, title, module_code, entity_type, entity_id, assigned_to_role, priority, status, created_at)
     VALUES (UUID(), 'DPDP_WITHDRAWAL_REVIEW', ?, 'compliance', 'dpdp_withdrawal', ?, 'compliance', 'high', 'pending', NOW())`,
    ["DPDP Withdrawal pending review", id]
  ).catch(() => {
    // work_item table may not exist in all environments — non-fatal
  });

  return { id, request_ref: requestRef };
}

/**
 * Employee views their own requests.
 */
export async function getMyRequests(requesterId: string): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, requester_id, requester_type, withdrawal_scope_json, withdrawal_reason,
            request_channel, status, processing_hold_active, hold_applied_at, hold_released_at,
            data_restriction_applied, data_restriction_at, review_remarks, escalation_required,
            created_at
     FROM dpdp_consent_withdrawal
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
  if (filters.dateFrom) {
    conditions.push("dcw.created_at >= ?");
    params.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    conditions.push("dcw.created_at <= ?");
    params.push(filters.dateTo + " 23:59:59");
  }

  const where = conditions.join(" AND ");

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT dcw.*,
            COALESCE(
              NULLIF(requester_emp.full_name, ''),
              NULLIF(TRIM(CONCAT(COALESCE(requester_emp.first_name, ''), ' ', COALESCE(requester_emp.last_name, ''))), ''),
              requester_user.email
            ) AS requester_name
     FROM dpdp_consent_withdrawal dcw
     LEFT JOIN auth_user requester_user ON requester_user.id = dcw.requester_id
     LEFT JOIN employees requester_emp ON requester_emp.user_id = requester_user.id AND requester_emp.active_status = 1
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
    `SELECT dcw.*,
            COALESCE(
              NULLIF(requester_emp.full_name, ''),
              NULLIF(TRIM(CONCAT(COALESCE(requester_emp.first_name, ''), ' ', COALESCE(requester_emp.last_name, ''))), ''),
              requester_user.email
            ) AS requester_name
     FROM dpdp_consent_withdrawal dcw
     LEFT JOIN auth_user requester_user ON requester_user.id = dcw.requester_id
     LEFT JOIN employees requester_emp ON requester_emp.user_id = requester_user.id AND requester_emp.active_status = 1
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

  await insertAuditLog(id, "DPDP_WITHDRAWAL_REVIEW_STARTED", reviewedBy, {
    fromStatus: "submitted",
    toStatus: "in_review",
    remarks: "Review started; processing hold applied",
  });
  await insertAuditLog(id, "DPDP_PROCESSING_HOLD_APPLIED", reviewedBy, {
    remarks: "Processing hold applied on review start",
  });
}

/**
 * HR/DPO approves request.
 */
export async function approve(
  id: string,
  approvedBy: string,
  remarks?: string
): Promise<void> {
  // Read current status for accurate audit log
  const [preRows] = await db.execute<RowDataPacket[]>(
    'SELECT status FROM dpdp_consent_withdrawal WHERE id = ? LIMIT 1', [id]
  );
  if (!preRows.length) throw Object.assign(new Error('Withdrawal request not found'), { statusCode: 404 });
  const fromStatus = preRows[0].status as string;

  const [result] = await db.execute<any>(
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
     WHERE id = ? AND status IN ('submitted', 'in_review')`,
    [approvedBy, remarks ?? null, approvedBy, id]
  );
  if (result.affectedRows === 0) {
    throw Object.assign(new Error(`Cannot approve: request is in status '${fromStatus}'`), { statusCode: 409 });
  }

  // Release any active hold record
  await db.execute(
    `UPDATE dpdp_processing_hold
     SET is_active = 0, released_at = NOW(), released_by = ?, release_reason = 'Withdrawal approved'
     WHERE withdrawal_id = ? AND is_active = 1`,
    [approvedBy, id]
  ).catch(() => {});

  await insertAuditLog(id, "DPDP_WITHDRAWAL_APPROVED", approvedBy, {
    fromStatus,
    toStatus: "approved",
    remarks: remarks ?? "Withdrawal approved",
  });
  await insertAuditLog(id, "DPDP_WITHDRAWAL_DATA_RESTRICTED", approvedBy, {
    remarks: "data_restriction_applied set to 1 on approval",
  });
  await insertAuditLog(id, "DPDP_PROCESSING_HOLD_RELEASED", approvedBy, {
    remarks: "Processing hold released on approval",
  });

  // Notification work item for requester
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT requester_id FROM dpdp_consent_withdrawal WHERE id = ? LIMIT 1",
    [id]
  );
  if (rows.length) {
    await db.execute(
      `INSERT INTO work_item
         (id, item_type, title, module_code, entity_type, entity_id, assigned_to_user_id, assigned_to_role, priority, status, created_at)
       VALUES (UUID(), 'DPDP_WITHDRAWAL_APPROVED', 'Your data withdrawal request was approved', 'compliance', 'dpdp_withdrawal', ?, ?, 'employee', 'normal', 'pending', NOW())`,
      [id, rows[0].requester_id]
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

  await insertAuditLog(id, "DPDP_WITHDRAWAL_REJECTED", rejectedBy, {
    fromStatus: "in_review",
    toStatus: "rejected",
    remarks: reason,
  });
  await insertAuditLog(id, "DPDP_PROCESSING_HOLD_RELEASED", rejectedBy, {
    remarks: "Processing hold released on rejection",
  });
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

  await insertAuditLog(id, "DPDP_PROCESSING_HOLD_RELEASED", releasedBy, {
    remarks: "Processing hold manually released",
  });
  await insertAuditLog(id, "DPDP_WITHDRAWAL_CLOSED", releasedBy, {
    toStatus: "hold_released",
    remarks: "Hold released manually — request considered closed",
  });
}

/**
 * Return full audit trail for a withdrawal request.
 */
export async function getAudit(id: string): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT dwal.*,
            COALESCE(
              NULLIF(performed_emp.full_name, ''),
              NULLIF(TRIM(CONCAT(COALESCE(performed_emp.first_name, ''), ' ', COALESCE(performed_emp.last_name, ''))), ''),
              performed_user.email
            ) AS performed_by_name
     FROM dpdp_withdrawal_audit_log dwal
     LEFT JOIN auth_user performed_user ON performed_user.id = dwal.performed_by
     LEFT JOIN employees performed_emp ON performed_emp.user_id = performed_user.id AND performed_emp.active_status = 1
     WHERE dwal.withdrawal_id = ?
     ORDER BY dwal.performed_at DESC`,
    [id]
  );
  return rows;
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export async function getTasksForWithdrawal(withdrawalId: string): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM dpdp_withdrawal_task WHERE withdrawal_id = ? ORDER BY created_at ASC`,
    [withdrawalId]
  );
  return rows;
}

export async function completeTask(
  taskId: string,
  completedBy: string,
  notes?: string
): Promise<void> {
  await db.execute(
    `UPDATE dpdp_withdrawal_task
     SET status = 'completed', completed_by = ?, completed_at = NOW(), notes = COALESCE(?, notes)
     WHERE id = ?`,
    [completedBy, notes ?? null, taskId]
  );
}

// ── Evidence ─────────────────────────────────────────────────────────────────

export async function getEvidenceForWithdrawal(withdrawalId: string): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM dpdp_withdrawal_evidence WHERE withdrawal_id = ? ORDER BY recorded_at DESC`,
    [withdrawalId]
  );
  return rows;
}

export async function addEvidence(
  withdrawalId: string,
  evidenceType: string,
  description: string,
  recordedBy: string,
  fileRef?: string
): Promise<void> {
  await db.execute(
    `INSERT INTO dpdp_withdrawal_evidence
       (id, withdrawal_id, evidence_type, description, file_ref, recorded_by, recorded_at)
     VALUES (UUID(), ?, ?, ?, ?, ?, NOW())`,
    [withdrawalId, evidenceType, description, fileRef ?? null, recordedBy]
  );
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export async function getStats(): Promise<Record<string, number>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS total,
       SUM(status IN ('submitted','in_review')) AS open_count,
       SUM(status = 'approved' AND MONTH(created_at) = MONTH(NOW()) AND YEAR(created_at) = YEAR(NOW())) AS approved_this_month,
       SUM(sla_due_at IS NOT NULL AND sla_due_at < NOW() AND status IN ('submitted','in_review')) AS sla_breached,
       SUM(processing_hold_active = 1) AS on_hold
     FROM dpdp_consent_withdrawal`
  );
  return rows[0] as Record<string, number>;
}
