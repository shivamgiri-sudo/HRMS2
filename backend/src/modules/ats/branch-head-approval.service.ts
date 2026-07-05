import { db } from '../../db/mysql.js';
import { RowDataPacket } from 'mysql2/promise';
import { sendSelectedEmail, sendRejectedEmail } from './ats.email.service.js';
import { approveOffer, rejectOffer } from './ats.onboarding.service.js';

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

interface BranchRow extends RowDataPacket {
  branch_name: string;
}

interface ApprovalHistoryRow extends RowDataPacket {
  id: string;
  approval_status: 'pending' | 'approved' | 'rejected';
  employee_code_generated?: number | null;
  remarks?: string | null;
  approved_at?: string | null;
  branch_head_name?: string | null;
  branch_head_code?: string | null;
}

/**
 * Get pending approvals for branch head
 */
export async function getPendingApprovals(branchHeadId: string): Promise<PendingApproval[]> {
  // Get branch head's assigned branches
  const [branches] = await db.execute<BranchRow[]>(
    `SELECT DISTINCT branch_name
     FROM branch_head_assignments
     WHERE branch_head_id = ? AND is_active = TRUE`,
    [branchHeadId]
  );

  if (branches.length === 0) {
    return [];
  }

  const branchNames = branches.map((b) => b.branch_name);
  const placeholders = branchNames.map(() => '?').join(',');
  const branchMatchParams = [...branchNames, ...branchNames, ...branchNames, ...branchNames];

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
      JSON_UNQUOTE(JSON_EXTRACT(phv.salary_components, '$.basic')) as basic_salary,
      JSON_UNQUOTE(JSON_EXTRACT(phv.salary_components, '$.hra')) as hra,
      JSON_UNQUOTE(JSON_EXTRACT(phv.salary_components, '$.conveyance')) as conveyance,
      JSON_UNQUOTE(JSON_EXTRACT(phv.salary_components, '$.specialAllowance')) as special_allowance,
      0 as pf_amount,
      0 as esic_amount,
      e.full_name as submitted_by,
      phv.validated_at as submitted_at,
      bha.approval_status
    FROM ats_payroll_hr_validation phv
    INNER JOIN ats_candidate c ON c.id = phv.candidate_id
    INNER JOIN ats_branch_head_approval bha ON bha.payroll_validation_id = phv.id
    LEFT JOIN employees e ON e.id = phv.payroll_hr_id
    LEFT JOIN branch_master cb
      ON cb.id = c.applied_for_branch
      OR cb.branch_name = c.applied_for_branch
      OR cb.branch_code = c.applied_for_branch
    WHERE phv.validation_status = 'validated'
      AND bha.approval_status = 'pending'
      AND (
        c.applied_for_branch IN (${placeholders})
        OR c.branch_display_name IN (${placeholders})
        OR cb.branch_name IN (${placeholders})
        OR cb.branch_code IN (${placeholders})
      )
      AND c.current_stage = 'payroll_validated'
    ORDER BY phv.validated_at DESC`,
    branchMatchParams
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
      c.applied_for_branch,
      o.id AS offer_id
    FROM ats_payroll_hr_validation phv
    LEFT JOIN ats_onboarding_request r ON r.candidate_id = phv.candidate_id
    LEFT JOIN ats_employment_offer o ON o.onboarding_request_id = r.id AND o.status = 'submitted'
    INNER JOIN ats_candidate c ON c.id = phv.candidate_id
    WHERE phv.id = ?
    ORDER BY o.submitted_at DESC
    LIMIT 1`,
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
      await connection.execute(
        `UPDATE salary_exception_proposal
            SET status = 'approved', approved_by = ?, approved_at = NOW(), updated_at = NOW()
          WHERE candidate_id = ? AND status = 'pending'`,
        [branch_head_id, approval.candidate_id]
      );

      await connection.execute(
        `UPDATE ats_branch_head_approval
            SET branch_head_id = ?, approval_status = 'approved', remarks = ?, approved_at = NOW(), updated_at = NOW()
          WHERE payroll_validation_id = ? AND approval_status = 'pending'`,
        [branch_head_id, remarks || null, approval_id]
      );

      await connection.execute(
        `UPDATE ats_candidate
        SET current_stage = 'offer_approved',
            updated_at = NOW()
        WHERE id = ?`,
        [approval.candidate_id]
      );

      await connection.execute(
        `INSERT INTO ats_candidate_stage_log
           (id, candidate_id, from_stage, to_stage, remarks, updated_by)
         VALUES (UUID(), ?, 'payroll_validated', 'offer_approved', ?, ?)`,
        [approval.candidate_id, remarks || 'Branch Head approved final offer', branch_head_id]
      );

      await connection.commit();

      if (approval.offer_id) {
        await approveOffer(String(approval.offer_id), branch_head_id, remarks);
      }

      // Fire-and-forget: send approval email after transaction commits
      if (!approval.offer_id && approval.email) {
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
        message: approval.offer_id
          ? 'Approval successful. Employee conversion completed through canonical offer approval.'
          : 'Approval recorded. Submit an employment offer to complete canonical employee conversion.',
      };
    } else {
      await connection.execute(
        `UPDATE ats_branch_head_approval
            SET branch_head_id = ?, approval_status = 'rejected', remarks = ?, approved_at = NOW(), updated_at = NOW()
          WHERE payroll_validation_id = ? AND approval_status = 'pending'`,
        [branch_head_id, remarks || null, approval_id]
      );

      // Update candidate stage
      await connection.execute(
        `UPDATE ats_candidate
        SET current_stage = 'payroll_validated', updated_at = NOW()
        WHERE id = ?`,
        [approval.candidate_id]
      );

      await connection.execute(
        `UPDATE ats_payroll_hr_validation
            SET validation_status = 'correction_requested', remarks = ?, updated_at = NOW()
          WHERE id = ?`,
        [remarks || 'Rejected by Branch Head', approval_id]
      );

      await connection.execute(
        `UPDATE salary_exception_proposal
            SET status = 'rejected', rejection_reason = ?, approved_by = ?, approved_at = NOW(), updated_at = NOW()
          WHERE candidate_id = ? AND status = 'pending'`,
        [remarks || 'Rejected by Branch Head', branch_head_id, approval.candidate_id]
      );

      await connection.execute(
        `INSERT INTO ats_candidate_stage_log
           (id, candidate_id, from_stage, to_stage, remarks, updated_by)
         VALUES (UUID(), ?, 'payroll_validated', 'payroll_correction_requested', ?, ?)`,
        [approval.candidate_id, remarks || 'Branch Head rejected offer; returned to Payroll HR', branch_head_id]
      );

      await connection.commit();

      if (approval.offer_id && remarks) {
        await rejectOffer(String(approval.offer_id), branch_head_id, remarks);
      }

      // Fire-and-forget: send rejection email after transaction commits
      if (!approval.offer_id && approval.email) {
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
export async function getApprovalHistory(candidateId: string): Promise<ApprovalHistoryRow[]> {
  const [history] = await db.execute<ApprovalHistoryRow[]>(
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
    INNER JOIN ats_branch_head_approval approval ON approval.payroll_validation_id = phv.id
    LEFT JOIN branch_master cb
      ON cb.id = c.applied_for_branch
      OR cb.branch_name = c.applied_for_branch
      OR cb.branch_code = c.applied_for_branch
    INNER JOIN branch_head_assignments bha
      ON bha.branch_name IN (c.applied_for_branch, c.branch_display_name, cb.branch_name, cb.branch_code)
    WHERE bha.branch_head_id = ?
      AND bha.is_active = TRUE
      AND phv.validation_status = 'validated'
      AND approval.approval_status = 'pending'
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
