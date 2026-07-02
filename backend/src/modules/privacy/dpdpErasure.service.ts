import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

/**
 * DPDP Act 2023 §12 — Erasure / Right to be Forgotten.
 *
 * Anonymizes non-payroll PII for the employee linked to an approved erasure request.
 * Payroll and statutory records are retained per the 8-year retention policy (legal obligation).
 *
 * What gets anonymized:
 *   - auth_user: first_name, last_name, email, phone
 *   - employees: personal_email, personal_phone, alternate_mobile, address_line1, address_line2, city, state, pincode
 *   - employee_emergency_contact: name, mobile, address → REDACTED
 *   - employee_nominee: nominee_name, mobile, address → REDACTED
 *
 * What is deliberately NOT touched:
 *   - salary_prep_line, employee_salary_assignment, statutory records (legal retention)
 *   - attendance_daily_record (operational record for prior months)
 *   - employee_code, employee_id, branch, designation (required for audit trail continuity)
 */
export async function executeErasure(
  requestId: string,
  approvedByUserId: string
): Promise<void> {
  // Resolve request and get auth_user.id (principal_id)
  const [reqRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, principal_id, status FROM data_rights_request
     WHERE id = ? AND request_type = 'erasure'
     LIMIT 1`,
    [requestId]
  );
  if (!reqRows.length) throw new Error("Erasure request not found");

  const request = reqRows[0];
  if (request.status === "completed") {
    throw new Error("Erasure request has already been executed");
  }

  const authUserId = request.principal_id;

  // Resolve employees.id from auth_user.id
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employees WHERE user_id = ? LIMIT 1`,
    [authUserId]
  );
  const employeeId = empRows.length ? empRows[0].id : null;

  // Anonymize auth_user
  await db.execute(
    `UPDATE auth_user SET
       first_name = 'REDACTED',
       last_name  = 'REDACTED',
       email      = CONCAT('redacted_', id, '@deleted.invalid'),
       phone      = NULL
     WHERE id = ?`,
    [authUserId]
  );

  if (employeeId) {
    // Anonymize employee profile PII
    await db.execute(
      `UPDATE employees SET
         personal_email    = NULL,
         personal_phone    = NULL,
         alternate_mobile  = NULL,
         address_line1     = NULL,
         address_line2     = NULL,
         city              = NULL,
         state             = NULL,
         pincode           = NULL
       WHERE id = ?`,
      [employeeId]
    );

    // Anonymize emergency contacts
    await db.execute(
      `UPDATE employee_emergency_contact SET
         name    = 'REDACTED',
         mobile  = NULL,
         address = NULL
       WHERE employee_id = ?`,
      [employeeId]
    );

    // Anonymize nominees
    await db.execute(
      `UPDATE employee_nominee SET
         nominee_name = 'REDACTED',
         mobile       = NULL,
         address      = NULL
       WHERE employee_id = ?`,
      [employeeId]
    );
  }

  // Mark request as completed
  await db.execute(
    `UPDATE data_rights_request
     SET status = 'resolved', response_notes = 'PII anonymized per DPDP §12',
         resolved_at = NOW(), assigned_to = ?
     WHERE id = ?`,
    [approvedByUserId, requestId]
  );

  await logSensitiveAction({
    actor_user_id: approvedByUserId,
    action_type:  "DPDP_ERASURE_EXECUTED",
    module_key:   "privacy",
    entity_type:  "data_rights_request",
    entity_id:    requestId,
    employee_id:  employeeId ?? undefined,
    change_summary: {
      erasure_request_id: requestId,
      auth_user_anonymized: authUserId,
      employee_id_anonymized: employeeId,
      retained: "payroll, statutory, attendance (legal retention)",
    },
  });
}

/**
 * Returns erasure requests that are ≥28 days old and not yet resolved/rejected.
 * Used by the 30-day SLA daily alert cron.
 */
export async function getOverdueErasureRequests(): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, principal_id, created_at,
            DATEDIFF(NOW(), created_at) AS days_pending
     FROM data_rights_request
     WHERE request_type = 'erasure'
       AND status NOT IN ('resolved', 'rejected')
       AND DATEDIFF(NOW(), created_at) >= 28
     ORDER BY created_at ASC`
  );
  return rows;
}
