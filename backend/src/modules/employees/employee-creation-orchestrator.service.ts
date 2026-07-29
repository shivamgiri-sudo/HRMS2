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

import { PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { randomUUID } from 'crypto';
import { db } from '../../db/mysql.js';
import { checkBgvReadiness, getBgvReadinessSummary } from '../ats/bgv-readiness.service.js';
import { PAN_REGEX, AADHAAR_REGEX } from '../ats/bgv-config.js';
import { dispatchJoinProvisioningTasks } from '../it-provisioning/it-provisioning.service.js';
import { activateIfJoiningDateReached } from './employee-activation.service.js';
import { provisionLmsIdentityForEmployee } from '../lms/lms-provisioning.service.js';
import { autoGenerateJoiningDocuments } from './employeeJoiningDocuments.service.js';
import { generateEmployeeCode } from './employee-code.service.js';
import { appendJourneyEvent } from '../employees/journeyLog.service.js';
import { logSensitiveAction } from '../../shared/auditLog.js';
import { sendPayrollHrJoiningDocNotification } from '../ats/ats.email.service.js';
import { env } from '../../config/env.js';

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
      // Identity, contact and posting all come from the candidate. The offer
      // carries none of them — it has no full_name, email, mobile or branch
      // column — so reading them off `offer` produced blank names and NULL
      // branch/process on every employee.
      `SELECT
         c.full_name,
         c.mobile,
         -- applied_for_branch / applied_for_process are VARCHAR(255) and hold a
         -- branch_master id on some rows and a branch *name* on others. Both
         -- employees.branch_id and .process_id are foreign keys, so assigning
         -- the raw value either violates the constraint or silently stores
         -- NULL. Resolve it to a real id, accepting id or name, and leave it
         -- NULL only when neither matches.
         (SELECT b.id FROM branch_master b
           WHERE b.id = c.applied_for_branch OR b.branch_name = c.applied_for_branch
           LIMIT 1) AS branch_id,
         (SELECT pm.id FROM process_master pm
           WHERE pm.id = c.applied_for_process OR pm.process_name = c.applied_for_process
           LIMIT 1) AS process_id,
         c.education,
         COALESCE(p.gender, c.gender) AS gender,
         COALESCE(p.date_of_birth, c.date_of_birth) AS date_of_birth,
         COALESCE(p.personal_email_id, c.email) AS personal_email,
         c.mobile AS personal_phone,
         p.alt_mobile_number AS alternate_mobile,
         -- PAN and Aadhaar come from the candidate only. The onboarding profile
         -- stores them masked (pan_number_masked / aadhaar_number_masked), and a
         -- masked value written into employee_statutory_info would be worse than
         -- an absent one — it looks like a real identifier and cannot be filed.
         c.pan_number,
         c.aadhar_number,
         COALESCE(p.uan_number, p.uan, c.uan_number) AS uan_number,
         COALESCE(p.present_address, c.current_address) AS current_address,
         COALESCE(p.permanent_address, c.permanent_address) AS permanent_address,
         -- The statutory forms need these; they were collected and then dropped.
         COALESCE(p.father_name, p.father_husband_name, c.father_name) AS father_name,
         p.marital_status
       FROM ats_candidate c
       LEFT JOIN candidate_onboarding_profile p ON p.candidate_id = c.id
       WHERE c.id = ? LIMIT 1`,
      [candidateId]
    );

    const candRow = candRows[0] as any;

    // The candidate is the only source of the name; `offer.full_name` does not
    // exist, so this used to split undefined and create every employee with a
    // blank first_name and a generated full_name of a single space.
    const nameParts = String(candRow?.full_name ?? '').trim().split(/\s+/).filter(Boolean);
    if (nameParts.length === 0) {
      throw new Error('Cannot create an employee: the candidate has no name.');
    }
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ') || firstName;

    const salaryStartDate = offer.date_of_salary ?? offer.date_of_joining;

    // Create employee record (active_status=0, no auth_user yet)
    await conn.execute(
      // employment_status must be written explicitly: the column defaults to
      // 'Active', and the nightly activation job only selects 'preboarding',
      // so a future-dated joiner left on the default is never activated.
      `INSERT INTO employees
         (id, employee_code, first_name, last_name, email, official_email, mobile,
          personal_email, personal_phone, alternate_mobile,
          gender, date_of_birth, father_name, marital_status,
          address1, permanent_address1,
          branch_id, process_id, department_id, designation_id,
          date_of_joining, salary_start_date, employment_type, reporting_manager_id,
          user_id, active_status, employment_status)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 'preboarding')`,
      [
        employeeId, employeeCode, firstName, lastName,
        candRow?.personal_email ?? null,
        candRow?.mobile ?? null,
        candRow?.personal_email ?? null,
        candRow?.personal_phone ?? null,
        candRow?.alternate_mobile ?? null,
        candRow?.gender ?? null,
        candRow?.date_of_birth ?? null,
        candRow?.father_name ?? null,
        candRow?.marital_status ?? null,
        candRow?.current_address ?? null,
        candRow?.permanent_address ?? null,
        candRow?.branch_id ?? null,
        candRow?.process_id ?? null,
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

    // Link the bridge. The idempotency guard above reads this row, so if the
    // update matches nothing the guard is silently defeated and a second
    // approval would create a second employee — insert the row rather than
    // letting the UPDATE no-op.
    const [bridgeUpdate] = await conn.execute<ResultSetHeader>(
      `UPDATE ats_onboarding_bridge
       SET employee_id = ?, employee_code = ?, converted_at = NOW()
       WHERE candidate_id = ?`,
      [employeeId, employeeCode, candidateId]
    );
    if (bridgeUpdate.affectedRows === 0) {
      await conn.execute(
        `INSERT INTO ats_onboarding_bridge (id, candidate_id, employee_id, employee_code, converted_at)
         VALUES (?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE employee_id = VALUES(employee_id),
                                 employee_code = VALUES(employee_code),
                                 converted_at = VALUES(converted_at)`,
        [randomUUID(), candidateId, employeeId, employeeCode]
      );
    }

    // Update offer status. The ENUM is ('draft','submitted','bh_approved',
    // 'bh_rejected') — 'approved' is not a member and was rejected outright.
    await conn.execute(
      `UPDATE ats_employment_offer SET status = 'bh_approved', approved_at = NOW() WHERE id = ?`,
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

    // Promote ATS candidate selfie to employee avatar_url/photo_url (non-blocking)
    // NOTE: selfie_url from ATS is /api/files/candidate/{uuid} — an auth-gated endpoint.
    // We only promote it if it is already a public employee-photos path; otherwise we skip
    // to avoid storing a broken URL that would fail ID card / public verify rendering.
    // TODO: implement physical file copy from candidate_file.storage_path to PHOTOS_DIR
    // so selfie can be properly promoted to the public employee-photos endpoint.
    try {
      const [selfieRows] = await db.execute<RowDataPacket[]>(
        `SELECT selfie_url FROM ats_candidate WHERE id = ? LIMIT 1`,
        [candidateId]
      );
      const selfieUrl: string | null = (selfieRows as any[])[0]?.selfie_url ?? null;
      if (selfieUrl && !selfieUrl.startsWith('/api/files/candidate/')) {
        await db.execute(
          `UPDATE employees SET photo_url = ?, avatar_url = ? WHERE id = ?`,
          [selfieUrl, selfieUrl, employeeId]
        );
        result.warnings.push('ATS selfie promoted to employee avatar');
      } else if (selfieUrl) {
        console.warn(`[EmployeeOrchestrator] Selfie promotion skipped — URL is auth-gated (${selfieUrl}). Physical file copy required.`);
        result.warnings.push('ATS selfie not promoted — requires physical file copy to employee-photos directory');
      }
    } catch (selfieErr) {
      console.warn('[EmployeeOrchestrator] Selfie promotion failed (non-blocking):', selfieErr);
    }

    // RULE 9: Provisioning failure doesn't block creation
    try {
      await dispatchJoinProvisioningTasks({
        employeeId,
        employeeCode,
        // Name and branch live on the candidate; the offer has neither column.
        employeeName: candRow?.full_name ?? null,
        branchId: candRow?.branch_id ?? null,
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

    // ── Post-code steps ────────────────────────────────────────────────────
    // These previously existed only in approveOfferLegacy (marked DO NOT USE),
    // so the live path never ran them: no joining-document pack was ever
    // created, no journey event, no audit row, and Payroll HR was never told.
    // All are fire-and-forget — the employee is already committed and must not
    // be rolled back by a downstream notification failure.

    appendJourneyEvent({
      employeeId,
      eventType: 'hiring',
      eventDate: offer.date_of_joining,
      description: `Joined through ATS as ${employeeCode}`,
      module: 'ATS',
      triggeredBy: approverId,
      metadata: { candidate_id: candidateId, offer_id: offerId },
    }).catch((err: unknown) => {
      console.error('[EmployeeOrchestrator] Journey log failed for employee', employeeId, ':', err instanceof Error ? err.message : String(err));
    });

    // No auth_user or password at this stage — IT provisioning creates the
    // account with the official email later.
    logSensitiveAction({
      actor_user_id: approverId,
      action_type: 'employee_created_preboarding',
      module_key: 'ats',
      entity_type: 'employee',
      entity_id: employeeId,
      employee_id: employeeId,
      change_summary: {
        candidate_id: candidateId,
        employee_code: employeeCode,
        active_status: 0,
        awaiting_it_provisioning: true,
      },
    }).catch((err: unknown) => {
      console.error('[EmployeeOrchestrator] Sensitive action log failed:', err instanceof Error ? err.message : String(err));
    });

    // Build the joining-document checklist and pre-filled drafts.
    autoGenerateJoiningDocuments(employeeId, candidateId, approverId).catch((err: unknown) => {
      console.error('[EmployeeOrchestrator] Auto joining document generation failed:', {
        employeeCode,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // Tell Payroll HR there is a pack to issue.
    void notifyPayrollHrToIssueJoiningDocuments({
      employeeId,
      employeeCode,
      employeeName: candRow?.full_name ?? null,
      candidateId,
      branchId: candRow?.branch_id ?? null,
    });

    // Consent and BGV problems are deliberately non-blocking, but the warnings
    // were only ever returned in the HTTP response and then discarded — a
    // "manual review required" that no system tracked and nobody was assigned.
    void raiseManualReviewWorkItem(employeeId, candidateId, employeeCode, result.warnings);

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
 * Record consent/BGV warnings as an assignable work item.
 *
 * Without this the warnings existed only in the API response for one request,
 * so an employee could be created with withdrawn DPDP consent or incomplete BGV
 * and nothing downstream would ever surface it.
 */
async function raiseManualReviewWorkItem(
  employeeId: string,
  candidateId: string,
  employeeCode: string,
  warnings: string[],
): Promise<void> {
  if (!warnings.length) return;
  try {
    await db.execute(
      `INSERT INTO work_item (id,item_type,title,description,module_code,entity_type,entity_id,assigned_to_role,priority,status,created_at)
       VALUES (UUID(),'EMPLOYEE_ONBOARDING_MANUAL_REVIEW',?,?,'employees','employee',?,'hr','high','pending',NOW())
       ON DUPLICATE KEY UPDATE updated_at = NOW()`,
      [
        `Manual review required for ${employeeCode}`,
        `Employee created with unresolved warnings (candidate ${candidateId}):\n- ${warnings.join('\n- ')}`,
        employeeId,
      ],
    );
  } catch (err: unknown) {
    console.error('[EmployeeOrchestrator] Failed to raise manual-review work item:', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Tell Payroll HR in the joiner's branch that a joining-document pack is ready
 * to issue. Entirely non-blocking: the employee already exists, and a missing
 * mailbox must never surface as a creation failure.
 */
async function notifyPayrollHrToIssueJoiningDocuments(params: {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  candidateId: string;
  branchId: string | null;
}): Promise<void> {
  try {
    const baseUrl = env.FRONTEND_URL || 'http://localhost:5173';
    const [hrRows] = await db.execute<RowDataPacket[]>(
      `SELECT u.email, u.full_name
         FROM auth_user u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN employees e ON e.user_id = u.id AND e.active_status = 1
        WHERE ur.role_key = 'payroll_hr'
          AND (? IS NULL OR e.branch_id = ?)
        LIMIT 3`,
      [params.branchId, params.branchId],
    );

    if ((hrRows as RowDataPacket[]).length === 0) {
      console.warn(`[EmployeeOrchestrator] No payroll_hr users found for branch ${params.branchId}, employee ${params.employeeCode}`);
      return;
    }

    for (const hr of hrRows as RowDataPacket[]) {
      await sendPayrollHrJoiningDocNotification({
        to: hr.email,
        hrName: hr.full_name,
        employeeCode: params.employeeCode,
        employeeName: params.employeeName,
        joiningDocUrl: `${baseUrl}/employees/${params.employeeId}/joining-documents`,
        candidateId: params.candidateId,
      }).catch((err: unknown) => console.error('[EmployeeOrchestrator] payroll-hr email failed', err));
    }
  } catch (err: unknown) {
    console.error('[EmployeeOrchestrator] Payroll HR notification failed:', {
      employeeCode: params.employeeCode,
      error: err instanceof Error ? err.message : String(err),
    });
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

  // Statutory info. The column is `aadhaar_id`, not `aadhaar_number`.
  if (panNumber || aadhaarNumber || uanNumber) {
    await conn.execute(
      `INSERT INTO employee_statutory_info
         (id, employee_id, pan_number, aadhaar_id, uan_number,
          pf_eligible, esi_eligible)
       VALUES (?, ?, ?, ?, ?, 1, 1)`,
      [randomUUID(), employeeId, panNumber, aadhaarNumber, uanNumber]
    );
  }

  // Salary snapshot. `snapshot_date` is NOT NULL with no default and must be
  // supplied; the effective column is `effective_date`, not `effective_from`.
  await conn.execute(
    `INSERT INTO employee_salary_snapshot
       (id, employee_id, snapshot_date, effective_date,
        ctc_offered, offered_ctc, basic, hra, conveyance, special_allowance)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      employeeId,
      offer.date_of_joining,
      offer.date_of_joining,
      offer.offered_ctc ?? 0,
      offer.offered_ctc ?? 0,
      offer.basic ?? 0,
      offer.hra ?? 0,
      offer.conveyance ?? 0,
      offer.special_allowance ?? 0,
    ]
  );

  // Opening leave balance. The ledger tracks allocated/used/adjusted days per
  // `balance_year` — there is no `balance` column — and the lookup column on
  // leave_type_master is `leave_code`.
  //
  // The table carries a unique key on (employee_id, leave_type, year), so a
  // retry would raise ER_DUP_ENTRY *inside the transaction* and roll the entire
  // conversion back. Leave an existing balance untouched rather than failing:
  // whatever is already allocated is more authoritative than this opening row.
  await conn.execute(
    `INSERT INTO leave_balance_ledger
       (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
     SELECT ?, ?, lt.id, YEAR(?), 1, 0, 0
       FROM leave_type_master lt
      WHERE lt.leave_code = 'CL'
      LIMIT 1
     ON DUPLICATE KEY UPDATE employee_id = leave_balance_ledger.employee_id`,
    [randomUUID(), employeeId, offer.date_of_joining]
  );
}
