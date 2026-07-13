import { randomUUID } from "crypto";
import type { RowDataPacket, PoolConnection } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { getLmsPool } from "./lms.service.js";
import { lmsService } from "./lms.service.js";

export interface LmsProvisionResult {
  employeeId: string | null;
  employeeCode: string;
  lmsLearnerId: string | null;
  externalSynced: boolean;
  mappingSynced: boolean;
  message?: string;
}

interface EmployeeProvisionSeed {
  employeeCode: string;
  createdBy?: string | null;
}

interface EmployeeProfileRow extends RowDataPacket {
  id: string;
  employee_code: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  official_email: string | null;
  mobile: string | null;
  branch_name: string | null;
  process_name: string | null;
  department_name: string | null;
}

function normalizeEmployeeCode(value: string): string {
  return String(value ?? "").trim().toUpperCase();
}

function buildBaseLmsLearnerId(employeeCode: string): string {
  const digits = employeeCode.replace(/\D/g, "").padStart(6, "0").slice(-6);
  return `LMS${digits}`;
}

function buildFallbackLmsLearnerId(): string {
  return `LMS${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 100).toString().padStart(2, "0")}`.slice(0, 20);
}

async function isLearnerIdAvailable(conn: PoolConnection, learnerId: string): Promise<boolean> {
  const [hrmsRows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM lms_employee_mapping WHERE lms_learner_id = ? LIMIT 1`,
    [learnerId],
  );
  if (hrmsRows.length > 0) return false;

  const [lmsRows] = await conn.execute<RowDataPacket[]>(
    `SELECT 1 FROM trainee_master WHERE lms_id = ? LIMIT 1`,
    [learnerId],
  );
  return lmsRows.length === 0;
}

async function resolveLearnerId(conn: PoolConnection, employeeCode: string, preferred?: string | null): Promise<string> {
  const candidates = new Set<string>();
  if (preferred?.trim()) candidates.add(preferred.trim());
  candidates.add(buildBaseLmsLearnerId(employeeCode));

  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) candidates.add(buildFallbackLmsLearnerId());
    for (const candidate of candidates) {
      if (await isLearnerIdAvailable(conn, candidate)) {
        return candidate;
      }
    }
  }

  return buildFallbackLmsLearnerId();
}

async function upsertExternalTrainee(
  conn: PoolConnection,
  profile: EmployeeProfileRow,
  learnerId: string,
  createdBy?: string | null,
): Promise<void> {
  const traineeName = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() || profile.employee_code;
  const email = profile.official_email ?? profile.email ?? null;
  await conn.execute(
    `INSERT INTO trainee_master
       (id, employee_id, lms_id, trainee_name, email, mobile, branch, process, lob,
        status, source, emp_id_type, permanent_emp_id, emp_id_mapped_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', 'HRMS', 'PERMANENT', ?, NOW(), ?)
     ON DUPLICATE KEY UPDATE
       lms_id = VALUES(lms_id),
       trainee_name = COALESCE(VALUES(trainee_name), trainee_name),
       email = COALESCE(VALUES(email), email),
       mobile = COALESCE(VALUES(mobile), mobile),
       branch = COALESCE(VALUES(branch), branch),
       process = COALESCE(VALUES(process), process),
       lob = COALESCE(VALUES(lob), lob),
       status = VALUES(status),
       source = VALUES(source),
       emp_id_type = VALUES(emp_id_type),
       permanent_emp_id = COALESCE(VALUES(permanent_emp_id), permanent_emp_id),
       emp_id_mapped_at = COALESCE(emp_id_mapped_at, NOW()),
       last_updated_at = NOW()`,
    [
      randomUUID(),
      profile.employee_code,
      learnerId,
      traineeName,
      email,
      profile.mobile ?? null,
      profile.branch_name ?? null,
      profile.process_name ?? null,
      profile.department_name ?? null,
      profile.employee_code,
      createdBy ?? null,
    ],
  );
}

export async function provisionLmsIdentityForEmployee(
  input: EmployeeProvisionSeed,
): Promise<LmsProvisionResult> {
  const employeeCode = normalizeEmployeeCode(input.employeeCode);
  if (!employeeCode) {
    return {
      employeeId: null,
      employeeCode: "",
      lmsLearnerId: null,
      externalSynced: false,
      mappingSynced: false,
      message: "Missing employee code",
    };
  }

  const [profileRows] = await db.execute<EmployeeProfileRow[]>(
    `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.email, e.official_email, e.mobile,
            b.branch_name, p.process_name, d.dept_name AS department_name
       FROM employees e
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN department_master d ON d.id = e.department_id
      WHERE UPPER(e.employee_code) = UPPER(?)
      LIMIT 1`,
    [employeeCode],
  );
  const profile = profileRows[0];
  if (!profile?.id) {
    return {
      employeeId: null,
      employeeCode,
      lmsLearnerId: null,
      externalSynced: false,
      mappingSynced: false,
      message: "Employee record not found",
    };
  }

  const existingMapping = await db.execute<RowDataPacket[]>(
    `SELECT lms_learner_id FROM lms_employee_mapping
      WHERE employee_id = ? AND is_active = 1
      LIMIT 1`,
    [profile.id],
  ).then(([rows]) => rows as RowDataPacket[]).catch(() => [] as RowDataPacket[]);

  let learnerId = String(existingMapping[0]?.lms_learner_id ?? "").trim() || null;
  let externalSynced = false;
  let externalError: string | null = null;

  try {
    const pool = await getLmsPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [existingRows] = await conn.execute<RowDataPacket[]>(
        `SELECT lms_id
           FROM trainee_master
          WHERE employee_id = ? OR permanent_emp_id = ? OR lms_id = ?
          LIMIT 1 FOR UPDATE`,
        [employeeCode, employeeCode, learnerId ?? ""],
      );
      const existing = existingRows[0];
      if (!learnerId && existing?.lms_id) {
        learnerId = String(existing.lms_id).trim();
      }
      if (!learnerId) {
        learnerId = await resolveLearnerId(conn, employeeCode);
      }

      await upsertExternalTrainee(conn, profile, learnerId, input.createdBy ?? null);
      await conn.commit();
      externalSynced = true;
    } catch (err) {
      await conn.rollback().catch(() => {});
      externalError = err instanceof Error ? err.message : String(err);
    } finally {
      conn.release();
    }
  } catch (err) {
    externalError = err instanceof Error ? err.message : String(err);
  }

  try {
    const resolvedLearnerId = learnerId ?? buildBaseLmsLearnerId(employeeCode);
    learnerId = resolvedLearnerId;
    await lmsService.upsertMapping(profile.id, resolvedLearnerId, profile.official_email ?? profile.email ?? undefined);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      employeeId: profile.id,
      employeeCode,
      lmsLearnerId: learnerId,
      externalSynced,
      mappingSynced: false,
      message: externalError ? `${message}; external=${externalError}` : message,
    };
  }

  return {
    employeeId: profile.id,
    employeeCode,
    lmsLearnerId: learnerId,
    externalSynced,
    mappingSynced: true,
    message: externalError ?? undefined,
  };
}
