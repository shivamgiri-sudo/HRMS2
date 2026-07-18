/**
 * Employee Creation Orchestrator
 *
 * Single source of truth for creating employees from candidates
 * Enforces all 10 business rules confirmed 2026-07-16
 *
 * Business Rules:
 * 1. Role-based BGV validation (manual review workflow)
 * 2. Salary lock validation (Payroll HR + Branch Head + Exceptions)
 * 3. Consent validation (recruitment + onboarding + bgv)
 * 4. Idempotency (return existing if bridge exists)
 * 5. Employee code gaps allowed
 * 6. Reporting manager validation
 * 7. No duplicate mobile/email blocking
 * 8. Full transaction rollback on failure
 * 9. Provisioning failure doesn't block creation
 * 10. Statutory validation (PAN duplicate check, format validation)
 */

import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'crypto';
import { db } from '../../db/mysql.js';
import { checkBgvReadiness, getBgvReadinessSummary } from '../ats/bgv-readiness.service.js';
import { PAN_REGEX, AADHAAR_REGEX } from '../ats/bgv-config.js';
import { dispatchJoinProvisioningTasks } from '../it-provisioning/it-provisioning.service.js';
import { activateIfJoiningDateReached } from './employee-activation.service.js';
import { provisionLmsIdentityForEmployee } from '../lms/lms-provisioning.service.js';

export interface EmployeeCreationInput {
  candidateId: string;
  offerId: string;
  approverId: string;
}

export interface EmployeeCreationResult {
  success: boolean;
  employeeId: string | null;
  employeeCode: string | null;
  alreadyExisted: boolean;
  blockers: Array<{
    type: string;
    reason: string;
    severity: 'critical' | 'warning';
  }>;
  warnings: string[];
  bgvStatus: string;
  provisioningStatus: {
    dispatched: boolean;
    tasksFailed: string[];
  };
}

/**
 * Main orchestrator function - creates employee from approved offer
 */
export async function createEmployeeFromCandidate(
  input: EmployeeCreationInput
): Promise<EmployeeCreationResult> {
  const { candidateId, offerId, approverId } = input;

  const result: EmployeeCreationResult = {
    success: false,
    employeeId: null,
    employeeCode: null,
    alreadyExisted: false,
    blockers: [],
    warnings: [],
    bgvStatus: 'pending',
    provisioningStatus: {
      dispatched: false,
      tasksFailed: [],
    },
  };

  const conn: PoolConnection = await db.getConnection();

  try {
    await conn.beginTransaction();

    // RULE 4: Idempotency - Check if employee already exists
    const [bridgeRows] = await conn.execute<RowDataPacket[]>(
      `SELECT employee_id, employee_code FROM ats_onboarding_bridge
       WHERE candidate_id = ? FOR UPDATE`,
      [candidateId]
    );

    if (bridgeRows.length > 0 && (bridgeRows[0] as any).employee_id) {
      const existing = bridgeRows[0] as any;
      result.success = true;
      result.employeeId = existing.employee_id;
      result.employeeCode = existing.employee_code;
      result.alreadyExisted = true;
      result.warnings.push('Employee already created for this candidate');

      await conn.commit();
      return result;
    }

    // Get offer details
    const [offerRows] = await conn.execute<RowDataPacket[]>(
      `SELECT * FROM ats_employment_offer WHERE id = ? FOR UPDATE`,
      [offerId]
    );

    if (offerRows.length === 0) {
      throw new Error('Offer not found');
    }

    const offer = offerRows[0] as any;

    // RULE 2: Salary Lock Validation
    const salaryValidation = await validateSalaryLock(conn, candidateId, offerId);
    if (!salaryValidation.locked) {
      result.blockers.push({
        type: 'salary_not_locked',
        reason: salaryValidation.reason,
        severity: 'critical',
      });
      await conn.rollback();
      return result;
    }

    // RULE 3: Consent Validation
    const consentValidation = await validateConsents(conn, candidateId);
    if (!consentValidation.valid) {
      result.blockers.push(...consentValidation.blockers);
      // ALLOW creation but flag for manual review
      result.warnings.push('Consent issues detected - manual review required');
    }

    // RULE 1: BGV Validation (manual review workflow - doesn't block)
    const bgvReadiness = await checkBgvReadiness(candidateId, offer.designation_id);
    result.bgvStatus = getBgvReadinessSummary(bgvReadiness);

    if (!bgvReadiness.ready) {
      result.warnings.push(`BGV not complete: ${bgvReadiness.blockers.map(b => b.reason).join(', ')}`);
      // Employee creation proceeds - manual review workflow
    }

    if (bgvReadiness.manualReviewRequired) {
      result.warnings.push('BGV manual review required before activation');
    }

    // RULE 10: Statutory Validation
    const statutoryValidation = await validateStatutoryInfo(conn, candidateId);
    if (!statutoryValidation.valid) {
      result.blockers.push(...statutoryValidation.blockers);
      await conn.rollback();
      return result;
    }

    // RULE 6: Reporting Manager Validation
    if (offer.reporting_manager_id) {
      const managerValid = await validateReportingManager(conn, offer.reporting_manager_id);
      if (!managerValid) {
        result.blockers.push({
          type: 'invalid_manager',
          reason: 'Reporting manager does not exist or is inactive',
          severity: 'critical',
        });
        await conn.rollback();
        return result;
      }
    }

    // RULE 5 & 8: Generate employee code (gaps allowed, transaction rollback on failure)
    const employeeCode = await generateEmployeeCode(conn, offer.emp_type);
    const employeeId = randomUUID();

    // Get candidate data
    const [candRows] = await conn.execute<RowDataPacket[]>(
      `SELECT
         COALESCE(p.gender, c.gender) AS gender,
         COALESCE(p.date_of_birth, c.date_of_birth) AS date_of_birth,
         COALESCE(p.personal_email_id, c.email) AS personal_email,
         c.mobile AS personal_phone,
         p.alt_mobile_number AS alternate_mobile,
         COALESCE(p.pan_number, c.pan_number) AS pan_number,
         COALESCE(p.aadhar_number, c.aadhar_number) AS aadhar_number,
         COALESCE(p.uan_number, c.uan_number) AS uan_number,
         p.present_address AS current_address
       FROM ats_candidate c
       LEFT JOIN candidate_onboarding_profile p ON p.candidate_id = c.id
       WHERE c.id = ? LIMIT 1`,
      [candidateId]
    );

    const candRow = candRows[0] as any;

    const nameParts = (offer.full_name ?? '').trim().split(/\s+/);
    const firstName = nameParts[0] ?? '';
    const lastName = nameParts.slice(1).join(' ') || firstName;

    const salaryStartDate = offer.date_of_salary ?? offer.date_of_joining;

    // Create employee record (active_status=0, no auth_user yet)
    await conn.execute(
      `INSERT INTO employees
         (id, employee_code, first_name, last_name, email, official_email, mobile,
          personal_email, personal_phone, alternate_mobile,
          gender, date_of_birth, address1, city, country,
          branch_id, process_id, department_id, designation_id,
          date_of_joining, salary_start_date, employment_type, reporting_manager_id,
          user_id, active_status)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0)`,
      [
        employeeId, employeeCode, firstName, lastName,
        candRow?.personal_email ?? offer.email,
        offer.mobile,
        candRow?.personal_email ?? offer.email,
        candRow?.personal_phone ?? null,
        candRow?.alternate_mobile ?? null,
        candRow?.gender ?? null,
        candRow?.date_of_birth ?? null,
        candRow?.current_address ?? null,
        null,
        null,
        offer.resolved_branch_id ?? null,
        offer.resolved_process_id ?? null,
        offer.department_id ?? null,
        offer.designation_id ?? null,
        offer.date_of_joining,
        salaryStartDate,
        offer.emp_type,
        offer.reporting_manager_id ?? null,
      ]
    );

    // Create related records (statutory, salary, nominee, leave)
    await createRelatedEmployeeRecords(conn, employeeId, candidateId, offer, candRow);

    // Update bridge
    await conn.execute(
      `UPDATE ats_onboarding_bridge
       SET employee_id = ?, employee_code = ?, converted_at = NOW()
       WHERE candidate_id = ?`,
      [employeeId, employeeCode, candidateId]
    );

    // Update offer status
    await conn.execute(
      `UPDATE ats_employment_offer SET status = 'approved', approved_at = NOW() WHERE id = ?`,
      [offerId]
    );

    // Update candidate status
    await conn.execute(
      `UPDATE ats_candidate SET profile_status = 'onboarded', employee_code = ? WHERE id = ?`,
      [employeeCode, candidateId]
    );

    await conn.commit();

    result.success = true;
    result.employeeId = employeeId;
    result.employeeCode = employeeCode;

    // RULE 9: Provisioning failure doesn't block creation
    try {
      await dispatchJoinProvisioningTasks({
        employeeId,
        employeeCode,
        employeeName: offer.full_name,
        branchId: offer.resolved_branch_id ?? offer.applied_for_branch,
        actorUserId: approverId,
        triggerEventId: offerId,
        joiningDate: offer.date_of_joining,
      });
      result.provisioningStatus.dispatched = true;
    } catch (provErr) {
      console.error('[EmployeeOrchestrator] Provisioning dispatch failed:', provErr);
      result.warnings.push('Provisioning tasks failed to dispatch - will retry automatically');
      result.provisioningStatus.dispatched = false;
      // Employee creation still successful
    }

    // Non-blocking LMS provisioning — errors do not block employee creation
    provisionLmsIdentityForEmployee({
      employeeCode,
      createdBy: approverId ?? "system",
    }).catch((err) => {
      console.error('[EmployeeOrchestrator] LMS auto-provisioning failed:', err);
    });

    // Real-time activation: if joining date is today or past, activate immediately
    if (result.employeeId && offer.date_of_joining) {
      try {
        const activated = await activateIfJoiningDateReached(
          result.employeeId,
          offer.date_of_joining,
          approverId
        );
        if (activated) {
          result.warnings.push('Employee activated immediately - joining date is today');
        }
      } catch (activationErr) {
        // Non-blocking - cron will handle it
        console.warn('[EmployeeOrchestrator] Real-time activation failed, cron will handle:', activationErr);
      }
    }

    return result;

  } catch (err) {
    // RULE 8: Full rollback on failure
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Validate salary is locked and ready
 */
async function validateSalaryLock(
  conn: PoolConnection,
  candidateId: string,
  offerId: string
): Promise<{ locked: boolean; reason: string }> {
  // Check Branch Head approval (joined via payroll_validation → candidate)
  const [bhApproval] = await conn.execute<RowDataPacket[]>(
    `SELECT bha.approval_status
     FROM ats_branch_head_approval bha
     JOIN ats_payroll_hr_validation pv ON pv.id = bha.payroll_validation_id
     WHERE pv.candidate_id = ?
     ORDER BY bha.approved_at DESC LIMIT 1`,
    [candidateId]
  );

  if (bhApproval.length === 0 || (bhApproval[0] as any).approval_status !== 'approved') {
    return { locked: false, reason: 'Branch Head approval pending' };
  }

  // Check Payroll HR validation
  const [payrollValidation] = await conn.execute<RowDataPacket[]>(
    `SELECT validation_status FROM ats_payroll_hr_validation
     WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1`,
    [candidateId]
  );

  if (payrollValidation.length === 0 || (payrollValidation[0] as any).validation_status !== 'validated') {
    return { locked: false, reason: 'Payroll HR validation pending' };
  }

  // Check salary exceptions
  const [exceptions] = await conn.execute<RowDataPacket[]>(
    `SELECT status FROM salary_exception_proposal
     WHERE candidate_id = ? AND status = 'pending' LIMIT 1`,
    [candidateId]
  );

  if (exceptions.length > 0) {
    return { locked: false, reason: 'Salary exception approval pending' };
  }

  return { locked: true, reason: 'Salary locked and approved' };
}

/**
 * Validate mandatory consents
 */
async function validateConsents(
  conn: PoolConnection,
  candidateId: string
): Promise<{ valid: boolean; blockers: Array<{ type: string; reason: string; severity: 'critical' | 'warning' }> }> {
  const blockers: Array<{ type: string; reason: string; severity: 'critical' | 'warning' }> = [];

  const requiredConsents = ['recruitment', 'onboarding', 'bgv'];

  for (const purposeCode of requiredConsents) {
    // Use dpdp_consent_register (actual table — confirmed 2026-07-16)
    const [consentRows] = await conn.execute<RowDataPacket[]>(
      `SELECT consent_status FROM dpdp_consent_register
       WHERE candidate_id = ? AND purpose_code = ?
       ORDER BY updated_at DESC LIMIT 1`,
      [candidateId, purposeCode]
    );

    if (consentRows.length === 0) {
      blockers.push({
        type: `consent_${purposeCode}_missing`,
        reason: `${purposeCode} consent not recorded`,
        severity: 'warning',
      });
    } else if ((consentRows[0] as any).consent_status === 'withdrawn') {
      blockers.push({
        type: `consent_${purposeCode}_withdrawn`,
        reason: `${purposeCode} consent was withdrawn - manual review required`,
        severity: 'warning',
      });
    }
  }

  return { valid: blockers.filter(b => b.severity === 'critical').length === 0, blockers };
}

/**
 * Validate statutory info (PAN format, duplicate check)
 */
async function validateStatutoryInfo(
  conn: PoolConnection,
  candidateId: string
): Promise<{ valid: boolean; blockers: Array<{ type: string; reason: string; severity: 'critical' }> }> {
  const blockers: Array<{ type: string; reason: string; severity: 'critical' }> = [];

  const [candRows] = await conn.execute<RowDataPacket[]>(
    `SELECT
       COALESCE(p.pan_number, c.pan_number) AS pan_number,
       COALESCE(p.aadhar_number, c.aadhar_number) AS aadhar_number
     FROM ats_candidate c
     LEFT JOIN candidate_onboarding_profile p ON p.candidate_id = c.id
     WHERE c.id = ? LIMIT 1`,
    [candidateId]
  );

  const panNumber = (candRows[0] as any)?.pan_number?.trim();
  const aadhaarNumber = (candRows[0] as any)?.aadhar_number?.trim();

  // Validate PAN format
  if (panNumber) {
    if (!PAN_REGEX.test(panNumber)) {
      blockers.push({
        type: 'invalid_pan_format',
        reason: `Invalid PAN format: ${panNumber}`,
        severity: 'critical',
      });
    } else {
      // Check PAN duplicate (RULE 10)
      const [dupPan] = await conn.execute<RowDataPacket[]>(
        `SELECT e.employee_code, e.first_name, e.last_name
         FROM employees e
         JOIN employee_statutory_info s ON s.employee_id = e.id
         WHERE s.pan_number = ? AND e.active_status = 1 LIMIT 1`,
        [panNumber]
      );

      if (dupPan.length > 0) {
        const existing = dupPan[0] as any;
        blockers.push({
          type: 'duplicate_pan',
          reason: `PAN ${panNumber} already registered to employee ${existing.employee_code} (${existing.first_name} ${existing.last_name})`,
          severity: 'critical',
        });
      }
    }
  }

  // Validate Aadhaar format
  if (aadhaarNumber && !AADHAAR_REGEX.test(aadhaarNumber)) {
    blockers.push({
      type: 'invalid_aadhaar_format',
      reason: `Invalid Aadhaar format: must be 12 digits`,
      severity: 'critical',
    });
  }

  return { valid: blockers.length === 0, blockers };
}

/**
 * Validate reporting manager exists and is active
 */
async function validateReportingManager(
  conn: PoolConnection,
  managerId: string
): Promise<boolean> {
  const [managerRows] = await conn.execute<RowDataPacket[]>(
    `SELECT active_status FROM employees WHERE id = ? LIMIT 1`,
    [managerId]
  );

  return managerRows.length > 0 && (managerRows[0] as any).active_status === 1;
}

/**
 * Generate employee code with atomic sequence
 */
async function generateEmployeeCode(conn: PoolConnection, empType: string): Promise<string> {
  const isTrainee = empType === 'Trainee' || empType === 'OffRoll';

  // Get next sequence
  const [maxRows] = await conn.execute<RowDataPacket[]>(
    `SELECT GREATEST(
       IFNULL((SELECT MAX(CAST(SUBSTRING(employee_code,4) AS UNSIGNED)) FROM employees WHERE employee_code REGEXP '^MAS[0-9]+$'),0),
       IFNULL((SELECT MAX(CAST(SUBSTRING(employee_code,4) AS UNSIGNED)) FROM employees WHERE employee_code REGEXP '^IDC[0-9]+$'),0),
       IFNULL((SELECT MAX(CAST(SUBSTRING(employee_code,1,CHAR_LENGTH(employee_code)-1) AS UNSIGNED)) FROM employees WHERE employee_code REGEXP '^[0-9]+C$'),0),
       IFNULL((SELECT MAX(CAST(SUBSTRING(employee_code,4,CHAR_LENGTH(employee_code)-4) AS UNSIGNED)) FROM employees WHERE employee_code REGEXP '^IDC[0-9]+C$'),0)
     ) AS global_max`
  );

  const nextSeq = ((maxRows[0] as any)?.global_max ?? 0) + 1;

  // Advance sequence table
  await conn.execute(
    `UPDATE employee_code_sequence SET current_sequence = ?, last_generated_at = NOW()
     WHERE current_sequence < ?`,
    [nextSeq, nextSeq]
  );

  // Format code (trainee = ####C, regular = MAS####)
  if (isTrainee) {
    return `${nextSeq}C`;
  } else {
    return `MAS${nextSeq}`;
  }
}

/**
 * Create related employee records (statutory, salary, nominee, leave)
 */
async function createRelatedEmployeeRecords(
  conn: PoolConnection,
  employeeId: string,
  candidateId: string,
  offer: any,
  candRow: any
): Promise<void> {
  const panNumber = String(candRow?.pan_number ?? '').trim() || null;
  const aadhaarNumber = String(candRow?.aadhar_number ?? '').trim() || null;
  const uanNumber = String(candRow?.uan_number ?? '').trim() || null;

  // Statutory info
  if (panNumber || aadhaarNumber || uanNumber) {
    await conn.execute(
      `INSERT INTO employee_statutory_info
         (id, employee_id, pan_number, aadhaar_number, uan_number,
          pf_eligible, esi_eligible)
       VALUES (?, ?, ?, ?, ?, 1, 1)`,
      [randomUUID(), employeeId, panNumber, aadhaarNumber, uanNumber]
    );
  }

  // Salary snapshot
  await conn.execute(
    `INSERT INTO employee_salary_snapshot
       (id, employee_id, ctc_offered, basic, hra, conveyance, special_allowance, effective_from)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      employeeId,
      offer.offered_ctc ?? 0,
      offer.basic ?? 0,
      offer.hra ?? 0,
      offer.conveyance ?? 0,
      offer.special_allowance ?? 0,
      offer.date_of_joining,
    ]
  );

  // Leave balance initialization (basic 1 day casual leave for starting)
  await conn.execute(
    `INSERT INTO leave_balance_ledger
       (id, employee_id, leave_type_id, balance, created_at)
     VALUES (?, ?, (SELECT id FROM leave_type_master WHERE leave_type_code = 'CL' LIMIT 1), 1, NOW())`,
    [randomUUID(), employeeId]
  );
}
