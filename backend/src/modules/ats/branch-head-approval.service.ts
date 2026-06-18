import { db } from '../../db/mysql.js';
import { RowDataPacket } from 'mysql2/promise';
import { generateEmployeeCode } from './ats.enhanced.service.js';
import { sendSelectedEmail, sendRejectedEmail } from './ats.email.service.js';

/**
 * Branch Head Approval Service
 * Handles approval workflow for selected candidates before final offer
 */

export interface PendingApproval {
  id: string;
  candidate_id: string;
  candidate_code: string;
  candidate_name: string;
  mobile: string;
  email: string;
  applied_for_role: string;
  applied_for_branch: string;
  branch_display_name: string;
  employment_type: 'onroll' | 'offrole';
  gross_salary: number;
  joining_date: string;
  salary_start_date: string;
  basic_salary: number;
  hra: number;
  conveyance: number;
  special_allowance: number;
  pf_amount: number;
  esic_amount: number;
  submitted_by: string;
  submitted_at: string;
  approval_status: 'pending' | 'approved' | 'rejected';
}

export interface ApprovalInput {
  approval_id: string;
  branch_head_id: string;
  approval_status: 'approved' | 'rejected';
  remarks?: string;
}

export interface EmployeeCodeGeneration {
  company_prefix: 'MAS' | 'IDC';
  is_offrole: boolean;
}

/**
 * Get pending approvals for branch head
 */
export async function getPendingApprovals(branchHeadId: string): Promise<PendingApproval[]> {
  // Get branch head's assigned branches
  const [branches] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT branch_name
     FROM branch_head_assignments
     WHERE branch_head_id = ? AND is_active = TRUE`,
    [branchHeadId]
  );

  if (branches.length === 0) {
    return [];
  }

  const branchNames = branches.map((b: any) => b.branch_name);
  const placeholders = branchNames.map(() => '?').join(',');

  // Get pending approvals for these branches
  const [approvals] = await db.execute<RowDataPacket[]>(
    `SELECT
      phv.id,
      phv.candidate_id,
      c.candidate_code,
      c.full_name as candidate_name,
      c.mobile,
      c.email,
      c.applied_for_role,
      c.applied_for_branch,
      c.branch_display_name,
      phv.employment_type,
      phv.gross_salary,
      phv.joining_date,
      phv.salary_start_date,
      phv.basic_salary,
      phv.hra,
      phv.conveyance,
      phv.special_allowance,
      phv.pf_amount,
      phv.esic_amount,
      e.full_name as submitted_by,
      phv.validated_at as submitted_at,
      phv.validation_status as approval_status
    FROM ats_payroll_hr_validation phv
    INNER JOIN ats_candidate c ON c.id = phv.candidate_id
    LEFT JOIN employees e ON e.id = phv.validated_by
    WHERE phv.validation_status = 'approved'
      AND c.applied_for_branch IN (${placeholders})
      AND c.current_stage = 'payroll_validated'
    ORDER BY phv.validated_at DESC`,
    [...branchNames]
  );

  return approvals as PendingApproval[];
}

/**
 * Process branch head approval
 */
export async function processBranchHeadApproval(input: ApprovalInput): Promise<{
  success: boolean;
  message: string;
  employee_code?: string;
}> {
  const { approval_id, branch_head_id, approval_status, remarks } = input;

  // Get approval details
  const [approvals] = await db.execute<RowDataPacket[]>(
    `SELECT
      phv.candidate_id,
      phv.employment_type,
      c.candidate_code,
      c.full_name,
      c.email,
      c.applied_for_branch
    FROM ats_payroll_hr_validation phv
    INNER JOIN ats_candidate c ON c.id = phv.candidate_id
    WHERE phv.id = ?`,
    [approval_id]
  );

  if (approvals.length === 0) {
    return {
      success: false,
      message: 'Approval record not found',
    };
  }

  const approval = approvals[0];

  // Start transaction
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    if (approval_status === 'approved') {
      // Generate employee code
      const companyPrefix: 'MAS' | 'IDC' = approval.applied_for_branch.includes('IDC') ? 'IDC' : 'MAS';
      const isOffrole = approval.employment_type === 'offrole';

      const employeeCode = await generateEmployeeCode(companyPrefix, isOffrole);

      // Create branch head approval record
      await connection.execute(
        `INSERT INTO ats_branch_head_approval
          (payroll_validation_id, branch_head_id, approval_status, employee_code_generated, remarks, approved_at)
        VALUES (?, ?, 'approved', ?, ?, NOW())`,
        [approval_id, branch_head_id, employeeCode, remarks || null]
      );

      // Update candidate stage
      await connection.execute(
        `UPDATE ats_candidate
        SET current_stage = 'offer_pending',
            employee_code = ?
        WHERE id = ?`,
        [employeeCode, approval.candidate_id]
      );

      await connection.commit();

      // Fire-and-forget: send approval email after transaction commits
      if (approval.email) {
        sendSelectedEmail({
          candidateId: approval.candidate_id,
          to: approval.email,
          candidateName: approval.full_name,
          branchName: approval.applied_for_branch,
          hrName: 'MAS Callnet HR',
          hrPhone: '',
        }).catch((err: unknown) => console.error('[branch-head] approval email failed:', err));
      }

      return {
        success: true,
        message: 'Approval successful. Employee code generated.',
        employee_code: employeeCode,
      };
    } else {
      // Rejected
      await connection.execute(
        `INSERT INTO ats_branch_head_approval
          (payroll_validation_id, branch_head_id, approval_status, remarks, approved_at)
        VALUES (?, ?, 'rejected', ?, NOW())`,
        [approval_id, branch_head_id, remarks || null]
      );

      // Update candidate stage
      await connection.execute(
        `UPDATE ats_candidate
        SET current_stage = 'rejected_by_branch_head'
        WHERE id = ?`,
        [approval.candidate_id]
      );

      await connection.commit();

      // Fire-and-forget: send rejection email after transaction commits
      if (approval.email) {
        sendRejectedEmail({
          candidateId: approval.candidate_id,
          to: approval.email,
          candidateName: approval.full_name,
          branchName: approval.applied_for_branch,
        }).catch((err: unknown) => console.error('[branch-head] rejection email failed:', err));
      }

      return {
        success: true,
        message: 'Rejection recorded and candidate notified.',
      };
    }
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Get approval history for a candidate
 */
export async function getApprovalHistory(candidateId: string): Promise<any[]> {
  const [history] = await db.execute<RowDataPacket[]>(
    `SELECT
      bha.id,
      bha.approval_status,
      bha.employee_code_generated,
      bha.remarks,
      bha.approved_at,
      e.full_name as branch_head_name,
      e.employee_code as branch_head_code
    FROM ats_branch_head_approval bha
    INNER JOIN ats_payroll_hr_validation phv ON phv.id = bha.payroll_validation_id
    LEFT JOIN employees e ON e.id = bha.branch_head_id
    WHERE phv.candidate_id = ?
    ORDER BY bha.approved_at DESC`,
    [candidateId]
  );

  return history;
}

/**
 * Get branch head statistics
 */
export async function getBranchHeadStats(branchHeadId: string): Promise<{
  total_pending: number;
  total_approved: number;
  total_rejected: number;
  this_month_approved: number;
}> {
  const [stats] = await db.execute<RowDataPacket[]>(
    `SELECT
      COUNT(*) as total_pending
    FROM ats_payroll_hr_validation phv
    INNER JOIN ats_candidate c ON c.id = phv.candidate_id
    INNER JOIN branch_head_assignments bha ON bha.branch_name = c.applied_for_branch
    WHERE bha.branch_head_id = ?
      AND bha.is_active = TRUE
      AND phv.validation_status = 'approved'
      AND c.current_stage = 'payroll_validated'`,
    [branchHeadId]
  );

  const [approved] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as total_approved
    FROM ats_branch_head_approval bha
    WHERE bha.branch_head_id = ? AND bha.approval_status = 'approved'`,
    [branchHeadId]
  );

  const [rejected] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as total_rejected
    FROM ats_branch_head_approval bha
    WHERE bha.branch_head_id = ? AND bha.approval_status = 'rejected'`,
    [branchHeadId]
  );

  const [thisMonth] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as this_month_approved
    FROM ats_branch_head_approval bha
    WHERE bha.branch_head_id = ?
      AND bha.approval_status = 'approved'
      AND MONTH(bha.approved_at) = MONTH(CURRENT_DATE())
      AND YEAR(bha.approved_at) = YEAR(CURRENT_DATE())`,
    [branchHeadId]
  );

  return {
    total_pending: stats[0]?.total_pending || 0,
    total_approved: approved[0]?.total_approved || 0,
    total_rejected: rejected[0]?.total_rejected || 0,
    this_month_approved: thisMonth[0]?.this_month_approved || 0,
  };
}
