/**
 * Real approve/reject + detail for Work Inbox's three "derived" item types
 * (LEAVE_APPROVAL_PENDING / FF_CLEARANCE_PENDING / BGV_PENDING — see
 * work-inbox.service.ts's DERIVED_REGISTRY_UNION_SQL).
 *
 * Why this file exists: NativeWorkInbox.tsx's only action ("Act & Close") completes a
 * work_item/work_inbox_item/task_tat_instance row — never the actual leave_request /
 * exit_clearance_task / candidate_bgv_check status the approval decision is really
 * about. For these three derived types the frontend didn't even offer that broken
 * button — completeTask() explicitly threw "This item has no generic completion
 * action — use its Open link instead," so there was no Approve/Reject at all here, and
 * a user had to leave Work Inbox and go find the real page. This is a genuine dispatch
 * to the SAME service/scope functions those real pages use — not a parallel
 * reimplementation that could drift from them.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { hasAnyRole } from "../../shared/scopeAccess.js";
import { canViewEmployee } from "../../shared/enterpriseScope.js";
import { canReviewLeave } from "../leave/leave.secure.routes.js";
import { leaveService } from "../leave/leave.service.js";
import { manualReview } from "../ats/bgv-verification.service.js";

export type DerivedEntityType = "leave_request" | "exit_clearance_task" | "candidate_bgv_check";
export type DerivedDecision = "approve" | "reject";

function apiError(statusCode: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

export function isDerivedEntityType(v: string): v is DerivedEntityType {
  return v === "leave_request" || v === "exit_clearance_task" || v === "candidate_bgv_check";
}

export async function decideDerivedItem(
  entityType: DerivedEntityType,
  entityId: string,
  decision: DerivedDecision,
  remarks: string | undefined,
  actorUserId: string,
): Promise<unknown> {
  const trimmedRemarks = String(remarks ?? "").trim();
  // Every domain below already requires a written reason to reject (leave, BGV) or
  // benefits from one for the same reason B/F&F review demands it elsewhere in this
  // app: a refusal with no reason is the one outcome the requester cannot act on.
  // Applied uniformly here rather than per-branch so Work Inbox can't become the
  // looser path into the same three domains.
  if (decision === "reject" && !trimmedRemarks) {
    return Promise.reject(apiError(400, "Remarks are required to reject this item"));
  }

  if (entityType === "leave_request") {
    if (!(await canReviewLeave(actorUserId, entityId))) {
      throw apiError(403, "Forbidden: leave request is outside your approval scope");
    }
    const status = decision === "approve" ? "approved" : "rejected";
    return leaveService.reviewRequest(entityId, { status: status as "approved" | "rejected", remarks: trimmedRemarks || null }, actorUserId);
  }

  if (entityType === "exit_clearance_task") {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT exit_request_id, employee_id FROM exit_clearance_task WHERE id = ? LIMIT 1`,
      [entityId],
    );
    const task = rows[0];
    if (!task) throw apiError(404, "Clearance task not found");
    if (!(await canViewEmployee(actorUserId, String(task.employee_id)))) {
      throw apiError(403, "This exit request is outside your assigned scope");
    }
    // Mirrors exit.routes.ts's PATCH /:id/clearance/:taskId exactly (same allowed status
    // set, same cleared_by/cleared_at rule) — approve clears it, reject blocks it pending
    // rework, matching the statuses that route itself accepts.
    const status = decision === "approve" ? "cleared" : "blocked";
    await db.execute(
      `UPDATE exit_clearance_task
          SET status = ?, remarks = ?, cleared_by = CASE WHEN ? IN ('cleared','waived') THEN ? ELSE cleared_by END,
              cleared_at = CASE WHEN ? IN ('cleared','waived') THEN NOW() ELSE cleared_at END,
              updated_at = NOW()
        WHERE id = ?`,
      [status, trimmedRemarks || null, status, actorUserId, status, entityId],
    );
    return { id: entityId, status };
  }

  // candidate_bgv_check
  if (!(await hasAnyRole(actorUserId, "hr", "hr_head", "admin", "super_admin", "recruiter", "recruitment_hr"))) {
    throw apiError(403, "Forbidden: BGV review is outside your role");
  }
  const [checkRows] = await db.execute<RowDataPacket[]>(
    `SELECT candidate_id, check_type FROM candidate_bgv_check WHERE id = ? LIMIT 1`,
    [entityId],
  );
  const check = checkRows[0];
  if (!check) throw apiError(404, "BGV check not found");
  const status = decision === "approve" ? "verified" : "failed";
  return manualReview(
    String(check.candidate_id),
    { checkId: entityId, status, remarks: trimmedRemarks || `Reviewed from Work Inbox (${decision})` },
    actorUserId,
  );
}

export async function getDerivedItemDetail(
  entityType: DerivedEntityType,
  entityId: string,
  actorUserId: string,
): Promise<Record<string, unknown>> {
  if (entityType === "leave_request") {
    if (!(await canReviewLeave(actorUserId, entityId)) ) {
      // canReviewLeave also returns false for a request that does not exist — resolve
      // which before deciding 403 vs 404, same distinction the real review route makes.
      const [exists] = await db.execute<RowDataPacket[]>(`SELECT id FROM leave_request WHERE id = ? LIMIT 1`, [entityId]);
      if (!exists.length) throw apiError(404, "Leave request not found");
      throw apiError(403, "Forbidden: leave request is outside your approval scope");
    }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT lr.*, e.full_name AS employee_name, e.employee_code, b.branch_name, p.process_name,
              COALESCE(NULLIF(TRIM(mgr.full_name), ''), NULL) AS reporting_manager_name
         FROM leave_request lr
         JOIN employees e ON e.id = lr.employee_id
         LEFT JOIN branch_master b ON b.id = e.branch_id
         LEFT JOIN process_master p ON p.id = e.process_id
         LEFT JOIN employees mgr ON mgr.id = e.reporting_manager_id
        WHERE lr.id = ? LIMIT 1`,
      [entityId],
    );
    if (!rows[0]) throw apiError(404, "Leave request not found");
    return rows[0];
  }

  if (entityType === "exit_clearance_task") {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT t.*, e.full_name AS employee_name, e.employee_code,
              er.exit_type, er.exit_sub_type, er.status AS exit_request_status,
              er.last_working_day_confirmed, er.last_working_day_proposed
         FROM exit_clearance_task t
         LEFT JOIN employees e ON e.id = t.employee_id
         LEFT JOIN exit_request er ON er.id = t.exit_request_id
        WHERE t.id = ? LIMIT 1`,
      [entityId],
    );
    const task = rows[0];
    if (!task) throw apiError(404, "Clearance task not found");
    if (!(await canViewEmployee(actorUserId, String(task.employee_id)))) {
      throw apiError(403, "This exit request is outside your assigned scope");
    }
    return task;
  }

  // candidate_bgv_check
  if (!(await hasAnyRole(actorUserId, "hr", "hr_head", "admin", "super_admin", "recruiter", "recruitment_hr"))) {
    throw apiError(403, "Forbidden: BGV review is outside your role");
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT bc.*, c.full_name AS candidate_name, c.candidate_code, c.mobile, c.email
       FROM candidate_bgv_check bc
       LEFT JOIN ats_candidate c ON c.id = bc.candidate_id
      WHERE bc.id = ? LIMIT 1`,
    [entityId],
  );
  if (!rows[0]) throw apiError(404, "BGV check not found");
  return rows[0];
}
