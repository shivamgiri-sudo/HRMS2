/**
 * Super Admin Analytics Service — Super Admin Dashboard Metrics
 */

import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

interface SuperAdminAnalyticsSummary {
  system_health: { db_connections: number; api_p95_ms: number; error_rate_pct: number };
  security_alerts: { failed_logins_24h: number; suspicious_activity: number; blocked_ips: number };
  audit_log_summary: Array<{ action: string; count: number }>;
  module_usage: Array<{ page: string; access_count: number }>;
  user_access_changes: { new_grants: number; revoked_permissions: number; role_changes: number };
  background_jobs: { running: number; failed: number; queued: number };
}

export async function getSuperAdminAnalyticsSummary(): Promise<SuperAdminAnalyticsSummary> {
  const [dbConnections] = await db.query<RowDataPacket[]>(`SHOW STATUS LIKE 'Threads_connected'`);
  const [apiP95] = await db.query<RowDataPacket[]>(
    `SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms) as p95
     FROM api_logs
     WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)`
  );
  const [errorRate] = await db.query<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as error_pct
     FROM api_logs
     WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)`
  );

  const [failedLogins] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) as count FROM audit_log WHERE action = 'login_failed' AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`
  );
  const [suspicious] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) as count FROM security_events WHERE event_type = 'suspicious_activity' AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`
  );
  const [blocked] = await db.query<RowDataPacket[]>(`SELECT COUNT(DISTINCT ip_address) as count FROM blocked_ips WHERE is_active = 1`);

  const [auditSummary] = await db.query<RowDataPacket[]>(
    `SELECT action, COUNT(*) as count
     FROM audit_log
     WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
     GROUP BY action
     ORDER BY count DESC
     LIMIT 10`
  );

  const [moduleUsage] = await db.query<RowDataPacket[]>(
    `SELECT page_path, COUNT(*) as access_count
     FROM page_access_log
     WHERE accessed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
     GROUP BY page_path
     ORDER BY access_count DESC
     LIMIT 10`
  );

  const [accessChanges] = await db.query<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN action = 'permission_granted' THEN 1 ELSE 0 END) as grants,
       SUM(CASE WHEN action = 'permission_revoked' THEN 1 ELSE 0 END) as revoked,
       SUM(CASE WHEN action = 'role_changed' THEN 1 ELSE 0 END) as role_changes
     FROM audit_log
     WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
  );

  const [bgJobs] = await db.query<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
       SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued
     FROM background_jobs`
  );

  return {
    system_health: {
      db_connections: Number(dbConnections[0]?.Value ?? 0),
      api_p95_ms: Math.round(Number(apiP95[0]?.p95 ?? 0)),
      error_rate_pct: Math.round(Number(errorRate[0]?.error_pct ?? 0) * 100) / 100,
    },
    security_alerts: {
      failed_logins_24h: failedLogins[0]?.count ?? 0,
      suspicious_activity: suspicious[0]?.count ?? 0,
      blocked_ips: blocked[0]?.count ?? 0,
    },
    audit_log_summary: auditSummary.map((r) => ({ action: r.action, count: r.count })),
    module_usage: moduleUsage.map((r) => ({ page: r.page_path, access_count: r.access_count })),
    user_access_changes: {
      new_grants: accessChanges[0]?.grants ?? 0,
      revoked_permissions: accessChanges[0]?.revoked ?? 0,
      role_changes: accessChanges[0]?.role_changes ?? 0,
    },
    background_jobs: {
      running: bgJobs[0]?.running ?? 0,
      failed: bgJobs[0]?.failed ?? 0,
      queued: bgJobs[0]?.queued ?? 0,
    },
  };
}
