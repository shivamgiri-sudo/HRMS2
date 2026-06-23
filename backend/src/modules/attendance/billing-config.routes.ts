// backend/src/modules/attendance/billing-config.routes.ts
// Attendance extra-billing config API — Finance Head + Super Admin only.
// Scope precedence (most-specific wins): employee > designation > branch > process > global

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { logSensitiveAction } from '../../shared/auditLog.js';

export const billingConfigRouter = Router();

const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

billingConfigRouter.use(requireAuth);

// ── List all billing config entries ──────────────────────────────────────────

billingConfigRouter.get(
  '/',
  requireRole('finance_head', 'super_admin', 'admin', 'hr'),
  h(async (_req, res) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         abc.*,
         pm.process_name,
         bm.branch_name,
         dm.designation_name,
         CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
         e.employee_code
       FROM attendance_billing_config abc
       LEFT JOIN process_master pm ON pm.id = abc.process_id
       LEFT JOIN branch_master bm ON bm.id = abc.branch_id
       LEFT JOIN designation_master dm ON dm.id = abc.designation_id
       LEFT JOIN employees e ON e.id = abc.employee_id
       ORDER BY
         FIELD(abc.scope_type,'employee','designation','branch','process','global'),
         abc.created_at DESC`
    );
    res.json({ success: true, data: rows });
  })
);

// ── Get single entry ──────────────────────────────────────────────────────────

billingConfigRouter.get(
  '/:id',
  requireRole('finance_head', 'super_admin', 'admin'),
  h(async (req, res) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT abc.*,
         pm.process_name, bm.branch_name, dm.designation_name,
         CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
         e.employee_code
       FROM attendance_billing_config abc
       LEFT JOIN process_master pm ON pm.id = abc.process_id
       LEFT JOIN branch_master bm ON bm.id = abc.branch_id
       LEFT JOIN designation_master dm ON dm.id = abc.designation_id
       LEFT JOIN employees e ON e.id = abc.employee_id
       WHERE abc.id = ? LIMIT 1`,
      [req.params.id]
    );
    if (!(rows as RowDataPacket[]).length) {
      return res.status(404).json({ success: false, message: 'Config entry not found' });
    }
    res.json({ success: true, data: rows[0] });
  })
);

// ── Create a new billing config entry ────────────────────────────────────────

billingConfigRouter.post(
  '/',
  requireRole('finance_head', 'super_admin'),
  h(async (req, res) => {
    const {
      scope_type,
      process_id,
      branch_id,
      designation_id,
      employee_id,
      extra_day_salary_allowed,
      effective_from,
      effective_to,
      change_reason,
    } = req.body as {
      scope_type: string;
      process_id?: string;
      branch_id?: string;
      designation_id?: string;
      employee_id?: string;
      extra_day_salary_allowed: number;
      effective_from: string;
      effective_to?: string;
      change_reason: string;
    };

    const validScopes = ['global', 'process', 'branch', 'designation', 'employee'];
    if (!validScopes.includes(scope_type)) {
      return res.status(400).json({ success: false, message: `Invalid scope_type: ${scope_type}` });
    }
    if (!change_reason?.trim()) {
      return res.status(400).json({ success: false, message: 'change_reason is required' });
    }
    if (!effective_from) {
      return res.status(400).json({ success: false, message: 'effective_from is required' });
    }
    if (extra_day_salary_allowed === undefined || extra_day_salary_allowed === null) {
      return res.status(400).json({ success: false, message: 'extra_day_salary_allowed is required (0 or 1)' });
    }

    // Scope-specific FK validation
    if (scope_type === 'process' && !process_id)         return res.status(400).json({ success: false, message: 'process_id required for scope_type=process' });
    if (scope_type === 'branch' && !branch_id)           return res.status(400).json({ success: false, message: 'branch_id required for scope_type=branch' });
    if (scope_type === 'designation' && !designation_id) return res.status(400).json({ success: false, message: 'designation_id required for scope_type=designation' });
    if (scope_type === 'employee' && !employee_id)       return res.status(400).json({ success: false, message: 'employee_id required for scope_type=employee' });

    const id = randomUUID();
    const actorId = req.authUser?.id as string;

    await db.execute(
      `INSERT INTO attendance_billing_config
         (id, scope_type, process_id, branch_id, designation_id, employee_id,
          extra_day_salary_allowed, effective_from, effective_to, active_status,
          change_reason, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        id, scope_type,
        process_id ?? null, branch_id ?? null, designation_id ?? null, employee_id ?? null,
        extra_day_salary_allowed ? 1 : 0,
        effective_from, effective_to ?? null,
        change_reason, actorId, actorId,
      ]
    );

    await logSensitiveAction({
      actor_user_id: actorId,
      actor_role: req.authUser?.role ?? 'unknown',
      action_type: 'BILLING_CONFIG_CREATED',
      module_key: 'attendance',
      entity_type: 'attendance_billing_config',
      entity_id: id,
      employee_id: employee_id,
      new_value_json: {
        scope_type, process_id, branch_id, designation_id, employee_id,
        extra_day_salary_allowed, effective_from, effective_to,
      },
      reason: change_reason,
    });

    const [created] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM attendance_billing_config WHERE id = ? LIMIT 1`, [id]
    );
    res.status(201).json({ success: true, data: (created as RowDataPacket[])[0] });
  })
);

// ── Update a billing config entry ─────────────────────────────────────────────

billingConfigRouter.patch(
  '/:id',
  requireRole('finance_head', 'super_admin'),
  h(async (req, res) => {
    const { id } = req.params;
    const { extra_day_salary_allowed, effective_from, effective_to, active_status, change_reason } = req.body as {
      extra_day_salary_allowed?: number;
      effective_from?: string;
      effective_to?: string;
      active_status?: number;
      change_reason: string;
    };

    if (!change_reason?.trim()) {
      return res.status(400).json({ success: false, message: 'change_reason is required for every update' });
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM attendance_billing_config WHERE id = ? LIMIT 1`, [id]
    );
    if (!(rows as RowDataPacket[]).length) {
      return res.status(404).json({ success: false, message: 'Config entry not found' });
    }
    const existing = rows[0] as any;

    if (existing.scope_type === 'global' && req.authUser?.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Only Super Admin can modify the global default billing config' });
    }

    const actorId = req.authUser?.id as string;
    const setParts: string[] = ['updated_by = ?', 'change_reason = ?'];
    const vals: unknown[] = [actorId, change_reason];

    if (extra_day_salary_allowed !== undefined) { setParts.push('extra_day_salary_allowed = ?'); vals.push(extra_day_salary_allowed ? 1 : 0); }
    if (effective_from !== undefined)            { setParts.push('effective_from = ?'); vals.push(effective_from); }
    if (effective_to !== undefined)              { setParts.push('effective_to = ?'); vals.push(effective_to); }
    if (active_status !== undefined)             { setParts.push('active_status = ?'); vals.push(active_status); }

    vals.push(id);
    await db.execute(`UPDATE attendance_billing_config SET ${setParts.join(', ')} WHERE id = ?`, vals);

    await logSensitiveAction({
      actor_user_id: actorId,
      actor_role: req.authUser?.role ?? 'unknown',
      action_type: 'BILLING_CONFIG_UPDATED',
      module_key: 'attendance',
      entity_type: 'attendance_billing_config',
      entity_id: id,
      employee_id: existing.employee_id,
      old_value_json: {
        extra_day_salary_allowed: existing.extra_day_salary_allowed,
        effective_from: existing.effective_from,
        effective_to: existing.effective_to,
        active_status: existing.active_status,
      },
      new_value_json: {
        extra_day_salary_allowed: extra_day_salary_allowed ?? existing.extra_day_salary_allowed,
        effective_from: effective_from ?? existing.effective_from,
        effective_to: effective_to ?? existing.effective_to,
        active_status: active_status ?? existing.active_status,
      },
      reason: change_reason,
    });

    const [updated] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM attendance_billing_config WHERE id = ? LIMIT 1`, [id]
    );
    res.json({ success: true, data: (updated as RowDataPacket[])[0] });
  })
);

// ── Deactivate (soft-delete) — Super Admin only ───────────────────────────────

billingConfigRouter.delete(
  '/:id',
  requireRole('super_admin'),
  h(async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body as { reason?: string };

    if (!reason?.trim()) {
      return res.status(400).json({ success: false, message: 'reason is required' });
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM attendance_billing_config WHERE id = ? LIMIT 1`, [id]
    );
    if (!(rows as RowDataPacket[]).length) {
      return res.status(404).json({ success: false, message: 'Config entry not found' });
    }
    const existing = rows[0] as any;

    if (existing.scope_type === 'global') {
      return res.status(400).json({ success: false, message: 'Cannot deactivate the global default billing config' });
    }

    const actorId = req.authUser?.id as string;
    await db.execute(
      `UPDATE attendance_billing_config SET active_status = 0, updated_by = ?, change_reason = ? WHERE id = ?`,
      [actorId, reason, id]
    );

    await logSensitiveAction({
      actor_user_id: actorId,
      actor_role: req.authUser?.role ?? 'unknown',
      action_type: 'BILLING_CONFIG_DEACTIVATED',
      module_key: 'attendance',
      entity_type: 'attendance_billing_config',
      entity_id: id,
      employee_id: existing.employee_id,
      old_value_json: { active_status: 1 },
      new_value_json: { active_status: 0 },
      reason,
    });

    res.json({ success: true, message: 'Billing config entry deactivated' });
  })
);

// ── Resolve effective rule for a given employee/date ─────────────────────────
// Payroll uses this logic internally; this endpoint exposes it for UI preview.

billingConfigRouter.get(
  '/resolve/:employeeId',
  requireRole('finance_head', 'super_admin', 'admin', 'payroll'),
  h(async (req, res) => {
    const { employeeId } = req.params;
    const date = (req.query.date as string) ?? new Date().toISOString().slice(0, 10);

    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT e.designation_id, e.branch_id, e.process_id
       FROM employees e WHERE e.id = ? LIMIT 1`,
      [employeeId]
    );
    if (!(empRows as RowDataPacket[]).length) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }
    const emp = empRows[0] as any;

    // Most-specific-wins: try from most specific to least
    const candidates = [
      { scope: 'employee',     where: 'employee_id = ?',    val: employeeId },
      { scope: 'designation',  where: 'designation_id = ?', val: emp.designation_id },
      { scope: 'branch',       where: 'branch_id = ?',      val: emp.branch_id },
      { scope: 'process',      where: 'process_id = ?',     val: emp.process_id },
      { scope: 'global',       where: 'scope_type = ?',     val: 'global' },
    ];

    let resolvedRule: any = null;
    for (const c of candidates) {
      const [r] = await db.execute<RowDataPacket[]>(
        `SELECT * FROM attendance_billing_config
         WHERE ${c.where}
           AND active_status = 1
           AND effective_from <= ?
           AND (effective_to IS NULL OR effective_to >= ?)
         ORDER BY effective_from DESC LIMIT 1`,
        [c.val, date, date]
      );
      if ((r as RowDataPacket[]).length) {
        resolvedRule = { ...r[0], resolved_scope: c.scope };
        break;
      }
    }

    res.json({
      success: true,
      resolved: resolvedRule,
      extra_day_salary_allowed: resolvedRule?.extra_day_salary_allowed ?? 1,
    });
  })
);
