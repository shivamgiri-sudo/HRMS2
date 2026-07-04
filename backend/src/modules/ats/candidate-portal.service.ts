import { db } from '../../db/mysql.js';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

/**
 * Candidate Portal Service
 * Handles candidate login, profile, tasks, and document management
 */

const JWT_SECRET = env.JWT_SECRET;

export interface CandidateLoginInput {
  candidate_id: string;
  password: string;
}

export interface CandidateProfile {
  id: string;
  candidate_code: string;
  full_name: string;
  mobile: string;
  email: string;
  applied_for_role: string;
  applied_for_branch: string;
  current_stage: string;
  joining_date?: string;
  salary_start_date?: string;
}

export interface OnboardingTask {
  id: string;
  task_name: string;
  task_description: string;
  is_completed: boolean;
  completed_at?: string;
  document_url?: string;
}

export interface DocumentUpload {
  id: string;
  document_type: string;
  file_name: string;
  file_url: string;
  uploaded_at: string;
  verification_status: 'pending' | 'verified' | 'rejected';
}

/**
 * Candidate login
 */
export async function candidateLogin(input: CandidateLoginInput): Promise<{
  success: boolean;
  message?: string;
  token?: string;
  candidate?: CandidateProfile;
}> {
  const { candidate_id, password } = input;

  // Get candidate with portal access
  const [candidates] = await db.execute<RowDataPacket[]>(
    `SELECT
      c.id,
      c.candidate_code,
      c.full_name,
      c.mobile,
      c.email,
      c.applied_for_role,
      c.applied_for_branch,
      c.current_stage,
      pa.password_hash,
      phv.joining_date,
      phv.salary_start_date
    FROM ats_candidate c
    LEFT JOIN ats_candidate_portal_access pa ON pa.candidate_id = c.id
    LEFT JOIN ats_payroll_hr_validation phv ON phv.candidate_id = c.id
    WHERE c.candidate_code = ? AND c.active_status = 1 AND pa.is_active = 1
    LIMIT 1`,
    [candidate_id]
  );

  if (candidates.length === 0) {
    return {
      success: false,
      message: 'Invalid credentials or portal access not granted',
    };
  }

  const candidate = candidates[0];

  // Verify password
  const isPasswordValid = await bcrypt.compare(password, candidate.password_hash);

  if (!isPasswordValid) {
    return {
      success: false,
      message: 'Invalid credentials',
    };
  }

  // Generate JWT token
  const token = jwt.sign(
    {
      candidate_id: candidate.id,
      candidate_code: candidate.candidate_code,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  // Return success with token and profile
  return {
    success: true,
    token,
    candidate: {
      id: candidate.id,
      candidate_code: candidate.candidate_code,
      full_name: candidate.full_name,
      mobile: candidate.mobile,
      email: candidate.email,
      applied_for_role: candidate.applied_for_role,
      applied_for_branch: candidate.applied_for_branch,
      current_stage: candidate.current_stage,
      joining_date: candidate.joining_date,
      salary_start_date: candidate.salary_start_date,
    },
  };
}

/**
 * Get candidate profile
 */
export async function getCandidateProfile(candidateId: string): Promise<CandidateProfile | null> {
  const [candidates] = await db.execute<RowDataPacket[]>(
    `SELECT
      c.id,
      c.candidate_code,
      c.full_name,
      c.mobile,
      c.email,
      c.applied_for_role,
      c.applied_for_branch,
      c.current_stage,
      phv.joining_date,
      phv.salary_start_date
    FROM ats_candidate c
    LEFT JOIN ats_payroll_hr_validation phv ON phv.candidate_id = c.id
    WHERE c.id = ? AND c.active_status = 1
    LIMIT 1`,
    [candidateId]
  );

  if (candidates.length === 0) {
    return null;
  }

  return candidates[0] as CandidateProfile;
}

/**
 * Get candidate onboarding tasks
 */
export async function getCandidateTasks(candidateId: string): Promise<OnboardingTask[]> {
  const [tasks] = await db.execute<RowDataPacket[]>(
    `SELECT
      id,
      task_name,
      task_description,
      is_completed,
      completed_at,
      document_url
    FROM ats_onboarding_tasks
    WHERE candidate_id = ?
    ORDER BY task_order ASC, created_at ASC`,
    [candidateId]
  );

  return tasks as OnboardingTask[];
}

/**
 * Get candidate uploaded documents
 */
export async function getCandidateDocuments(candidateId: string): Promise<DocumentUpload[]> {
  const [documents] = await db.execute<RowDataPacket[]>(
    `SELECT
      id,
      document_type,
      file_name,
      file_url,
      uploaded_at,
      verification_status
    FROM ats_candidate_documents
    WHERE candidate_id = ?
    ORDER BY uploaded_at DESC`,
    [candidateId]
  );

  return documents as DocumentUpload[];
}

/**
 * Upload candidate document
 */
export async function uploadCandidateDocument(
  candidateId: string,
  documentType: string,
  fileName: string,
  fileUrl: string
): Promise<{ id: string }> {
  const [result] = await db.execute(
    `INSERT INTO ats_candidate_documents
      (candidate_id, document_type, file_name, file_url, verification_status, uploaded_at)
    VALUES (?, ?, ?, ?, 'pending', NOW())`,
    [candidateId, documentType, fileName, fileUrl]
  );

  const insertResult = result as ResultSetHeader;
  return { id: String(insertResult.insertId) };
}

/**
 * Mark task as completed
 */
export async function markTaskCompleted(
  candidateId: string,
  taskId: string
): Promise<void> {
  await db.execute(
    `UPDATE ats_onboarding_tasks
    SET is_completed = TRUE, completed_at = NOW()
    WHERE id = ? AND candidate_id = ?`,
    [taskId, candidateId]
  );
}

/**
 * Create portal access for selected candidate
 * Called automatically when candidate is selected in interview
 */
export async function createPortalAccess(
  candidateId: string,
  tempPassword: string
): Promise<void> {
  // Hash password
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  // Create portal access record
  await db.execute(
    `INSERT INTO ats_candidate_portal_access
      (candidate_id, password_hash, is_active, created_at)
    VALUES (?, ?, TRUE, NOW())
    ON DUPLICATE KEY UPDATE
      password_hash = VALUES(password_hash),
      is_active = TRUE`,
    [candidateId, passwordHash]
  );
}

/**
 * Verify JWT token
 */
export function verifyToken(token: string): { candidate_id: string; candidate_code: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      candidate_id: string;
      candidate_code: string;
    };
    return decoded;
  } catch (error) {
    return null;
  }
}
