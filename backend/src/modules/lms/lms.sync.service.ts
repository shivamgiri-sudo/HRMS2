import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { lmsQuery } from "./lms.service.js";
import { lmsEmployeeMapper } from "./lms-employee-mapper.js";

export interface SyncResult {
  mapped: number;
  progress: number;
  certifications: number;
  assessments: number;
  errors: string[];
}

function deriveProgressStatus(pct: number): "not_started" | "in_progress" | "completed" {
  if (pct >= 100) return "completed";
  if (pct > 0) return "in_progress";
  return "not_started";
}

// Reads trainee_master from lms_mcn, maps to HRMS employees by employee_code.
// Upserts lms_employee_mapping for each matched pair.
export async function syncMappings(actorId?: string): Promise<{ count: number; errors: string[] }> {
  const errors: string[] = [];
  let count = 0;

  const trainees = await lmsQuery<RowDataPacket[]>(
    `SELECT employee_id, permanent_emp_id, email, trainee_name
       FROM trainee_master
      WHERE status != 'Dropped'
      LIMIT 2000`
  ).catch((e: any) => { errors.push(`fetchTrainees: ${e?.message}`); return [] as RowDataPacket[]; });

  for (const t of trainees) {
    const empCode = String(t.permanent_emp_id || t.employee_id || "").trim();
    if (!empCode) continue;
    try {
      const [emps] = await db.execute<RowDataPacket[]>(
        `SELECT id, email FROM employees WHERE employee_code = ? AND active_status = 1 LIMIT 1`,
        [empCode]
      );
      const emp = (emps as any[])[0];
      if (!emp) continue;
      await db.execute(
        `INSERT INTO lms_employee_mapping (id, employee_id, lms_learner_id, email)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE lms_learner_id = VALUES(lms_learner_id), email = COALESCE(VALUES(email), email)`,
        [randomUUID(), emp.id, empCode, t.email || emp.email || null]
      );
      count++;
    } catch (e: any) {
      errors.push(`mapping ${empCode}: ${e?.message}`);
    }
  }

  await db.execute(
    `INSERT INTO lms_sync_audit_log (id, sync_type, records_synced, errors_count, status, initiated_by)
     VALUES (?, 'mappings', ?, ?, ?, ?)`,
    [randomUUID(), count, errors.length, errors.length === 0 ? "success" : count > 0 ? "partial" : "failed", actorId ?? null]
  );

  return { count, errors };
}

// Reads trainee_master KPIs from lms_mcn, upserts lms_learning_progress_snapshot.
export async function syncProgress(actorId?: string): Promise<{ count: number; errors: string[] }> {
  const errors: string[] = [];
  let count = 0;

  const trainees = await lmsQuery<RowDataPacket[]>(
    `SELECT t.employee_id, t.permanent_emp_id, t.batch_no, t.classroom_id,
            t.course_completion_pct, t.assessment_pass_pct, t.risk_status, t.status,
            b.batch_name, c.classroom_name
       FROM trainee_master t
       LEFT JOIN batch_master b ON b.batch_no = t.batch_no
       LEFT JOIN classroom_master c ON c.classroom_id = t.classroom_id
      WHERE t.status != 'Dropped'
      LIMIT 2000`
  ).catch((e: any) => { errors.push(`fetchProgress: ${e?.message}`); return [] as RowDataPacket[]; });

  for (const t of trainees) {
    const empCode = String(t.permanent_emp_id || t.employee_id || "").trim();
    if (!empCode) continue;
    try {
      const [emps] = await db.execute<RowDataPacket[]>(
        `SELECT e.id FROM employees e WHERE e.employee_code = ? AND e.active_status = 1 LIMIT 1`,
        [empCode]
      );
      const emp = (emps as any[])[0];
      if (!emp) continue;

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
        [randomUUID(), emp.id, empCode, t.batch_no ?? null, t.classroom_name ?? t.batch_name ?? null, completionPct, score, status]
      );
      count++;
    } catch (e: any) {
      errors.push(`progress ${empCode}: ${e?.message}`);
    }
  }

  await db.execute(
    `INSERT INTO lms_sync_audit_log (id, sync_type, records_synced, errors_count, status, initiated_by)
     VALUES (?, 'progress', ?, ?, ?, ?)`,
    [randomUUID(), count, errors.length, errors.length === 0 ? "success" : count > 0 ? "partial" : "failed", actorId ?? null]
  );

  return { count, errors };
}

// Reads certified trainees from lms_mcn, upserts lms_certification_snapshot.
export async function syncCertifications(actorId?: string): Promise<{ count: number; errors: string[] }> {
  const errors: string[] = [];
  let count = 0;

  const certified = await lmsQuery<RowDataPacket[]>(
    `SELECT t.employee_id, t.permanent_emp_id, t.certification_status,
            t.batch_no, c.classroom_name,
            t.last_updated_at
       FROM trainee_master t
       LEFT JOIN classroom_master c ON c.classroom_id = t.classroom_id
      WHERE t.certification_status = 'Certified'
      LIMIT 2000`
  ).catch((e: any) => { errors.push(`fetchCerts: ${e?.message}`); return [] as RowDataPacket[]; });

  for (const t of certified) {
    const empCode = String(t.permanent_emp_id || t.employee_id || "").trim();
    if (!empCode) continue;
    try {
      const [emps] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM employees WHERE employee_code = ? AND active_status = 1 LIMIT 1`,
        [empCode]
      );
      const emp = (emps as any[])[0];
      if (!emp) continue;

      const certName = t.classroom_name ? `${t.classroom_name} Certification` : `LMS Batch ${t.batch_no ?? ""} Certification`;

      await db.execute(
        `INSERT INTO lms_certification_snapshot
           (id, employee_id, certification_name, issued_date, status, synced_at)
         VALUES (?, ?, ?, ?, 'active', NOW())
         ON DUPLICATE KEY UPDATE
           certification_name = VALUES(certification_name),
           status = 'active',
           synced_at = NOW()`,
        [randomUUID(), emp.id, certName, t.last_updated_at ? String(t.last_updated_at).slice(0, 10) : null]
      );
      count++;
    } catch (e: any) {
      errors.push(`cert ${empCode}: ${e?.message}`);
    }
  }

  await db.execute(
    `INSERT INTO lms_sync_audit_log (id, sync_type, records_synced, errors_count, status, initiated_by)
     VALUES (?, 'certifications', ?, ?, ?, ?)`,
    [randomUUID(), count, errors.length, errors.length === 0 ? "success" : count > 0 ? "partial" : "failed", actorId ?? null]
  );

  return { count, errors };
}

// Syncs MCQ assessment attempts from last 24h.
// Writes to lms_assessment_scores (from migration 250).
export async function syncAssessmentScores(actorId?: string): Promise<{ count: number; errors: string[] }> {
  const errors: string[] = [];
  let count = 0;

  const attempts = await lmsQuery<RowDataPacket[]>(
    `SELECT aa.id AS attempt_id, aa.employee_id AS lms_id, aa.assessment_id, aa.attempt_no,
            aa.score, aa.percentage, aa.result, aa.time_taken_seconds, aa.submitted_at,
            am.assessment_name,
            tm.permanent_emp_id, tm.batch_no
       FROM assessment_attempts aa
       LEFT JOIN assessment_master am ON am.assessment_id = aa.assessment_id
       LEFT JOIN trainee_master tm ON tm.employee_id = aa.employee_id OR tm.permanent_emp_id = aa.employee_id
      WHERE aa.submitted_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      LIMIT 5000`
  ).catch((e: any) => { errors.push(`fetchAttempts: ${e?.message}`); return [] as RowDataPacket[]; });

  for (const att of attempts) {
    const lmsId = String(att.lms_id || "").trim();
    if (!lmsId) continue;
    try {
      const hrmsEmpId = await lmsEmployeeMapper.getOrMapLmsTrainee(lmsId);
      if (!hrmsEmpId) continue;

      const [empRows] = await db.execute<RowDataPacket[]>(
        `SELECT employee_code FROM employees WHERE id = ? LIMIT 1`, [hrmsEmpId]
      );
      const empCode = (empRows as any[])[0]?.employee_code ?? null;

      await db.execute(
        `INSERT INTO lms_assessment_scores
           (id, employee_id, employee_code, batch_no, assessment_name, attempt_no,
            score, percentage, result, time_taken_seconds, attempted_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           percentage = VALUES(percentage), result = VALUES(result), synced_at = NOW()`,
        [randomUUID(), hrmsEmpId, empCode, att.batch_no ?? null,
         att.assessment_name ?? "Unknown", att.attempt_no ?? 1,
         att.score ?? 0, att.percentage ?? 0, att.result ?? "fail",
         att.time_taken_seconds ?? 0, att.submitted_at]
      );
      count++;
    } catch (e: any) {
      errors.push(`assessment ${lmsId}: ${e?.message}`);
    }
  }

  await db.execute(
    `INSERT INTO lms_sync_audit_log (id, sync_type, records_synced, errors_count, status, initiated_by)
     VALUES (?, 'assessment_scores', ?, ?, ?, ?)`,
    [randomUUID(), count, errors.length,
     errors.length === 0 ? "success" : count > 0 ? "partial" : "failed", actorId ?? null]
  );

  return { count, errors };
}

// Runs all sync phases in order.
export async function runFullSync(actorId?: string): Promise<SyncResult> {
  const allErrors: string[] = [];

  const mappingResult = await syncMappings(actorId);
  allErrors.push(...mappingResult.errors);

  const progressResult = await syncProgress(actorId);
  allErrors.push(...progressResult.errors);

  const certResult = await syncCertifications(actorId);
  allErrors.push(...certResult.errors);

  const assessmentResult = await syncAssessmentScores(actorId);
  allErrors.push(...assessmentResult.errors);

  return {
    mapped: mappingResult.count,
    progress: progressResult.count,
    certifications: certResult.count,
    assessments: assessmentResult.count,
    errors: allErrors,
  };
}
