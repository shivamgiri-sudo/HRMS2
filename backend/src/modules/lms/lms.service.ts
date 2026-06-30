import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket, Pool } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import { getPoolForKey, testPoolForKey } from "../external-db/external-db.service.js";
import mysql from "mysql2/promise";
import { assertSafeOutboundUrl } from "../../shared/outboundUrlGuard.js";

// Static fallback pool from .env — used only when no Integration Hub credentials are configured.
// Once LMS credentials are saved via Integration Hub (integration_key='lms_sync'),
// getLmsPool() will return the config-driven pool instead.
let _envPool: Pool | null = null;
let _writePool: Pool | null = null;
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

function hasDedicatedWriteCredentials(): boolean {
  return Boolean(env.LMS_WRITE_DB_USER && env.LMS_WRITE_DB_PASSWORD);
}

function getWritePool(): Pool {
  if (!_writePool) {
    _writePool = mysql.createPool({
      host: env.LMS_WRITE_DB_HOST,
      port: env.LMS_WRITE_DB_PORT,
      user: env.LMS_WRITE_DB_USER || env.LMS_DB_USER,
      password: env.LMS_WRITE_DB_PASSWORD || env.LMS_DB_PASSWORD,
      database: env.LMS_WRITE_DB_NAME,
      connectionLimit: env.LMS_WRITE_DB_POOL_MAX,
      waitForConnections: true,
      queueLimit: 0,
      timezone: "local",
      decimalNumbers: true,
    });
  }
  return _writePool;
}

async function getLmsWritePool(): Promise<Pool> {
  try {
    return await getPoolForKey("lms_write") as Pool;
  } catch {
    if (hasDedicatedWriteCredentials()) return getWritePool();
    return await getLmsPool();
  }
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

export async function lmsExecute(sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
  const pool = await getLmsWritePool();
  const [result] = await pool.execute<ResultSetHeader>(sql, params as any);
  return result;
}

function hasLmsAdminRole(hrmsRoles: string[]) {
  return hrmsRoles.some((role) => ["admin", "hr", "ceo", "super_admin", "lms_admin"].includes(String(role).toLowerCase()));
}

function hasLmsCoordinatorRole(hrmsRoles: string[], lmsRole?: string | null) {
  const normalized = hrmsRoles.map((role) => String(role).toLowerCase());
  return normalized.some((role) => ["trainer", "quality", "quality_auditor", "qa", "qtl", "training", "training_manager", "lms_coordinator", "coordinator"].includes(role)) || ["coordinator", "trainer", "quality"].includes(String(lmsRole ?? "").toLowerCase());
}

const localColumnCache = new Map<string, Set<string>>();

async function getLocalColumns(table: string): Promise<Set<string>> {
  const cached = localColumnCache.get(table);
  if (cached) return cached;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [table],
  );
  const columns = new Set(rows.map((row) => String(row.COLUMN_NAME)));
  localColumnCache.set(table, columns);
  return columns;
}

async function getEmployeeIdentity(employeeId: string): Promise<RowDataPacket | null> {
  const employeeColumns = await getLocalColumns("employees");
  const select = [
    "id",
    "employee_code",
    "mobile",
    "personal_email",
    "official_email",
    "office_email",
    "email",
  ].map((column) => employeeColumns.has(column) ? column : `NULL AS ${column}`).join(", ");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ${select}
       FROM employees
      WHERE id = ?
      LIMIT 1`,
    [employeeId],
  );
  return rows[0] ?? null;
}

async function getLmsWriteCapabilities(): Promise<{ canWriteSessions: boolean; canUpdateLms: boolean; grants: string[] }> {
  const pool = await getLmsWritePool();
  let grants: RowDataPacket[] = [];
  try {
    const [rows] = await pool.execute<RowDataPacket[]>("SHOW GRANTS FOR CURRENT_USER()");
    grants = rows;
  } catch {
    grants = [];
  }
  const grantText = grants
    .flatMap((row) => Object.values(row).map((value) => String(value).toUpperCase()));
  const canWriteSessions = grantText.some((grant) => (
    grant.includes("ALL PRIVILEGES")
    || grant.includes("INSERT")
    || grant.includes("UPDATE")
  ));
  return {
    canWriteSessions,
    canUpdateLms: canWriteSessions || Boolean(env.LMS_ADMIN_SESSION_TOKEN),
    grants: grantText,
  };
}

async function writeBackTraineeMapping(employee: RowDataPacket, lmsLearnerId: string): Promise<{ status: string; rows_affected?: number; error?: string }> {
  const caps = await getLmsWriteCapabilities();
  if (!caps.canUpdateLms) return { status: "read_only_credentials" };

  if (env.LMS_ADMIN_SESSION_TOKEN) {
    try {
      const baseUrl = env.LMS_PORTAL_URL.replace(/\/$/, "");
      const sourceUrl = await assertSafeOutboundUrl(
        `${baseUrl}/api/admin/trainees/${encodeURIComponent(lmsLearnerId)}/map-emp-id`,
        "LMS admin mapping API",
      );
      const response = await fetch(sourceUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.LMS_ADMIN_SESSION_TOKEN}`,
        },
        body: JSON.stringify({ permanentEmpId: employee.employee_code }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json.ok === false) {
        return { status: "api_write_failed", error: json.message || `LMS admin API returned HTTP ${response.status}` };
      }
      return { status: "updated_lms_api", rows_affected: 1 };
    } catch (error) {
      return { status: "api_write_failed", error: error instanceof Error ? error.message : String(error) };
    }
  }

  try {
    const result = await lmsExecute(
      `UPDATE trainee_master
          SET permanent_emp_id = ?,
              emp_id_type = 'PERMANENT',
              emp_id_mapped_at = COALESCE(emp_id_mapped_at, NOW(3)),
              last_updated_at = NOW(3)
        WHERE employee_id = ?
           OR lms_id = ?
           OR permanent_emp_id = ?
        LIMIT 1`,
      [
        employee.employee_code,
        lmsLearnerId,
        lmsLearnerId,
        lmsLearnerId,
      ],
    );
    return { status: result.affectedRows > 0 ? "updated_lms" : "lms_trainee_not_found", rows_affected: result.affectedRows };
  } catch (error) {
    return { status: "write_failed", error: error instanceof Error ? error.message : String(error) };
  }
}

export const lmsService = {
  async testConnection(): Promise<{ ok: boolean; source: "integration_hub" | "env"; latency_ms?: number; error?: string; can_write_sessions?: boolean; can_update_lms?: boolean }> {
    const start = Date.now();
    // Try Integration Hub credentials first
    try {
      const result = await testPoolForKey("lms_sync");
      if (result.ok) {
        const caps = await getLmsWriteCapabilities();
        return { ok: true, source: "integration_hub", latency_ms: Date.now() - start, can_write_sessions: caps.canWriteSessions, can_update_lms: caps.canUpdateLms };
      }
    } catch {
      // Fall through to env pool
    }
    // Try env pool
    try {
      const pool = getEnvPool();
      await pool.execute("SELECT 1");
      const caps = await getLmsWriteCapabilities();
      return { ok: true, source: "env", latency_ms: Date.now() - start, can_write_sessions: caps.canWriteSessions, can_update_lms: caps.canUpdateLms };
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
    const attendance = await lmsQuery<RowDataPacket[]>(`SELECT * FROM attendance_inference WHERE ${where} ORDER BY date DESC LIMIT 200`, params).catch(() => [] as RowDataPacket[]);
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
    const mappingColumns = await getLocalColumns("lms_employee_mapping");
    const sql = mappingColumns.has("lms_employee_id")
      ? `SELECT m.id,
                m.hrms_employee_id AS employee_id,
                m.lms_employee_id AS lms_learner_id,
                m.hrms_official_email AS email,
                m.mapped_at,
                1 AS is_active,
                m.mapping_source,
                m.mapping_confidence,
                e.full_name,
                e.employee_code
           FROM lms_employee_mapping m
           LEFT JOIN employees e ON e.id = m.hrms_employee_id
          ORDER BY e.full_name`
      : `SELECT m.*, e.full_name, e.employee_code
           FROM lms_employee_mapping m
           LEFT JOIN employees e ON e.id = m.employee_id
          WHERE m.is_active = 1
          ORDER BY e.full_name`;
    const [rows] = await db.execute<RowDataPacket[]>(sql);
    return rows as RowDataPacket[];
  },

  async upsertMapping(employeeId: string, lmsLearnerId: string, email?: string) {
    const mappingColumns = await getLocalColumns("lms_employee_mapping");
    const employee = await getEmployeeIdentity(employeeId);
    if (!employee) {
      throw Object.assign(new Error("Employee record not found for LMS mapping"), { statusCode: 404 });
    }
    const officialEmail = email ?? employee.official_email ?? employee.office_email ?? employee.email ?? null;

    if (mappingColumns.has("lms_employee_id")) {
      await db.execute(
        `INSERT INTO lms_employee_mapping
           (id, lms_employee_id, hrms_employee_id, hrms_employee_code, hrms_mobile,
            hrms_personal_email, hrms_official_email, mapping_source, mapping_confidence,
            mapped_by, remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', 'low', 'hrms', 'Manual HRMS mapping')
         ON DUPLICATE KEY UPDATE
            hrms_employee_id = VALUES(hrms_employee_id),
            hrms_employee_code = VALUES(hrms_employee_code),
            hrms_mobile = VALUES(hrms_mobile),
            hrms_personal_email = VALUES(hrms_personal_email),
            hrms_official_email = VALUES(hrms_official_email),
            mapping_source = 'manual',
            mapping_confidence = 'low',
            mapped_by = 'hrms',
            remarks = 'Manual HRMS mapping',
            mapped_at = NOW()`,
        [
          randomUUID(),
          lmsLearnerId,
          employeeId,
          employee.employee_code ?? null,
          employee.mobile ?? null,
          employee.personal_email ?? employee.email ?? null,
          officialEmail,
        ],
      );
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT m.id,
                m.hrms_employee_id AS employee_id,
                m.lms_employee_id AS lms_learner_id,
                m.hrms_official_email AS email,
                m.mapped_at,
                1 AS is_active,
                m.mapping_source,
                m.mapping_confidence,
                e.full_name,
                e.employee_code
           FROM lms_employee_mapping m
           LEFT JOIN employees e ON e.id = m.hrms_employee_id
          WHERE m.hrms_employee_id = ?
          LIMIT 1`,
        [employeeId],
      );
      const writeBack = await writeBackTraineeMapping(employee, lmsLearnerId);
      return {
        ...(rows[0] ?? {}),
        lms_write_status: writeBack.status,
        lms_write_rows_affected: writeBack.rows_affected ?? 0,
        lms_write_error: writeBack.error,
      };
    }

    await db.execute(
      `INSERT INTO lms_employee_mapping (id, employee_id, lms_learner_id, email)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
          lms_learner_id = VALUES(lms_learner_id),
          email = VALUES(email),
          mapped_at = NOW(),
          is_active = 1`,
      [randomUUID(), employeeId, lmsLearnerId, officialEmail]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM lms_employee_mapping WHERE employee_id = ? LIMIT 1", [employeeId]
    );
    const writeBack = await writeBackTraineeMapping(employee, lmsLearnerId);
    return {
      ...((rows as RowDataPacket[])[0] ?? {}),
      lms_write_status: writeBack.status,
      lms_write_rows_affected: writeBack.rows_affected ?? 0,
      lms_write_error: writeBack.error,
    };
  },

  async getSyncLog() {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM lms_sync_audit_log ORDER BY created_at DESC LIMIT 100"
    );
    return rows as RowDataPacket[];
  },

  async getProgressSummary() {
    // Aggregate progress stats per employee
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         e.id AS employee_id,
         e.employee_code,
         CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
         COUNT(DISTINCT lp.course_id) AS modules_assigned,
         SUM(CASE WHEN lp.status = 'completed' THEN 1 ELSE 0 END) AS modules_completed,
         ROUND(
           (SUM(CASE WHEN lp.status = 'completed' THEN 1 ELSE 0 END) * 100.0) /
           NULLIF(COUNT(DISTINCT lp.course_id), 0),
           0
         ) AS completion_percent,
         COUNT(DISTINCT lc.id) AS certifications_earned,
         MAX(lp.synced_at) AS last_activity
       FROM employees e
       LEFT JOIN lms_employee_mapping lem ON lem.employee_id = e.id AND lem.is_active = 1
       LEFT JOIN lms_learning_progress_snapshot lp ON lp.employee_id = e.id
       LEFT JOIN lms_certification_snapshot lc ON lc.employee_id = e.id
       WHERE e.active_status = 1
       GROUP BY e.id, e.employee_code, e.first_name, e.last_name
       HAVING modules_assigned > 0
       ORDER BY employee_name`
    );
    return rows as RowDataPacket[];
  },
};
