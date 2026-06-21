import { randomUUID } from "crypto";
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
    const id = randomUUID();

    await db.execute(
      `INSERT INTO profile_update_approval
       (id, employee_id, request_type, old_values, new_values, status, requested_by_role, reviewed_by)
       VALUES (?, ?, 'bank_details', ?, ?, 'pending', 'employee', NULL)
       ON DUPLICATE KEY UPDATE
       new_values = VALUES(new_values),
       requested_at = NOW()`,
      [id, employeeId, JSON.stringify(oldVals), JSON.stringify(newValues)]
    );

    await logSensitiveAction({
      actor_user_id: userId,
      action_type: "BANK_DETAILS_APPROVAL_REQUESTED",
      module_key: "EMPLOYEE_PROFILE",
      entity_type: "profile_update_approval",
      entity_id: id,
      change_summary: { fields: Object.keys(newValues) },
    });

    return { id, status: "pending" };
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
      // Apply bank details update
      await db.execute(
        `INSERT INTO employee_bank_detail
         (id, employee_id, is_primary, account_seq, bank_name, account_holder_name,
          bank_branch, account_number, ifsc_code, account_type, verified, active_status)
         VALUES (UUID(), ?, 1, 1, ?, ?, ?, NULL, ?, ?, 1, 1)
         ON DUPLICATE KEY UPDATE
         bank_name = VALUES(bank_name),
         account_holder_name = VALUES(account_holder_name),
         bank_branch = VALUES(bank_branch),
         ifsc_code = VALUES(ifsc_code),
         account_type = VALUES(account_type),
         verified = 1`,
        [
          approval.employee_id,
          newVals.bank_name,
          newVals.account_holder_name,
          newVals.bank_branch || null,
          newVals.ifsc_code,
          newVals.account_type,
        ]
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
      change_summary: { approved, note: reviewerNote },
    });
  },
};
