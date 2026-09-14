/**
 * Payroll Head — month-level payable days override APIs.
 *
 * Operates on payroll_payable_days_override (migration 1653), which payrollCalculate.service.ts
 * reads at step 6 to replace the computed paid base. The engine re-applies the active-calendar
 * cap on top, so nothing entered here can pay for days outside the employment window.
 *
 * This is the month-level instrument. attendance.manual-override.routes.ts remains the per-day
 * one, and neither replaces the other.
 *
 * Routes mounted at /api/payroll/payable-days-overrides by app.ts.
 */

import { Router, type NextFunction, type Response } from "express";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { hasAnyRole } from "../../shared/scopeAccess.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { isRunClosed, runRankSql } from "./run-status.js";

export const payableDaysOverrideRouter = Router();
payableDaysOverrideRouter.use(requireAuth);

type RequiredAuthRequest = AuthenticatedRequest & { authUser: NonNullable<AuthenticatedRequest["authUser"]> };

const h = (fn: (req: RequiredAuthRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req as RequiredAuthRequest, res).catch(next);

const ENTITY_TYPE = "payroll_payable_days_override";
const RUN_MONTH_RE = /^\d{4}-\d{2}$/;

// Same role set and precedence as attendance.manual-override.routes.ts.
async function assertPayrollAccess(userId: string): Promise<{ actorRole: string } | null> {
  if (await hasAnyRole(userId, "super_admin"))   return { actorRole: "super_admin" };
  if (await hasAnyRole(userId, "admin"))         return { actorRole: "admin" };
  if (await hasAnyRole(userId, "payroll_head"))  return { actorRole: "payroll_head" };
  if (await hasAnyRole(userId, "payroll_admin")) return { actorRole: "payroll_admin" };
  return null;
}

const SELECT_ROW = `
  SELECT o.id, o.employee_id, o.run_month, o.payable_days, o.computed_days,
         o.reason, o.active_status,
         o.created_by, o.created_at, o.updated_by, o.updated_at,
         o.revoked_by, o.revoked_at, o.revoke_reason,
         COALESCE(NULLIF(TRIM(e.full_name),''), TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,'')))) AS employee_name,
         e.employee_code,
         br.branch_name,
         p.process_name
    FROM payroll_payable_days_override o
    LEFT JOIN employees e      ON e.id  = o.employee_id
    LEFT JOIN branch_master br ON br.id = e.branch_id
    LEFT JOIN process_master p ON p.id  = e.process_id
`;

async function getRowById(id: string): Promise<RowDataPacket | null> {
  const [rows] = await db.execute<RowDataPacket[]>(`${SELECT_ROW} WHERE o.id = ? LIMIT 1`, [id]);
  return rows[0] ?? null;
}

/**
 * The canonical payroll run for a month, if any.
 *
 * run_month is compared as the VARCHAR it is stored as. Comparing it to a DATE matches zero rows
 * — the defect that silently emptied earlier payroll reports — so the parameter stays 'YYYY-MM'.
 */
async function getRunForMonth(runMonth: string): Promise<{ id: string; status: string } | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, status
       FROM salary_prep_run
      WHERE run_month = ?
      ORDER BY ${runRankSql()}, created_at DESC
      LIMIT 1`,
    [runMonth],
  );
  const row = rows[0] as any;
  return row ? { id: String(row.id), status: String(row.status) } : null;
}

/**
 * What the engine currently computes for this employee+month, for the "was 22 -> now 26" display.
 *
 * Read from salary_prep_line if the month has been calculated, since that is the number the run
 * actually produced. Null when the month has never been calculated — in which case the screen
 * shows the override alone, which is honest: there is nothing yet to compare it against.
 */
async function getComputedDays(employeeId: string, runMonth: string): Promise<number | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT spl.final_payable_days
       FROM salary_prep_line spl
       JOIN salary_prep_run spr ON spr.id = spl.run_id
      WHERE spl.employee_id = ? AND spr.run_month = ?
      ORDER BY ${runRankSql("spr")}, spr.created_at DESC
      LIMIT 1`,
    [employeeId, runMonth],
  );
  const row = rows[0] as any;
  if (!row || row.final_payable_days === null || row.final_payable_days === undefined) return null;
  const n = Number(row.final_payable_days);
  return Number.isFinite(n) ? n : null;
}

function reasonError(reason: unknown): string | null {
  if (typeof reason !== "string" || !reason.trim()) return "reason is mandatory";
  if (reason.trim().length < 10) return "reason must be at least 10 characters";
  return null;
}

// ─── GET / ────────────────────────────────────────────────────────────────────
/** List overrides. Filter by ?runMonth= and/or ?employeeId=; ?includeRevoked=1 for history. */
payableDaysOverrideRouter.get("/", h(async (req, res) => {
  if (!(await assertPayrollAccess(req.authUser.id))) {
    return res.status(403).json({ success: false, error: "Forbidden: Payroll access required" });
  }

  const conds: string[] = [];
  const params: unknown[] = [];
  if (req.query.includeRevoked !== "1") conds.push("o.active_status = 1");
  if (req.query.runMonth) {
    const m = String(req.query.runMonth);
    if (!RUN_MONTH_RE.test(m)) return res.status(400).json({ success: false, error: "runMonth must be YYYY-MM" });
    conds.push("o.run_month = ?"); params.push(m);
  }
  if (req.query.employeeId) { conds.push("o.employee_id = ?"); params.push(String(req.query.employeeId)); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const [rows] = await db.execute<RowDataPacket[]>(
    `${SELECT_ROW} ${where} ORDER BY o.run_month DESC, o.created_at DESC LIMIT 500`,
    params,
  );
  return res.json({ success: true, data: rows });
}));

// ─── GET /current ─────────────────────────────────────────────────────────────
/**
 * What the engine currently says for one employee+month, plus any override already standing.
 *
 * The screen calls this before offering the form so the Payroll Head is typing against a real
 * number rather than into a blank box, and so a month whose run is already closed can be refused
 * before they compose a reason for it.
 */
payableDaysOverrideRouter.get("/current", h(async (req, res) => {
  if (!(await assertPayrollAccess(req.authUser.id))) {
    return res.status(403).json({ success: false, error: "Forbidden: Payroll access required" });
  }

  const employeeId = String(req.query.employeeId ?? "").trim();
  const runMonth = String(req.query.runMonth ?? "").trim();
  if (!employeeId) return res.status(400).json({ success: false, error: "employeeId is required" });
  if (!RUN_MONTH_RE.test(runMonth)) return res.status(400).json({ success: false, error: "runMonth must be YYYY-MM" });

  const run = await getRunForMonth(runMonth);
  const [existingRows] = await db.execute<RowDataPacket[]>(
    `${SELECT_ROW} WHERE o.employee_id = ? AND o.run_month = ? LIMIT 1`,
    [employeeId, runMonth],
  );

  return res.json({
    success: true,
    data: {
      employee_id: employeeId,
      run_month: runMonth,
      computed_days: await getComputedDays(employeeId, runMonth),
      existing_override: existingRows[0] ?? null,
      run_status: run?.status ?? null,
      run_closed: run ? isRunClosed(run.status) : false,
    },
  });
}));

// ─── POST / ───────────────────────────────────────────────────────────────────
/**
 * Set (or restate) an employee's payable days for a month.
 *
 * Refuses a month whose run is already closed. An override entered against a finalized run would
 * never be read by anything — the run cannot be recalculated — so accepting it would tell the
 * Payroll Head their instruction landed when the payslip will never reflect it.
 */
payableDaysOverrideRouter.post("/", h(async (req, res) => {
  const access = await assertPayrollAccess(req.authUser.id);
  if (!access) {
    return res.status(403).json({ success: false, error: "Forbidden: Payroll Head or Payroll Admin role required" });
  }

  const { employee_id, run_month, payable_days, reason } = req.body ?? {};

  if (typeof employee_id !== "string" || !employee_id.trim()) {
    return res.status(400).json({ success: false, error: "employee_id is required" });
  }
  if (typeof run_month !== "string" || !RUN_MONTH_RE.test(run_month.trim())) {
    return res.status(400).json({ success: false, error: "run_month is required in YYYY-MM format" });
  }
  const rErr = reasonError(reason);
  if (rErr) return res.status(400).json({ success: false, error: rErr });

  const days = Number(payable_days);
  if (!Number.isFinite(days) || days < 0) {
    return res.status(400).json({ success: false, error: "payable_days must be a number of 0 or more" });
  }
  // 31 is the ceiling any calendar month can hold. The engine additionally caps at the
  // employee's own active days, so this bound only rejects input that is impossible for anyone.
  if (days > 31) {
    return res.status(400).json({ success: false, error: "payable_days cannot exceed 31" });
  }
  // Half days are real; quarter days are not.
  if (Math.round(days * 2) !== days * 2) {
    return res.status(400).json({ success: false, error: "payable_days must be a whole or half day (e.g. 25 or 25.5)" });
  }

  const month = run_month.trim();

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employees WHERE id = ? LIMIT 1`, [employee_id.trim()],
  );
  if (!empRows.length) return res.status(404).json({ success: false, error: "Employee not found" });

  const run = await getRunForMonth(month);
  if (run && isRunClosed(run.status)) {
    return res.status(409).json({
      success: false,
      error: `Payroll for ${month} is already ${run.status} and cannot be recalculated. `
           + `An override entered now would never reach a payslip. Use a correction in the next run instead.`,
    });
  }

  const computedDays = await getComputedDays(employee_id.trim(), month);

  const [existingRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, payable_days, computed_days, reason, active_status
       FROM payroll_payable_days_override
      WHERE employee_id = ? AND run_month = ? LIMIT 1`,
    [employee_id.trim(), month],
  );
  const existing = existingRows[0] ?? null;
  const id = existing ? String(existing.id) : randomUUID();

  if (existing) {
    await db.execute(
      `UPDATE payroll_payable_days_override
          SET payable_days  = ?, computed_days = ?, reason = ?,
              active_status = 1, updated_by = ?,
              revoked_by = NULL, revoked_at = NULL, revoke_reason = NULL
        WHERE id = ?`,
      [days, computedDays, String(reason).trim(), req.authUser.id, id],
    );
  } else {
    await db.execute(
      `INSERT INTO payroll_payable_days_override
         (id, employee_id, run_month, payable_days, computed_days, reason, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, employee_id.trim(), month, days, computedDays, String(reason).trim(), req.authUser.id],
    );
  }

  void logSensitiveAction({
    actor_user_id: req.authUser.id,
    actor_role:    access.actorRole,
    action_type:   existing ? "PAYABLE_DAYS_OVERRIDE_UPDATED" : "PAYABLE_DAYS_OVERRIDE_SET",
    module_key:    "payroll",
    entity_type:   ENTITY_TYPE,
    entity_id:     id,
    employee_id:   employee_id.trim(),
    reason:        String(reason).trim(),
    old_value_json: existing
      ? { payable_days: existing.payable_days, reason: existing.reason, active_status: existing.active_status }
      : undefined,
    new_value_json: { run_month: month, payable_days: days, computed_days: computedDays, active_status: 1 },
    req,
  });

  return res.status(existing ? 200 : 201).json({
    success: true,
    data: await getRowById(id),
    message: `Payable days for ${month} set to ${days}`
      + (computedDays !== null ? ` (calculated: ${computedDays})` : "")
      + ". It applies the next time this month's payroll is calculated.",
  });
}));

// ─── DELETE /:id ──────────────────────────────────────────────────────────────
/** Withdraw an override so the month reverts to the calculated payable days. */
payableDaysOverrideRouter.delete("/:id", h(async (req, res) => {
  const access = await assertPayrollAccess(req.authUser.id);
  if (!access) {
    return res.status(403).json({ success: false, error: "Forbidden: Payroll Head or Payroll Admin role required" });
  }

  const current = await getRowById(req.params.id);
  if (!current) return res.status(404).json({ success: false, error: "Override not found" });
  if (Number(current.active_status) === 0) {
    return res.status(409).json({ success: false, error: "This override has already been withdrawn" });
  }

  const rErr = reasonError((req.body ?? {}).reason);
  if (rErr) return res.status(400).json({ success: false, error: `${rErr} — state why the override is being withdrawn` });

  const run = await getRunForMonth(String(current.run_month));
  if (run && isRunClosed(run.status)) {
    return res.status(409).json({
      success: false,
      error: `Payroll for ${current.run_month} is already ${run.status}. Withdrawing the override now would not `
           + `change the finalized run, and would misrepresent what it was calculated with.`,
    });
  }

  await db.execute(
    `UPDATE payroll_payable_days_override
        SET active_status = 0, revoked_by = ?, revoked_at = NOW(), revoke_reason = ?
      WHERE id = ?`,
    [req.authUser.id, String((req.body ?? {}).reason).trim(), req.params.id],
  );

  void logSensitiveAction({
    actor_user_id: req.authUser.id,
    actor_role:    access.actorRole,
    action_type:   "PAYABLE_DAYS_OVERRIDE_WITHDRAWN",
    module_key:    "payroll",
    entity_type:   ENTITY_TYPE,
    entity_id:     req.params.id,
    employee_id:   String(current.employee_id),
    reason:        String((req.body ?? {}).reason).trim(),
    old_value_json: { payable_days: current.payable_days, active_status: 1 },
    new_value_json: { active_status: 0 },
    req,
  });

  return res.json({
    success: true,
    message: "Override withdrawn. The calculated payable days apply from the next calculation.",
  });
}));

// ─── GET /:id ─────────────────────────────────────────────────────────────────
/** One override with its audit timeline, for the drill-down drawer. */
payableDaysOverrideRouter.get("/:id", h(async (req, res) => {
  if (!(await assertPayrollAccess(req.authUser.id))) {
    return res.status(403).json({ success: false, error: "Forbidden: Payroll access required" });
  }

  const row = await getRowById(req.params.id);
  if (!row) return res.status(404).json({ success: false, error: "Override not found" });

  const [auditRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, actor_user_id, action_type, actor_role, reason,
            old_value_json, new_value_json, ip_address, acted_at
       FROM sensitive_action_log
      WHERE entity_type = ? AND entity_id = ?
      ORDER BY acted_at ASC
      LIMIT 50`,
    [ENTITY_TYPE, req.params.id],
  );

  const run = await getRunForMonth(String(row.run_month));
  return res.json({
    success: true,
    data: {
      ...row,
      run_status: run?.status ?? null,
      run_closed: run ? isRunClosed(run.status) : false,
      audit_timeline: auditRows,
    },
  });
}));
