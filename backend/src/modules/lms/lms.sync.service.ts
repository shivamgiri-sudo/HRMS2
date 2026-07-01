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
