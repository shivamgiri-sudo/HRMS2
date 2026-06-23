import { db } from '../../db/mysql.js';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { logSensitiveAction } from '../../shared/auditLog.js';

/**
 * BGV Enhanced Service
 * Digital verification integration with Digilocker and status tracking
 */

export interface BGVRequest {
  candidate_id: string;
  verification_type: 'aadhaar' | 'pan' | 'education' | 'employment' | 'address' | 'criminal' | 'name_match';
  document_number?: string;
  verification_method: 'manual' | 'digilocker' | 'api';
  initiated_by: string;
  remarks?: string;
}

function normalizeName(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameMatches(expected: string, actual: string): boolean {
  const left = normalizeName(expected);
  const right = normalizeName(actual);
  if (!left || !right) return false;
  return left === right || left.split(" ").sort().join(" ") === right.split(" ").sort().join(" ");
}

async function ensureBgvRecord(candidateId: string): Promise<string> {
  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM ats_bgv_verification WHERE candidate_id = ? LIMIT 1`,
    [candidateId],
  );
  if (existing[0]) return String(existing[0].id);
  const [inserted] = await db.execute<ResultSetHeader>(
    `INSERT INTO ats_bgv_verification (candidate_id, verification_status, overall_progress)
     VALUES (?, 'in_progress', 0)`,
    [candidateId],
  );
  return String(inserted.insertId);
}

export interface BGVStatus {
  id: string;
  candidate_id: string;
  candidate_name: string;
  candidate_code: string;
  mobile: string;
  email: string;
  current_stage: string;
  verification_status: 'pending' | 'in_progress' | 'verified' | 'failed';
  aadhaar_status: string | null;
  pan_status: string | null;
  education_status: string | null;
  employment_status: string | null;
  address_status: string | null;
  criminal_status: string | null;
  overall_progress: number;
  initiated_at: string;
  completed_at: string | null;
}

export interface VerificationDetail {
  verification_type: string;
  status: string;
  verification_method: string;
  document_number: string | null;
  verified_at: string | null;
  initiated_by_name: string;
  remarks: string | null;
}

/**
 * Get pending BGV requests
 */
export async function getPendingBGVRequests(): Promise<BGVStatus[]> {
  const [results] = await db.execute<RowDataPacket[]>(
    `SELECT
      c.id,
      c.candidate_id as candidate_code,
      c.full_name as candidate_name,
      c.mobile,
      c.email,
      c.current_stage,
      COALESCE(bgv.verification_status, 'pending') as verification_status,
      bgv.aadhaar_status,
      bgv.pan_status,
      bgv.education_status,
      bgv.employment_status,
      bgv.address_status,
      bgv.criminal_status,
      COALESCE(bgv.overall_progress, 0) as overall_progress,
      bgv.created_at as initiated_at,
      bgv.completed_at
    FROM ats_candidate c
    LEFT JOIN ats_bgv_verification bgv ON bgv.candidate_id = c.id
    WHERE c.current_stage = 'bgv_pending'
    AND c.active_status = 1
    ORDER BY c.created_at DESC`
  );

  return results as BGVStatus[];
}

/**
 * Get BGV details for a candidate
 */
export async function getBGVDetails(candidateId: string): Promise<{
  candidate: any;
  verifications: VerificationDetail[];
}> {
  // Get candidate details
  const [candidateRes] = await db.execute<RowDataPacket[]>(
    `SELECT
      c.*,
      COALESCE(bgv.verification_status, 'pending') as bgv_status,
      bgv.overall_progress,
      bgv.aadhaar_status,
      bgv.pan_status,
      bgv.education_status,
      bgv.employment_status,
      bgv.address_status,
      bgv.criminal_status
    FROM ats_candidate c
    LEFT JOIN ats_bgv_verification bgv ON bgv.candidate_id = c.id
    WHERE c.id = ?`,
    [candidateId]
  );

  if (candidateRes.length === 0) {
    throw new Error('Candidate not found');
  }

  // Get verification details
  const [verifications] = await db.execute<RowDataPacket[]>(
    `SELECT
      vd.verification_type,
      vd.status,
      vd.verification_method,
      vd.document_number,
      vd.verified_at,
      vd.remarks,
      CONCAT(e.first_name, ' ', e.last_name) as initiated_by_name
    FROM ats_bgv_verification_details vd
    LEFT JOIN employees e ON e.id = vd.initiated_by
    WHERE vd.candidate_id = ?
    ORDER BY vd.created_at DESC`,
    [candidateId]
  );

  return {
    candidate: candidateRes[0],
    verifications: verifications as VerificationDetail[],
  };
}

/**
 * Initiate BGV verification
 */
export async function initiateBGVVerification(input: BGVRequest): Promise<{
  success: boolean;
  message: string;
  verification_id?: string;
}> {
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // Check if candidate exists and is in correct stage
    const [candidateRes] = await conn.execute<RowDataPacket[]>(
      'SELECT id, current_stage FROM ats_candidate WHERE id = ?',
      [input.candidate_id]
    );

    if (candidateRes.length === 0) {
      throw new Error('Candidate not found');
    }

    const candidate = candidateRes[0];
    if (candidate.current_stage !== 'bgv_pending') {
      throw new Error('Candidate is not in BGV pending stage');
    }

    // Check if BGV record exists
    const [bgvRes] = await conn.execute<RowDataPacket[]>(
      'SELECT id FROM ats_bgv_verification WHERE candidate_id = ?',
      [input.candidate_id]
    );

    let bgvId: string;

    if (bgvRes.length === 0) {
      // Create BGV record
      const [insertRes] = await conn.execute<ResultSetHeader>(
        `INSERT INTO ats_bgv_verification (
          candidate_id, verification_status, overall_progress
        ) VALUES (?, 'in_progress', 0)`,
        [input.candidate_id]
      );
      bgvId = insertRes.insertId.toString();
    } else {
      bgvId = bgvRes[0].id;
      // Update status to in_progress
      await conn.execute(
        'UPDATE ats_bgv_verification SET verification_status = ? WHERE id = ?',
        ['in_progress', bgvId]
      );
    }

    // Insert verification detail
    const [detailRes] = await conn.execute<ResultSetHeader>(
      `INSERT INTO ats_bgv_verification_details (
        bgv_id, candidate_id, verification_type, status,
        verification_method, document_number, initiated_by, remarks
      ) VALUES (?, ?, ?, 'in_progress', ?, ?, ?, ?)`,
      [
        bgvId,
        input.candidate_id,
        input.verification_type,
        input.verification_method,
        input.document_number || null,
        input.initiated_by,
        input.remarks || null,
      ]
    );

    // Update specific status column in BGV record
    const statusColumn = `${input.verification_type}_status`;
    await conn.execute(
      `UPDATE ats_bgv_verification SET ${statusColumn} = ? WHERE id = ?`,
      ['in_progress', bgvId]
    );

    await conn.commit();

    return {
      success: true,
      message: 'BGV verification initiated successfully',
      verification_id: detailRes.insertId.toString(),
    };
  } catch (error: any) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * Update verification status
 */
export async function updateVerificationStatus(
  verificationId: string,
  status: 'verified' | 'failed',
  remarks?: string
): Promise<{ success: boolean; message: string }> {
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // Get verification detail
    const [detailRes] = await conn.execute<RowDataPacket[]>(
      'SELECT bgv_id, candidate_id, verification_type FROM ats_bgv_verification_details WHERE id = ?',
      [verificationId]
    );

    if (detailRes.length === 0) {
      throw new Error('Verification not found');
    }

    const detail = detailRes[0];

    // Update verification detail
    await conn.execute(
      `UPDATE ats_bgv_verification_details
       SET status = ?, verified_at = NOW(), remarks = ?
       WHERE id = ?`,
      [status, remarks || null, verificationId]
    );

    // Update status column in BGV record
    const statusColumn = `${detail.verification_type}_status`;
    await conn.execute(
      `UPDATE ats_bgv_verification SET ${statusColumn} = ? WHERE id = ?`,
      [status, detail.bgv_id]
    );

    // Calculate overall progress
    const [progressRes] = await conn.execute<RowDataPacket[]>(
      `SELECT
        SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) as verified_count,
        COUNT(*) as total_count
       FROM ats_bgv_verification_details
       WHERE bgv_id = ?`,
      [detail.bgv_id]
    );

    const progress = progressRes[0];
    const overallProgress = Math.round((progress.verified_count / progress.total_count) * 100);

    // Update overall progress
    await conn.execute(
      'UPDATE ats_bgv_verification SET overall_progress = ? WHERE id = ?',
      [overallProgress, detail.bgv_id]
    );

    // Check if all verifications are complete
    const [allVerifiedRes] = await conn.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as pending_count
       FROM ats_bgv_verification_details
       WHERE bgv_id = ? AND status IN ('pending', 'in_progress')`,
      [detail.bgv_id]
    );

    if (allVerifiedRes[0].pending_count === 0) {
      // Check if any failed
      const [failedRes] = await conn.execute<RowDataPacket[]>(
        `SELECT COUNT(*) as failed_count
         FROM ats_bgv_verification_details
         WHERE bgv_id = ? AND status = 'failed'`,
        [detail.bgv_id]
      );

      const finalStatus = failedRes[0].failed_count > 0 ? 'failed' : 'verified';

      // Update BGV record
      await conn.execute(
        `UPDATE ats_bgv_verification
         SET verification_status = ?, completed_at = NOW()
         WHERE id = ?`,
        [finalStatus, detail.bgv_id]
      );

      // Update candidate stage
      const nextStage = finalStatus === 'verified' ? 'bgv_verified' : 'bgv_failed';
      await conn.execute(
        'UPDATE ats_candidate SET current_stage = ? WHERE id = ?',
        [nextStage, detail.candidate_id]
      );
    }

    await conn.commit();

    return {
      success: true,
      message: 'Verification status updated successfully',
    };
  } catch (error: any) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function runNameMatchCheck(candidateId: string, actorUserId: string): Promise<{
  success: boolean;
  status: 'verified' | 'manual_review';
  result: Record<string, unknown>;
}> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.full_name AS candidate_name,
            p.employee_name AS profile_name,
            p.full_name_aadhaar,
            JSON_UNQUOTE(JSON_EXTRACT(aadhaar.result_data, '$.matchedName')) AS aadhaar_name,
            JSON_UNQUOTE(JSON_EXTRACT(pan.result_data, '$.matchedName')) AS pan_name,
            JSON_UNQUOTE(JSON_EXTRACT(bank_match.result_data, '$.matchedName')) AS bank_verified_name,
            JSON_UNQUOTE(JSON_EXTRACT(education.result_data, '$.matchedName')) AS education_name,
            b.account_holder_name,
            q.institution_name
       FROM ats_candidate c
       LEFT JOIN candidate_onboarding_profile p ON p.candidate_id = c.id
       LEFT JOIN candidate_onboarding_bank_detail b ON b.candidate_id = c.id
       LEFT JOIN candidate_onboarding_qualification q ON q.candidate_id = c.id
       LEFT JOIN ats_bgv_verification_details aadhaar
         ON aadhaar.candidate_id = c.id AND aadhaar.verification_type = 'aadhaar'
       LEFT JOIN ats_bgv_verification_details pan
         ON pan.candidate_id = c.id AND pan.verification_type = 'pan'
       LEFT JOIN ats_bgv_verification_details bank_match
         ON bank_match.candidate_id = c.id AND bank_match.verification_type = 'address'
       LEFT JOIN ats_bgv_verification_details education
         ON education.candidate_id = c.id AND education.verification_type = 'education'
      WHERE c.id = ?
      LIMIT 1`,
    [candidateId],
  );
  const row = rows[0];
  if (!row) throw Object.assign(new Error('Candidate not found'), { statusCode: 404 });

  const baseline = String(row.profile_name ?? row.candidate_name ?? '').trim();
  const checks = [
    { source: 'aadhaar', value: row.aadhaar_name ?? row.full_name_aadhaar },
    { source: 'pan', value: row.pan_name },
    { source: 'bank', value: row.bank_verified_name ?? row.account_holder_name },
    { source: 'education', value: row.education_name },
  ].map((item) => {
    const value = String(item.value ?? '').trim();
    return {
      source: item.source,
      available: Boolean(value),
      matched: value ? nameMatches(baseline, value) : null,
    };
  });
  const hasMismatch = checks.some((item) => item.matched === false);
  const status = hasMismatch ? 'manual_review' : 'verified';
  const result = {
    baseline_name: baseline,
    checks,
    decision: status,
  };

  const bgvId = await ensureBgvRecord(candidateId);
  await db.execute(
    `INSERT INTO ats_bgv_verification_details
       (bgv_id, candidate_id, verification_type, status, verification_method, initiated_by, remarks, result_data, completed_at)
     VALUES (?, ?, 'name_match', ?, 'system', ?, ?, ?, NOW())`,
    [
      bgvId,
      candidateId,
      status,
      actorUserId,
      hasMismatch ? 'Name mismatch requires HR manual review' : 'Name match verified',
      JSON.stringify(result),
    ],
  );
  await db.execute(
    `UPDATE ats_bgv_verification
        SET verification_status = IF(? = 'manual_review', 'in_progress', verification_status),
            updated_at = NOW()
      WHERE id = ?`,
    [status, bgvId],
  );

  await logSensitiveAction({
    actor_user_id: actorUserId,
    action_type: 'bgv_name_match_checked',
    module_key: 'ats_bgv',
    entity_type: 'ats_bgv_verification_details',
    entity_id: candidateId,
    change_summary: result,
  });

  return { success: true, status, result };
}

export async function overrideNameMatchReview(params: {
  candidateId: string;
  actorUserId: string;
  reason: string;
}): Promise<{ success: boolean }> {
  if (!params.reason.trim()) {
    throw Object.assign(new Error('Override reason is required'), { statusCode: 400 });
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, result_data
       FROM ats_bgv_verification_details
      WHERE candidate_id = ? AND verification_type = 'name_match'
      ORDER BY created_at DESC
      LIMIT 1`,
    [params.candidateId],
  );
  const detail = rows[0];
  if (!detail) throw Object.assign(new Error('Name match review not found'), { statusCode: 404 });

  await db.execute(
    `UPDATE ats_bgv_verification_details
        SET status = 'verified',
            reviewed_by = ?,
            remarks = CONCAT(COALESCE(remarks, ''), '\nHR override: ', ?),
            completed_at = NOW(),
            updated_at = NOW()
      WHERE id = ?`,
    [params.actorUserId, params.reason.trim(), detail.id],
  );

  await logSensitiveAction({
    actor_user_id: params.actorUserId,
    action_type: 'bgv_name_match_hr_override',
    module_key: 'ats_bgv',
    entity_type: 'ats_bgv_verification_details',
    entity_id: String(detail.id),
    reason: params.reason.trim(),
    change_summary: {
      candidate_id: params.candidateId,
      override: true,
    },
  });

  return { success: true };
}

/**
 * Get verification statistics
 */
export async function getBGVStatistics(): Promise<{
  total_pending: number;
  in_progress: number;
  verified: number;
  failed: number;
  avg_completion_time_days: number;
}> {
  const [results] = await db.execute<RowDataPacket[]>(
    `SELECT
      COUNT(*) as total,
      SUM(CASE WHEN verification_status = 'pending' THEN 1 ELSE 0 END) as total_pending,
      SUM(CASE WHEN verification_status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
      SUM(CASE WHEN verification_status = 'verified' THEN 1 ELSE 0 END) as verified,
      SUM(CASE WHEN verification_status = 'failed' THEN 1 ELSE 0 END) as failed,
      AVG(CASE
        WHEN completed_at IS NOT NULL
        THEN DATEDIFF(completed_at, created_at)
        ELSE NULL
      END) as avg_completion_time_days
    FROM ats_bgv_verification`
  );

  return {
    total_pending: results[0]?.total_pending || 0,
    in_progress: results[0]?.in_progress || 0,
    verified: results[0]?.verified || 0,
    failed: results[0]?.failed || 0,
    avg_completion_time_days: Math.round(results[0]?.avg_completion_time_days || 0),
  };
}
