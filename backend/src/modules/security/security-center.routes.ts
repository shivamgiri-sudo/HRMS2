import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";

export const securityCenterRouter = Router();
securityCenterRouter.use(requireAuth);

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
const securityRoles = requireRole("admin", "ceo", "hr", "it", "security", "dpo");
let initialized = false;

async function ensureSecurityTables() {
  if (initialized) return;
  await db.execute(`CREATE TABLE IF NOT EXISTS security_audit_event (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    event_type VARCHAR(80) NOT NULL,
    severity ENUM('info','low','medium','high','critical') NOT NULL DEFAULT 'info',
    module_key VARCHAR(80) NULL,
    entity_type VARCHAR(80) NULL,
    entity_id VARCHAR(80) NULL,
    actor_user_id VARCHAR(80) NULL,
    actor_employee_id VARCHAR(80) NULL,
    actor_role VARCHAR(120) NULL,
    target_employee_id VARCHAR(80) NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NULL,
    old_value TEXT NULL,
    new_value TEXT NULL,
    reason TEXT NULL,
    ip_address VARCHAR(80) NULL,
    user_agent VARCHAR(500) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_security_event_type (event_type),
    INDEX idx_security_severity (severity),
    INDEX idx_security_module (module_key),
    INDEX idx_security_created_at (created_at),
    INDEX idx_security_actor (actor_user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  initialized = true;
}

function limitParam(value: unknown) {
  const n = Number(value ?? 100);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 1000) : 100;
}

async function readCounts() {
  await ensureSecurityTables();
  const [todayRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN event_type = 'LOGIN_SUCCESS' THEN 1 ELSE 0 END) AS logins_today,
       SUM(CASE WHEN event_type = 'LOGIN_FAILED' THEN 1 ELSE 0 END) AS failed_logins_today,
       SUM(CASE WHEN event_type = 'PASSWORD_RESET' THEN 1 ELSE 0 END) AS password_resets_today,
       SUM(CASE WHEN event_type = 'ROLE_CHANGE' THEN 1 ELSE 0 END) AS role_changes_today,
       SUM(CASE WHEN event_type = 'EXPORT' THEN 1 ELSE 0 END) AS exports_today,
       SUM(CASE WHEN event_type = 'SENSITIVE_VIEW' THEN 1 ELSE 0 END) AS sensitive_views_today,
       SUM(CASE WHEN severity IN ('high','critical') THEN 1 ELSE 0 END) AS high_risk_today
     FROM security_audit_event
     WHERE DATE(created_at) = CURDATE()`
  );
  const [userRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN active_status = 1 THEN 1 ELSE 0 END) AS active_users,
       SUM(CASE WHEN active_status = 0 THEN 1 ELSE 0 END) AS inactive_users
     FROM users`
  ).catch(async () => [[{ active_users: 0, inactive_users: 0 }]] as any);
  return { ...(todayRows[0] ?? {}), ...(userRows[0] ?? {}) };
}

securityCenterRouter.get("/summary", securityRoles, h(async (_req, res) => {
  const counts = await readCounts();
  const highRisk = Number(counts.high_risk_today ?? 0);
  const failedLogins = Number(counts.failed_logins_today ?? 0);
  const exports = Number(counts.exports_today ?? 0);
  const sensitiveViews = Number(counts.sensitive_views_today ?? 0);
  const score = Math.max(0, 100 - highRisk * 8 - failedLogins * 2 - exports * 2 - sensitiveViews);
  return res.json({
    success: true,
    data: {
      securityScore: score,
      loginsToday: Number(counts.logins_today ?? 0),
      failedLoginsToday: failedLogins,
      passwordResetsToday: Number(counts.password_resets_today ?? 0),
      roleChangesToday: Number(counts.role_changes_today ?? 0),
      exportsToday: exports,
      sensitiveViewsToday: sensitiveViews,
      highRiskToday: highRisk,
      activeUsers: Number(counts.active_users ?? 0),
      inactiveUsers: Number(counts.inactive_users ?? 0),
    },
  });
}));

securityCenterRouter.get("/events", securityRoles, h(async (req, res) => {
  await ensureSecurityTables();
  const limit = limitParam(req.query.limit);
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (req.query.severity && req.query.severity !== "all") { clauses.push("severity = ?"); params.push(String(req.query.severity)); }
  if (req.query.eventType && req.query.eventType !== "all") { clauses.push("event_type = ?"); params.push(String(req.query.eventType)); }
  if (req.query.module && req.query.module !== "all") { clauses.push("module_key = ?"); params.push(String(req.query.module)); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM security_audit_event ${where} ORDER BY created_at DESC LIMIT ${limit}`,
    params,
  );
  return res.json({ success: true, data: rows, meta: { count: rows.length, limit } });
}));

securityCenterRouter.post("/events", securityRoles, h(async (req, res) => {
  await ensureSecurityTables();
  const body = req.body ?? {};
  const eventType = String(body.event_type ?? body.eventType ?? "MANUAL_SECURITY_EVENT").toUpperCase();
  const severity = ["info", "low", "medium", "high", "critical"].includes(String(body.severity)) ? String(body.severity) : "medium";
  await db.execute(
    `INSERT INTO security_audit_event
      (event_type, severity, module_key, entity_type, entity_id, actor_user_id, actor_role, target_employee_id, title, description, old_value, new_value, reason, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      eventType,
      severity,
      body.module_key ?? body.moduleKey ?? null,
      body.entity_type ?? body.entityType ?? null,
      body.entity_id ?? body.entityId ?? null,
      req.authUser?.id ?? null,
      req.authUser?.role ?? null,
      body.target_employee_id ?? body.targetEmployeeId ?? null,
      String(body.title ?? eventType),
      body.description ?? null,
      body.old_value == null ? null : JSON.stringify(body.old_value),
      body.new_value == null ? null : JSON.stringify(body.new_value),
      body.reason ?? null,
      req.ip ?? null,
      req.get?.("user-agent") ?? null,
    ],
  );
  return res.status(201).json({ success: true, message: "Security event logged" });
}));

securityCenterRouter.post("/export-audit", securityRoles, h(async (req, res) => {
  await ensureSecurityTables();
  const body = req.body ?? {};
  await db.execute(
    `INSERT INTO security_audit_event
      (event_type, severity, module_key, entity_type, entity_id, actor_user_id, actor_role, title, description, reason, ip_address, user_agent)
     VALUES ('EXPORT', 'high', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      body.module_key ?? body.moduleKey ?? "unknown",
      body.entity_type ?? body.entityType ?? "export",
      body.entity_id ?? body.entityId ?? null,
      req.authUser?.id ?? null,
      req.authUser?.role ?? null,
      `Export: ${body.report_name ?? body.reportName ?? body.module_key ?? "data"}`,
      `Records exported: ${body.record_count ?? body.recordCount ?? "unknown"}`,
      body.reason ?? null,
      req.ip ?? null,
      req.get?.("user-agent") ?? null,
    ],
  );
  return res.status(201).json({ success: true, message: "Export audit logged" });
}));
