import { randomUUID } from "crypto";
import type { RowDataPacket, Pool } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import { getPoolForKey, testPoolForKey } from "../external-db/external-db.service.js";
import mysql from "mysql2/promise";

// Static fallback pool from .env — used only when no Integration Hub credentials are configured.
// Once LMS credentials are saved via Integration Hub (integration_key='lms_sync'),
// getLmsPool() will return the config-driven pool instead.
let _envPool: Pool | null = null;
function getEnvPool(): Pool {
  if (!_envPool) {
    _envPool = mysql.createPool({
      host: env.LMS_DB_HOST,
      port: env.LMS_DB_PORT,
      user: env.LMS_DB_USER,
      password: env.LMS_DB_PASSWORD,
      database: env.LMS_DB_NAME,
      connectionLimit: env.LMS_DB_POOL_MAX,
      waitForConnections: true,
      queueLimit: 0,
      timezone: "local",
      decimalNumbers: true,
    });
  }
  return _envPool;
}

// Returns the active LMS pool. Prefers Integration Hub credentials (lms_sync key).
// Falls back to .env pool when no IH credentials are stored.
export async function getLmsPool(): Promise<Pool> {
  try {
    const pool = await getPoolForKey("lms_sync") as Pool;
    return pool;
  } catch {
    return getEnvPool();
  }
}

export async function lmsQuery<T extends RowDataPacket[] = RowDataPacket[]>(sql: string, params: unknown[] = []): Promise<T> {
  const pool = await getLmsPool();
  const [rows] = await pool.execute<T>(sql, params as any);
  return rows;
}

function hasLmsAdminRole(hrmsRoles: string[]) {
  return hrmsRoles.some((role) => ["admin", "hr", "ceo", "super_admin", "lms_admin"].includes(String(role).toLowerCase()));
}

function hasLmsCoordinatorRole(hrmsRoles: string[], lmsRole?: string | null) {
  const normalized = hrmsRoles.map((role) => String(role).toLowerCase());
  return normalized.some((role) => ["trainer", "quality", "quality_auditor", "qa", "qtl", "training", "training_manager", "lms_coordinator", "coordinator"].includes(role)) || ["coordinator", "trainer", "quality"].includes(String(lmsRole ?? "").toLowerCase());
}

export const lmsService = {
  async testConnection(): Promise<{ ok: boolean; source: "integration_hub" | "env"; latency_ms?: number; error?: string }> {
    const start = Date.now();
    // Try Integration Hub credentials first
    try {
      const result = await testPoolForKey("lms_sync");
      if (result.ok) {
        return { ok: true, source: "integration_hub", latency_ms: Date.now() - start };
      }
    } catch {
      // Fall through to env pool
    }
    // Try env pool
    try {
      const pool = getEnvPool();
      await pool.execute("SELECT 1");
      return { ok: true, source: "env", latency_ms: Date.now() - start };
    } catch (e: any) {
      return { ok: false, source: "env", error: e?.message ?? "Connection failed", latency_ms: Date.now() - start };
    }
  },

  async getAccessForEmployee(employee: any, hrmsRoles: string[]) {
    const employeeCode = String(employee?.employee_code ?? "").trim();
    const userId = String(employee?.user_id ?? "").trim();
    const email = String(employee?.email ?? employee?.official_email ?? "").trim();
    const [roleAccess] = await lmsQuery<RowDataPacket[]>(
      `SELECT * FROM role_access_matrix
        WHERE active = 1
          AND (employee_code = ? OR login_id = ? OR email = ?)
        LIMIT 1`,
      [employeeCode, employeeCode || userId, email],
    );
    const [trainee] = await lmsQuery<RowDataPacket[]>(
      `SELECT * FROM trainee_master
        WHERE employee_id = ? OR permanent_emp_id = ? OR email = ?
        LIMIT 1`,
      [employeeCode, employeeCode, email],
    );
    const canAdmin = hasLmsAdminRole(hrmsRoles) || ["admin", "management"].includes(String(roleAccess?.role ?? "").toLowerCase()) || ["admin", "management"].includes(String(roleAccess?.portal_access ?? "").toLowerCase());
    const canCoordinator = canAdmin || hasLmsCoordinatorRole(hrmsRoles, roleAccess?.role) || ["coordinator", "trainer"].includes(String(roleAccess?.portal_access ?? "").toLowerCase());
    const canEmployee = Boolean(trainee) || Boolean(employeeCode);
    return {
      employeeCode,
      user: {
        employeeId: employee?.id,
        employeeCode,
        name: employee?.full_name ?? [employee?.first_name, employee?.last_name].filter(Boolean).join(" "),
        email,
        branch: employee?.branch_name ?? employee?.branch_id,
        process: employee?.process_name ?? employee?.process_id,
      },
      lmsRole: roleAccess ?? null,
      trainee: trainee ?? null,
      access: {
        employee: canEmployee,
        coordinator: canCoordinator,
        admin: canAdmin,
      },
    };
  },

  async getNativeEmployeeDashboard(employeeCode: string, email?: string) {
    const [trainee] = await lmsQuery<RowDataPacket[]>(
      `SELECT * FROM trainee_master
        WHERE employee_id = ? OR permanent_emp_id = ? OR email = ?
        LIMIT 1`,
      [employeeCode, employeeCode, email ?? ""],
    );
    if (!trainee) return { trainee: null, modules: [], contents: [], progress: [] };
    const modules = await lmsQuery<RowDataPacket[]>(
      `SELECT m.*, c.classroom_name
         FROM module_master m
         LEFT JOIN classroom_master c ON c.classroom_id = m.classroom_id
        WHERE m.active = 1 AND (? IS NULL OR m.classroom_id = ?)
        ORDER BY m.day_no, m.module_order`,
      [trainee.classroom_id ?? null, trainee.classroom_id ?? null],
    );
    const contents = await lmsQuery<RowDataPacket[]>(
      `SELECT cm.*, mm.module_title, mm.day_no
         FROM content_master cm
         JOIN module_master mm ON mm.module_id = cm.module_id
        WHERE cm.active = 1 AND mm.active = 1 AND (? IS NULL OR mm.classroom_id = ?)
        ORDER BY mm.day_no, mm.module_order, cm.content_order`,
      [trainee.classroom_id ?? null, trainee.classroom_id ?? null],
    );
    const progress = await lmsQuery<RowDataPacket[]>(
      `SELECT * FROM trainee_content_progress
        WHERE employee_id = ? OR trainee_employee_id = ?
        ORDER BY updated_at DESC
        LIMIT 500`,
      [employeeCode, employeeCode],
    ).catch(() => [] as RowDataPacket[]);
    return { trainee, modules, contents, progress };
  },

  async getNativeCoordinatorDashboard(access: any) {
    const role = access?.lmsRole ?? {};
    const conds = ["1=1"];
    const params: unknown[] = [];
    if (!access?.access?.admin) {
      if (role.branch) { conds.push("branch = ?"); params.push(role.branch); }
      if (role.process) { conds.push("process = ?"); params.push(role.process); }
      if (role.lob) { conds.push("lob = ?"); params.push(role.lob); }
    }
    const where = conds.join(" AND ");
    const batches = await lmsQuery<RowDataPacket[]>(`SELECT * FROM batch_master WHERE ${where} ORDER BY start_date DESC, created_at DESC LIMIT 100`, params);
    const trainees = await lmsQuery<RowDataPacket[]>(`SELECT * FROM trainee_master WHERE ${where} ORDER BY last_updated_at DESC LIMIT 200`, params);
    const attendance = await lmsQuery<RowDataPacket[]>(`SELECT * FROM attendance_inference WHERE ${where} ORDER BY attendance_date DESC LIMIT 200`, params).catch(() => [] as RowDataPacket[]);
    return { scope: { branch: role.branch, process: role.process, lob: role.lob }, batches, trainees, attendance };
  },

  async getNativeAdminDashboard() {
    const [batchStats] = await lmsQuery<RowDataPacket[]>(`SELECT COUNT(*) AS total_batches, SUM(batch_status = 'Active') AS active_batches FROM batch_master`);
    const [traineeStats] = await lmsQuery<RowDataPacket[]>(`SELECT COUNT(*) AS total_trainees, SUM(status = 'Active') AS active_trainees, SUM(certification_status = 'Certified') AS certified FROM trainee_master`);
    const [contentStats] = await lmsQuery<RowDataPacket[]>(`SELECT COUNT(*) AS classrooms FROM classroom_master WHERE active = 1`);
    const [moduleStats] = await lmsQuery<RowDataPacket[]>(`SELECT COUNT(*) AS modules FROM module_master WHERE active = 1`);
    const [fileStats] = await lmsQuery<RowDataPacket[]>(`SELECT COUNT(*) AS contents FROM content_master WHERE active = 1`);
    const roleAccess = await lmsQuery<RowDataPacket[]>(`SELECT login_id, name, role, portal_access, employee_code, branch, process, active FROM role_access_matrix ORDER BY updated_at DESC LIMIT 200`);
    const batches = await lmsQuery<RowDataPacket[]>(`SELECT * FROM batch_master ORDER BY created_at DESC LIMIT 50`);
    return { batchStats, traineeStats, contentStats, moduleStats, fileStats, roleAccess, batches };
  },

  async getProgress(employeeId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, employee_id, lms_learner_id, course_id, course_name, course_name AS content_title, 'course' AS content_type, NULL AS content_url, completion_pct, score, status, last_accessed, synced_at
         FROM lms_learning_progress_snapshot
        WHERE employee_id = ?
        ORDER BY synced_at DESC`,
      [employeeId]
    );
    return rows as RowDataPacket[];
  },

  async getCertifications(employeeId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM lms_certification_snapshot WHERE employee_id = ? ORDER BY issued_date DESC",
      [employeeId]
    );
    return rows as RowDataPacket[];
  },

  async listMappings() {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT m.*, e.full_name, e.employee_code
       FROM lms_employee_mapping m
       LEFT JOIN employees e ON e.id = m.employee_id
       WHERE m.is_active = 1
       ORDER BY e.full_name`
    );
    return rows as RowDataPacket[];
  },

  async upsertMapping(employeeId: string, lmsLearnerId: string, email?: string) {
    await db.execute(
      `INSERT INTO lms_employee_mapping (id, employee_id, lms_learner_id, email)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE lms_learner_id = VALUES(lms_learner_id), email = VALUES(email)`,
      [randomUUID(), employeeId, lmsLearnerId, email ?? null]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM lms_employee_mapping WHERE employee_id = ? LIMIT 1", [employeeId]
    );
    return (rows as RowDataPacket[])[0];
  },

  async getSyncLog() {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM lms_sync_audit_log ORDER BY created_at DESC LIMIT 100"
    );
    return rows as RowDataPacket[];
  },
};
