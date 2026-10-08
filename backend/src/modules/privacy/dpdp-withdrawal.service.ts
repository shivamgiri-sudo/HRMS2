import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  APPROVED_TEXT, DEFAULT_DECISION_SLA_HOURS, RETENTION, SLA_CONFIG_KEY, acknowledgementText, clampSlaHours, rejectedText,
} from "./dpdp-withdrawal.policy.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface WithdrawalFilters {
  status?: string;
  branchId?: string;
  dateFrom?: string;
  dateTo?: string;
}

// ── Input validation ─────────────────────────────────────────────────────────

export const WITHDRAWAL_CHANNELS = ["self", "hr_on_behalf", "email", "phone", "in_person", "portal"] as const;
export const WITHDRAWAL_REQUESTER_TYPES = ["employee", "candidate"] as const;
/** Data categories a principal may name. Anything else is rejected rather than stored as free text. */
export const WITHDRAWAL_SCOPE_KEYS = ["personal_data", "employment_data", "biometric_data", "financial_data", "bgv_data"] as const;
export const MAX_REASON_LENGTH = 2000;

export interface ValidatedSubmission {
  requesterType: string;
  channel: string;
  scope: string[] | null;
  reason: string;
}

/**
 * Normalises a submission. The reason is deliberately OPTIONAL: DPDP Act s.6(4) requires that
 * withdrawing consent be as easy as giving it, and a mandatory free-text justification is a hurdle
 * the principal never faced when consenting. Everything else is checked against whitelists.
 */
export function validateSubmission(body: {
  reason?: unknown; scope_json?: unknown; channel?: unknown; requester_type?: unknown;
}): { ok: true; value: ValidatedSubmission } | { ok: false; message: string } {
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length > MAX_REASON_LENGTH) {
    return { ok: false, message: `reason must be ${MAX_REASON_LENGTH} characters or fewer` };
  }
  const channel = body.channel == null || body.channel === "" ? "self" : String(body.channel);
  if (!(WITHDRAWAL_CHANNELS as readonly string[]).includes(channel)) {
    return { ok: false, message: `channel must be one of: ${WITHDRAWAL_CHANNELS.join(", ")}` };
  }
  const requesterType = body.requester_type == null || body.requester_type === "" ? "employee" : String(body.requester_type);
  if (!(WITHDRAWAL_REQUESTER_TYPES as readonly string[]).includes(requesterType)) {
    return { ok: false, message: `requester_type must be one of: ${WITHDRAWAL_REQUESTER_TYPES.join(", ")}` };
  }
  let scope: string[] | null = null;
  if (body.scope_json != null) {
    if (!Array.isArray(body.scope_json)) return { ok: false, message: "scope_json must be a list of data categories" };
    const keys = [...new Set(body.scope_json.map((k) => String(k)))];
    const bad = keys.filter((k) => !(WITHDRAWAL_SCOPE_KEYS as readonly string[]).includes(k));
    if (bad.length) return { ok: false, message: `Unknown data categories: ${bad.join(", ")}` };
    scope = keys.length ? keys : null;
  }
  return { ok: true, value: { requesterType, channel, scope, reason } };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Default implementation tasks per data category, so an approved withdrawal is executable. */
const TASKS_BY_SCOPE: Record<string, Array<{ module: string; action: string }>> = {
  personal_data: [
    { module: "employee_master", action: `Restrict processing of the principal's personal data in the employee master, except fields the law requires to be kept (employee records: ${RETENTION.payrollAndEmployeeRecordsYears} years). Record the legal basis for what is kept.` },
    { module: "documents", action: "Restrict access to uploaded personal documents; retain only those a statute requires and record the legal basis." },
  ],
  employment_data: [
    { module: "attendance", action: `Stop non-statutory processing of attendance and roster data; keep records required for wages and labour-law compliance (leave and attendance: ${RETENTION.leaveAndAttendanceYears} years).` },
    { module: "performance", action: "Stop optional processing of performance and engagement data." },
  ],
  biometric_data: [
    { module: "biometric", action: "Stop biometric capture and remove stored templates where an alternative authentication is available; record what was removed." },
  ],
  financial_data: [
    { module: "payroll", action: `Confirm which payroll and bank records must be retained (tax, PF/ESI, wage records: ${RETENTION.payrollAndEmployeeRecordsYears} years) and restrict all other processing; record the legal basis.` },
  ],
  bgv_data: [
    { module: "bgv", action: "Stop further background-verification processing and restrict stored BGV reports; notify the verification vendor where applicable." },
  ],
};
const ALL_SCOPE_TASKS = Object.keys(TASKS_BY_SCOPE);

/** Pure: the task list an approval of this scope should create (null scope = every category). */
export function tasksForScope(scope: string[] | null): Array<{ module: string; action: string }> {
  const keys = scope && scope.length ? scope : ALL_SCOPE_TASKS;
  const seen = new Set<string>();
  const out: Array<{ module: string; action: string }> = [];
  for (const k of keys) {
    for (const t of TASKS_BY_SCOPE[k] ?? []) {
      if (!seen.has(t.module)) { seen.add(t.module); out.push(t); }
    }
  }
  out.push({ module: "third_parties", action: "Inform processors and recipients that hold this principal's data of the withdrawal, and record the notices sent." });
  return out;
}

function parseScope(raw: unknown): string[] | null {
  if (raw == null) return null;
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v.map(String) : null;
  } catch {
    return null;
  }
}

/** Decision target in hours: dpdp_config `withdrawal_decision_sla_hours` when set and sane, else 7 days. */
export async function getDecisionSlaHours(): Promise<number> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT config_value FROM dpdp_config WHERE config_key = ? LIMIT 1", [SLA_CONFIG_KEY],
    );
    return clampSlaHours(Array.isArray(rows) ? rows[0]?.config_value : undefined);
  } catch {
    return DEFAULT_DECISION_SLA_HOURS; // config unreadable: never block a principal's request on it
  }
}

export const OWN_REQUEST_MESSAGE = "You cannot review or decide your own withdrawal request. Another reviewer must handle it.";

/** Separation of duties: the person who made a request never reviews, decides or releases it. */
export function assertNotOwnRequest(requesterId: unknown, actorId: string): void {
  if (requesterId != null && String(requesterId) === String(actorId)) {
    throw Object.assign(new Error(OWN_REQUEST_MESSAGE), { statusCode: 403 });
  }
}

/** True when the user is a current employee (employment-essential processing continues for them). */
export async function isActiveEmployeeUser(userId: string): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT 1 AS ok FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1", [userId],
  );
  return Array.isArray(rows) && rows.length > 0;
}

/** Tells the principal something happened to their request (inbox work item). Never throws. */
async function notifyRequester(requesterId: string, itemType: string, title: string, withdrawalId: string, priority = "normal"): Promise<void> {
  await db.execute(
    `INSERT INTO work_item
       (id, item_type, title, module_code, entity_type, entity_id, assigned_to_user_id, assigned_to_role, priority, status, created_at)
     VALUES (UUID(), ?, ?, 'compliance', 'dpdp_withdrawal', ?, ?, 'employee', ?, 'pending', NOW())`,
    [itemType, title, withdrawalId, requesterId, priority],
  ).catch((err) => {
    process.stderr.write(JSON.stringify({ level: "warn", module: "dpdp-withdrawal", event: "NOTIFY_FAILED", itemType, error: String(err?.message ?? err) }) + "\n");
  });
}

/**
 * Exported so dpdpRestrictionGuard.ts can record enforcement against the same table
 * with the same shape, rather than growing a second copy of this INSERT.
 */
export async function insertAuditLog(
  withdrawalId: string,
  action: string,
  performedBy: string,
  opts?: { fromStatus?: string; toStatus?: string; remarks?: string },
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
    ],
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
): Promise<{ id: string; request_ref: string; sla_due_at: string | null }> {
  // One open request at a time: stops duplicate submissions from flooding the DPO queue and gives the
  // principal the reference they already have instead of a second one.
  const [open] = await db.execute<RowDataPacket[]>(
    `SELECT id, reference_number FROM dpdp_consent_withdrawal
      WHERE requester_id = ? AND status IN ('submitted', 'in_review') LIMIT 1`,
    [requesterId]
  );
  if (Array.isArray(open) && open.length) {
    throw Object.assign(
      new Error(`You already have an open withdrawal request (${String(open[0].reference_number ?? open[0].id)}). It is being processed.`),
      { statusCode: 409 },
    );
  }

  const id = randomUUID();
  const requestRef = `WDR-${id.slice(0, 8).toUpperCase()}`;
  const slaHours = await getDecisionSlaHours();

  await db.execute(
    `INSERT INTO dpdp_consent_withdrawal
       (id, requester_id, requester_type, withdrawal_scope_json, withdrawal_reason,
        request_channel, status, sla_due_at, reference_number, requester_ip, requester_ua, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'submitted', DATE_ADD(NOW(), INTERVAL ? HOUR), ?, ?, ?, NOW())`,
    [
      id,
      requesterId,
      requesterType ?? "employee",
      scopeJson ? JSON.stringify(scopeJson) : null,
      reason || null,
      channel ?? "self",
      slaHours,
      requestRef,
      extras?.requester_ip ?? null,
      extras?.requester_ua?.slice(0, 500) ?? null,
    ]
  );

  await insertAuditLog(id, "DPDP_WITHDRAWAL_SUBMITTED", requesterId, {
    toStatus: "submitted",
    remarks: "Request submitted by principal",
  });
  await insertAuditLog(id, "DPDP_WITHDRAWAL_ACKNOWLEDGED", requesterId, {
    remarks: `Acknowledgement issued to the principal with reference ${requestRef}`,
  }).catch(() => undefined);

  // Work item for compliance/DPO to pick up (internal 72-hour review SLA)
  await db.execute(
    `INSERT INTO work_item
       (id, item_type, title, module_code, entity_type, entity_id, assigned_to_role, priority, status, created_at)
     VALUES (UUID(), 'DPDP_WITHDRAWAL_REVIEW', ?, 'compliance', 'dpdp_withdrawal', ?, 'compliance', 'high', 'pending', NOW())`,
    [`DPDP withdrawal ${requestRef} pending review`, id]
  ).catch(() => {
    // work_item table may not exist in all environments — non-fatal
  });

  // Acknowledgement back to the principal, with the reference they can quote.
  await notifyRequester(requesterId, "DPDP_WITHDRAWAL_ACKNOWLEDGED", acknowledgementText(requestRef, slaHours), id);

  const [slaRows] = await db.execute<RowDataPacket[]>(
    "SELECT sla_due_at FROM dpdp_consent_withdrawal WHERE id = ? LIMIT 1", [id]
  );
  const sla = Array.isArray(slaRows) && slaRows[0]?.sla_due_at ? new Date(slaRows[0].sla_due_at as string).toISOString() : null;
  return { id, request_ref: requestRef, sla_due_at: sla };
}

/**
 * Employee views their own requests.
 */
export async function getMyRequests(
  requesterId: string,
): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, reference_number, reference_number AS request_ref, requester_id, requester_type,
            withdrawal_scope_json, withdrawal_reason,
            request_channel, status, processing_hold_active, hold_applied_at, hold_released_at,
            data_restriction_applied, data_restriction_at, review_remarks, escalation_required,
            sla_due_at, reviewed_at, closed_at, implementation_completed_at,
            created_at
     FROM dpdp_consent_withdrawal
     WHERE requester_id = ?
     ORDER BY created_at DESC`,
    [requesterId],
  );
  return rows;
}

/**
 * HR/compliance views all requests with optional filters.
 */
export async function listAll(filters: WithdrawalFilters, scope?: { sql: string; params: unknown[] } | null): Promise<RowDataPacket[]> {
  const conditions: string[] = ["1=1"];
  const params: unknown[] = [];

  if (scope) {
    conditions.push(scope.sql);
    params.push(...scope.params);
  }
  if (filters.status) {
    conditions.push("dcw.status = ?");
    params.push(filters.status);
  }
  if (filters.branchId) {
    conditions.push("dcw.requester_id IN (SELECT be.user_id FROM employees be WHERE be.user_id IS NOT NULL AND be.branch_id = ?)");
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
    params,
  );
  return rows;
}

/**
 * Get single request. Non-HR callers may only see their own.
 */
export async function getById(
  id: string,
  requesterId?: string,
  isHr = false,
  /**
   * Record a DPDP_WITHDRAWAL_VIEWED entry for this read.
   *
   * Opt-in rather than automatic: getById is also called by the audit-log endpoint purely
   * to run its access check, and logging there would record a phantom "view" for every
   * audit fetch. Only the detail route passes true.
   *
   * A data principal reading their own request is not logged — the DPDP interest is in who
   * ELSE looked at it, so only HR/DPO reads produce an entry.
   */
  logView = false,
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
    [id],
  );
  if (!rows.length) return null;
  const record = rows[0];
  if (!isHr && requesterId && record.requester_id !== requesterId) return null;

  if (logView && isHr && requesterId) {
    // Never let an audit-write failure turn a successful read into an error.
    void insertAuditLog(id, "DPDP_WITHDRAWAL_VIEWED", requesterId, {
      remarks: "Withdrawal record opened by HR/DPO",
    }).catch(() => undefined);
  }
  return record;
}

/**
 * HR starts review: status → in_review, insert processing hold.
 */
export async function startReview(id: string, reviewedBy: string): Promise<void> {
  // A processing hold freezes the principal's data while the request is reviewed. For a CURRENT employee that
  // would also freeze payroll, attendance and HR use of their record, which the employment itself requires, so
  // no blanket hold is placed for them; the chosen categories are restricted through the module tasks instead.
  // A former employee or candidate has no such need, so the hold applies.
  const [who] = await db.execute<RowDataPacket[]>(
    "SELECT requester_id FROM dpdp_consent_withdrawal WHERE id = ? LIMIT 1", [id]
  );
  const requesterId = Array.isArray(who) && who[0]?.requester_id ? String(who[0].requester_id) : null;
  assertNotOwnRequest(requesterId, reviewedBy);
  const applyHold = requesterId ? !(await isActiveEmployeeUser(requesterId)) : true;

  const [result] = await db.execute<any>(
    `UPDATE dpdp_consent_withdrawal
     SET status = 'in_review', reviewed_by = ?, reviewed_at = NOW(),
         processing_hold_active = ?, hold_applied_at = ${applyHold ? "NOW()" : "NULL"}
     WHERE id = ? AND status = 'submitted'`,
    [reviewedBy, applyHold ? 1 : 0, id]
  );
  // Only a request still in 'submitted' can start review. Without this check a second click (or a
  // request already approved / rejected) still inserted a hold row and wrote "review started" audit.
  if (result && result.affectedRows === 0) {
    const [cur] = await db.execute<RowDataPacket[]>("SELECT status FROM dpdp_consent_withdrawal WHERE id = ? LIMIT 1", [id]);
    if (!cur.length) throw Object.assign(new Error("Withdrawal request not found"), { statusCode: 404 });
    throw Object.assign(new Error(`Cannot start review: request is in status '${String(cur[0].status)}'`), { statusCode: 409 });
  }

  if (applyHold) {
    await db.execute(
      `INSERT INTO dpdp_processing_hold
         (id, withdrawal_id, entity_type, entity_id, held_by, hold_reason, is_active, held_at)
       SELECT UUID(), dcw.id, 'employee', COALESCE(e.id, dcw.requester_id), ?, 'Withdrawal review in progress', 1, NOW()
         FROM dpdp_consent_withdrawal dcw
         LEFT JOIN employees e ON e.user_id = dcw.requester_id
        WHERE dcw.id = ?
        LIMIT 1`,
      [reviewedBy, id]
    ).catch((err) => {
      // Not silent any more: a missing hold row means the enforcement record is incomplete.
      process.stderr.write(JSON.stringify({ level: "error", module: "dpdp-withdrawal", event: "HOLD_RECORD_FAILED", withdrawalId: id, error: String(err?.message ?? err) }) + "\n");
    });
  }

  await insertAuditLog(id, "DPDP_WITHDRAWAL_REVIEW_STARTED", reviewedBy, {
    fromStatus: "submitted",
    toStatus: "in_review",
    remarks: applyHold
      ? "Review started; processing hold applied"
      : "Review started; no blanket hold for a current employee (employment processing continues; categories are restricted through module tasks)",
  });
  if (applyHold) {
    await insertAuditLog(id, "DPDP_PROCESSING_HOLD_APPLIED", reviewedBy, {
      remarks: "Processing hold applied on review start",
    });
  }
}

/**
 * HR/DPO approves request.
 */
export async function approve(
  id: string,
  approvedBy: string,
  remarks?: string,
): Promise<void> {
  // Read current status for accurate audit log
  const [preRows] = await db.execute<RowDataPacket[]>(
    'SELECT status, requester_id FROM dpdp_consent_withdrawal WHERE id = ? LIMIT 1', [id]
  );
  if (!preRows.length) throw Object.assign(new Error('Withdrawal request not found'), { statusCode: 404 });
  assertNotOwnRequest(preRows[0].requester_id, approvedBy);
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
         restricted_by = ?,
         final_decision_by = ?
     WHERE id = ? AND status IN ('submitted', 'in_review')`,
    [approvedBy, remarks ?? null, approvedBy, approvedBy, id]
  );
  if (result.affectedRows === 0) {
    throw Object.assign(
      new Error(`Cannot approve: request is in status '${fromStatus}'`),
      { statusCode: 409 },
    );
  }

  // Release any active hold record
  await db
    .execute(
      `UPDATE dpdp_processing_hold
     SET is_active = 0, released_at = NOW(), released_by = ?, release_reason = 'Withdrawal approved'
     WHERE withdrawal_id = ? AND is_active = 1`,
      [approvedBy, id],
    )
    .catch(() => {});

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

  // Make the approval executable: one task per module that must act on it (idempotent).
  const [reqRows] = await db.execute<RowDataPacket[]>(
    "SELECT requester_id, withdrawal_scope_json FROM dpdp_consent_withdrawal WHERE id = ? LIMIT 1",
    [id]
  );
  const [existing] = await db.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM dpdp_withdrawal_task WHERE withdrawal_id = ?", [id]
  ).catch(() => [[{ n: 0 }]] as unknown as [RowDataPacket[]]);
  if (Number(existing?.[0]?.n ?? 0) === 0) {
    for (const t of tasksForScope(parseScope(reqRows[0]?.withdrawal_scope_json))) {
      await db.execute(
        `INSERT INTO dpdp_withdrawal_task (id, withdrawal_id, module_key, action_required, status, created_at)
         VALUES (UUID(), ?, ?, ?, 'pending', NOW())`,
        [id, t.module, t.action]
      ).catch((err) => {
        process.stderr.write(JSON.stringify({ level: "error", module: "dpdp-withdrawal", event: "TASK_CREATE_FAILED", withdrawalId: id, taskModule: t.module, error: String(err?.message ?? err) }) + "\n");
      });
    }
    await insertAuditLog(id, "DPDP_WITHDRAWAL_IMPLEMENTATION_STARTED", approvedBy, {
      remarks: "Per-module implementation tasks created",
    }).catch(() => undefined);
  }

  if (reqRows.length) {
    await notifyRequester(String(reqRows[0].requester_id), "DPDP_WITHDRAWAL_APPROVED", APPROVED_TEXT, id);
  }
}

/**
 * HR/DPO rejects request.
 */
export async function reject(
  id: string,
  rejectedBy: string,
  reason: string,
): Promise<void> {
  const [preRows] = await db.execute<RowDataPacket[]>(
    "SELECT status, requester_id FROM dpdp_consent_withdrawal WHERE id = ? LIMIT 1", [id]
  );
  if (!preRows.length) throw Object.assign(new Error("Withdrawal request not found"), { statusCode: 404 });
  assertNotOwnRequest(preRows[0].requester_id, rejectedBy);
  const fromStatus = String(preRows[0].status);

  // Only an open request can be rejected. This UPDATE used to match on id alone, so a request that had
  // already been APPROVED could be flipped to rejected, silently dropping a restriction that was in force.
  const [result] = await db.execute<any>(
    `UPDATE dpdp_consent_withdrawal
     SET status = 'rejected',
         reviewed_by = COALESCE(reviewed_by, ?),
         reviewed_at = COALESCE(reviewed_at, NOW()),
         review_remarks = ?,
         processing_hold_active = 0,
         hold_released_at = NOW(),
         final_decision_by = ?,
         closed_at = NOW()
     WHERE id = ? AND status IN ('submitted', 'in_review')`,
    [rejectedBy, reason, rejectedBy, id]
  );
  if (result && result.affectedRows === 0) {
    throw Object.assign(new Error(`Cannot reject: request is in status '${fromStatus}'`), { statusCode: 409 });
  }

  await db
    .execute(
      `UPDATE dpdp_processing_hold
     SET is_active = 0, released_at = NOW(), released_by = ?, release_reason = 'Withdrawal rejected'
     WHERE withdrawal_id = ? AND is_active = 1`,
      [rejectedBy, id],
    )
    .catch(() => {});

  await insertAuditLog(id, "DPDP_WITHDRAWAL_REJECTED", rejectedBy, {
    fromStatus,
    toStatus: "rejected",
    remarks: reason,
  });
  await insertAuditLog(id, "DPDP_PROCESSING_HOLD_RELEASED", rejectedBy, {
    remarks: "Processing hold released on rejection",
  });

  // The principal must be told, with the reason, so they can use the grievance route if they disagree.
  await notifyRequester(String(preRows[0].requester_id), "DPDP_WITHDRAWAL_REJECTED", rejectedText(reason), id, "high");
}

/**
 * Manually release a processing hold without full approval/rejection.
 */
export async function releaseHold(id: string, releasedBy: string): Promise<void> {
  const [own] = await db.execute<RowDataPacket[]>("SELECT requester_id FROM dpdp_consent_withdrawal WHERE id = ? LIMIT 1", [id]);
  assertNotOwnRequest(Array.isArray(own) ? own[0]?.requester_id : null, releasedBy);
  await db.execute(
    `UPDATE dpdp_processing_hold
     SET is_active = 0, released_at = NOW(), released_by = ?, release_reason = 'Manual hold release'
     WHERE withdrawal_id = ? AND is_active = 1`,
      [releasedBy, id],
    )
    .catch(() => {});

  // A manual release closes a request that never reached a decision; leaving it 'in_review' kept it
  // in every open-queue count and SLA breach figure forever.
  await db.execute(
    `UPDATE dpdp_consent_withdrawal
     SET processing_hold_active = 0, hold_released_at = NOW(),
         status = IF(status = 'in_review', 'hold_released', status),
         closed_at = IF(status = 'in_review', NOW(), closed_at)
     WHERE id = ?`,
    [id],
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
export async function getAudit(
  id: string,
  viewedBy?: string,
): Promise<RowDataPacket[]> {
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
    [id],
  );
  if (viewedBy) {
    // Reading the audit trail of someone's withdrawal is itself an access event a regulator
    // will ask about. Fire-and-forget so an audit-write failure cannot break the read.
    void insertAuditLog(id, "DPDP_WITHDRAWAL_AUDIT_VIEWED", viewedBy, {
      remarks: "Withdrawal audit trail opened",
    }).catch(() => undefined);
  }
  return rows;
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export async function getTasksForWithdrawal(
  withdrawalId: string,
): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM dpdp_withdrawal_task WHERE withdrawal_id = ? ORDER BY created_at ASC`,
    [withdrawalId],
  );
  return rows;
}

export async function completeTask(
  taskId: string,
  completedBy: string,
  notes?: string,
  /** The :id of the route. When given, the task must belong to that withdrawal (blocks cross-request edits). */
  withdrawalId?: string
): Promise<boolean> {
  const [updateResult] = await db.execute<any>(
    `UPDATE dpdp_withdrawal_task
     SET status = 'completed', completed_by = ?, completed_at = NOW(), notes = COALESCE(?, notes)
     WHERE id = ?${withdrawalId ? " AND withdrawal_id = ?" : ""}`,
    withdrawalId ? [completedBy, notes ?? null, taskId, withdrawalId] : [completedBy, notes ?? null, taskId]
  );
  if (updateResult && updateResult.affectedRows === 0) return false;

  /**
   * Completing a per-module task IS the "module action completed" step of the withdrawal —
   * it was the one already-implemented workflow action in this service that wrote no audit
   * entry at all, so the record showed a withdrawal moving to closed with no evidence of the
   * work done in between.
   *
   * The withdrawal id is read back from the task because callers hold only the task id.
   */
  const [taskRows] = await db.execute<RowDataPacket[]>(
    `SELECT withdrawal_id, module_key FROM dpdp_withdrawal_task WHERE id = ? LIMIT 1`,
    [taskId],
  );
  const task = taskRows[0];
  if (task?.withdrawal_id) {
    void insertAuditLog(
      String(task.withdrawal_id),
      "DPDP_WITHDRAWAL_MODULE_ACTION_COMPLETED",
      completedBy,
      {
        remarks: `Task completed${task.module_key ? ` for module ${String(task.module_key)}` : ""}`,
      },
    ).catch(() => undefined);

    // When the last task closes, the withdrawal is fully implemented: stamp it and say so.
    const pending = await db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM dpdp_withdrawal_task WHERE withdrawal_id = ? AND status IN ('pending', 'in_progress')",
      [String(task.withdrawal_id)]
    ).catch(() => null);
    const left = Array.isArray(pending) && Array.isArray(pending[0]) ? Number((pending[0] as RowDataPacket[])[0]?.n ?? -1) : -1;
    if (left === 0) {
      await db.execute(
        `UPDATE dpdp_consent_withdrawal
            SET implementation_completed_at = NOW(), closed_at = COALESCE(closed_at, NOW())
          WHERE id = ? AND implementation_completed_at IS NULL`,
        [String(task.withdrawal_id)]
      ).catch(() => undefined);
      void insertAuditLog(String(task.withdrawal_id), "DPDP_WITHDRAWAL_IMPLEMENTATION_COMPLETED", completedBy, {
        remarks: "All module tasks completed; withdrawal fully implemented",
      }).catch(() => undefined);
    }
  }
  return true;
}

// ── Evidence ─────────────────────────────────────────────────────────────────

export async function getEvidenceForWithdrawal(
  withdrawalId: string,
): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM dpdp_withdrawal_evidence WHERE withdrawal_id = ? ORDER BY recorded_at DESC`,
    [withdrawalId],
  );
  return rows;
}

export async function addEvidence(
  withdrawalId: string,
  evidenceType: string,
  description: string,
  recordedBy: string,
  fileRef?: string,
): Promise<void> {
  await db.execute(
    `INSERT INTO dpdp_withdrawal_evidence
       (id, withdrawal_id, evidence_type, description, file_ref, recorded_by, recorded_at)
     VALUES (UUID(), ?, ?, ?, ?, ?, NOW())`,
    [withdrawalId, evidenceType, description, fileRef ?? null, recordedBy],
  );
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export async function getStats(scope?: { sql: string; params: unknown[] } | null): Promise<Record<string, number>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS total,
       SUM(status IN ('submitted','in_review')) AS open_count,
       SUM(status = 'approved' AND MONTH(created_at) = MONTH(NOW()) AND YEAR(created_at) = YEAR(NOW())) AS approved_this_month,
       SUM(sla_due_at IS NOT NULL AND sla_due_at < NOW() AND status IN ('submitted','in_review')) AS sla_breached,
       SUM(processing_hold_active = 1) AS on_hold
     FROM dpdp_consent_withdrawal dcw${scope ? ` WHERE ${scope.sql}` : ""}`,
    scope ? scope.params : []
  );
  return rows[0] as Record<string, number>;
}

// ── SLA escalation ────────────────────────────────────────────────────────────

/**
 * Flags open requests past their SLA and raises a high-priority work item for the DPO, once per request.
 * `escalation_required` existed on the table but nothing ever set it, so a breached request just sat
 * in the queue with a red label and nobody was told.
 */
export async function escalateOverdueWithdrawals(): Promise<number> {
  const [due] = await db.execute<RowDataPacket[]>(
    `SELECT id, reference_number FROM dpdp_consent_withdrawal
      WHERE status IN ('submitted', 'in_review') AND sla_due_at IS NOT NULL AND sla_due_at < NOW()
        AND COALESCE(escalation_required, 0) = 0
      LIMIT 200`
  );
  for (const r of due as RowDataPacket[]) {
    await db.execute("UPDATE dpdp_consent_withdrawal SET escalation_required = 1 WHERE id = ?", [r.id]);
    await insertAuditLog(String(r.id), "DPDP_WITHDRAWAL_SLA_ESCALATED", "system", {
      remarks: "Decision deadline passed; escalated to the DPO",
    }).catch(() => undefined);
    await db.execute(
      `INSERT INTO work_item
         (id, item_type, title, module_code, entity_type, entity_id, assigned_to_role, priority, status, created_at)
       VALUES (UUID(), 'DPDP_WITHDRAWAL_SLA_BREACH', ?, 'compliance', 'dpdp_withdrawal', ?, 'dpo', 'critical', 'pending', NOW())`,
      [`DPDP withdrawal ${String(r.reference_number ?? r.id)} is past its decision deadline`, r.id]
    ).catch(() => undefined);
  }
  return (due as RowDataPacket[]).length;
}
