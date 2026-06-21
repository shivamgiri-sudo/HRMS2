import { db } from '../../db/mysql.js';
import { getLmsConnection } from './lms-external-db.js';
import { randomUUID } from 'crypto';
import type { RowDataPacket } from 'mysql2';

export const lmsSyncService = {
  async syncLearnerProgress(): Promise<{ synced: number; failed: number }> {
    const auditId = randomUUID();
    await logSyncStart('learner_progress', auditId);

    let synced = 0, failed = 0;
    try {
      const lms = await getLmsConnection();

      // Get unique employee IDs from assessment attempts
      const [employees] = await lms.execute<RowDataPacket[]>(`
        SELECT DISTINCT aa.employee_id
        FROM assessment_attempts aa
        WHERE aa.submitted_at IS NOT NULL
        LIMIT 1000
      `);

      for (const emp of employees) {
        try {
          // Get employee code from mas_hrms
          const [eRows] = await db.execute<RowDataPacket[]>(
            `SELECT id, employee_code FROM employees WHERE id = ? OR employee_code = ? LIMIT 1`,
            [emp.employee_id, emp.employee_id]
          );

          if (!eRows.length) continue; // Skip unmapped employees

          const empData = eRows[0] as any;

          // Get best MCQ score
          const [scores] = await lms.execute<RowDataPacket[]>(`
            SELECT MAX(percentage) as best_score, COUNT(*) as attempt_count
            FROM assessment_attempts
            WHERE employee_id = ?
          `, [emp.employee_id]);

          const bestScore = (scores[0] as any)?.best_score || 0;

          // Get batch info
          const [batches] = await lms.execute<RowDataPacket[]>(`
            SELECT DISTINCT bcm.batch_no, bcm.batch_name, bm.process, bm.branch
            FROM assessment_attempts aa
            JOIN batch_classroom_map bcm ON bcm.classroom_id = (
              SELECT classroom_id FROM assessment_master WHERE assessment_id = aa.assessment_id LIMIT 1
            )
            LEFT JOIN batch_master bm ON bm.batch_no = bcm.batch_no
            WHERE aa.employee_id = ?
            LIMIT 1
          `, [emp.employee_id]);

          const batch = (batches[0] || {}) as any;

          // Calculate readiness
          const readinessScore = Math.min(bestScore, 100);
          const riskSignal = readinessScore >= 80 ? 'green' : readinessScore >= 60 ? 'yellow' : 'red';

          await db.execute(`
            INSERT INTO lms_learner_progress (
              id, employee_id, employee_code, batch_no, batch_name, process_name, branch_name,
              mcq_best_score, readiness_score, attrition_risk_signal, ops_handover_ready, synced_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
              mcq_best_score = VALUES(mcq_best_score),
              readiness_score = VALUES(readiness_score),
              attrition_risk_signal = VALUES(attrition_risk_signal),
              ops_handover_ready = VALUES(ops_handover_ready),
              synced_at = NOW()
          `, [
            randomUUID(),
            empData.id,
            empData.employee_code,
            batch.batch_no || null,
            batch.batch_name || null,
            batch.process || null,
            batch.branch || null,
            bestScore,
            readinessScore,
            riskSignal,
            readinessScore >= 75 ? 1 : 0
          ]);

          synced++;
        } catch (e) {
          console.error(`Failed to sync ${emp.employee_id}:`, e);
          failed++;
        }
      }

      await lms.release();
      await logSyncComplete('learner_progress', auditId, synced, failed);
      return { synced, failed };
    } catch (e) {
      await logSyncError('learner_progress', auditId, String(e));
      throw e;
    }
  },

  async syncAssessmentScores(): Promise<{ synced: number }> {
    const auditId = randomUUID();
    await logSyncStart('assessment_scores', auditId);

    let synced = 0;
    try {
      const lms = await getLmsConnection();

      const [attempts] = await lms.execute<RowDataPacket[]>(`
        SELECT aa.*, am.assessment_name,
               bcm.batch_no
        FROM assessment_attempts aa
        LEFT JOIN assessment_master am ON am.assessment_id = aa.assessment_id
        LEFT JOIN batch_classroom_map bcm ON bcm.classroom_id = am.classroom_id
        WHERE aa.submitted_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
        LIMIT 5000
      `);

      for (const att of attempts) {
        const [eRows] = await db.execute<RowDataPacket[]>(
          `SELECT employee_code FROM employees WHERE id = ? OR employee_code = ? LIMIT 1`,
          [att.employee_id, att.employee_id]
        );

        const empCode = (eRows[0] as any)?.employee_code || att.employee_id;

        await db.execute(`
          INSERT INTO lms_assessment_scores (
            id, employee_id, employee_code, batch_no, assessment_name, attempt_no,
            score, percentage, result, time_taken_seconds, attempted_at, synced_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE
            percentage = VALUES(percentage), result = VALUES(result), synced_at = NOW()
        `, [
          randomUUID(),
          att.employee_id,
          empCode,
          att.batch_no || null,
          att.assessment_name || 'Unknown Assessment',
          att.attempt_no || 1,
          att.score || 0,
          att.percentage || 0,
          att.result,
          att.time_taken_seconds || 0,
          att.submitted_at
        ]);

        synced++;
      }

      await lms.release();
      await logSyncComplete('assessment_scores', auditId, synced, 0);
      return { synced };
    } catch (e) {
      await logSyncError('assessment_scores', auditId, String(e));
      throw e;
    }
  }
};

async function logSyncStart(syncType: string, auditId: string) {
  await db.execute(`
    INSERT INTO lms_sync_audit (id, sync_type, status, started_at)
    VALUES (?, ?, 'running', NOW())
  `, [auditId, syncType]);
}

async function logSyncComplete(syncType: string, auditId: string, synced: number, failed: number) {
  await db.execute(`
    UPDATE lms_sync_audit
    SET status = 'success', rows_synced = ?, rows_failed = ?, completed_at = NOW()
    WHERE id = ?
  `, [synced, failed, auditId]);
}

async function logSyncError(syncType: string, auditId: string, error: string) {
  await db.execute(`
    UPDATE lms_sync_audit
    SET status = 'failed', error_message = ?, completed_at = NOW()
    WHERE id = ?
  `, [error.substring(0, 500), auditId]);
}
