/**
 * Audit Log Extension APIs — Phase 5
 *
 * Extends existing GET /api/access/audit-log with rich filtering and adds
 * CSV export capability. Built on top of sensitive_action_log table
 * (extended by migration 237 with structured old_value_json, new_value_json,
 * employee_id, actor_role, reason columns).
 *
 * Routes mounted at /api/audit by app.ts.
 * Also extends /api/access/audit-log with new query parameters.
 */

import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { hasAnyRole } from "../../shared/scopeAccess.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

export const auditLogRouter = Router();
auditLogRouter.use(requireAuth);

const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

// ─── Role helpers ──────────────────────────────────────────────────────────

async function resolveActorRole(userId: string): Promise<string> {
  if (await hasAnyRole(userId, "super_admin"))   return "super_admin";
  if (await hasAnyRole(userId, "admin"))         return "admin";
  if (await hasAnyRole(userId, "payroll_head"))  return "payroll_head";
  if (await hasAnyRole(userId, "hr"))            return "hr";
  if (await hasAnyRole(userId, "wfm"))           return "wfm";
  if (await hasAnyRole(userId, "manager"))       return "manager";
  return "employee";
}

// ─── GET /api/access/audit-log (extended) ────────────────────────────────
/**
 * Extended audit log query with rich filtering.
 *
 * New query parameters (in addition to existing ones):
 * - fromDate (YYYY-MM-DD or ISO datetime)
 * - toDate
 * - employeeId
 * - actorUserId
 * - actorRole
 * - module (module_key filter)
 * - entityType
 * - entityId
 * - actionType
 * - reason (partial match in reason field)
 * - page (1-based, default 1)
 * - limit (default 50, max 500)
 *
 * Access control:
 * - admin/super_admin: view all
 * - payroll_head: attendance and payroll_manual_override module audit only
 * - hr/wfm: attendance/regularization/dispute module audit within scope
 * - manager: own team's dispute audit if allowed (restricted, not yet implemented)
 * - employee: cannot access
 */
export async function getAuditLogExtended(req: any, res: any): Promise<void> {
  // Access control: determine what this user can view
  const isAdmin = await hasAnyRole(req.authUser.id, "admin", "super_admin");
  const isPayrollHead = await hasAnyRole(req.authUser.id, "payroll_head");
  const isHRWFM = await hasAnyRole(req.authUser.id, "hr", "wfm");

  if (!isAdmin && !isPayrollHead && !isHRWFM) {
    return res.status(403).json({ success: false, error: "Forbidden: audit log access not permitted" });
  }

  // Build dynamic WHERE clause
  const conds: string[] = [];
  const params: unknown[] = [];

  // Role-based module filter
  if (isPayrollHead && !isAdmin) {
    conds.push("(sal.module_key IN ('attendance','payroll') OR sal.module_key LIKE 'manual_override%')");
  } else if (isHRWFM && !isAdmin) {
    conds.push("sal.module_key IN ('attendance','regularization','dispute','wfm')");
  }
  // Admin/super_admin: no module restriction

  // Date range
  if (req.query.fromDate) {
    conds.push("sal.acted_at >= ?");
    params.push(String(req.query.fromDate));
  }
  if (req.query.toDate) {
    conds.push("sal.acted_at <= ?");
    params.push(String(req.query.toDate));
  }

  // Employee filter
  if (req.query.employeeId) {
    conds.push("sal.employee_id = ?");
    params.push(String(req.query.employeeId));
  }

  // Actor filter
  if (req.query.actorUserId) {
    conds.push("sal.actor_user_id = ?");
    params.push(String(req.query.actorUserId));
  }

  if (req.query.actorRole) {
    conds.push("sal.actor_role = ?");
    params.push(String(req.query.actorRole));
  }

  // Module / entity filters
  if (req.query.module) {
    conds.push("sal.module_key = ?");
    params.push(String(req.query.module));
  }

  if (req.query.entityType) {
    conds.push("sal.entity_type = ?");
    params.push(String(req.query.entityType));
  }

  if (req.query.entityId) {
    conds.push("sal.entity_id = ?");
    params.push(String(req.query.entityId));
  }

  // Action filter
  if (req.query.actionType) {
    conds.push("sal.action_type = ?");
    params.push(String(req.query.actionType));
  }

  // Reason (partial/LIKE)
  if (req.query.reason) {
    conds.push("sal.reason LIKE ?");
    params.push(`%${String(req.query.reason)}%`);
  }

  // Pagination — guard against NaN (MySQL rejects non-integer LIMIT/OFFSET params)
  const limitRaw = parseInt(String(req.query.limit ?? "50"), 10);
  const pageRaw  = parseInt(String(req.query.page  ?? "1"),  10);
  const limit  = Math.min(isNaN(limitRaw) ? 50 : Math.max(1, limitRaw), 500);
  const page   = isNaN(pageRaw)  ? 1 : Math.max(1, pageRaw);
  const offset = (page - 1) * limit;

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "WHERE 1=1";

  // Get total count for pagination
  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as total FROM sensitive_action_log sal ${where}`,
    params,
  );
  const total = (countRows[0] as any)?.total ?? 0;

  // Fetch rows
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT sal.id, sal.actor_user_id, sal.action_type, sal.module_key,
            sal.entity_type, sal.entity_id, sal.employee_id,
            sal.ip_address, sal.user_agent,
            sal.actor_role, sal.reason,
            sal.change_summary, sal.old_value_json, sal.new_value_json,
            sal.acted_at,
            au.email as actor_email
       FROM sensitive_action_log sal
       LEFT JOIN auth_user au ON au.id = sal.actor_user_id
       ${where}
      ORDER BY sal.acted_at DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return res.json({
    success: true,
    data: rows,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
    filters_applied: {
      fromDate: req.query.fromDate ?? null,
      toDate: req.query.toDate ?? null,
      employeeId: req.query.employeeId ?? null,
      actorUserId: req.query.actorUserId ?? null,
      actorRole: req.query.actorRole ?? null,
      module: req.query.module ?? null,
      entityType: req.query.entityType ?? null,
      entityId: req.query.entityId ?? null,
      actionType: req.query.actionType ?? null,
      reason: req.query.reason ?? null,
    },
  });
}

// Mount on both /api/access/audit-log and /api/audit/log for convenience
auditLogRouter.get("/log", h(getAuditLogExtended));

// ─── POST /api/audit/export ────────────────────────────────────────────────
/**
 * Export audit log as CSV.
 *
 * Request body matches audit-log filters (all optional):
 * { fromDate, toDate, employeeId, actorUserId, actorRole, module, entityType,
 *   entityId, actionType, reason }
 *
 * Access: admin, super_admin, payroll_head can export (with module restrictions)
 * Every export is itself audited as AUDIT_LOG_EXPORTED.
 */
auditLogRouter.post("/export", h(async (req: any, res: any) => {
  // Access control: same as list
  const isAdmin = await hasAnyRole(req.authUser.id, "admin", "super_admin");
  const isPayrollHead = await hasAnyRole(req.authUser.id, "payroll_head");

  if (!isAdmin && !isPayrollHead) {
    return res.status(403).json({ success: false, error: "Forbidden: audit export not permitted" });
  }

  const {
    fromDate, toDate, employeeId, actorUserId, actorRole, module,
    entityType, entityId, actionType, reason,
  } = req.body as Record<string, string | undefined>;

  // Build WHERE clause (same pattern as GET)
  const conds: string[] = [];
  const params: unknown[] = [];

  if (isPayrollHead && !isAdmin) {
    conds.push("(sal.module_key IN ('attendance','payroll') OR sal.module_key LIKE 'manual_override%')");
  }

  if (fromDate) { conds.push("sal.acted_at >= ?"); params.push(fromDate); }
  if (toDate) { conds.push("sal.acted_at <= ?"); params.push(toDate); }
  if (employeeId) { conds.push("sal.employee_id = ?"); params.push(employeeId); }
  if (actorUserId) { conds.push("sal.actor_user_id = ?"); params.push(actorUserId); }
  if (actorRole) { conds.push("sal.actor_role = ?"); params.push(actorRole); }
  if (module) { conds.push("sal.module_key = ?"); params.push(module); }
  if (entityType) { conds.push("sal.entity_type = ?"); params.push(entityType); }
  if (entityId) { conds.push("sal.entity_id = ?"); params.push(entityId); }
  if (actionType) { conds.push("sal.action_type = ?"); params.push(actionType); }
  if (reason) { conds.push("sal.reason LIKE ?"); params.push(`%${reason}%`); }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "WHERE 1=1";

  // Fetch all matching rows (up to reasonable limit for export)
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT sal.id, sal.actor_user_id, sal.action_type, sal.module_key,
            sal.entity_type, sal.entity_id, sal.employee_id,
            sal.ip_address, sal.user_agent,
            sal.actor_role, sal.reason,
            sal.old_value_json, sal.new_value_json,
            sal.acted_at
       FROM sensitive_action_log sal
       ${where}
      ORDER BY sal.acted_at DESC
      LIMIT 50000`,
    params,
  );

  // Build CSV header
  const csvHeader = [
    "acted_at",
    "actor_user_id",
    "actor_role",
    "module_key",
    "action_type",
    "entity_type",
    "entity_id",
    "employee_id",
    "reason",
    "ip_address",
    "user_agent",
    "old_value_json",
    "new_value_json",
  ].join(",");

  // Build CSV rows (escape quotes, handle nulls)
  const csvRows = (rows as any[]).map((row) => [
    escapeCSV(row.acted_at ?? ""),
    escapeCSV(row.actor_user_id ?? ""),
    escapeCSV(row.actor_role ?? ""),
    escapeCSV(row.module_key ?? ""),
    escapeCSV(row.action_type ?? ""),
    escapeCSV(row.entity_type ?? ""),
    escapeCSV(row.entity_id ?? ""),
    escapeCSV(row.employee_id ?? ""),
    escapeCSV(row.reason ?? ""),
    escapeCSV(row.ip_address ?? ""),
    escapeCSV(row.user_agent ?? ""),
    escapeCSV(row.old_value_json ? JSON.stringify(row.old_value_json) : ""),
    escapeCSV(row.new_value_json ? JSON.stringify(row.new_value_json) : ""),
  ].join(",")).join("\n");

  const csv = `${csvHeader}\n${csvRows}`;

  // Audit the export action itself
  const exportActorRole = await resolveActorRole(req.authUser.id);
  void logSensitiveAction({
    actor_user_id: req.authUser.id,
    actor_role: exportActorRole,
    action_type: "AUDIT_LOG_EXPORTED",
    module_key: "audit",
    entity_type: "audit_log",
    entity_id: `export_${new Date().getTime()}`,
    reason: `Exported audit log: ${rows.length} rows, filters: ${JSON.stringify({
      fromDate, toDate, employeeId, actorUserId, actorRole, module,
      entityType, entityId, actionType, reason,
    })}`,
    new_value_json: {
      row_count: rows.length,
      filters: { fromDate, toDate, employeeId, actorUserId, actorRole, module,
        entityType, entityId, actionType, reason },
    },
    req,
  });

  // Return CSV file
  const timestamp = new Date().toISOString().split("T")[0];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="audit-log-export-${timestamp}.csv"`);
  return res.send(csv);
}));

// ─── Helper: CSV escaping ───────────────────────────────────────────────────

function escapeCSV(value: string): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ─── Helper: Audit timeline services ────────────────────────────────────────

/**
 * Service helper: fetch audit timeline for a specific entity.
 * Used by dispute and override detail endpoints.
 */
export async function getAuditTimeline(
  entityType: string,
  entityId: string,
  limit: number = 50,
): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, actor_user_id, action_type, actor_role, reason,
            old_value_json, new_value_json, ip_address, acted_at
       FROM sensitive_action_log
      WHERE entity_type = ? AND entity_id = ?
      ORDER BY acted_at ASC
      LIMIT ?`,
    [entityType, entityId, limit],
  );
  return rows;
}

/**
 * Service helper: fetch audit timeline for an employee across all modules.
 * Supports scoped queries (e.g., HR sees only attendance audits for their scope).
 */
export async function getEmployeeAuditTimeline(
  employeeId: string,
  filters?: {
    fromDate?: string;
    toDate?: string;
    module?: string;
    actionType?: string;
    limit?: number;
  },
): Promise<RowDataPacket[]> {
  const limit = filters?.limit ?? 100;
  const conds: string[] = ["sal.employee_id = ?"];
  const params: unknown[] = [employeeId];

  if (filters?.fromDate) { conds.push("sal.acted_at >= ?"); params.push(filters.fromDate); }
  if (filters?.toDate) { conds.push("sal.acted_at <= ?"); params.push(filters.toDate); }
  if (filters?.module) { conds.push("sal.module_key = ?"); params.push(filters.module); }
  if (filters?.actionType) { conds.push("sal.action_type = ?"); params.push(filters.actionType); }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, actor_user_id, action_type, actor_role, module_key,
            entity_type, entity_id, reason,
            old_value_json, new_value_json, ip_address, acted_at
       FROM sensitive_action_log sal
      WHERE ${conds.join(" AND ")}
      ORDER BY sal.acted_at DESC
      LIMIT ?`,
    [...params, limit],
  );
  return rows;
}
