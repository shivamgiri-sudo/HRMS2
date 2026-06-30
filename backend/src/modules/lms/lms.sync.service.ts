import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { lmsQuery } from "./lms.service.js";

export interface SyncResult {
  mapped: number;
  progress: number;
  certifications: number;
  errors: string[];
}

function deriveProgressStatus(pct: number): "not_started" | "in_progress" | "completed" {
  if (pct >= 100) return "completed";
  if (pct > 0) return "in_progress";
  return "not_started";
}

type MappingSource = "mobile" | "personal_email" | "official_email" | "employee_code" | "manual" | "none";
type MappingConfidence = "high" | "medium" | "low";

interface ResolvedLmsEmployee {
  employee: RowDataPacket;
  lmsEmployeeId: string;
  lmsPermanentId: string;
  source: Exclude<MappingSource, "manual" | "none">;
  confidence: MappingConfidence;
}

const columnCache = new Map<string, Set<string>>();

async function getColumns(table: string): Promise<Set<string>> {
  const cached = columnCache.get(table);
  if (cached) return cached;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [table],
  );
  const columns = new Set(rows.map((row) => String(row.COLUMN_NAME)));
  columnCache.set(table, columns);
  return columns;
}

async function tableExists(table: string): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
      LIMIT 1`,
    [table],
  );
  return rows.length > 0;
}

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizedPhone(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "").trim();
}

function fieldList(columns: Set<string>, names: string[]): string[] {
  return names.filter((name) => columns.has(name));
}

function selectEmployeeColumns(columns: Set<string>): string {
  const wanted = [
    "id",
    "employee_code",
    "mobile",
    "personal_mobile",
    "alternate_mobile",
    "personal_email",
    "official_email",
    "office_email",
    "email",
  ];
  return wanted
    .map((name) => columns.has(name) ? `e.${name}` : `NULL AS ${name}`)
    .join(", ");
}

async function findEmployeeByFields(
  columns: Set<string>,
  fields: string[],
  values: string[],
): Promise<RowDataPacket | null> {
  const availableFields = fieldList(columns, fields);
  const candidates = [...new Set(values.map(normalized).filter(Boolean))];
  if (availableFields.length === 0 || candidates.length === 0) return null;

  const placeholders = candidates.map(() => "?").join(",");
  const predicates = availableFields.map((field) => `LOWER(TRIM(e.${field})) IN (${placeholders})`);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ${selectEmployeeColumns(columns)}
       FROM employees e
      WHERE e.active_status = 1
        AND (${predicates.join(" OR ")})
      LIMIT 1`,
    availableFields.flatMap(() => candidates),
  );
  return rows[0] ?? null;
}

async function findEmployeeByPhone(
  columns: Set<string>,
  fields: string[],
  values: string[],
): Promise<RowDataPacket | null> {
  const availableFields = fieldList(columns, fields);
  const candidates = [...new Set(values.map(normalizedPhone).filter(Boolean))];
  if (availableFields.length === 0 || candidates.length === 0) return null;

  const placeholders = candidates.map(() => "?").join(",");
  const predicates = availableFields.map((field) => {
    const cleaned = `REPLACE(REPLACE(REPLACE(REPLACE(TRIM(e.${field}), ' ', ''), '-', ''), '+', ''), '.', '')`;
    return `${cleaned} IN (${placeholders})`;
  });
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ${selectEmployeeColumns(columns)}
       FROM employees e
      WHERE e.active_status = 1
        AND (${predicates.join(" OR ")})
      LIMIT 1`,
    availableFields.flatMap(() => candidates),
  );
  return rows[0] ?? null;
}

async function resolveHrmsEmployeeForTrainee(trainee: RowDataPacket): Promise<ResolvedLmsEmployee | null> {
  const columns = await getColumns("employees");
  const lmsEmployeeId = String(trainee.employee_id ?? trainee.lms_id ?? "").trim();
  const lmsPermanentId = String(trainee.permanent_emp_id ?? "").trim();
  const email = String(trainee.email ?? "").trim();
  const emailLocalPart = email.includes("@") ? email.split("@")[0] : "";
  const employeeCodeCandidates = [
    trainee.permanent_emp_id,
    trainee.employee_id,
    trainee.lms_id,
  ].map(String).map((value) => value.trim()).filter(Boolean);

  const mobileMatch = await findEmployeeByPhone(
    columns,
    ["mobile", "personal_mobile", "alternate_mobile"],
    [String(trainee.mobile ?? "")],
  );
  if (mobileMatch) return { employee: mobileMatch, lmsEmployeeId, lmsPermanentId, source: "mobile", confidence: "high" };

  const personalEmailMatch = await findEmployeeByFields(
    columns,
    ["personal_email", "email"],
    [email],
  );
  if (personalEmailMatch) return { employee: personalEmailMatch, lmsEmployeeId, lmsPermanentId, source: "personal_email", confidence: "medium" };

  const officialEmailMatch = await findEmployeeByFields(
    columns,
    ["official_email", "office_email", "email"],
    [email, emailLocalPart],
  );
  if (officialEmailMatch) return { employee: officialEmailMatch, lmsEmployeeId, lmsPermanentId, source: "official_email", confidence: "medium" };

  const employeeCodeMatch = await findEmployeeByFields(
    columns,
    ["employee_code"],
    employeeCodeCandidates,
  );
  if (employeeCodeMatch) return { employee: employeeCodeMatch, lmsEmployeeId, lmsPermanentId, source: "employee_code", confidence: "low" };

  return null;
}

async function logMappingAttempt(
  trainee: RowDataPacket,
  resolved: ResolvedLmsEmployee | null,
  errorReason?: string,
): Promise<void> {
  if (!await tableExists("lms_mapping_audit")) return;
  await db.execute(
    `INSERT INTO lms_mapping_audit
       (id, lms_employee_id, tried_mobile, tried_personal_email, tried_official_email, tried_employee_code,
        mobile_match_found, email_personal_match_found, email_official_match_found, employee_code_match_found,
        final_match_source, final_hrms_employee_id, success, error_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      String(trainee.employee_id ?? trainee.lms_id ?? ""),
      trainee.mobile ?? null,
      trainee.email ?? null,
      trainee.email ?? null,
      trainee.permanent_emp_id ?? trainee.employee_id ?? null,
      resolved?.source === "mobile" ? 1 : 0,
      resolved?.source === "personal_email" ? 1 : 0,
      resolved?.source === "official_email" ? 1 : 0,
      resolved?.source === "employee_code" ? 1 : 0,
      resolved?.source ?? "none",
      resolved?.employee?.id ?? null,
      resolved ? 1 : 0,
      errorReason ?? null,
    ],
  ).catch(() => undefined);
}

async function saveMapping(resolved: ResolvedLmsEmployee, actorId?: string): Promise<void> {
  const columns = await getColumns("lms_employee_mapping");
  const employee = resolved.employee;
  const lmsEmployeeId = resolved.lmsEmployeeId || resolved.lmsPermanentId || String(employee.employee_code ?? "");
  const officialEmail = employee.official_email ?? employee.office_email ?? employee.email ?? null;
  const personalEmail = employee.personal_email ?? employee.email ?? null;

  if (columns.has("lms_employee_id")) {
    await db.execute(
      `INSERT INTO lms_employee_mapping
         (id, lms_employee_id, hrms_employee_id, hrms_employee_code, hrms_mobile,
          hrms_personal_email, hrms_official_email, mapping_source, mapping_confidence,
          mapped_by, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
          hrms_employee_id = VALUES(hrms_employee_id),
          hrms_employee_code = VALUES(hrms_employee_code),
          hrms_mobile = VALUES(hrms_mobile),
          hrms_personal_email = VALUES(hrms_personal_email),
          hrms_official_email = VALUES(hrms_official_email),
          mapping_source = VALUES(mapping_source),
          mapping_confidence = VALUES(mapping_confidence),
          mapped_by = VALUES(mapped_by),
          remarks = VALUES(remarks),
          mapped_at = NOW()`,
      [
        randomUUID(),
        lmsEmployeeId,
        employee.id,
        employee.employee_code ?? null,
        employee.mobile ?? null,
        personalEmail,
        officialEmail,
        resolved.source,
        resolved.confidence,
        actorId ?? "system",
        `Matched by ${resolved.source}`,
      ],
    );
    return;
  }

  await db.execute(
    `INSERT INTO lms_employee_mapping (id, employee_id, lms_learner_id, email)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
        lms_learner_id = VALUES(lms_learner_id),
        email = COALESCE(VALUES(email), email),
        mapped_at = NOW(),
        is_active = 1`,
    [
      randomUUID(),
      employee.id,
      lmsEmployeeId,
      officialEmail ?? personalEmail,
    ],
  );
}

async function resolveAndSaveMapping(trainee: RowDataPacket, actorId?: string): Promise<ResolvedLmsEmployee | null> {
  const resolved = await resolveHrmsEmployeeForTrainee(trainee);
  if (!resolved) {
    await logMappingAttempt(trainee, null, "No matching active HRMS employee found");
    return null;
  }
  await saveMapping(resolved, actorId);
  await logMappingAttempt(trainee, resolved);
  return resolved;
}

// Reads trainee_master from mcn_lms and maps to HRMS employees by priority:
// mobile, personal email, official email, then employee code.
export async function syncMappings(actorId?: string): Promise<{ count: number; errors: string[] }> {
  const errors: string[] = [];
  let count = 0;

  const trainees = await lmsQuery<RowDataPacket[]>(
    `SELECT employee_id, lms_id, permanent_emp_id, email, mobile, trainee_name
       FROM trainee_master
      WHERE status != 'Dropped'
      LIMIT 2000`
  ).catch((e: any) => { errors.push(`fetchTrainees: ${e?.message}`); return [] as RowDataPacket[]; });

  for (const trainee of trainees) {
    const lmsEmployeeId = String(trainee.employee_id || trainee.lms_id || "").trim();
    if (!lmsEmployeeId) continue;
    try {
      const resolved = await resolveAndSaveMapping(trainee, actorId);
      if (resolved) count++;
    } catch (e: any) {
      errors.push(`mapping ${lmsEmployeeId}: ${e?.message}`);
    }
  }

  await db.execute(
    `INSERT INTO lms_sync_audit_log (id, sync_type, records_synced, errors_count, status, initiated_by)
     VALUES (?, 'mappings', ?, ?, ?, ?)`,
    [randomUUID(), count, errors.length, errors.length === 0 ? "success" : count > 0 ? "partial" : "failed", actorId ?? null]
  );

  return { count, errors };
}

// Reads trainee_master KPIs from mcn_lms, upserts lms_learning_progress_snapshot.
export async function syncProgress(actorId?: string): Promise<{ count: number; errors: string[] }> {
  const errors: string[] = [];
  let count = 0;

  const trainees = await lmsQuery<RowDataPacket[]>(
    `SELECT t.employee_id, t.lms_id, t.permanent_emp_id, t.email, t.mobile,
            t.batch_no, t.classroom_id,
            t.course_completion_pct, t.assessment_pass_pct, t.risk_status, t.status,
            b.batch_name, c.classroom_name
       FROM trainee_master t
       LEFT JOIN batch_master b ON b.batch_no = t.batch_no
       LEFT JOIN classroom_master c ON c.classroom_id = t.classroom_id
      WHERE t.status != 'Dropped'
      LIMIT 2000`
  ).catch((e: any) => { errors.push(`fetchProgress: ${e?.message}`); return [] as RowDataPacket[]; });

  for (const t of trainees) {
    const lmsEmployeeId = String(t.employee_id || t.lms_id || "").trim();
    if (!lmsEmployeeId) continue;
    try {
      const resolved = await resolveAndSaveMapping(t, actorId);
      if (!resolved) continue;

      const completionPct = Number(t.course_completion_pct ?? 0);
      const score = t.assessment_pass_pct !== undefined ? Number(t.assessment_pass_pct) : null;
      const status = deriveProgressStatus(completionPct);

      await db.execute(
        `INSERT INTO lms_learning_progress_snapshot
           (id, employee_id, lms_learner_id, course_id, course_name, completion_pct, score, status, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           completion_pct = VALUES(completion_pct),
           score = VALUES(score),
           status = VALUES(status),
           synced_at = NOW()`,
        [randomUUID(), resolved.employee.id, lmsEmployeeId, t.batch_no ?? null, t.classroom_name ?? t.batch_name ?? null, completionPct, score, status]
      );
      count++;
    } catch (e: any) {
      errors.push(`progress ${lmsEmployeeId}: ${e?.message}`);
    }
  }

  await db.execute(
    `INSERT INTO lms_sync_audit_log (id, sync_type, records_synced, errors_count, status, initiated_by)
     VALUES (?, 'progress', ?, ?, ?, ?)`,
    [randomUUID(), count, errors.length, errors.length === 0 ? "success" : count > 0 ? "partial" : "failed", actorId ?? null]
  );

  return { count, errors };
}

// Reads certified trainees from mcn_lms, upserts lms_certification_snapshot.
export async function syncCertifications(actorId?: string): Promise<{ count: number; errors: string[] }> {
  const errors: string[] = [];
  let count = 0;

  const certified = await lmsQuery<RowDataPacket[]>(
    `SELECT t.employee_id, t.lms_id, t.permanent_emp_id, t.email, t.mobile,
            t.certification_status,
            t.batch_no, c.classroom_name,
            t.last_updated_at
       FROM trainee_master t
       LEFT JOIN classroom_master c ON c.classroom_id = t.classroom_id
      WHERE t.certification_status = 'Certified'
      LIMIT 2000`
  ).catch((e: any) => { errors.push(`fetchCerts: ${e?.message}`); return [] as RowDataPacket[]; });

  for (const t of certified) {
    const lmsEmployeeId = String(t.employee_id || t.lms_id || "").trim();
    if (!lmsEmployeeId) continue;
    try {
      const resolved = await resolveAndSaveMapping(t, actorId);
      if (!resolved) continue;

      const certName = t.classroom_name ? `${t.classroom_name} Certification` : `LMS Batch ${t.batch_no ?? ""} Certification`;

      await db.execute(
        `INSERT INTO lms_certification_snapshot
           (id, employee_id, certification_name, issued_date, status, synced_at)
         VALUES (?, ?, ?, ?, 'active', NOW())
         ON DUPLICATE KEY UPDATE
           certification_name = VALUES(certification_name),
           status = 'active',
           synced_at = NOW()`,
        [randomUUID(), resolved.employee.id, certName, t.last_updated_at ? String(t.last_updated_at).slice(0, 10) : null]
      );
      count++;
    } catch (e: any) {
      errors.push(`cert ${lmsEmployeeId}: ${e?.message}`);
    }
  }

  await db.execute(
    `INSERT INTO lms_sync_audit_log (id, sync_type, records_synced, errors_count, status, initiated_by)
     VALUES (?, 'certifications', ?, ?, ?, ?)`,
    [randomUUID(), count, errors.length, errors.length === 0 ? "success" : count > 0 ? "partial" : "failed", actorId ?? null]
  );

  return { count, errors };
}

// Runs all three sync phases in order.
export async function runFullSync(actorId?: string): Promise<SyncResult> {
  const allErrors: string[] = [];

  const mappingResult = await syncMappings(actorId);
  allErrors.push(...mappingResult.errors);

  const progressResult = await syncProgress(actorId);
  allErrors.push(...progressResult.errors);

  const certResult = await syncCertifications(actorId);
  allErrors.push(...certResult.errors);

  return {
    mapped: mappingResult.count,
    progress: progressResult.count,
    certifications: certResult.count,
    errors: allErrors,
  };
}
