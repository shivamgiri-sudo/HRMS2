import { db } from '../../db/mysql.js';
import { RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'crypto';
import { sendBranchHeadApprovalEmail } from './ats.email.service.js';

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
  gross_salary?: number;
  requested_gross_salary?: number;
  salary_exception_reason?: string;
  salary_components?: unknown; // Optional - can be auto-calculated
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
      COALESCE(c.role_applied, c.applied_for_process) AS applied_for_role,
      c.applied_for_branch,
      c.branch_display_name,
      COALESCE(bgv.verification_status, CASE WHEN COALESCE(bgv_details.verified_count, 0) > 0 OR COALESCE(bgv_checks.verified_count, 0) > 0 THEN 'verified' END) AS bgv_status,
      COALESCE(bgv.completed_at, bgv_details.completed_at, bgv_checks.verified_at) as bgv_completed_at,
      c.education,
      c.experience AS years_of_experience,
      onb.submitted_at as onboarding_submitted_at
    FROM ats_candidate c
    LEFT JOIN ats_bgv_verification bgv ON bgv.candidate_id = c.id
    LEFT JOIN (
      SELECT
        candidate_id,
        SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) AS verified_count,
        SUM(CASE WHEN status IN ('failed', 'manual_review') THEN 1 ELSE 0 END) AS blocker_count,
        MAX(completed_at) AS completed_at
      FROM ats_bgv_verification_details
      GROUP BY candidate_id
    ) bgv_details ON bgv_details.candidate_id = c.id
    LEFT JOIN (
      SELECT
        candidate_id,
        SUM(CASE WHEN status IN ('verified', 'waived') THEN 1 ELSE 0 END) AS verified_count,
        SUM(CASE WHEN status IN ('mismatch', 'failed', 'manual_review') THEN 1 ELSE 0 END) AS blocker_count,
        MAX(verified_at) AS verified_at
      FROM candidate_bgv_check
      GROUP BY candidate_id
    ) bgv_checks ON bgv_checks.candidate_id = c.id
    LEFT JOIN candidate_bgv_consent bgv_consent
      ON bgv_consent.candidate_id = c.id AND bgv_consent.consent_status = 'granted'
    LEFT JOIN candidate_onboarding_profile onb ON onb.candidate_id = c.id
    LEFT JOIN ats_payroll_hr_validation phr ON phr.candidate_id = c.id
    WHERE LOWER(COALESCE(c.final_decision, c.status, c.current_stage, '')) = 'selected'
      AND bgv_consent.id IS NOT NULL
      AND (
        bgv.verification_status = 'verified'
        OR COALESCE(bgv_details.verified_count, 0) > 0
        OR COALESCE(bgv_checks.verified_count, 0) > 0
      )
      AND COALESCE(bgv_details.blocker_count, 0) = 0
      AND COALESCE(bgv_checks.blocker_count, 0) = 0
      AND onb.submitted_at IS NOT NULL
      AND (phr.id IS NULL OR phr.validation_status = 'correction_requested')
    ORDER BY COALESCE(bgv.completed_at, bgv_details.completed_at, bgv_checks.verified_at, onb.submitted_at) DESC`
  );

  return rows as PendingCandidate[];
}

/**
 * Get candidates whose payroll HR validation has been approved/validated
 */
export async function getValidatedCandidates(): Promise<PendingCandidate[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
      c.id as candidate_id,
      c.full_name,
      c.mobile,
      c.email,
      COALESCE(c.role_applied, c.applied_for_process) AS applied_for_role,
      c.applied_for_branch,
      c.branch_display_name,
      phr.validation_status,
      phr.validated_at,
      phr.joining_date,
      phr.gross_salary
    FROM ats_payroll_hr_validation phr
    JOIN ats_candidate c ON c.id = phr.candidate_id
    WHERE phr.validation_status IN ('validated', 'approved')
    ORDER BY phr.validated_at DESC`
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
      COALESCE(bgv.verification_status, CASE WHEN COALESCE(bgv_details.verified_count, 0) > 0 OR COALESCE(bgv_checks.verified_count, 0) > 0 THEN 'verified' END) AS bgv_status,
      COALESCE(bgv.completed_at, bgv_details.completed_at, bgv_checks.verified_at) as bgv_completed_at,
      COALESCE(bgv_details.remarks, bgv_checks.remarks) as bgv_remarks,
      onb.*,
      b.branch_name,
      b.id as branch_id
    FROM ats_candidate c
    LEFT JOIN ats_bgv_verification bgv ON bgv.candidate_id = c.id
    LEFT JOIN (
      SELECT
        candidate_id,
        SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) AS verified_count,
        SUM(CASE WHEN status IN ('failed', 'manual_review') THEN 1 ELSE 0 END) AS blocker_count,
        MAX(completed_at) AS completed_at,
        GROUP_CONCAT(NULLIF(remarks, '') SEPARATOR '; ') AS remarks
      FROM ats_bgv_verification_details
      GROUP BY candidate_id
    ) bgv_details ON bgv_details.candidate_id = c.id
    LEFT JOIN (
      SELECT
        candidate_id,
        SUM(CASE WHEN status IN ('verified', 'waived') THEN 1 ELSE 0 END) AS verified_count,
        SUM(CASE WHEN status IN ('mismatch', 'failed', 'manual_review') THEN 1 ELSE 0 END) AS blocker_count,
        MAX(verified_at) AS verified_at,
        GROUP_CONCAT(NULLIF(review_remarks, '') SEPARATOR '; ') AS remarks
      FROM candidate_bgv_check
      GROUP BY candidate_id
    ) bgv_checks ON bgv_checks.candidate_id = c.id
    LEFT JOIN candidate_bgv_consent bgv_consent
      ON bgv_consent.candidate_id = c.id AND bgv_consent.consent_status = 'granted'
    LEFT JOIN candidate_onboarding_profile onb ON onb.candidate_id = c.id
    LEFT JOIN branch_master b ON b.branch_name = c.applied_for_branch
    WHERE c.id = ?
      AND bgv_consent.id IS NOT NULL
      AND (
        bgv.verification_status = 'verified'
        OR COALESCE(bgv_details.verified_count, 0) > 0
        OR COALESCE(bgv_checks.verified_count, 0) > 0
      )
      AND COALESCE(bgv_details.blocker_count, 0) = 0
      AND COALESCE(bgv_checks.blocker_count, 0) = 0`,
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
    let branchHeadNotice: {
      candidateId: string;
      to: string;
      branchHeadName: string;
      candidateName: string;
      branchDisplayName: string;
      roleOffered: string;
      proposedSalary: string;
      joiningDate: string;
    } | null = null;

    // Validate salary_start_date is not before joining_date
    if (new Date(salaryStartDate) < new Date(input.joining_date)) {
      throw new Error('salary_start_date cannot be before joining_date');
    }

    const [slabRowsRaw] = await connection.execute(
      `SELECT id, range_from, range_to, active_status FROM salary_slab_master WHERE id = ? LIMIT 1`,
      [input.salary_slab_id]
    );
    const slabRows = slabRowsRaw as RowDataPacket[];
    const slab = slabRows[0];
    if (!slab || Number(slab.active_status) !== 1) {
      throw new Error('salary slab must be active');
    }

    const [processRowsRaw] = await connection.execute(
      `SELECT id FROM process_master WHERE id = ? AND active_status = 1 LIMIT 1`,
      [input.process_id]
    );
    const processRows = processRowsRaw as RowDataPacket[];
    if (!processRows.length) throw new Error('process_id must exist');

    const [branchRowsRaw] = await connection.execute(
      `SELECT b.id AS branch_id
         FROM ats_candidate c
         LEFT JOIN branch_master b ON b.id = c.applied_for_branch OR b.branch_name = c.applied_for_branch OR b.branch_code = c.applied_for_branch
        WHERE c.id = ?
        LIMIT 1`,
      [input.candidate_id]
    );
    const branchRows = branchRowsRaw as RowDataPacket[];
    const branchId = branchRows[0]?.branch_id;
    if (!branchId) throw new Error('branch_id must exist');

    const [managerRowsRaw] = await connection.execute(
      `SELECT id FROM employees WHERE id = ? AND active_status = 1 LIMIT 1`,
      [input.reporting_manager_id]
    );
    const managerRows = managerRowsRaw as RowDataPacket[];
    if (!managerRows.length) throw new Error('reporting_manager_id must be active employee');

    const slabGross = Number(slab.range_to);
    const requestedGross = Number(input.requested_gross_salary || 0);
    const isException = requestedGross > 0 && requestedGross !== slabGross;
    if (isException && !String(input.salary_exception_reason || '').trim()) {
      throw new Error('salary proposal must have reason');
    }

    const effectiveGross = isException ? requestedGross : slabGross;
    const salaryBreakdown = calculateSalaryBreakdown(effectiveGross, input.employment_type);
    const salaryComponents = input.salary_components || salaryBreakdown.components;
    const persistedSalaryComponents =
      typeof salaryComponents === 'object' && salaryComponents !== null ? salaryComponents : {};

    // Check if validation already exists
    const [existingRaw] = await connection.execute(
      `SELECT id FROM ats_payroll_hr_validation WHERE candidate_id = ?`,
      [input.candidate_id]
    );
    const existing = existingRaw as RowDataPacket[];

    const validationId = existing.length > 0 ? existing[0].id : randomUUID();

    // Insert or update validation record
    await connection.execute(
      `INSERT INTO ats_payroll_hr_validation (
        id, candidate_id, branch_id, payroll_hr_id, validation_status,
        employment_type, company_id, designation_id, department_id, process_id,
        cost_centre_id, reporting_manager_id, salary_slab_id, gross_salary,
        salary_components, joining_date, salary_start_date, shift_id, remarks,
        validated_at
      ) VALUES (?, ?, ?, ?, 'validated', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
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
        branchId,
        input.payroll_hr_id,
        input.employment_type,
        input.company_id,
        input.designation_id,
        input.department_id,
        input.process_id,
        input.cost_centre_id,
        input.reporting_manager_id,
        input.salary_slab_id,
        effectiveGross,
        JSON.stringify({ ...persistedSalaryComponents, slabGross, requestedGross: isException ? requestedGross : null, exceptionReason: input.salary_exception_reason || null }),
        input.joining_date,
        salaryStartDate, // This ensures salary_start_date is always set
        input.shift_id || null,
        input.remarks || null,
      ]
    );

    await connection.execute(
      `INSERT INTO ats_onboarding_request (id, candidate_id, branch_id, requested_by, status)
       VALUES (UUID(), ?, ?, ?, 'offer_submitted')
       ON DUPLICATE KEY UPDATE
         branch_id = VALUES(branch_id),
         requested_by = VALUES(requested_by),
         status = IF(status = 'approved', status, 'offer_submitted'),
         updated_at = NOW()`,
      [input.candidate_id, branchId, input.payroll_hr_id]
    );

    const [requestRowsRaw] = await connection.execute(
      `SELECT id FROM ats_onboarding_request WHERE candidate_id = ? LIMIT 1`,
      [input.candidate_id]
    );
    const requestRows = requestRowsRaw as RowDataPacket[];
    const onboardingRequestId = requestRows[0]?.id;
    if (!onboardingRequestId) throw new Error('onboarding request could not be created');

    const offerId = randomUUID();
    const empType = input.employment_type === 'offrole' ? 'OffRoll' : 'OnRoll';
    await connection.execute(
      `INSERT INTO ats_employment_offer
         (id, onboarding_request_id, candidate_id,
          emp_type, date_of_joining, date_of_salary, profile,
          department_id, designation_id, cost_centre, reporting_manager_id, role_type,
          salary_band, offered_ctc, basic, hra, conveyance, da, special_allowance,
          other_allowance, bonus, gross, pf_employee, pf_employer, esic_employee, esic_employer,
          professional_tax, gratuity, admin_charges, net_in_hand,
          status, created_by, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Analyst', ?, ?, ?, ?, ?, 0, ?, 0, 0, ?, ?, ?, ?, ?, 0, 0, 0, ?, 'submitted', ?, NOW())
       ON DUPLICATE KEY UPDATE
          emp_type = VALUES(emp_type),
          date_of_joining = VALUES(date_of_joining),
          date_of_salary = VALUES(date_of_salary),
          profile = VALUES(profile),
          department_id = VALUES(department_id),
          designation_id = VALUES(designation_id),
          cost_centre = VALUES(cost_centre),
          reporting_manager_id = VALUES(reporting_manager_id),
          salary_band = VALUES(salary_band),
          offered_ctc = VALUES(offered_ctc),
          basic = VALUES(basic),
          hra = VALUES(hra),
          conveyance = VALUES(conveyance),
          special_allowance = VALUES(special_allowance),
          gross = VALUES(gross),
          pf_employee = VALUES(pf_employee),
          pf_employer = VALUES(pf_employer),
          esic_employee = VALUES(esic_employee),
          esic_employer = VALUES(esic_employer),
          net_in_hand = VALUES(net_in_hand),
          status = 'submitted',
          created_by = VALUES(created_by),
          submitted_at = NOW(),
          updated_at = NOW()`,
      [
        offerId,
        onboardingRequestId,
        input.candidate_id,
        empType,
        input.joining_date,
        salaryStartDate,
        input.employment_type,
        input.department_id,
        input.designation_id,
        input.cost_centre_id,
        input.reporting_manager_id,
        input.salary_slab_id,
        effectiveGross,
        salaryBreakdown.components.basic,
        salaryBreakdown.components.hra,
        salaryBreakdown.components.conveyance,
        salaryBreakdown.components.specialAllowance,
        effectiveGross,
        salaryBreakdown.deductions.pf,
        salaryBreakdown.deductions.pf,
        salaryBreakdown.deductions.esic,
        salaryBreakdown.deductions.esic,
        salaryBreakdown.net,
        input.payroll_hr_id,
      ]
    );

    // Update candidate status
    await connection.execute(
      `UPDATE ats_candidate
       SET candidate_status = 'pending_approval',
           current_stage = 'payroll_validated',
           updated_at = NOW()
       WHERE id = ?`,
      [input.candidate_id]
    );

    await connection.execute(
      `INSERT INTO ats_branch_head_approval
         (id, candidate_id, payroll_validation_id, branch_head_id, approval_status, notified_at)
       VALUES (UUID(), ?, ?, NULL, 'pending', NOW())
       ON DUPLICATE KEY UPDATE approval_status = IF(approval_status = 'rejected', 'pending', approval_status), notified_at = NOW(), updated_at = NOW()`,
      [input.candidate_id, validationId]
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
        isException
          ? `Salary exception proposed for Branch Head review. Slab: ${slabGross}, Requested: ${requestedGross}. Joining: ${input.joining_date}, Salary Start: ${salaryStartDate}`
          : `Salary slab assigned for candidate. Joining: ${input.joining_date}, Salary Start: ${salaryStartDate}`,
      ]
    );

    const [branchHeadRowsRaw] = await connection.execute(
      `SELECT
          u.email,
          COALESCE(e.full_name, u.email) AS branch_head_name,
          c.full_name AS candidate_name,
          COALESCE(b.branch_name, c.branch_display_name, c.applied_for_branch) AS branch_display_name,
          COALESCE(pm.process_name, c.applied_for_process, c.role_applied, 'Candidate') AS role_offered
       FROM ats_candidate c
       JOIN branch_master b ON b.id = ?
       JOIN branch_head_assignments bha ON bha.branch_name IN (b.branch_name, b.branch_code)
       JOIN employees e ON e.id = bha.branch_head_id AND e.active_status = 1
       JOIN auth_user u ON u.id = e.user_id
       LEFT JOIN process_master pm
         ON pm.id = c.applied_for_process
         OR pm.process_name = c.applied_for_process
         OR pm.process_code = c.applied_for_process
       WHERE c.id = ?
         AND bha.is_active = TRUE
         AND u.email IS NOT NULL
       ORDER BY bha.assigned_at DESC
       LIMIT 1`,
      [branchId, input.candidate_id]
    );
    const branchHeadRows = branchHeadRowsRaw as RowDataPacket[];
    const branchHead = branchHeadRows[0];
    if (branchHead?.email) {
      branchHeadNotice = {
        candidateId: input.candidate_id,
        to: String(branchHead.email),
        branchHeadName: String(branchHead.branch_head_name ?? 'Branch Head'),
        candidateName: String(branchHead.candidate_name ?? 'Candidate'),
        branchDisplayName: String(branchHead.branch_display_name ?? 'Branch'),
        roleOffered: String(branchHead.role_offered ?? 'Candidate'),
        proposedSalary: `${effectiveGross}`,
        joiningDate: input.joining_date,
      };
    }

    await connection.commit();

    if (branchHeadNotice) {
      sendBranchHeadApprovalEmail(branchHeadNotice).catch((err: unknown) => {
        console.error('[payroll-hr] branch head approval email failed:', err instanceof Error ? err.message : String(err));
      });
    }

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
