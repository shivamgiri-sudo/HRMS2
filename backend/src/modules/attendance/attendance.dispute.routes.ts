/**
 * Attendance Dispute APIs — Phase 3
 *
 * Built as a governance layer on top of attendance_regularization.
 * Does NOT create a duplicate table — all state lives in attendance_regularization
 * (extended by migration 237) with dispute_type populated.
 *
 * Routes mounted at /api/attendance by app.ts.
 */

import { Router, type NextFunction, type Response } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import {
  hasAnyRole,
  hasScopedAccess,
  buildScopeWhereClause,
} from "../../shared/scopeAccess.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { wfmService } from "../wfm/wfm.service.js";

export const attendanceDisputeRouter = Router();
attendanceDisputeRouter.use(requireAuth);

type RequiredAuthRequest = AuthenticatedRequest & { authUser: NonNullable<AuthenticatedRequest["authUser"]> };

const h = (fn: (req: RequiredAuthRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req as RequiredAuthRequest, res).catch(next);

interface AttendanceDisputeRow extends RowDataPacket {
  id: string;
  employee_id: string;
  session_date: string;
  status: string;
  reason: string | null;
  reason_code: string | null;
  requested_status: string | null;
  requested_by_type: string | null;
  dispute_type: string | null;
  old_status: string | null;
  new_status: string | null;
  old_punch_in: string | null;
  old_punch_out: string | null;
  new_punch_in: string | null;
  new_punch_out: string | null;
  payroll_impact: number | null;
  payroll_head_approval_required: number | null;
  payroll_head_approved_by: string | null;
  payroll_head_approved_at: string | null;
  escalated_to: string | null;
  escalated_at: string | null;
  supporting_doc_id: string | null;
  supporting_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  reviewer_note: string | null;
  created_at: string;
  employee_name?: string | null;
  employee_code?: string | null;
  branch_name?: string | null;
  process_name?: string | null;
  reason_label?: string | null;
  emp_branch_id?: string | null;
  emp_process_id?: string | null;
  emp_lob_id?: string | null;
  emp_department_id?: string | null;
  reporting_manager_id?: string | null;
  manager_id?: string | null;
  current_attendance_status?: string | null;
  current_lwp?: number | null;
  current_clock_in?: string | null;
  current_clock_out?: string | null;
}

interface AuditRow extends RowDataPacket {
  id: string;
  actor_user_id: string;
  action_type: string;
  actor_role: string;
  reason: string | null;
  old_value_json: unknown;
  new_value_json: unknown;
  ip_address: string | null;
  acted_at: string;
}

// Roles allowed to review disputes at various levels
const MANAGER_SCOPE_ROLES = ["manager", "assistant_manager", "tl", "branch_head", "process_manager", "wfm", "hr"];
const PAYROLL_ROLES       = ["payroll", "payroll_head", "payroll_admin", "finance"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Return the single most-relevant role key for audit purposes. */
async function resolveActorRole(userId: string): Promise<string> {
  if (await hasAnyRole(userId, "super_admin"))   return "super_admin";
  if (await hasAnyRole(userId, "admin"))         return "admin";
  if (await hasAnyRole(userId, "payroll_head"))  return "payroll_head";
  if (await hasAnyRole(userId, "payroll_admin")) return "payroll_admin";
  if (await hasAnyRole(userId, "payroll", "finance")) return "payroll";
  if (await hasAnyRole(userId, "hr"))            return "hr";
  if (await hasAnyRole(userId, "wfm"))           return "wfm";
  if (await hasAnyRole(userId, "branch_head"))   return "branch_head";
  if (await hasAnyRole(userId, "process_manager")) return "process_manager";
  if (await hasAnyRole(userId, "manager", "assistant_manager", "tl")) return "manager";
  return "employee";
}

/** Fetch the full dispute record with employee + audit fields for scope checks. */
async function getDisputeWithTarget(id: string): Promise<AttendanceDisputeRow | null> {
  const [rows] = await db.execute<AttendanceDisputeRow[]>(
    `SELECT ar.*,
            COALESCE(NULLIF(TRIM(e.full_name),''), TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
            e.employee_code,
            e.branch_id    AS emp_branch_id,
            e.process_id   AS emp_process_id,
            e.lob_id       AS emp_lob_id,
            e.department_id AS emp_department_id,
            e.reporting_manager_id,
            e.manager_id,
            b.branch_name,
            p.process_name,
            arm.label AS reason_label,
            adr.attendance_status AS current_attendance_status,
            adr.lwp_value         AS current_lwp,
            adr.clock_in_time     AS current_clock_in,
            adr.clock_out_time    AS current_clock_out
       FROM attendance_regularization ar
       LEFT JOIN employees e   ON e.id  = ar.employee_id
       LEFT JOIN branch_master b  ON b.id  = COALESCE(ar.branch_id, e.branch_id)
       LEFT JOIN process_master p ON p.id  = e.process_id
       LEFT JOIN attendance_reason_master arm ON arm.code = ar.reason_code
       LEFT JOIN attendance_daily_record adr
              ON adr.employee_id = ar.employee_id AND adr.record_date = ar.session_date
      WHERE ar.id = ?
      LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}

/** Verify caller can read/act on a specific dispute. */
async function canAccessDispute(userId: string, dispute: AttendanceDisputeRow, allowSelf = true): Promise<boolean> {
  // Super admin / admin / hr / wfm have full access
  if (await hasAnyRole(userId, "admin", "super_admin", "hr", "wfm", "ceo")) return true;

  // Payroll Head/Admin can access payroll-impact disputes only
  if (await hasAnyRole(userId, "payroll_head", "payroll_admin", "payroll", "finance")) {
    return dispute.payroll_impact === 1 || dispute.payroll_head_approval_required === 1;
  }

  const callerEmp = await getEmployeeForUser(userId);

  // Employee can see their own
  if (allowSelf && callerEmp?.id === dispute.employee_id) return true;

  // Manager / branch head / process manager via scope
  return hasScopedAccess(
    userId,
    MANAGER_SCOPE_ROLES,
    {
      branchId:            dispute.emp_branch_id,
      processId:           dispute.emp_process_id,
      lobId:               dispute.emp_lob_id,
      departmentId:        dispute.emp_department_id,
      managerEmployeeId:   dispute.reporting_manager_id ?? dispute.manager_id,
      employeeId:          dispute.employee_id,
    },
    { allowAdminBypass: true, requireScopeForNonAdmin: true },
  );
}

/** Build scope-restricted WHERE clause for list queries. */
async function buildDisputeListScope(userId: string): Promise<{ sql: string; params: unknown[] }> {
  if (await hasAnyRole(userId, "admin", "super_admin", "hr", "wfm", "ceo")) {
    return { sql: "1=1", params: [] };
  }

  // Payroll Head/Admin: only payroll-impact rows
  if (await hasAnyRole(userId, "payroll_head", "payroll_admin", "payroll", "finance")) {
    return { sql: "(ar.payroll_impact = 1 OR ar.payroll_head_approval_required = 1)", params: [] };
  }

  // Manager scope
  const scoped = await buildScopeWhereClause(
    userId,
    MANAGER_SCOPE_ROLES,
    {
      branchId:    "e.branch_id",
      processId:   "e.process_id",
      departmentId: "e.department_id",
      managerEmployeeId: "e.reporting_manager_id",
      employeeId:  "e.id",
    },
    { allowAdminBypass: true, allowCeoAllRead: true },
  );
  if (scoped.sql !== "1=0") return scoped;

  // Fallback: own records only
  const emp = await getEmployeeForUser(userId);
  if (emp?.id) return { sql: "ar.employee_id = ?", params: [emp.id] };
  return { sql: "1=0", params: [] };
}

// ─── Shared audit helper ──────────────────────────────────────────────────────

function auditDispute(
  req: AuthenticatedRequest,
  actionType: string,
  dispute: AttendanceDisputeRow,
  actorRole: string,
  reason: string | null,
  extra: { old?: Record<string, unknown>; next?: Record<string, unknown> } = {},
): void {
  void logSensitiveAction({
    actor_user_id: req.authUser!.id,
    actor_role: actorRole,
    action_type: actionType,
    module_key: "attendance",
    entity_type: "attendance_regularization",
    entity_id: dispute.id,
    employee_id: dispute.employee_id,
    reason: reason ?? undefined,
    old_value_json: {
      status: dispute.status,
      escalated_to: dispute.escalated_to ?? null,
      current_attendance_status: dispute.current_attendance_status ?? null,
      current_lwp: dispute.current_lwp ?? null,
      ...(extra.old ?? {}),
    },
    new_value_json: {
      session_date: dispute.session_date,
      dispute_type: dispute.dispute_type ?? null,
      payroll_impact: dispute.payroll_impact,
      payroll_head_approval_required: dispute.payroll_head_approval_required,
      ...(extra.next ?? {}),
    },
    req,
  });
}

// ─── GET /api/attendance/disputes ────────────────────────────────────────────
/**
 * List attendance disputes (regularizations where dispute_type IS NOT NULL
 * OR any regularization — same endpoint covers both).
 *
 * Query params: employeeId, status, disputeType, fromDate, toDate,
 *               payrollImpact, payrollHeadApprovalRequired
 */
attendanceDisputeRouter.get("/disputes", h(async (req, res) => {
  let scope;
  try {
    scope = await buildDisputeListScope(req.authUser.id);
  } catch (err) {
    console.error("[Disputes Scope Error]", err);
    return res.status(500).json({ success: false, error: "Failed to build scope: " + (err instanceof Error ? err.message : String(err)) });
  }
  const conds: string[] = [`(${scope.sql})`];
  const params: unknown[] = [...scope.params];

  // queue= param: scopes results to a specific review queue tab
  const queue = req.query.queue ? String(req.query.queue) : null;
  if (queue === "my") {
    const callerEmp = await getEmployeeForUser(req.authUser.id);
    if (callerEmp?.id) { conds.push("ar.employee_id = ?"); params.push(callerEmp.id); }
    else { conds.push("1=0"); }
  } else if (queue === "manager") {
    // Stage 1: pending records — manager queue
    conds.push("ar.status IN ('pending','submitted')");
  } else if (queue === "hr") {
    // Stage 2: manager approved, or escalated to HR
    conds.push("(ar.status = 'manager_approved' OR (ar.status = 'escalated' AND ar.escalated_to = 'hr'))");
  } else if (queue === "payroll") {
    // Payroll head required or escalated to payroll
    conds.push("(ar.payroll_head_approval_required = 1 OR (ar.status = 'escalated' AND ar.escalated_to = 'payroll'))");
    conds.push("ar.payroll_head_approved_at IS NULL");
  }

  if (req.query.employeeId)                 { conds.push("ar.employee_id = ?");                       params.push(String(req.query.employeeId)); }
  if (req.query.status)                     { conds.push("ar.status = ?");                             params.push(String(req.query.status)); }
  if (req.query.disputeType)                { conds.push("ar.dispute_type = ?");                       params.push(String(req.query.disputeType)); }
  if (req.query.fromDate)                   { conds.push("ar.session_date >= ?");                      params.push(String(req.query.fromDate)); }
  if (req.query.toDate)                     { conds.push("ar.session_date <= ?");                      params.push(String(req.query.toDate)); }
  if (req.query.payrollImpact !== undefined) { conds.push("ar.payroll_impact = ?");                   params.push(req.query.payrollImpact === "1" ? 1 : 0); }
  if (req.query.payrollHeadApprovalRequired !== undefined) {
    conds.push("ar.payroll_head_approval_required = ?");
    params.push(req.query.payrollHeadApprovalRequired === "1" ? 1 : 0);
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ar.id, ar.employee_id, ar.session_date, ar.status,
            ar.reason, ar.reason_code, ar.requested_status, ar.requested_by_type,
            ar.dispute_type, ar.old_status, ar.new_status,
            ar.old_punch_in, ar.old_punch_out, ar.new_punch_in, ar.new_punch_out,
            ar.payroll_impact, ar.payroll_head_approval_required,
            ar.payroll_head_approved_by, ar.payroll_head_approved_at,
            ar.escalated_to, ar.escalated_at,
            ar.supporting_doc_id, ar.supporting_note,
            ar.reviewed_by, ar.reviewed_at, ar.reviewer_note,
            ar.created_at,
            COALESCE(NULLIF(TRIM(e.full_name),''), TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
            e.employee_code,
            b.branch_name,
            p.process_name,
            arm.label AS reason_label
       FROM attendance_regularization ar
       LEFT JOIN employees e   ON e.id  = ar.employee_id
       LEFT JOIN branch_master b  ON b.id  = COALESCE(ar.branch_id, e.branch_id)
       LEFT JOIN process_master p ON p.id  = e.process_id
       LEFT JOIN attendance_reason_master arm ON arm.code = ar.reason_code
      WHERE ${conds.join(" AND ")}
      ORDER BY ar.created_at DESC
      LIMIT 200`,
    params,
  );

  return res.json({ success: true, data: rows });
}));

// ─── GET /api/attendance/disputes/:id ────────────────────────────────────────
/**
 * Return one dispute with full employee detail, current attendance state,
 * and audit timeline from sensitive_action_log.
 */
attendanceDisputeRouter.get("/disputes/:id", h(async (req, res) => {
  const dispute = await getDisputeWithTarget(req.params.id);
  if (!dispute) return res.status(404).json({ success: false, error: "Dispute not found" });

  if (!(await canAccessDispute(req.authUser.id, dispute))) {
    return res.status(403).json({ success: false, error: "Forbidden: outside your scope" });
  }

  // Fetch audit timeline for this dispute
  const [auditRows] = await db.execute<AuditRow[]>(
    `SELECT id, actor_user_id, action_type, actor_role, reason,
            old_value_json, new_value_json, ip_address, acted_at
       FROM sensitive_action_log
      WHERE entity_type = 'attendance_regularization'
        AND entity_id = ?
      ORDER BY acted_at ASC
      LIMIT 50`,
    [req.params.id],
  );

  return res.json({
    success: true,
    data: {
      ...dispute,
      audit_timeline: auditRows,
    },
  });
}));

// ─── POST /api/attendance/disputes/:id/manager-action ────────────────────────
/**
 * Manager approves, rejects, or escalates to HR.
 *
 * Scope:  Manager must be mapped to the employee.
 * Guard:  Cannot directly approve payroll-impact disputes (must escalate).
 * Audit:  Every action writes a sensitive_action_log row.
 */
attendanceDisputeRouter.post("/disputes/:id/manager-action", h(async (req, res) => {
  const { action, reason } = req.body as { action?: string; reason?: string };

  if (!action || !["approve", "reject", "escalate_to_hr"].includes(action)) {
    return res.status(400).json({ success: false, error: "action must be: approve | reject | escalate_to_hr" });
  }
  if ((action === "reject" || action === "escalate_to_hr") && !reason?.trim()) {
    return res.status(400).json({ success: false, error: "reason is mandatory for reject and escalate_to_hr" });
  }

  const dispute = await getDisputeWithTarget(req.params.id);
  if (!dispute) return res.status(404).json({ success: false, error: "Dispute not found" });

  // Access: manager must be scoped to this employee (not self, not cross-team)
  const isPrivileged = await hasAnyRole(req.authUser.id, "admin", "super_admin", "hr", "wfm");
  if (!isPrivileged) {
    const callerEmp = await getEmployeeForUser(req.authUser.id);
    if (!callerEmp) return res.status(403).json({ success: false, error: "No employee record" });
    if (callerEmp.id === dispute.employee_id) {
      return res.status(403).json({ success: false, error: "Cannot act on your own dispute" });
    }
    const scoped = await hasScopedAccess(req.authUser.id, MANAGER_SCOPE_ROLES, {
      branchId: dispute.emp_branch_id,
      processId: dispute.emp_process_id,
      lobId: dispute.emp_lob_id,
      departmentId: dispute.emp_department_id,
      managerEmployeeId: dispute.reporting_manager_id ?? dispute.manager_id,
      employeeId: dispute.employee_id,
    }, { allowAdminBypass: true, requireScopeForNonAdmin: true });
    if (!scoped) return res.status(403).json({ success: false, error: "Forbidden: employee outside your scope" });
  }

  // Guard: manager cannot directly approve payroll-impact disputes
  if (action === "approve" && (dispute.payroll_impact || dispute.payroll_head_approval_required)) {
    return res.status(400).json({
      success: false,
      error: "This dispute has payroll impact and requires Payroll Head approval. Use escalate_to_hr instead.",
    });
  }

  // Guard: dispute must be in a state that allows manager action
  if (!["pending", "escalated_to_manager"].includes(dispute.status)) {
    return res.status(409).json({ success: false, error: `Cannot act: dispute is already '${dispute.status}'` });
  }

  const actorRole = await resolveActorRole(req.authUser.id);

  if (action === "approve") {
    // Use existing safe service method to apply attendance correction
    await wfmService.reviewRegularization(req.params.id, {
      status: "approved",
      reviewerNote: reason ?? null,
    }, req.authUser.id);

    auditDispute(req, "DISPUTE_MANAGER_APPROVED", dispute, actorRole, reason ?? null, {
      next: { action: "approved", reviewer_note: reason ?? null },
    });

  } else if (action === "reject") {
    await wfmService.reviewRegularization(req.params.id, {
      status: "rejected",
      reviewerNote: reason!,
    }, req.authUser.id);

    auditDispute(req, "DISPUTE_MANAGER_REJECTED", dispute, actorRole, reason!, {
      next: { action: "rejected", reviewer_note: reason },
    });

  } else {
    // escalate_to_hr
    await db.execute(
      `UPDATE attendance_regularization
          SET escalated_to = 'hr',
              escalated_at = NOW(),
              escalated_by = ?,
              status       = 'escalated'
        WHERE id = ?`,
      [req.authUser.id, req.params.id],
    );

    auditDispute(req, "DISPUTE_ESCALATED_TO_HR", dispute, actorRole, reason!, {
      next: { action: "escalated_to_hr", escalated_by: req.authUser.id },
    });
  }

  const updated = await getDisputeWithTarget(req.params.id);
  return res.json({ success: true, data: updated, message: `Manager action '${action}' applied` });
}));

// ─── POST /api/attendance/disputes/:id/hr-action ─────────────────────────────
/**
 * HR / WFM approves, rejects, or escalates to Payroll Head.
 *
 * If payroll_impact = 1: must use escalate_to_payroll, not approve directly.
 * Audit: every action logged.
 */
attendanceDisputeRouter.post("/disputes/:id/hr-action", h(async (req, res) => {
  const { action, reason } = req.body as { action?: string; reason?: string };

  if (!action || !["approve", "reject", "escalate_to_payroll"].includes(action)) {
    return res.status(400).json({ success: false, error: "action must be: approve | reject | escalate_to_payroll" });
  }
  if (!reason?.trim()) {
    return res.status(400).json({ success: false, error: "reason is mandatory for all HR actions" });
  }

  // Access: HR/WFM scope or admin
  if (!(await hasAnyRole(req.authUser.id, "admin", "super_admin", "hr", "wfm", "ceo"))) {
    return res.status(403).json({ success: false, error: "Forbidden: HR or WFM role required" });
  }

  const dispute = await getDisputeWithTarget(req.params.id);
  if (!dispute) return res.status(404).json({ success: false, error: "Dispute not found" });

  // Guard: HR cannot directly approve payroll-impact disputes
  if (action === "approve" && (dispute.payroll_impact || dispute.payroll_head_approval_required)) {
    return res.status(400).json({
      success: false,
      error: "Payroll-impact dispute must be escalated to Payroll Head, not directly approved by HR.",
    });
  }

  // Guard: must be in an actionable state
  if (!["pending", "escalated", "escalated_to_hr"].includes(dispute.status)) {
    return res.status(409).json({ success: false, error: `Cannot act: dispute is already '${dispute.status}'` });
  }

  const actorRole = await resolveActorRole(req.authUser.id);

  if (action === "approve") {
    await wfmService.reviewRegularization(req.params.id, {
      status: "approved",
      reviewerNote: reason,
    }, req.authUser.id);

    auditDispute(req, "DISPUTE_HR_APPROVED", dispute, actorRole, reason, {
      next: { action: "approved", reviewer_note: reason },
    });

  } else if (action === "reject") {
    await wfmService.reviewRegularization(req.params.id, {
      status: "rejected",
      reviewerNote: reason,
    }, req.authUser.id);

    auditDispute(req, "DISPUTE_HR_REJECTED", dispute, actorRole, reason, {
      next: { action: "rejected", reviewer_note: reason },
    });

  } else {
    // escalate_to_payroll
    await db.execute(
      `UPDATE attendance_regularization
          SET escalated_to                  = 'payroll_head',
              escalated_at                  = NOW(),
              escalated_by                  = ?,
              status                        = 'escalated',
              payroll_head_approval_required = 1
        WHERE id = ?`,
      [req.authUser.id, req.params.id],
    );

    auditDispute(req, "DISPUTE_ESCALATED_TO_PAYROLL", dispute, actorRole, reason, {
      next: { action: "escalated_to_payroll", escalated_by: req.authUser.id },
    });
  }

  const updated = await getDisputeWithTarget(req.params.id);
  return res.json({ success: true, data: updated, message: `HR action '${action}' applied` });
}));

// ─── POST /api/attendance/disputes/:id/payroll-action ────────────────────────
/**
 * Payroll Head / Payroll Admin / Super Admin final resolution.
 *
 * Allowed only when payroll_impact = 1 OR payroll_head_approval_required = 1.
 * On approve: applies correction via safe service method + captures before/after.
 * No silent update: every path writes audit row.
 */
attendanceDisputeRouter.post("/disputes/:id/payroll-action", h(async (req, res) => {
  const { action, reason } = req.body as { action?: string; reason?: string };

  if (!action || !["approve", "reject", "send_back"].includes(action)) {
    return res.status(400).json({ success: false, error: "action must be: approve | reject | send_back" });
  }
  if (!reason?.trim()) {
    return res.status(400).json({ success: false, error: "reason is mandatory for all payroll actions" });
  }

  // Access: Payroll Head / Payroll Admin / Super Admin / Admin only
  const hasPayrollAccess = await hasAnyRole(
    req.authUser.id,
    "payroll_head", "payroll_admin", "admin", "super_admin",
  );
  if (!hasPayrollAccess) {
    return res.status(403).json({ success: false, error: "Forbidden: Payroll Head or Payroll Admin role required" });
  }

  const dispute = await getDisputeWithTarget(req.params.id);
  if (!dispute) return res.status(404).json({ success: false, error: "Dispute not found" });

  // Guard: only payroll-impact disputes reach this endpoint
  if (!dispute.payroll_impact && !dispute.payroll_head_approval_required) {
    return res.status(400).json({
      success: false,
      error: "This dispute has no payroll impact. Use manager-action or hr-action instead.",
    });
  }

  // Guard: must be in escalated state
  if (!["pending", "escalated", "escalated_to_payroll"].includes(dispute.status)) {
    return res.status(409).json({ success: false, error: `Cannot act: dispute is already '${dispute.status}'` });
  }

  const actorRole = await resolveActorRole(req.authUser.id);

  if (action === "approve") {
    // Use the existing safe service: captures old state, writes audit, locks record
    await wfmService.reviewRegularization(req.params.id, {
      status: "approved",
      reviewerNote: reason,
    }, req.authUser.id);

    // Also stamp payroll_head approval columns
    await db.execute(
      `UPDATE attendance_regularization
          SET payroll_head_approved_by = ?,
              payroll_head_approved_at = NOW()
        WHERE id = ?`,
      [req.authUser.id, req.params.id],
    );

    auditDispute(req, "DISPUTE_PAYROLL_APPROVED", dispute, actorRole, reason, {
      next: {
        action: "approved",
        reviewer_note: reason,
        payroll_head_approved_by: req.authUser.id,
        attendance_corrected_to: dispute.requested_status ?? null,
      },
    });

  } else if (action === "reject") {
    await wfmService.reviewRegularization(req.params.id, {
      status: "rejected",
      reviewerNote: reason,
    }, req.authUser.id);

    auditDispute(req, "DISPUTE_PAYROLL_REJECTED", dispute, actorRole, reason, {
      next: { action: "rejected", reviewer_note: reason },
    });

  } else {
    // send_back — return to HR/WFM queue for re-evaluation
    await db.execute(
      `UPDATE attendance_regularization
          SET status       = 'pending',
              escalated_to = NULL,
              reviewer_note = ?
        WHERE id = ?`,
      [reason, req.params.id],
    );

    auditDispute(req, "DISPUTE_SENT_BACK", dispute, actorRole, reason, {
      next: { action: "sent_back", sent_back_by: req.authUser.id },
    });
  }

  const updated = await getDisputeWithTarget(req.params.id);
  return res.json({ success: true, data: updated, message: `Payroll action '${action}' applied` });
}));
