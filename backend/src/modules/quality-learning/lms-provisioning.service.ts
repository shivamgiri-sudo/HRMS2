/**
 * quality-learning/lms-provisioning.service.ts
 *
 * Best-effort LMS-side provisioning for a training_assignment, and honest tracking of what
 * still needs a human. See backend/sql/1822_training_assignment_lms_provisioning.sql for
 * the full rationale — short version:
 *
 *   - mcn_lms (the external LMS) has NO per-trainee content-assignment table. Content
 *     visibility is a fixed classroom_id -> module_master -> content_master cascade.
 *   - This codebase's own UAT governance checklist (CS-04) blocks changing anything
 *     LMS-owned. This module NEVER writes to content_master/module_master/batch_master.
 *   - The one thing that IS automatable and already has a safe existing write path is the
 *     employee's LEARNER IDENTITY (trainee_master row) — provisionLmsIdentityForEmployee()
 *     in modules/lms/lms-provisioning.service.ts, best-effort/non-fatal by design.
 *
 * So "provisioning" here means: confirm the identity exists, and if it does, record that a
 * training coordinator still needs to add the mapped content to that trainee's classroom
 * curriculum — a manual step surfaced clearly rather than silently assumed to have happened.
 */
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { provisionLmsIdentityForEmployee } from "../lms/lms-provisioning.service.js";

export type LmsProvisioningStatus =
  | "pending"
  | "identity_provisioned"
  | "content_manual_pending"
  | "content_confirmed"
  | "provisioning_failed";

/**
 * Attempts to confirm/create the employee's LMS learner identity, then records the result
 * on the training_assignment row. Never throws — a failure here must not roll back or block
 * the training_assignment/TAT instance that was already created, since the assignment (the
 * evidence + TAT tracking) is the thing HRMS genuinely owns; the LMS side is best-effort.
 */
export async function provisionLmsForAssignment(params: {
  assignmentId: string;
  employeeCode: string;
}): Promise<{ status: LmsProvisioningStatus; learnerId: string | null; note: string | null }> {
  let status: LmsProvisioningStatus;
  let learnerId: string | null = null;
  let note: string | null = null;

  try {
    const result = await provisionLmsIdentityForEmployee({ employeeCode: params.employeeCode, createdBy: "SYSTEM" });
    if (result.externalSynced && result.lmsLearnerId) {
      // Identity confirmed. The content itself still needs a coordinator's manual action —
      // see the module header for why there is no further automatable step.
      status = "content_manual_pending";
      learnerId = result.lmsLearnerId;
      note = "Learner identity confirmed. A training coordinator must add the mapped content to this employee's classroom curriculum in the LMS.";
    } else {
      status = "provisioning_failed";
      note = result.message ?? "LMS identity provisioning did not complete.";
    }
  } catch (err) {
    status = "provisioning_failed";
    note = (err as Error).message?.slice(0, 500) ?? "Unknown error provisioning LMS identity.";
  }

  await db.execute(
    `UPDATE training_assignment
        SET lms_learner_id = ?, lms_provisioning_status = ?, lms_provisioning_note = ?, updated_at = NOW()
      WHERE id = ?`,
    [learnerId, status, note, params.assignmentId]
  );

  return { status, learnerId, note };
}

/**
 * A training coordinator confirming they have manually added the mapped content to the
 * employee's classroom curriculum in the LMS. This is the human action this module cannot
 * automate — see the module header.
 */
export async function confirmLmsContentAdded(
  assignmentId: string,
  confirmedBy: string,
  note?: string
): Promise<void> {
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE training_assignment
        SET lms_provisioning_status = 'content_confirmed',
            lms_content_confirmed_by = ?,
            lms_content_confirmed_at = NOW(),
            lms_provisioning_note = COALESCE(?, lms_provisioning_note),
            updated_at = NOW()
      WHERE id = ? AND lms_provisioning_status IN ('identity_provisioned', 'content_manual_pending', 'provisioning_failed')`,
    [confirmedBy, note ?? null, assignmentId]
  );
  if (result.affectedRows === 0) {
    throw Object.assign(
      new Error("Assignment not found, or its LMS content is already confirmed"),
      { statusCode: 409 }
    );
  }
}

/** Assignments still needing a coordinator's manual LMS content action — the worklist. */
export async function listPendingLmsContentActions(): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ta.id, ta.employee_id, ta.lms_learner_id, ta.lms_provisioning_status,
            ta.lms_provisioning_note, ta.created_at,
            e.employee_code, e.full_name AS employee_name,
            sc.category_name
       FROM training_assignment ta
       JOIN employees e ON e.id = ta.employee_id
       JOIN skill_category sc ON sc.id = ta.skill_category_id
       LEFT JOIN task_tat_instance t ON t.id = ta.tat_instance_id
      WHERE ta.lms_provisioning_status IN ('content_manual_pending', 'provisioning_failed')
        AND (t.status IS NULL OR t.status NOT IN ('completed', 'cancelled'))
      ORDER BY ta.created_at ASC`
  );
  return rows as RowDataPacket[];
}
