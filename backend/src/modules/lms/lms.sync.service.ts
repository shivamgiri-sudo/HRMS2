import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { lmsQuery } from "./lms.service.js";
import { lmsEmployeeMapper } from "./lms-employee-mapper.js";
import { lmsSyncService } from "../lms-integration/lms-sync.service.js";

/**
 * Upper bound on trainees pulled per sync, shared by both queries below.
 *
 * Both were `LIMIT 2000` with no ORDER BY. trainee_master holds 1,226 non-Dropped rows today —
 * under the cap, so nothing is being lost yet, but 61% of the way there and climbing. The
 * sibling sync in modules/lms-integration had exactly this shape at LIMIT 1000 and quietly
 * dropped 226 trainees once the table outgrew it (fixed in 54e19f10); this is the same bug
 * waiting for the same trigger.
 *
 * Two changes, neither of which alters behaviour below the cap: ORDER BY makes the set stable
 * so a trainee cannot sync one run and vanish the next, and the guard below makes truncation
 * announce itself instead of being invisible. A bound nobody is told about is the bug.
 */
const TRAINEE_SYNC_CAP = 5000;

export interface SyncResult {
  mapped: number;
  progress: number;
  certifications: number;
  assessments: number;
  learnerProgress: number;
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
    `SELECT employee_id, permanent_emp_id, lms_id, email, trainee_name
       FROM trainee_master
      WHERE status != 'Dropped'
      ORDER BY lms_id
      LIMIT ${TRAINEE_SYNC_CAP}`
  ).catch((e: any) => { errors.push(`fetchTrainees: ${e?.message}`); return [] as RowDataPacket[]; });

  if (trainees.length >= TRAINEE_SYNC_CAP) {
    errors.push(
      `fetchTrainees: trainee cap reached at ${TRAINEE_SYNC_CAP} rows — trainees beyond it were NOT synced. ` +
      `Raise TRAINEE_SYNC_CAP or paginate before trusting these counts.`
    );
  }

  for (const t of trainees) {
    const learnerId = String(t.lms_id || t.permanent_emp_id || t.employee_id || "").trim();
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
        [randomUUID(), emp.id, learnerId, t.email || emp.email || null]
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
    `SELECT t.employee_id, t.permanent_emp_id, t.lms_id, t.batch_no, t.classroom_id,
            t.course_completion_pct, t.assessment_pass_pct, t.risk_status, t.status,
            b.batch_name, c.classroom_name
       FROM trainee_master t
       LEFT JOIN batch_master b ON b.batch_no = t.batch_no
       LEFT JOIN classroom_master c ON c.classroom_id = t.classroom_id
      WHERE t.status != 'Dropped'
      ORDER BY t.lms_id
      LIMIT ${TRAINEE_SYNC_CAP}`
  ).catch((e: any) => { errors.push(`fetchProgress: ${e?.message}`); return [] as RowDataPacket[]; });

  if (trainees.length >= TRAINEE_SYNC_CAP) {
    errors.push(
      `fetchProgress: trainee cap reached at ${TRAINEE_SYNC_CAP} rows — trainees beyond it were NOT synced. ` +
      `Raise TRAINEE_SYNC_CAP or paginate before trusting these counts.`
    );
  }

  for (const t of trainees) {
    const learnerId = String(t.lms_id || t.permanent_emp_id || t.employee_id || "").trim();
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
        // course_id is varchar(128) NOT NULL DEFAULT '' and is half of the
        // unique key uq_lms_prog_emp_course (employee_id, course_id) that the
        // ON DUPLICATE KEY UPDATE above depends on. `t.batch_no ?? null` sent
        // NULL for any trainee with no batch, and MySQL rejected the row with
        // "Column 'course_id' cannot be null" — 914 of 1,125 trainees in the
        // 2026-08-08 22:09 cycle, so 81% of LMS progress never reached HRMS
        // while the sync reported itself as merely "partial".
        //
        // '' is the column's own default, i.e. the sentinel the schema already
        // uses for "no course", and it keeps the unique key intact: one
        // unbatched progress row per employee rather than a key MySQL cannot
        // match on. Skipping these rows instead would have discarded those 914
        // employees' progress entirely, which is worse than recording it against
        // a blank course.
        [randomUUID(), emp.id, learnerId, String(t.batch_no ?? "").trim(), t.classroom_name ?? t.batch_name ?? null, completionPct, score, status]
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
    `SELECT t.employee_id, t.permanent_emp_id, t.lms_id, t.certification_status,
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

// Syncs MCQ assessment attempts since the last successful sync (max 30 days back on first run).
// Writes to lms_assessment_scores (from migration 250).
export async function syncAssessmentScores(actorId?: string): Promise<{ count: number; errors: string[] }> {
  const errors: string[] = [];
  let count = 0;

  // Window start = the newest attempt we have ACTUALLY stored, not the last time this
  // function happened to run.
  //
  // It previously read the last 'success' row from lms_sync_audit_log. That row is written
  // on every run, including runs that synced zero records — so the watermark advanced to
  // "now" whether or not anything was imported, and any attempt older than the first run
  // could never be picked up again. Observed on production 2026-07-31: the LMS held 227
  // assessment attempts (newest 2026-07-14) while lms_assessment_scores had 0 rows, with
  // every audit row reporting success. The data was permanently stranded and the logs said
  // everything was fine.
  //
  // Anchoring on MAX(attempted_at) of what was stored makes the sync self-healing: if a
  // row never landed, the watermark never moved past it, so the next run retries it. The
  // 30-day floor applies only when the table is genuinely empty, and LOOKBACK_OVERLAP
  // re-reads a small window each time so an attempt submitted mid-run is not skipped.
  const LOOKBACK_OVERLAP_MS = 6 * 60 * 60 * 1000;   // 6 hours
  const FIRST_RUN_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000;

  const [storedRows] = await db.execute<RowDataPacket[]>(
    `SELECT MAX(attempted_at) AS newest FROM lms_assessment_scores`
  ).catch(() => [[] as RowDataPacket[], []]);
  const newestStored = (storedRows as any[])[0]?.newest;

  // On a genuinely empty table, look back far enough to backfill the existing history
  // rather than silently starting from today.
  const windowStart = newestStored
    ? new Date(new Date(newestStored).getTime() - LOOKBACK_OVERLAP_MS)
    : new Date(Date.now() - FIRST_RUN_LOOKBACK_MS);

  const attempts = await lmsQuery<RowDataPacket[]>(
    `SELECT aa.id AS attempt_id, aa.employee_id AS lms_id, aa.assessment_id, aa.attempt_no,
            aa.score, aa.percentage, aa.result, aa.time_taken_seconds, aa.submitted_at,
            am.assessment_name,
            tm.permanent_emp_id, tm.batch_no
       FROM assessment_attempts aa
       LEFT JOIN assessment_master am ON am.assessment_id = aa.assessment_id
       LEFT JOIN trainee_master tm ON tm.employee_id = aa.employee_id OR tm.permanent_emp_id = aa.employee_id
      WHERE aa.submitted_at > ?
      LIMIT 5000`,
    [windowStart]
  ).catch((e: any) => { errors.push(`fetchAttempts: ${e?.message}`); return [] as RowDataPacket[]; });

  for (const att of attempts) {
    const lmsId = String(att.lms_id || "").trim();
    if (!lmsId) continue;
    try {
      const hrmsEmpId = await lmsEmployeeMapper.getOrMapLmsTrainee(lmsId);
      if (!hrmsEmpId) {
        errors.push(`assessment ${lmsId}: could not resolve HRMS employee for LMS learner ${lmsId}`);
        continue;
      }

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

// Learner readiness/attrition-risk snapshot (lms_learner_progress). The computation
// itself lives in modules/lms-integration/lms-sync.service.ts — it was never wired
// into any active sync path, so lms_learner_progress stayed permanently empty while
// 5 other modules (bi.service.ts, the reporting executor, report-catalog, data-
// governance, this module's own /progress-summary) read it assuming freshness.
// Wraps its {synced, failed} result into this file's {count, errors} shape and writes
// to lms_sync_audit_log (the table actually read by the UI/sync-log endpoint) rather
// than relying on the wrapped function's own internal audit writes, which go to a
// separate, unread table.
export async function syncLearnerProgressSnapshot(actorId?: string): Promise<{ count: number; errors: string[] }> {
  const errors: string[] = [];
  let count = 0;

  try {
    const { synced, failed } = await lmsSyncService.syncLearnerProgress();
    count = synced;
    if (failed > 0) {
      errors.push(`learnerProgress: ${failed} trainee(s) could not be mapped or synced`);
    }
  } catch (e: any) {
    errors.push(`learnerProgress: ${e?.message}`);
  }

  await db.execute(
    `INSERT INTO lms_sync_audit_log (id, sync_type, records_synced, errors_count, status, initiated_by)
     VALUES (?, 'learner_progress', ?, ?, ?, ?)`,
    [randomUUID(), count, errors.length, errors.length === 0 ? "success" : count > 0 ? "partial" : "failed", actorId ?? null]
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

  const learnerProgressResult = await syncLearnerProgressSnapshot(actorId);
  allErrors.push(...learnerProgressResult.errors);

  return {
    mapped: mappingResult.count,
    progress: progressResult.count,
    certifications: certResult.count,
    assessments: assessmentResult.count,
    learnerProgress: learnerProgressResult.count,
    errors: allErrors,
  };
}
