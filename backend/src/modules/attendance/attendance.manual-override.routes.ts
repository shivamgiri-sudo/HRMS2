/**
 * Payroll Head Manual Attendance Override APIs — Phase 4
 *
 * Operates on attendance_manual_override table (migration 238).
 * Strictly Payroll Head / Payroll Admin / Admin / Super Admin access.
 * Does NOT update attendance_daily_record on create — only on approve.
 * Every action writes sensitive_action_log.
 *
 * Routes mounted at /api/attendance by app.ts.
 */

import { Router } from "express";
import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { hasAnyRole } from "../../shared/scopeAccess.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

export const attendanceManualOverrideRouter = Router();
attendanceManualOverrideRouter.use(requireAuth);

const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

// ─── Role constants ───────────────────────────────────────────────────────────
const PAYROLL_WRITE_ROLES = ["payroll_head", "payroll_admin", "admin", "super_admin"] as const;
const PAYROLL_READ_ROLES  = [...PAYROLL_WRITE_ROLES] as const;

// ─── Access guard helpers ─────────────────────────────────────────────────────

async function assertPayrollAccess(userId: string): Promise<{ actorRole: string } | null> {
  if (await hasAnyRole(userId, "super_admin"))   return { actorRole: "super_admin" };
  if (await hasAnyRole(userId, "admin"))         return { actorRole: "admin" };
  if (await hasAnyRole(userId, "payroll_head"))  return { actorRole: "payroll_head" };
  if (await hasAnyRole(userId, "payroll_admin")) return { actorRole: "payroll_admin" };
  return null;
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

/** Fetch the attendance_daily_record current state for a given employee+date. */
async function getCurrentAttendance(employeeId: string, date: string): Promise<any | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, attendance_status, lwp_value, shift_id, is_locked
       FROM attendance_daily_record
      WHERE employee_id = ? AND record_date = ?
      LIMIT 1`,
    [employeeId, date],
  );
  return (rows as RowDataPacket[])[0] ?? null;
}

/** Verify employee exists and return basic info. */
async function getEmployee(employeeId: string): Promise<any | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_code,
            COALESCE(NULLIF(TRIM(full_name),''), TRIM(CONCAT(first_name,' ',COALESCE(last_name,'')))) AS employee_name
       FROM employees
      WHERE id = ?
      LIMIT 1`,
    [employeeId],
  );
  return (rows as RowDataPacket[])[0] ?? null;
}

/** Fetch a single manual override with full detail. */
async function getOverrideWithDetail(id: string): Promise<any | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT amo.*,
            COALESCE(NULLIF(TRIM(e.full_name),''), TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
            e.employee_code,
            b.branch_name,
            p.process_name,
            creator.email AS created_by_email,
            approver.email AS approved_by_email
       FROM attendance_manual_override amo
       LEFT JOIN employees  e        ON e.id  = amo.employee_id
       LEFT JOIN branch_master b     ON b.id  = e.branch_id
       LEFT JOIN process_master p    ON p.id  = e.process_id
       LEFT JOIN auth_user creator   ON creator.id = amo.created_by
       LEFT JOIN auth_user approver  ON approver.id = amo.approved_by
      WHERE amo.id = ?
      LIMIT 1`,
    [id],
  );
  return (rows as RowDataPacket[])[0] ?? null;
}

/**
 * Check whether the given YYYY-MM payroll month is locked.
 * A month is considered locked when salary_prep_run has status IN
 * ('published','disbursed','locked','finalized') for that run_month.
 */
async function isPayrollMonthLocked(payrollMonth: string | null | undefined): Promise<boolean> {
  if (!payrollMonth) return false;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM salary_prep_run
      WHERE run_month = ?
        AND status IN ('published','disbursed','locked','finalized')
      LIMIT 1`,
    [payrollMonth],
  );
  return (rows as RowDataPacket[]).length > 0;
}

// ─── POST /api/attendance/manual-overrides ────────────────────────────────────
/**
 * Create a manual attendance override request.
 *
 * - Fetches current attendance state automatically (old_status etc.)
 * - Does NOT update attendance_daily_record here
 * - Blocks duplicate pending override for same employee+date
 * - If payroll month is locked → is_payroll_month_locked=1, higher_approval_required=1
 */
attendanceManualOverrideRouter.post("/manual-overrides", h(async (req: any, res: any) => {
  const access = await assertPayrollAccess(req.authUser.id);
  if (!access) {
    return res.status(403).json({ success: false, error: "Forbidden: Payroll Head or Payroll Admin role required" });
  }

  const {
    employee_id, attendance_date, new_status,
    new_payable_days, new_lwp, new_shift_id,
    reason, supporting_doc_id,
    payroll_month, payroll_run_id, payroll_impact_amount,
  } = req.body;

  // ── Validation ──────────────────────────────────────────────────────────────
  if (!employee_id?.trim())    return res.status(400).json({ success: false, error: "employee_id is required" });
  if (!attendance_date?.trim()) return res.status(400).json({ success: false, error: "attendance_date is required (YYYY-MM-DD)" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(attendance_date)) {
    return res.status(400).json({ success: false, error: "attendance_date must be YYYY-MM-DD" });
  }
  if (!new_status?.trim())     return res.status(400).json({ success: false, error: "new_status is required" });
  if (!reason?.trim() || reason.trim().length < 10) {
    return res.status(400).json({ success: false, error: "reason is mandatory and must be at least 10 characters" });
  }

  // Safety 1: employee must exist
  const employee = await getEmployee(employee_id);
  if (!employee) return res.status(404).json({ success: false, error: "Employee not found" });

  // Safety 2: attendance_daily_record must exist (we fetch old values from it)
  const current = await getCurrentAttendance(employee_id, attendance_date);
  if (!current) {
    return res.status(404).json({
      success: false,
      error: `No attendance_daily_record found for employee ${employee.employee_code} on ${attendance_date}. Ensure attendance has been processed for this date.`,
    });
  }

  // Safety 4: block duplicate pending override for same employee + date
  const [dupRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM attendance_manual_override
      WHERE employee_id = ? AND attendance_date = ? AND approval_status = 'pending'
      LIMIT 1`,
    [employee_id, attendance_date],
  );
  if ((dupRows as RowDataPacket[]).length > 0) {
    return res.status(409).json({
      success: false,
      error: "A pending manual override already exists for this employee on this date. Approve or reject it first.",
    });
  }

  // Safety 5: check payroll month lock
  const monthLocked = await isPayrollMonthLocked(payroll_month);
  const isLocked = monthLocked ? 1 : 0;
  // (Trigger in migration 238 also sets higher_approval_required=1 for locked months)

  const id = randomUUID();
  await db.execute(
    `INSERT INTO attendance_manual_override
       (id, employee_id, attendance_date,
        old_status, old_payable_days, old_lwp, old_shift_id,
        new_status, new_payable_days, new_lwp, new_shift_id,
        reason, supporting_doc_id,
        payroll_month, payroll_run_id, payroll_impact_amount,
        is_payroll_month_locked, higher_approval_required,
        approval_status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [
      id, employee_id, attendance_date,
      current.attendance_status,        // old_status — from live record
      null,                             // old_payable_days (future: derive from payroll line)
      current.lwp_value ?? null,        // old_lwp
      current.shift_id ?? null,         // old_shift_id
      new_status.trim(),
      new_payable_days ?? null,
      new_lwp ?? null,
      new_shift_id ?? null,
      reason.trim(),
      supporting_doc_id ?? null,
      payroll_month ?? null,
      payroll_run_id ?? null,
      payroll_impact_amount ?? null,
      isLocked,
      isLocked,                         // higher_approval_required = same as isLocked initially
      req.authUser.id,
    ],
  );

  // Audit: override created
  void logSensitiveAction({
    actor_user_id: req.authUser.id,
    actor_role:    access.actorRole,
    action_type:   "MANUAL_ATTENDANCE_OVERRIDE_CREATED",
    module_key:    "attendance",
    entity_type:   "attendance_manual_override",
    entity_id:     id,
    employee_id,
    reason:        reason.trim(),
    old_value_json: {
      attendance_status: current.attendance_status,
      lwp_value:         current.lwp_value ?? null,
      shift_id:          current.shift_id ?? null,
    },
    new_value_json: {
      new_status:              new_status.trim(),
      new_lwp:                 new_lwp ?? null,
      new_shift_id:            new_shift_id ?? null,
      payroll_month:           payroll_month ?? null,
      is_payroll_month_locked: isLocked,
      higher_approval_required: isLocked,
      payroll_impact_amount:   payroll_impact_amount ?? null,
    },
    req,
  });

  const created = await getOverrideWithDetail(id);
  return res.status(201).json({
    success: true,
    data: created,
    message: monthLocked
      ? "Override request created. Payroll month is locked — Super Admin approval required."
      : "Override request created. Pending approval.",
  });
}));

// ─── GET /api/attendance/manual-overrides ─────────────────────────────────────
/**
 * List override requests with optional filters.
 * Access: payroll_head / payroll_admin / admin / super_admin only.
 */
attendanceManualOverrideRouter.get("/manual-overrides", h(async (req: any, res: any) => {
  if (!(await assertPayrollAccess(req.authUser.id))) {
    return res.status(403).json({ success: false, error: "Forbidden: Payroll access required" });
  }

  const conds: string[] = [];
  const params: unknown[] = [];

  if (req.query.employeeId)   { conds.push("amo.employee_id = ?");                params.push(String(req.query.employeeId)); }
  if (req.query.status)       { conds.push("amo.approval_status = ?");             params.push(String(req.query.status)); }
  if (req.query.fromDate)     { conds.push("amo.attendance_date >= ?");            params.push(String(req.query.fromDate)); }
  if (req.query.toDate)       { conds.push("amo.attendance_date <= ?");            params.push(String(req.query.toDate)); }
  if (req.query.payrollMonth) { conds.push("amo.payroll_month = ?");               params.push(String(req.query.payrollMonth)); }
  if (req.query.payrollRunId) { conds.push("amo.payroll_run_id = ?");              params.push(String(req.query.payrollRunId)); }
  if (req.query.createdBy)    { conds.push("amo.created_by = ?");                  params.push(String(req.query.createdBy)); }
  if (req.query.higherApprovalRequired !== undefined) {
    conds.push("amo.higher_approval_required = ?");
    params.push(req.query.higherApprovalRequired === "1" ? 1 : 0);
  }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT amo.id, amo.employee_id, amo.attendance_date,
            amo.old_status, amo.new_status, amo.old_lwp, amo.new_lwp,
            amo.reason, amo.approval_status,
            amo.is_payroll_month_locked, amo.higher_approval_required,
            amo.payroll_month, amo.payroll_run_id, amo.payroll_impact_amount,
            amo.created_by, amo.approved_by, amo.rejected_by,
            amo.created_at, amo.approved_at, amo.rejected_at, amo.applied_at,
            COALESCE(NULLIF(TRIM(e.full_name),''), TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
            e.employee_code,
            b.branch_name,
            p.process_name
       FROM attendance_manual_override amo
       LEFT JOIN employees e      ON e.id = amo.employee_id
       LEFT JOIN branch_master b  ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       ${where}
      ORDER BY amo.created_at DESC
      LIMIT 200`,
    params,
  );

  return res.json({ success: true, data: rows });
}));

// ─── GET /api/attendance/manual-overrides/:id ─────────────────────────────────
/**
 * Return one override with full detail + audit timeline.
 */
attendanceManualOverrideRouter.get("/manual-overrides/:id", h(async (req: any, res: any) => {
  if (!(await assertPayrollAccess(req.authUser.id))) {
    return res.status(403).json({ success: false, error: "Forbidden: Payroll access required" });
  }

  const override = await getOverrideWithDetail(req.params.id);
  if (!override) return res.status(404).json({ success: false, error: "Manual override not found" });

  // Audit timeline for this override
  const [auditRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, actor_user_id, action_type, actor_role, reason,
            old_value_json, new_value_json, ip_address, acted_at
       FROM sensitive_action_log
      WHERE entity_type = 'attendance_manual_override'
        AND entity_id   = ?
      ORDER BY acted_at ASC
      LIMIT 50`,
    [req.params.id],
  );

  return res.json({
    success: true,
    data: { ...override, audit_timeline: auditRows },
  });
}));

// ─── POST /api/attendance/manual-overrides/:id/approve ───────────────────────
/**
 * Approve a pending override and apply it to attendance_daily_record.
 *
 * - If higher_approval_required = 1, only super_admin can approve.
 * - Fetches current attendance state again before writing (safety re-check).
 * - Writes both MANUAL_ATTENDANCE_OVERRIDE_APPROVED and
 *   ATTENDANCE_RECORD_MANUALLY_OVERRIDDEN audit events.
 */
attendanceManualOverrideRouter.post("/manual-overrides/:id/approve", h(async (req: any, res: any) => {
  const access = await assertPayrollAccess(req.authUser.id);
  if (!access) {
    return res.status(403).json({ success: false, error: "Forbidden: Payroll Head or Admin role required" });
  }

  const override = await getOverrideWithDetail(req.params.id);
  if (!override) return res.status(404).json({ success: false, error: "Manual override not found" });

  // Guard: must be pending
  if (override.approval_status !== "pending") {
    return res.status(409).json({
      success: false,
      error: `Cannot approve: override is already '${override.approval_status}'`,
    });
  }

  // Safety 5: locked month → only super_admin can approve
  if (override.higher_approval_required && access.actorRole !== "super_admin") {
    return res.status(403).json({
      success: false,
      error: "This override is for a locked payroll month. Only Super Admin can approve.",
    });
  }

  // Re-fetch current attendance state at approval time (may have changed since create)
  const current = await getCurrentAttendance(override.employee_id, override.attendance_date);

  // Safety check: attendance_daily_record MUST exist at approval time
  if (!current) {
    return res.status(404).json({
      success: false,
      error: `Attendance record for employee ${override.employee_code} on ${override.attendance_date} no longer exists or was deleted. Manual override cannot be applied. Contact system administrator.`,
    });
  }

  // Apply override to attendance_daily_record
  const lwpMap: Record<string, number> = { present: 0, half_day: 0.5, absent: 1.0 };
  const newLwp = override.new_lwp ?? lwpMap[override.new_status] ?? null;
  const appliedRecordId = current.id;

  // Update existing record — preserve old state in the record's own audit columns
  await db.execute(
    `UPDATE attendance_daily_record
        SET attendance_status      = ?,
            lwp_value              = ?,
            override_by            = ?,
            override_reason        = ?,
            is_locked              = 1,
            processed_at           = NOW(),
            old_attendance_status  = ?,
            old_lwp_value          = ?,
            status_change_reason   = ?,
            status_changed_by      = ?,
            status_changed_at      = NOW()
      WHERE employee_id = ? AND record_date = ?`,
    [
      override.new_status,
      newLwp,
      req.authUser.id,
      `Manual override approved: ${override.reason}`,
      current.attendance_status,
      current.lwp_value ?? null,
      `Manual override approved by ${access.actorRole}: ${override.reason}`,
      req.authUser.id,
      override.employee_id,
      override.attendance_date,
    ],
  );

  // Stamp override as approved + applied
  await db.execute(
    `UPDATE attendance_manual_override
        SET approval_status      = 'approved',
            approved_by          = ?,
            approved_at          = NOW(),
            applied_to_record_id = ?,
            applied_at           = NOW(),
            applied_by           = ?
      WHERE id = ?`,
    [req.authUser.id, appliedRecordId, req.authUser.id, req.params.id],
  );

  // Audit event 1: override approved
  void logSensitiveAction({
    actor_user_id: req.authUser.id,
    actor_role:    access.actorRole,
    action_type:   "MANUAL_ATTENDANCE_OVERRIDE_APPROVED",
    module_key:    "attendance",
    entity_type:   "attendance_manual_override",
    entity_id:     req.params.id,
    employee_id:   override.employee_id,
    reason:        req.body.reason ?? override.reason,
    old_value_json: { approval_status: "pending" },
    new_value_json: {
      approval_status: "approved",
      approved_by: req.authUser.id,
      applied_to_record_id: appliedRecordId,
    },
    req,
  });

  // Audit event 2: attendance record changed
  void logSensitiveAction({
    actor_user_id: req.authUser.id,
    actor_role:    access.actorRole,
    action_type:   "ATTENDANCE_RECORD_MANUALLY_OVERRIDDEN",
    module_key:    "attendance",
    entity_type:   "attendance_daily_record",
    entity_id:     `${override.employee_id}:${override.attendance_date}`,
    employee_id:   override.employee_id,
    reason:        override.reason,
    old_value_json: {
      attendance_status: current?.attendance_status ?? null,
      lwp_value:         current?.lwp_value ?? null,
    },
    new_value_json: {
      attendance_status: override.new_status,
      lwp_value:         newLwp,
      overridden_by:     req.authUser.id,
      manual_override_id: req.params.id,
    },
    req,
  });

  const updated = await getOverrideWithDetail(req.params.id);
  return res.json({ success: true, data: updated, message: "Override approved and attendance record updated" });
}));

// ─── POST /api/attendance/manual-overrides/:id/reject ────────────────────────
/**
 * Reject a pending override request.
 * Does NOT update attendance_daily_record.
 * Reason mandatory.
 */
attendanceManualOverrideRouter.post("/manual-overrides/:id/reject", h(async (req: any, res: any) => {
  const access = await assertPayrollAccess(req.authUser.id);
  if (!access) {
    return res.status(403).json({ success: false, error: "Forbidden: Payroll Head or Admin role required" });
  }

  const { reason } = req.body as { reason?: string };
  if (!reason?.trim() || reason.trim().length < 10) {
    return res.status(400).json({ success: false, error: "reason is mandatory and must be at least 10 characters" });
  }

  const override = await getOverrideWithDetail(req.params.id);
  if (!override) return res.status(404).json({ success: false, error: "Manual override not found" });

  // Guard: must be pending
  if (override.approval_status !== "pending") {
    return res.status(409).json({
      success: false,
      error: `Cannot reject: override is already '${override.approval_status}'`,
    });
  }

  await db.execute(
    `UPDATE attendance_manual_override
        SET approval_status  = 'rejected',
            rejected_by      = ?,
            rejected_at      = NOW(),
            rejection_reason = ?
      WHERE id = ?`,
    [req.authUser.id, reason.trim(), req.params.id],
  );

  // Audit: override rejected — attendance_daily_record NOT changed
  void logSensitiveAction({
    actor_user_id: req.authUser.id,
    actor_role:    access.actorRole,
    action_type:   "MANUAL_ATTENDANCE_OVERRIDE_REJECTED",
    module_key:    "attendance",
    entity_type:   "attendance_manual_override",
    entity_id:     req.params.id,
    employee_id:   override.employee_id,
    reason:        reason.trim(),
    old_value_json: {
      approval_status:  "pending",
      requested_status: override.new_status,
      requested_by:     override.created_by,
    },
    new_value_json: {
      approval_status:  "rejected",
      rejected_by:      req.authUser.id,
      rejection_reason: reason.trim(),
      attendance_record_unchanged: true,
    },
    req,
  });

  const updated = await getOverrideWithDetail(req.params.id);
  return res.json({
    success: true,
    data: updated,
    message: "Override request rejected. Attendance record was not changed.",
  });
}));
