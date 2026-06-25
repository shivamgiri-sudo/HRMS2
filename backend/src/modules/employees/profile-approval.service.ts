import { randomUUID } from "crypto";
import { createHash } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

export const profileApprovalService = {
  async submitBankDetailsForApproval(
    userId: string,
    employeeId: string,
    newValues: Record<string, any>,
    oldValues?: Record<string, any>
  ) {
    const [existing] = await db.execute<RowDataPacket[]>(
      `SELECT old_values FROM profile_update_approval
       WHERE employee_id = ? AND request_type = 'bank_details' AND status = 'pending'
       LIMIT 1`,
      [employeeId]
    );

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

    const id = randomUUID();
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

    return { id, status: "pending", routed_to: "payroll" };
  },

  async getPendingBankDetailsApprovals(reviewerEmployeeId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT pua.*,
              CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
              e.employee_code, b.branch_name
       FROM profile_update_approval pua
       LEFT JOIN employees e ON e.id = pua.employee_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       WHERE pua.request_type = 'bank_details' AND pua.status = 'pending'
       ORDER BY pua.requested_at DESC`,
      []
    );
    return rows;
  },

  async approveBankDetailsUpdate(
    reviewerId: string,
    approvalId: string,
    approved: boolean,
    reviewerNote?: string
  ) {
    const [req] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM profile_update_approval WHERE id = ? AND request_type = 'bank_details'`,
      [approvalId]
    );

    if (!req.length) throw new Error("Approval request not found");
    const approval = (req[0] as any);

    if (approved) {
      const newVals = JSON.parse(approval.new_values || "{}");

      // Archive existing primary account (keep for history, mark non-primary)
      await db.execute(
        `UPDATE employee_bank_detail
         SET is_primary = 0, active_status = 0
         WHERE employee_id = ? AND is_primary = 1`,
        [approval.employee_id]
      );

      // Determine effective run month: earliest draft run, or next calendar month
      const today = new Date();
      const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      const defaultEffective = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;

      const [draftRuns] = await db.execute<RowDataPacket[]>(
        `SELECT run_month FROM salary_prep_run
         WHERE status = 'draft' ORDER BY run_month ASC LIMIT 1`
      );
      const effectiveRunMonth = draftRuns[0]?.run_month ?? defaultEffective;

      // Insert new primary account
      await db.execute(
        `INSERT INTO employee_bank_detail
           (id, employee_id, is_primary, account_seq, bank_name, account_holder_name,
            bank_branch, account_number, ifsc_code, account_type, verified, active_status)
         VALUES (UUID(), ?, 1, 1, ?, ?, ?, NULL, ?, ?, 1, 1)`,
        [
          approval.employee_id,
          newVals.bank_name,
          newVals.account_holder_name,
          newVals.bank_branch || null,
          newVals.ifsc_code,
          newVals.account_type,
        ]
      );

      // Record effective run month on the approval record
      await db.execute(
        `UPDATE profile_update_approval SET effective_run_month = ? WHERE id = ?`,
        [effectiveRunMonth, approvalId]
      );
    }

    await db.execute(
      `UPDATE profile_update_approval
       SET status = ?, reviewed_by = ?, reviewed_at = NOW(), reviewer_note = ?
       WHERE id = ?`,
      [approved ? "approved" : "rejected", reviewerId, reviewerNote || null, approvalId]
    );

    await logSensitiveAction({
      actor_user_id: reviewerId,
      action_type: approved ? "BANK_DETAILS_APPROVED" : "BANK_DETAILS_REJECTED",
      module_key: "EMPLOYEE_PROFILE",
      entity_type: "profile_update_approval",
      entity_id: approvalId,
      change_summary: {
        approved,
        note: reviewerNote,
        employee_id: approval.employee_id,
        old_values: approval.old_values,
        new_values: approval.new_values,
      },
    });
  },
};
