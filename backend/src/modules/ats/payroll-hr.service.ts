import { db } from '../../db/mysql.js';
import { RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'crypto';
import { sendPayrollHRNotificationEmail } from './ats.email.service.js';

/**
 * Payroll HR Validation Service
 *
 * Handles salary assignment and validation for BGV-completed candidates.
 * Key feature: Manages joining_date and salary_start_date separately.
 *
 * Logic:
 * - joining_date: Physical day 1 in office
 * - salary_start_date: When salary generation begins (can be same or different)
 * - If salary_start_date is NULL, defaults to joining_date for payroll calculation
 */

interface PendingCandidate {
  candidate_id: string;
  full_name: string;
  mobile: string;
  email: string;
  applied_for_role: string;
  applied_for_branch: string;
  branch_display_name: string;
  bgv_status: string;
  bgv_completed_at: string;
  education: string;
  years_of_experience: string;
  onboarding_submitted_at: string;
}

export interface SalaryValidationInput {
  candidate_id: string;
  employment_type: 'onroll' | 'offrole';
  company_id: string;
  designation_id: string;
  department_id: string;
  process_id: string;
  cost_centre_id: string;
  reporting_manager_id: string;
  salary_slab_id: string;
  gross_salary: number;
  salary_components?: any; // Optional - can be auto-calculated
  joining_date: string; // YYYY-MM-DD format
  salary_start_date?: string; // YYYY-MM-DD format (optional, defaults to joining_date)
  shift_id?: string;
  remarks?: string;
  payroll_hr_id: string;
}

/**
 * Get all BGV-completed candidates pending payroll validation
 */
export async function getPendingCandidates(): Promise<PendingCandidate[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
      c.id as candidate_id,
      c.full_name,
      c.mobile,
      c.email,
      c.applied_for_role,
      c.applied_for_branch,
      c.branch_display_name,
      bgv.bgv_status,
      bgv.completed_at as bgv_completed_at,
      c.education,
      c.years_of_experience,
      onb.submitted_at as onboarding_submitted_at
    FROM ats_candidate c
    INNER JOIN ats_bgv_initiation bgv ON bgv.candidate_id = c.id
    LEFT JOIN candidate_onboarding_profile onb ON onb.candidate_id = c.id
    LEFT JOIN ats_payroll_hr_validation phr ON phr.candidate_id = c.id
    WHERE c.candidate_status = 'selected'
      AND bgv.bgv_status = 'verified'
      AND onb.submitted_at IS NOT NULL
      AND (phr.id IS NULL OR phr.validation_status = 'correction_requested')
    ORDER BY bgv.completed_at DESC`
  );

  return rows as PendingCandidate[];
}

/**
 * Get candidate details for validation
 */
export async function getCandidateForValidation(candidateId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
      c.*,
      bgv.bgv_status,
      bgv.completed_at as bgv_completed_at,
      bgv.remarks as bgv_remarks,
      onb.*,
      b.branch_name,
      b.id as branch_id
    FROM ats_candidate c
    INNER JOIN ats_bgv_initiation bgv ON bgv.candidate_id = c.id
    LEFT JOIN candidate_onboarding_profile onb ON onb.candidate_id = c.id
    LEFT JOIN branch_master b ON b.branch_name = c.applied_for_branch
    WHERE c.id = ?`,
    [candidateId]
  );

  if (rows.length === 0) {
    throw new Error('Candidate not found');
  }

  return rows[0];
}

/**
 * Validate and assign salary to candidate
 *
 * Key Feature: Handles joining_date and salary_start_date separately
 * - joining_date: Required, physical day 1 in office
 * - salary_start_date: Optional, defaults to joining_date if not provided
 */
export async function validateAndAssignSalary(input: SalaryValidationInput) {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // Validate joining_date is provided
    if (!input.joining_date) {
      throw new Error('joining_date is required');
    }

    // If salary_start_date is not provided, default to joining_date
    const salaryStartDate = input.salary_start_date || input.joining_date;

    // Validate salary_start_date is not before joining_date
    if (new Date(salaryStartDate) < new Date(input.joining_date)) {
      throw new Error('salary_start_date cannot be before joining_date');
    }

    // Auto-calculate salary_components if not provided
    const salaryComponents = input.salary_components || calculateSalaryBreakdown(input.gross_salary, input.employment_type).components;

    // Check if validation already exists
    const [existing] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM ats_payroll_hr_validation WHERE candidate_id = ?`,
      [input.candidate_id]
    );

    const validationId = existing.length > 0 ? existing[0].id : randomUUID();

    // Insert or update validation record
    await connection.execute(
      `INSERT INTO ats_payroll_hr_validation (
        id, candidate_id, branch_id, payroll_hr_id, validation_status,
        employment_type, company_id, designation_id, department_id, process_id,
        cost_centre_id, reporting_manager_id, salary_slab_id, gross_salary,
        salary_components, joining_date, salary_start_date, shift_id, remarks,
        validated_at
      ) VALUES (?, ?, (SELECT b.id FROM branch_master b WHERE b.branch_name = (
        SELECT applied_for_branch FROM ats_candidate WHERE id = ?
      )), ?, 'validated', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        payroll_hr_id = VALUES(payroll_hr_id),
        validation_status = 'validated',
        employment_type = VALUES(employment_type),
        company_id = VALUES(company_id),
        designation_id = VALUES(designation_id),
        department_id = VALUES(department_id),
        process_id = VALUES(process_id),
        cost_centre_id = VALUES(cost_centre_id),
        reporting_manager_id = VALUES(reporting_manager_id),
        salary_slab_id = VALUES(salary_slab_id),
        gross_salary = VALUES(gross_salary),
        salary_components = VALUES(salary_components),
        joining_date = VALUES(joining_date),
        salary_start_date = VALUES(salary_start_date),
        shift_id = VALUES(shift_id),
        remarks = VALUES(remarks),
        validated_at = NOW()`,
      [
        validationId,
        input.candidate_id,
        input.candidate_id,
        input.payroll_hr_id,
        input.employment_type,
        input.company_id,
        input.designation_id,
        input.department_id,
        input.process_id,
        input.cost_centre_id,
        input.reporting_manager_id,
        input.salary_slab_id,
        input.gross_salary,
        JSON.stringify(salaryComponents),
        input.joining_date,
        salaryStartDate, // This ensures salary_start_date is always set
        input.shift_id || null,
        input.remarks || null,
      ]
    );

    // Update candidate status
    await connection.execute(
      `UPDATE ats_candidate
       SET candidate_status = 'pending_approval'
       WHERE id = ?`,
      [input.candidate_id]
    );

    // Log in notification table
    await connection.execute(
      `INSERT INTO ats_notification_log (
        id, candidate_id, notification_type, recipient_type, recipient_id,
        title, message, read_status
      ) VALUES (UUID(), ?, 'payroll_validation', 'hr', ?, ?, ?, 0)`,
      [
        input.candidate_id,
        input.payroll_hr_id,
        'Salary Validated',
        `Salary assigned for candidate. Joining: ${input.joining_date}, Salary Start: ${salaryStartDate}`,
      ]
    );

    await connection.commit();

    return {
      success: true,
      validationId,
      joining_date: input.joining_date,
      salary_start_date: salaryStartDate,
      message: 'Salary validation completed successfully',
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Get validation record for a candidate
 */
export async function getValidationRecord(candidateId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
      phr.*,
      c.full_name as candidate_name,
      c.mobile as candidate_mobile,
      c.email as candidate_email,
      hr.full_name as payroll_hr_name,
      comp.company_name,
      dept.department_name,
      des.designation_name,
      proc.process_name,
      cost.cost_centre_name,
      mgr.full_name as reporting_manager_name
    FROM ats_payroll_hr_validation phr
    LEFT JOIN ats_candidate c ON c.id = phr.candidate_id
    LEFT JOIN employees hr ON hr.id = phr.payroll_hr_id
    LEFT JOIN company_master comp ON comp.id = phr.company_id
    LEFT JOIN department_master dept ON dept.id = phr.department_id
    LEFT JOIN designation_master des ON des.id = phr.designation_id
    LEFT JOIN process_master proc ON proc.id = phr.process_id
    LEFT JOIN cost_centre_master cost ON cost.id = phr.cost_centre_id
    LEFT JOIN employees mgr ON mgr.id = phr.reporting_manager_id
    WHERE phr.candidate_id = ?`,
    [candidateId]
  );

  return rows.length > 0 ? rows[0] : null;
}

/**
 * Notify branch head for approval
 */
export async function notifyBranchHeadForApproval(candidateId: string, branchHeadId: string) {
  const validation = await getValidationRecord(candidateId);

  if (!validation) {
    throw new Error('Validation record not found');
  }

  // Create branch head approval record
  await db.execute(
    `INSERT INTO ats_branch_head_approval (
      id, candidate_id, payroll_validation_id, branch_head_id,
      approval_status, notified_at
    ) VALUES (UUID(), ?, ?, ?, 'pending', NOW())`,
    [candidateId, validation.id, branchHeadId]
  );

  // Send notification
  await db.execute(
    `INSERT INTO portal_notification (
      id, user_id, user_type, title, message, notification_type,
      reference_id, priority, read_status
    ) VALUES (UUID(), ?, 'employee', ?, ?, 'approval_request', ?, 'high', 0)`,
    [
      branchHeadId,
      'New Candidate Approval Request',
      `${validation.candidate_name} - ${validation.designation_name} - CTC: ₹${validation.gross_salary}`,
      candidateId,
    ]
  );

  return { success: true, message: 'Branch head notified for approval' };
}

/**
 * Get salary breakdown for display
 */
export function calculateSalaryBreakdown(grossSalary: number, employmentType: 'onroll' | 'offrole') {
  // Basic breakdown (customize based on company policy)
  const basic = Math.round(grossSalary * 0.4);
  const hra = Math.round(grossSalary * 0.3);
  const conveyance = Math.round(grossSalary * 0.1);
  const specialAllowance = grossSalary - basic - hra - conveyance;

  // Deductions (only for onroll)
  const pf = employmentType === 'onroll' ? Math.round(basic * 0.12) : 0;
  const esic = employmentType === 'onroll' ? Math.round(grossSalary * 0.0075) : 0;

  const netSalary = grossSalary - pf - esic;

  return {
    gross: grossSalary,
    components: {
      basic,
      hra,
      conveyance,
      specialAllowance,
    },
    deductions: {
      pf,
      esic,
      total: pf + esic,
    },
    net: netSalary,
  };
}
