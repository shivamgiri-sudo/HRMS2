import { randomUUID } from "crypto";
import { createHash } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { sendSMS } from "../communication/sms.helper.js";

/**
 * A pending row for this employee + request_type, if one already exists.
 *
 * profile_update_approval's only unique key is its own `id` PK — a fresh
 * randomUUID() on every submit call. The INSERT below is followed by
 * `ON DUPLICATE KEY UPDATE`, which was clearly meant to replace an existing
 * pending request in place (the UI tells the employee exactly that: "New
 * requests will replace the pending one"), but a fresh id can never collide
 * with anything, so that clause could never actually fire — conflicting
 * pending requests for the same employee stacked up unbounded. Reusing the
 * existing pending row's id when one exists makes the ON DUPLICATE clause
 * do real work.
 */
async function findPendingApprovalId(employeeId: string, requestType: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM profile_update_approval
     WHERE employee_id = ? AND request_type = ? AND status = 'pending'
     LIMIT 1`,
    [employeeId, requestType]
  );
  return (rows[0] as any)?.id ?? null;
}

export const profileApprovalService = {
  async submitBankDetailsForApproval(
    userId: string,
    employeeId: string,
    newValues: Record<string, any>,
    oldValues?: Record<string, any>
  ) {
    const [existing] = await db.execute<RowDataPacket[]>(
      `SELECT id, old_values FROM profile_update_approval
       WHERE employee_id = ? AND request_type = 'bank_details' AND status = 'pending'
       LIMIT 1`,
      [employeeId]
    );
    const existingPendingId = (existing[0] as any)?.id ?? null;

    const oldVals = oldValues || (existing[0] as any)?.old_values || {};

    // Create a penny drop log entry (initiated status; provider integration optional)
    const pennyDropId = randomUUID();
    const acctRaw = String(newValues.account_number ?? newValues.accountNumber ?? '').replace(/\s/g, '');
    const acctHash = acctRaw
      ? createHash('sha256').update(acctRaw.toUpperCase()).digest('hex')
      : 'unknown';
    await db.execute(
      `INSERT INTO bank_penny_drop_log
         (id, employee_id, account_number_hash, ifsc_code, penny_drop_status)
       VALUES (?, ?, ?, ?, 'skipped')`,
      [pennyDropId, employeeId, acctHash, newValues.ifsc_code ?? newValues.ifscCode ?? '']
    );

    const id = existingPendingId ?? randomUUID();
    await db.execute(
      `INSERT INTO profile_update_approval
         (id, employee_id, request_type, old_values, new_values, status, requested_by_role,
          penny_drop_log_id, routed_to_role, reviewed_by)
       VALUES (?, ?, 'bank_details', ?, ?, 'pending', 'employee', ?, 'payroll', NULL)
       ON DUPLICATE KEY UPDATE
         new_values = VALUES(new_values), penny_drop_log_id = VALUES(penny_drop_log_id),
         routed_to_role = 'payroll', requested_at = NOW()`,
      [id, employeeId, JSON.stringify(oldVals), JSON.stringify(newValues), pennyDropId]
    );

    await logSensitiveAction({
      actor_user_id: userId,
      action_type: "BANK_DETAILS_APPROVAL_REQUESTED",
      module_key: "EMPLOYEE_PROFILE",
      entity_type: "profile_update_approval",
      entity_id: id,
      change_summary: { fields: Object.keys(newValues), routed_to: 'payroll' },
    });

    // SMS — bank detail update submitted (fire-and-forget)
    try {
      const [empRow] = await db.execute<RowDataPacket[]>(
        `SELECT CONCAT(first_name,' ',COALESCE(last_name,'')) AS name, mobile, personal_phone
         FROM employees WHERE id = ? LIMIT 1`, [employeeId]
      );
      const emp = (empRow[0] as any);
      const phone = emp?.mobile ?? emp?.personal_phone ?? null;
      if (phone) sendSMS(phone, 'bank_update_submitted', { name: emp.name }).catch(() => {});
    } catch { /* non-fatal */ }

    return { id, status: "pending", routed_to: "payroll" };
  },

  // getPendingBankDetailsApprovals / approveBankDetailsUpdate used to live here. Removed:
  // their only caller was profile-approval.routes.ts, which was never mounted in app.ts —
  // confirmed via profile-trust-audit (2026-08-13) and re-verified unreferenced anywhere
  // before deletion. The live bank-approval review path is
  // PATCH /api/payroll/bank-change-requests/:id (payroll-window.routes.ts), fixed
  // separately to persist account_number_enc, compute account_seq correctly and write
  // this same audit trail — see that file for the reviewer that actually runs.
};

export async function submitStatutoryDetailsForApproval(
  userId: string,
  employeeId: string,
  newValues: Record<string, unknown>
): Promise<{ id: string; message: string }> {
  // Same fix as submitBankDetailsForApproval above: reuse an existing pending
  // request's id so ON DUPLICATE KEY UPDATE actually replaces it, instead of
  // stacking a fresh conflicting request every time this is called.
  const existingPendingId = await findPendingApprovalId(employeeId, 'statutory_details');
  const id = existingPendingId ?? randomUUID();
  await db.execute(
    `INSERT INTO profile_update_approval
       (id, employee_id, request_type, old_values, new_values, status,
        requested_by_role, routed_to_role, reviewed_by)
     VALUES (?, ?, 'statutory_details', '{}', ?, 'pending', 'employee', 'hr', NULL)
     ON DUPLICATE KEY UPDATE
       new_values = VALUES(new_values),
       routed_to_role = 'hr',
       requested_at = NOW()`,
    [id, employeeId, JSON.stringify(newValues)]
  );

  await logSensitiveAction({
    actor_user_id: userId,
    action_type: 'STATUTORY_DETAILS_APPROVAL_REQUESTED',
    module_key: 'EMPLOYEE_PROFILE',
    entity_type: 'profile_update_approval',
    entity_id: id,
    change_summary: { fields: Object.keys(newValues), routed_to: 'hr' },
  });

  return { id, message: 'Statutory details submitted for HR approval' };
}
