import { db } from '../../db/mysql.js';
import { RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'crypto';
import { sendSelectionCongratulationsEmail } from './ats.email.service.js';
import { sendOnboardingToken } from './ats.onboarding.service.js';
import { env } from '../../config/env.js';
import { inboxService } from '../inbox/inbox.service.js';
import { getUserRoleKeys } from '../../shared/roleResolver.js';

/**
 * Interview Service
 *
 * Handles interview result submission and candidate selection flow
 */

export interface InterviewResultInput {
  candidate_id: string;
  recruiter_id: string;
  interview_status: 'selected' | 'rejected' | 'hold' | 'callback' | 'no_show' | 'walkout';
  communication_rating?: number; // 1-5
  stability_rating?: number; // 1-5
  salary_fit?: boolean;
  shift_fit?: boolean;
  location_fit?: boolean;
  role_fit?: boolean;
  remarks?: string;
  rejection_reason?: string;
  next_step?: string;
  documents_pending?: boolean;
  joining_interest?: boolean;
  expected_joining_date?: string;
  recruiter_recommendation?: string;
}

interface AssignedCandidate {
  candidate_id: string;
  full_name: string;
  mobile: string;
  email: string;
  applied_for_role: string;
  applied_for_branch: string;
  branch_display_name: string;
  education: string;
  years_of_experience: string;
  token_number: string;
  queue_status: string;
  registered_at: string;
  resume_url: string;
  selfie_url: string;
  address: string;
  gender: string;
}

/**
 * Get assigned candidates for a recruiter
 */
export async function getAssignedCandidates(recruiterId: string): Promise<AssignedCandidate[]> {
  // Resolve recruiter roster id from users.id via employees table
  const [rosterRows] = await db.execute<RowDataPacket[]>(
    `SELECT r.id as roster_id
     FROM ats_recruiter_roster r
     INNER JOIN employees e ON e.id = r.employee_id
     WHERE e.user_id = ?
     LIMIT 1`,
    [recruiterId]
  );
  const rosterId: string | null = (rosterRows[0]?.roster_id as string) ?? null;

  // Fall back: if no roster mapping, return empty (recruiter not yet set up)
  if (!rosterId) return [];

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
      c.id as candidate_id,
      c.full_name,
      c.mobile,
      c.email,
      COALESCE(c.role_applied, c.applied_for_process) AS applied_for_role,
      c.applied_for_branch,
      c.branch_display_name,
      c.education,
      COALESCE(c.experience, '') AS years_of_experience,
      c.address,
      NULL AS gender,
      c.resume_url,
      c.selfie_url,
      c.created_at as registered_at,
      qt.token_number,
      qt.queue_status
    FROM ats_candidate c
    LEFT JOIN ats_queue_token qt ON qt.candidate_id = c.id
    WHERE c.recruiter_id = ?
      AND c.candidate_status = 'registered'
      AND qt.queue_status IN ('waiting', 'called', 'in_interview')
    ORDER BY qt.created_at ASC`,
    [rosterId]
  );

  return rows as AssignedCandidate[];
}

/**
 * Get candidate details for interview
 */
/**
 * `recruiterId` is the caller's user id. ats_candidate.recruiter_id stores an
 * ats_recruiter_roster id, so comparing the two directly never matched and this
 * returned "not assigned to you" for every candidate. Resolve the roster id
 * first, exactly as getAssignedCandidates does.
 */
export async function getCandidateForInterview(candidateId: string, recruiterId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
      c.*,
      qt.token_number,
      qt.queue_status,
      qt.created_at as token_created_at,
      b.branch_name,
      b.id as branch_id
    FROM ats_candidate c
    LEFT JOIN ats_queue_token qt ON qt.candidate_id = c.id
    LEFT JOIN branch_master b ON b.branch_name = c.applied_for_branch
    WHERE c.id = ?
      AND c.recruiter_id = (
        SELECT r.id FROM ats_recruiter_roster r
         INNER JOIN employees e ON e.id = r.employee_id
         WHERE e.user_id = ? LIMIT 1
      )`,
    [candidateId, recruiterId]
  );

  if (rows.length === 0) {
    throw new Error('Candidate not found or not assigned to you');
  }

  return rows[0];
}

/**
 * Confirms the caller may record an outcome for this candidate.
 *
 * Recording a result is consequential — a 'selected' fires the onboarding
 * token, the portal login and the congratulations email — yet this path had no
 * ownership check at all, so any holder of a write role could select or reject
 * any candidate in any branch.
 *
 * ats_candidate.recruiter_id holds an ats_recruiter_roster id, not a user id
 * (verified: all 1,035 non-null values resolve against the roster). Comparing
 * it to req.authUser.id, as the sibling read path does, can never match — so
 * the roster id is resolved first.
 */
async function assertCandidateAssignedToCaller(candidateId: string, userId: string): Promise<void> {
  const [[candidate]] = await db.execute<RowDataPacket[]>(
    `SELECT recruiter_id FROM ats_candidate WHERE id = ? LIMIT 1`,
    [candidateId]
  );
  if (!candidate) {
    throw Object.assign(new Error('Candidate not found'), { statusCode: 404 });
  }

  const [[roster]] = await db.execute<RowDataPacket[]>(
    `SELECT r.id AS roster_id
       FROM ats_recruiter_roster r
       INNER JOIN employees e ON e.id = r.employee_id
      WHERE e.user_id = ? LIMIT 1`,
    [userId]
  );
  if (roster?.roster_id && String(roster.roster_id) === String(candidate.recruiter_id)) return;

  // HR and admins legitimately act across candidates they were never assigned.
  const roleKeys = await getUserRoleKeys(userId);
  if (roleKeys.some((role) => ['admin', 'super_admin', 'hr'].includes(role))) return;

  throw Object.assign(
    new Error('This candidate is not assigned to you.'),
    { statusCode: 403 }
  );
}

export async function submitInterviewResult(input: InterviewResultInput) {
  await assertCandidateAssignedToCaller(input.candidate_id, input.recruiter_id);

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // Insert interview result
    const resultId = randomUUID();
    await connection.execute(
      `INSERT INTO ats_interview_result (
        id, candidate_id, recruiter_id, interview_status,
        communication_rating, stability_rating,
        salary_fit, shift_fit, location_fit, role_fit,
        remarks, rejection_reason, next_step,
        documents_pending, joining_interest, expected_joining_date,
        recruiter_recommendation
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        resultId,
        input.candidate_id,
        input.recruiter_id,
        input.interview_status,
        input.communication_rating || null,
        input.stability_rating || null,
        input.salary_fit ? 1 : 0,
        input.shift_fit ? 1 : 0,
        input.location_fit ? 1 : 0,
        input.role_fit ? 1 : 0,
        input.remarks || null,
        input.rejection_reason || null,
        input.next_step || null,
        input.documents_pending ? 1 : 0,
        input.joining_interest ? 1 : 0,
        input.expected_joining_date || null,
        input.recruiter_recommendation || null,
      ]
    );

    // Record the outcome that was actually given. The route accepts selected,
    // rejected, hold, callback, no_show and walkout, but this collapsed
    // everything except 'selected' into 'rejected' — so a candidate asked to
    // come back tomorrow, or one who simply did not turn up, was permanently
    // marked rejected and the rejection mail keys off exactly this value.
    // candidate_status is VARCHAR(50) and holds the outcome verbatim.
    await connection.execute(
      `UPDATE ats_candidate
       SET candidate_status = ?
       WHERE id = ?`,
      [input.interview_status, input.candidate_id]
    );

    // Update queue status
    const queueStatus =
      input.interview_status === 'selected' ? 'completed' :
      input.interview_status === 'no_show' ? 'no_show' :
      'completed'; // rejected/hold/callback/walkout all become completed
    await connection.execute(
      `UPDATE ats_queue_token
       SET queue_status = ?,
           interview_completed_at = NOW()
       WHERE candidate_id = ?`,
      [queueStatus, input.candidate_id]
    );

    // Deciding a candidate's outcome left no trace at all: no stage log, no
    // sensitive-action row. Write one inside the transaction so the decision and
    // its record cannot diverge.
    await connection.execute(
      `INSERT INTO ats_sensitive_action_log
         (id, actor_user_id, action_type, target_entity, target_id, action_details, created_at)
       VALUES (?, ?, 'interview_result', 'ats_candidate', ?, CAST(? AS JSON), NOW())`,
      [
        randomUUID(),
        input.recruiter_id,
        input.candidate_id,
        JSON.stringify({
          action: 'SUBMIT_INTERVIEW_RESULT',
          interview_status: input.interview_status,
          result_id: resultId,
          rejection_reason: input.rejection_reason ?? null,
          next_step: input.next_step ?? null,
        }),
      ]
    );

    await connection.commit();

    // If selected, send congratulations email and create portal login
    if (input.interview_status === 'selected') {
      await handleCandidateSelection(input.candidate_id);
    }

    return {
      success: true,
      resultId,
      interview_status: input.interview_status,
      message: `Interview result submitted: ${input.interview_status}`,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Handle candidate selection - create portal login and send email
 */
async function handleCandidateSelection(candidateId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, full_name, mobile, email, applied_for_branch, branch_display_name,
     COALESCE(role_applied, applied_for_process) AS applied_for_role
     FROM ats_candidate WHERE id = ?`,
    [candidateId]
  );

  if (rows.length === 0) return;

  const candidate = rows[0];

  // Send onboarding link immediately on selection — candidate fills BGV docs within the onboarding form.
  sendOnboardingToken(candidateId, 'system').catch((err) =>
    console.error('[interview] Failed to send onboarding token for', candidateId, err)
  );

  const tempPassword = generateTempPassword();

  if (candidate.email) {
    const loginId = randomUUID();
    await db.execute(
      `INSERT INTO ats_candidate_portal_login (
        id, candidate_id, email, temp_password, password_reset_required
      ) VALUES (?, ?, ?, ?, 1)
      ON DUPLICATE KEY UPDATE
        temp_password = VALUES(temp_password),
        password_reset_required = 1`,
      [loginId, candidateId, candidate.email, tempPassword]
    );

    const onboardingPortalUrl = `${env.FRONTEND_URL}/candidate-portal/login`;
    sendSelectionCongratulationsEmail({
      candidateId: candidate.id,
      to: candidate.email,
      candidateName: candidate.full_name,
      branchDisplayName: candidate.branch_display_name,
      roleOffered: candidate.applied_for_role,
      onboardingPortalUrl,
      tempPassword,
    }).catch((err) => console.error('Failed to send selection email:', err));
  }

  await db.execute(
    `INSERT INTO portal_notification (
      id, user_id, user_type, title, message, notification_type,
      reference_id, priority, read_status
    ) VALUES (UUID(), ?, 'candidate', ?, ?, 'selection', ?, 'high', 0)`,
    [
      candidateId,
      'Congratulations! You are Selected',
      `You have been selected for ${candidate.applied_for_role ?? 'the role'} at ${candidate.branch_display_name ?? ''}. Please complete your onboarding.`,
      candidateId,
    ]
  ).catch((err: unknown) => {
    // notification table may not exist on all deployments
    console.error('[interview] Selection notification failed for candidate', candidateId, ':', err instanceof Error ? err.message : String(err));
  });

  // Notify the recruiter who owns this candidate via work inbox
  void (async () => {
    try {
      if (!candidate.preferred_recruiter_id) return;
      const [rosterRows] = await db.execute<RowDataPacket[]>(
        `SELECT employee_id FROM ats_recruiter_roster WHERE id = ? LIMIT 1`,
        [candidate.preferred_recruiter_id]
      );
      const empId = rosterRows[0]?.employee_id as string | null;
      if (!empId) return;
      const [userRows] = await db.execute<RowDataPacket[]>(
        `SELECT user_id AS id FROM employees WHERE id = ? AND active_status = 1 LIMIT 1`,
        [empId]
      );
      const userId = userRows[0]?.id as string | null;
      if (!userId) return;
      await inboxService.createItem({
        user_id: userId,
        type: 'candidate_selected',
        title: `Candidate Selected: ${candidate.full_name ?? 'Candidate'}`,
        description: `${candidate.full_name ?? 'Candidate'} has been selected for ${candidate.applied_for_role ?? 'the role'} at ${candidate.branch_display_name ?? ''}. Onboarding link sent.`,
        entity_type: 'ats_candidate',
        entity_id: candidateId,
        action_url: '/ats/onboarding-requests',
        priority: 'high',
      });
    } catch (e) {
      console.warn('[interview] recruiter inbox notification failed:', e);
    }
  })();
}

/**
 * Generate temporary password (8 characters)
 */
function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed ambiguous chars
  let password = '';
  for (let i = 0; i < 8; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

/**
 * Get interview history for a candidate
 */
export async function getInterviewHistory(candidateId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
      ir.*,
      e.full_name as recruiter_name,
      e.employee_code as recruiter_code
    FROM ats_interview_result ir
    LEFT JOIN employees e ON e.id = ir.recruiter_id
    WHERE ir.candidate_id = ?
    ORDER BY ir.created_at DESC`,
    [candidateId]
  );

  return rows;
}

/**
 * Get recruiter performance metrics
 */
export async function getRecruiterPerformance(recruiterId: string, fromDate?: string, toDate?: string) {
  const params: unknown[] = [recruiterId];
  let dateFilter: string;
  if (fromDate && toDate) {
    dateFilter = 'AND DATE(ir.created_at) BETWEEN ? AND ?';
    params.push(fromDate, toDate);
  } else {
    dateFilter = 'AND DATE(ir.created_at) = CURDATE()';
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
      COUNT(*) as total_interviews,
      SUM(CASE WHEN interview_status = 'selected' THEN 1 ELSE 0 END) as selected_count,
      SUM(CASE WHEN interview_status = 'rejected' THEN 1 ELSE 0 END) as rejected_count,
      SUM(CASE WHEN interview_status = 'hold' THEN 1 ELSE 0 END) as hold_count,
      SUM(CASE WHEN interview_status = 'no_show' THEN 1 ELSE 0 END) as no_show_count,
      ROUND(AVG(communication_rating), 2) as avg_communication_rating,
      ROUND(AVG(stability_rating), 2) as avg_stability_rating,
      ROUND(SUM(CASE WHEN interview_status = 'selected' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 2) as selection_rate
    FROM ats_interview_result ir
    WHERE ir.recruiter_id = ? ${dateFilter}`,
    params
  );

  return rows[0] || {
    total_interviews: 0,
    selected_count: 0,
    rejected_count: 0,
    hold_count: 0,
    no_show_count: 0,
    avg_communication_rating: 0,
    avg_stability_rating: 0,
    selection_rate: 0,
  };
}

/**
 * Update queue status (called/in_interview)
 */
export async function updateQueueStatus(candidateId: string, status: 'called' | 'in_interview') {
  const fieldMap = {
    called: 'called_at',
    in_interview: 'interview_started_at',
  };

  const field = fieldMap[status];

  await db.execute(
    `UPDATE ats_queue_token
     SET queue_status = ?, ${field} = NOW()
     WHERE candidate_id = ?`,
    [status, candidateId]
  );

  return { success: true, status };
}
