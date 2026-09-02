/**
 * Payroll Head — Employee Attendance Exception Bucket APIs
 *
 * Operates on employee_attendance_exception_bucket (migration 1652).
 *
 * The bucket names individual privileged employees whose COSEC day is judged differently:
 *   - single_punch_counts_as_present — a day COSEC saw one punch on is a present day, instead of
 *     falling into the missing_punch review queue with zero minutes.
 *   - full_day_threshold_minutes     — this person's full day is (say) 480 minutes, not 540.
 *
 * Assignment is the Payroll Head's own authority: no second approver, but reason is mandatory and
 * every write lands in sensitive_action_log, which is what the drill-down timeline reads.
 *
 * attendance-engine.service.ts consumes this table; it never writes to it.
 *
 * Routes mounted at /api/wfm/attendance-exception-bucket by app.ts.
 */

import { Router, type NextFunction, type Response } from "express";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { hasAnyRole } from "../../shared/scopeAccess.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { COSEC_DEFAULT_FULL_DAY_MINUTES } from "./attendance-engine.service.js";

export const attendanceExceptionBucketRouter = Router();
attendanceExceptionBucketRouter.use(requireAuth);

type RequiredAuthRequest = AuthenticatedRequest & { authUser: NonNullable<AuthenticatedRequest["authUser"]> };

const h = (fn: (req: RequiredAuthRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req as RequiredAuthRequest, res).catch(next);

const ENTITY_TYPE = "employee_attendance_exception_bucket";

/**
 * Bounds on a full-day override. The floor is one hour rather than zero because a threshold of 0
 * would make every day with any punch a present day — the single-punch flag exists to express
 * that deliberately, and doing it accidentally through a mistyped threshold should not be
 * possible. The ceiling is 1,440 (24h) because minutes beyond a day can never be reached and
 * would silently mean "this employee is never present".
 */
const MIN_FULL_DAY_MINUTES = 60;
const MAX_FULL_DAY_MINUTES = 1440;

// ─── Access guard ─────────────────────────────────────────────────────────────
// Same role set and precedence as attendance.manual-override.routes.ts, so the two screens a
// Payroll Head uses together cannot disagree about who may act.
async function assertPayrollAccess(userId: string): Promise<{ actorRole: string } | null> {
  if (await hasAnyRole(userId, "super_admin"))   return { actorRole: "super_admin" };
  if (await hasAnyRole(userId, "admin"))         return { actorRole: "admin" };
  if (await hasAnyRole(userId, "payroll_head"))  return { actorRole: "payroll_head" };
  if (await hasAnyRole(userId, "payroll_admin")) return { actorRole: "payroll_admin" };
  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SELECT_ROW = `
  SELECT b.id, b.employee_id,
         b.single_punch_counts_as_present, b.full_day_threshold_minutes,
         b.reason, b.active_status,
         b.created_by, b.created_at, b.updated_by, b.updated_at,
         b.deactivated_by, b.deactivated_at, b.deactivation_reason,
         COALESCE(NULLIF(TRIM(e.full_name),''), TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
         e.employee_code,
         br.branch_name,
         p.process_name,
         d.designation_name
    FROM employee_attendance_exception_bucket b
    LEFT JOIN employees e           ON e.id  = b.employee_id
    LEFT JOIN branch_master br      ON br.id = e.branch_id
    LEFT JOIN process_master p      ON p.id  = e.process_id
    LEFT JOIN designation_master d  ON d.id  = e.designation_id
`;

async function getRowById(id: string): Promise<RowDataPacket | null> {
  const [rows] = await db.execute<RowDataPacket[]>(`${SELECT_ROW} WHERE b.id = ? LIMIT 1`, [id]);
  return rows[0] ?? null;
}

/** Validate an incoming threshold. Returns the value to store, or an error message. */
function normaliseThreshold(raw: unknown): { value: number | null } | { error: string } {
  // Absent, null, or empty string all mean "no override — use the engine default". They are
  // stored as NULL rather than as 540 so that a later change to the global default carries.
  if (raw === undefined || raw === null || raw === "") return { value: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { error: "full_day_threshold_minutes must be a whole number of minutes" };
  }
  if (n < MIN_FULL_DAY_MINUTES || n > MAX_FULL_DAY_MINUTES) {
    return { error: `full_day_threshold_minutes must be between ${MIN_FULL_DAY_MINUTES} and ${MAX_FULL_DAY_MINUTES}` };
  }
  return { value: n };
}

function reasonError(reason: unknown): string | null {
  if (typeof reason !== "string" || !reason.trim()) return "reason is mandatory";
  if (reason.trim().length < 10) return "reason must be at least 10 characters";
  return null;
}

// ─── GET / ────────────────────────────────────────────────────────────────────
/**
 * List bucketed employees. Active only by default; ?includeInactive=1 returns removed rows too,
 * so "who was exempt last month, and why" stays answerable after someone is taken out.
 */
attendanceExceptionBucketRouter.get("/", h(async (req, res) => {
  if (!(await assertPayrollAccess(req.authUser.id))) {
    return res.status(403).json({ success: false, error: "Forbidden: Payroll access required" });
  }

  const includeInactive = req.query.includeInactive === "1";
  const conds: string[] = [];
  const params: unknown[] = [];
  if (!includeInactive) conds.push("b.active_status = 1");
  if (req.query.employeeId) { conds.push("b.employee_id = ?"); params.push(String(req.query.employeeId)); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const [rows] = await db.execute<RowDataPacket[]>(
    `${SELECT_ROW} ${where} ORDER BY b.active_status DESC, b.created_at DESC LIMIT 500`,
    params,
  );

  return res.json({
    success: true,
    data: rows,
    meta: { default_full_day_minutes: COSEC_DEFAULT_FULL_DAY_MINUTES },
  });
}));

// ─── GET /:id ─────────────────────────────────────────────────────────────────
/** One row with its full audit timeline, for the drill-down drawer. */
attendanceExceptionBucketRouter.get("/:id", h(async (req, res) => {
  if (!(await assertPayrollAccess(req.authUser.id))) {
    return res.status(403).json({ success: false, error: "Forbidden: Payroll access required" });
  }

  const row = await getRowById(req.params.id);
  if (!row) return res.status(404).json({ success: false, error: "Exception bucket entry not found" });

  const [auditRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, actor_user_id, action_type, actor_role, reason,
            old_value_json, new_value_json, ip_address, acted_at
       FROM sensitive_action_log
      WHERE entity_type = ? AND entity_id = ?
      ORDER BY acted_at ASC
      LIMIT 50`,
    [ENTITY_TYPE, req.params.id],
  );

  return res.json({
    success: true,
    data: {
      ...row,
      default_full_day_minutes: COSEC_DEFAULT_FULL_DAY_MINUTES,
      audit_timeline: auditRows,
    },
  });
}));

// ─── POST / ───────────────────────────────────────────────────────────────────
/**
 * Add an employee to the bucket.
 *
 * Upsert rather than insert: the table holds one row per employee, and someone removed in August
 * and re-added in September is the same person with a new decision on them, not a second row.
 * Re-adding reactivates and overwrites the settings, and the audit log carries both events.
 */
attendanceExceptionBucketRouter.post("/", h(async (req, res) => {
  const access = await assertPayrollAccess(req.authUser.id);
  if (!access) {
    return res.status(403).json({ success: false, error: "Forbidden: Payroll Head or Payroll Admin role required" });
  }

  const { employee_id, single_punch_counts_as_present, full_day_threshold_minutes, reason } = req.body ?? {};

  if (typeof employee_id !== "string" || !employee_id.trim()) {
    return res.status(400).json({ success: false, error: "employee_id is required" });
  }
  const rErr = reasonError(reason);
  if (rErr) return res.status(400).json({ success: false, error: rErr });

  const threshold = normaliseThreshold(full_day_threshold_minutes);
  if ("error" in threshold) return res.status(400).json({ success: false, error: threshold.error });

  const singlePunch = single_punch_counts_as_present === true || single_punch_counts_as_present === 1 ? 1 : 0;

  // An entry that relaxes nothing is almost certainly a half-filled form, and it would sit in the
  // list looking like an active exception while changing no one's attendance.
  if (singlePunch === 0 && threshold.value === null) {
    return res.status(400).json({
      success: false,
      error: "Set at least one exception: single-punch-counts-as-present, or a full-day threshold.",
    });
  }

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_code FROM employees WHERE id = ? LIMIT 1`,
    [employee_id.trim()],
  );
  if (!empRows.length) return res.status(404).json({ success: false, error: "Employee not found" });

  const [existingRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, single_punch_counts_as_present, full_day_threshold_minutes, reason, active_status
       FROM employee_attendance_exception_bucket WHERE employee_id = ? LIMIT 1`,
    [employee_id.trim()],
  );
  const existing = existingRows[0] ?? null;
  const id = existing ? String(existing.id) : randomUUID();

  if (existing) {
    await db.execute(
      `UPDATE employee_attendance_exception_bucket
          SET single_punch_counts_as_present = ?,
              full_day_threshold_minutes     = ?,
              reason                         = ?,
              active_status                  = 1,
              updated_by                     = ?,
              deactivated_by                 = NULL,
              deactivated_at                 = NULL,
              deactivation_reason            = NULL
        WHERE id = ?`,
      [singlePunch, threshold.value, String(reason).trim(), req.authUser.id, id],
    );
  } else {
    await db.execute(
      `INSERT INTO employee_attendance_exception_bucket
         (id, employee_id, single_punch_counts_as_present, full_day_threshold_minutes, reason, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, employee_id.trim(), singlePunch, threshold.value, String(reason).trim(), req.authUser.id],
    );
  }

  void logSensitiveAction({
    actor_user_id: req.authUser.id,
    actor_role:    access.actorRole,
    action_type:   existing ? "ATTENDANCE_EXCEPTION_BUCKET_UPDATED" : "ATTENDANCE_EXCEPTION_BUCKET_ASSIGNED",
    module_key:    "attendance",
    entity_type:   ENTITY_TYPE,
    entity_id:     id,
    employee_id:   employee_id.trim(),
    reason:        String(reason).trim(),
    old_value_json: existing
      ? {
          single_punch_counts_as_present: existing.single_punch_counts_as_present,
          full_day_threshold_minutes:     existing.full_day_threshold_minutes,
          reason:                         existing.reason,
          active_status:                  existing.active_status,
        }
      : undefined,
    new_value_json: {
      single_punch_counts_as_present: singlePunch,
      full_day_threshold_minutes:     threshold.value,
      active_status:                  1,
    },
    req,
  });

  return res.status(existing ? 200 : 201).json({
    success: true,
    data: await getRowById(id),
    message: existing
      ? "Exception updated. It applies from the next attendance processing run."
      : "Employee added to the exception bucket. It applies from the next attendance processing run.",
  });
}));

// ─── PATCH /:id ───────────────────────────────────────────────────────────────
/** Change an existing entry's settings. Only the fields present in the body are touched. */
attendanceExceptionBucketRouter.patch("/:id", h(async (req, res) => {
  const access = await assertPayrollAccess(req.authUser.id);
  if (!access) {
    return res.status(403).json({ success: false, error: "Forbidden: Payroll Head or Payroll Admin role required" });
  }

  const current = await getRowById(req.params.id);
  if (!current) return res.status(404).json({ success: false, error: "Exception bucket entry not found" });

  const { single_punch_counts_as_present, full_day_threshold_minutes, reason } = req.body ?? {};
  const rErr = reasonError(reason);
  if (rErr) return res.status(400).json({ success: false, error: `${rErr} — state why this exception is changing` });

  const singlePunch = single_punch_counts_as_present === undefined
    ? Number(current.single_punch_counts_as_present ?? 0)
    : (single_punch_counts_as_present === true || single_punch_counts_as_present === 1 ? 1 : 0);

  const threshold = full_day_threshold_minutes === undefined
    ? { value: current.full_day_threshold_minutes === null ? null : Number(current.full_day_threshold_minutes) }
    : normaliseThreshold(full_day_threshold_minutes);
  if ("error" in threshold) return res.status(400).json({ success: false, error: threshold.error });

  if (singlePunch === 0 && threshold.value === null) {
    return res.status(400).json({
      success: false,
      error: "An entry must keep at least one exception. Remove the employee from the bucket instead.",
    });
  }

  await db.execute(
    `UPDATE employee_attendance_exception_bucket
        SET single_punch_counts_as_present = ?,
            full_day_threshold_minutes     = ?,
            reason                         = ?,
            updated_by                     = ?
      WHERE id = ?`,
    [singlePunch, threshold.value, String(reason).trim(), req.authUser.id, req.params.id],
  );

  void logSensitiveAction({
    actor_user_id: req.authUser.id,
    actor_role:    access.actorRole,
    action_type:   "ATTENDANCE_EXCEPTION_BUCKET_UPDATED",
    module_key:    "attendance",
    entity_type:   ENTITY_TYPE,
    entity_id:     req.params.id,
    employee_id:   String(current.employee_id),
    reason:        String(reason).trim(),
    old_value_json: {
      single_punch_counts_as_present: current.single_punch_counts_as_present,
      full_day_threshold_minutes:     current.full_day_threshold_minutes,
      reason:                         current.reason,
    },
    new_value_json: {
      single_punch_counts_as_present: singlePunch,
      full_day_threshold_minutes:     threshold.value,
    },
    req,
  });

  return res.json({
    success: true,
    data: await getRowById(req.params.id),
    message: "Exception updated. It applies from the next attendance processing run.",
  });
}));

// ─── DELETE /:id ──────────────────────────────────────────────────────────────
/**
 * Remove an employee from the bucket. Soft delete: the row stays with active_status = 0 so the
 * period during which the exception applied is still on the record. The engine reads active rows
 * only, so removal takes effect on the next processing run.
 */
attendanceExceptionBucketRouter.delete("/:id", h(async (req, res) => {
  const access = await assertPayrollAccess(req.authUser.id);
  if (!access) {
    return res.status(403).json({ success: false, error: "Forbidden: Payroll Head or Payroll Admin role required" });
  }

  const current = await getRowById(req.params.id);
  if (!current) return res.status(404).json({ success: false, error: "Exception bucket entry not found" });
  if (Number(current.active_status) === 0) {
    return res.status(409).json({ success: false, error: "This employee is already removed from the bucket" });
  }

  const reason = (req.body ?? {}).reason;
  const rErr = reasonError(reason);
  if (rErr) return res.status(400).json({ success: false, error: `${rErr} — state why this exception is being removed` });

  await db.execute(
    `UPDATE employee_attendance_exception_bucket
        SET active_status       = 0,
            deactivated_by      = ?,
            deactivated_at      = NOW(),
            deactivation_reason = ?
      WHERE id = ?`,
    [req.authUser.id, String(reason).trim(), req.params.id],
  );

  void logSensitiveAction({
    actor_user_id: req.authUser.id,
    actor_role:    access.actorRole,
    action_type:   "ATTENDANCE_EXCEPTION_BUCKET_REMOVED",
    module_key:    "attendance",
    entity_type:   ENTITY_TYPE,
    entity_id:     req.params.id,
    employee_id:   String(current.employee_id),
    reason:        String(reason).trim(),
    old_value_json: {
      single_punch_counts_as_present: current.single_punch_counts_as_present,
      full_day_threshold_minutes:     current.full_day_threshold_minutes,
      active_status:                  1,
    },
    new_value_json: { active_status: 0 },
    req,
  });

  return res.json({
    success: true,
    message: "Employee removed from the exception bucket. Standard COSEC rules apply from the next processing run.",
  });
}));
