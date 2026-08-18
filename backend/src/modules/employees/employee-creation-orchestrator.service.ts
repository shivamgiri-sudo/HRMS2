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
 * 10. Statutory validation (PAN + Aadhaar duplicate check, format validation)
 *
 * Rule 10 widened 2026-08-08. It matched only employee_statutory_info, which
 * covers 36 of 1,125 active employees (3.2%), and Aadhaar had no duplicate check
 * at all — so an already-employed person could be converted into a SECOND
 * employee record. That happened: MAS63086 was raised on 2026-08-05, with a full
 * joining kit and e-sign chase, for someone already working under MAS62457 whose
 * attendance runs through 2026-08-06. Both IDs are now checked against the
 * employees table too (Aadhaar 93% coverage, PAN 81%).
 *
 * Rule 7 is unchanged: mobile and email still do NOT block. Mobile is on 100% of
 * active employees but is shared within families and mistyped constantly; PAN and
 * Aadhaar identify a person, a phone number identifies a handset.
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
import { queueJoiningKit, dispatchJoiningKit } from './joiningKitDispatch.service.js';
import { generateEmployeeCode } from './employee-code.service.js';
import { appendJourneyEvent } from '../employees/journeyLog.service.js';
import { logSensitiveAction } from '../../shared/auditLog.js';
import { sendPayrollHrJoiningDocNotification } from '../ats/ats.email.service.js';
import { issueCandidatePortalAccess } from '../ats/interview.service.js';
import { env } from '../../config/env.js';
import { resolveVerifiedDob } from "../ats/ageVerification.service.js";
import { encryptPanForSync, blindIndexPan } from "../../shared/syncPiiEncryption.js";
import { registerEmployeeInCosec } from "../integrations/cosec/cosec-registration.service.js";
import { toStoredName, toStoredNameRequired } from "../../shared/nameFormat.js";

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
    //
    // Failing to COMPUTE readiness must not be more blocking than a negative
    // readiness result, which only ever warns. It was: the query inside read
    // three columns that exist in no schema, and the ER_BAD_FIELD_ERROR
    // travelled out of this transaction, past approveOffer's blocker handling
    // (which only reacts to a returned result, never a throw) and into the
    // generic 500 handler. Every branch head approving on /ats/offer-approvals
    // got "An unexpected server error occurred. Please quote reference …", with
    // the decision row already written and no employee behind it.
    //
    // The query is fixed; this catch is here so the next missing column costs a
    // warning rather than the whole hire. It cannot hide a *negative* readiness
    // verdict — that path still runs below and is still surfaced.
    try {
      const bgvReadiness = await checkBgvReadiness(candidateId, offer.designation_id);
      result.bgvStatus = getBgvReadinessSummary(bgvReadiness);

      if (!bgvReadiness.ready) {
        result.warnings.push(`BGV not complete: ${bgvReadiness.blockers.map(b => b.reason).join(', ')}`);
        // Employee creation proceeds - manual review workflow
      }

      if (bgvReadiness.manualReviewRequired) {
        result.warnings.push('BGV manual review required before activation');
      }
    } catch (bgvErr) {
      const message = bgvErr instanceof Error ? bgvErr.message : String(bgvErr);
      console.error('[EmployeeOrchestrator] BGV readiness could not be evaluated:', { candidateId, message });
      result.bgvStatus = 'unknown';
      result.warnings.push(
        `BGV readiness could not be evaluated (${message}) — verify the candidate's checks manually before activation.`,
      );
    }

    // RULE 11: an unresolved fraud alert stops the conversion.
    //
    // This is the only place any fraud signal has a consequence. Everything
    // else is advisory: the six alerts in production are all open with no
    // reviewer, overall_status='hold' is computed and read by nobody, and BGV
    // readiness above explicitly does not block. Detection without a
    // consequence is not a control.
    //
    // It gates creation rather than onboarding submission on purpose. A false
    // positive — a married-name change, an OCR misread — still lets the
    // candidate finish all ten steps, and Payroll HR clears it before the offer
    // converts. Blocking the form would strand real people with no way out.
    const fraudCheck = await validateNoOpenFraudAlerts(conn, candidateId);
    if (!fraudCheck.valid) {
      result.blockers.push(...fraudCheck.blockers);
      await conn.rollback();
      return result;
    }

    // RULE 10: Statutory Validation
    const statutoryValidation = await validateStatutoryInfo(conn, candidateId);
    if (!statutoryValidation.valid) {
      result.blockers.push(...statutoryValidation.blockers);
      await conn.rollback();
      return result;
    }

    // RULE 11: minimum employment age. A critical blocker with a rollback, the
    // same shape as the statutory check above — an underage hire is not a
    // "manual review" case, it is one that must not be created.
    const ageCheck = await resolveVerifiedDob(candidateId, offer?.date_of_joining ?? null);
    if (ageCheck.isMinor) {
      result.blockers.push({
        type: 'underage_candidate',
        reason: ageCheck.reason,
        severity: 'critical',
      });
      await conn.rollback();
      return result;
    }
    if (ageCheck.conflicts.length > 0) {
      // Sources disagree on the date of birth. Not a blocker — but HR should see
      // it rather than have one source silently win.
      result.warnings.push(
        `Date of birth differs between sources (${ageCheck.source} says ${ageCheck.dob}); verify before activation.`,
      );
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
         p.marital_status,
         -- Form 11 PF opt-out election captured during onboarding
         COALESCE(p.pf_opt_out_elected, 0) AS pf_opt_out_elected
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

    /**
     * Cost centre — captured at onboarding, and until now dropped here.
     *
     * The offer form makes "Cost Centre" a required field and stores the chosen
     * cost_centre_master.id on ats_employment_offer.cost_centre, which is then mirrored to
     * ats_payroll_hr_validation.cost_centre_id. Neither reached the employee: this INSERT
     * never named the column, and no other creation path writes it either, so
     * employees.cost_centre_id arrived only if someone opened the Edit Employee dialog by
     * hand. 185 active employees were NULL on 2026-08-15 because of this.
     *
     * Resolved rather than assigned straight through, for two reasons:
     *   - ats_employment_offer.cost_centre is VARCHAR(100) with NO foreign key, while
     *     employees.cost_centre_id is CHAR(36) WITH one. Passing an unmatched value would
     *     raise ER_NO_REFERENCED_ROW and roll back the whole conversion — turning a blank
     *     field into a candidate who cannot be onboarded at all. A cost centre that cannot
     *     be resolved must leave the employee unassigned, exactly as today, not block them.
     *   - the same defensive shape is already used above for branch_id and process_id,
     *     which hold an id on some rows and a name on others.
     *
     * The validation row is consulted as a fallback because the payroll-HR path can write
     * ats_payroll_hr_validation.cost_centre_id directly.
     */
    const rawCostCentre = offer.cost_centre ?? null;
    const [ccRows] = await conn.execute<RowDataPacket[]>(
      `SELECT cm.id
         FROM cost_centre_master cm
        WHERE cm.id = COALESCE(
                ?,
                (SELECT v.cost_centre_id FROM ats_payroll_hr_validation v
                  WHERE v.candidate_id = ? LIMIT 1)
              )
        LIMIT 1`,
      [rawCostCentre, candidateId]
    );
    const costCentreId = (ccRows[0] as { id?: string } | undefined)?.id ?? null;
    if (!costCentreId) {
      result.warnings.push(
        'No cost centre could be resolved for this employee; it must be set manually.'
      );
    }

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
          branch_id, process_id, department_id, designation_id, cost_centre_id,
          date_of_joining, salary_start_date, employment_type, reporting_manager_id,
          user_id, active_status, employment_status)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 'preboarding')`,
      [
        employeeId, employeeCode, toStoredNameRequired(firstName), toStoredNameRequired(lastName),
        candRow?.personal_email ?? null,
        candRow?.mobile ?? null,
        candRow?.personal_email ?? null,
        candRow?.personal_phone ?? null,
        candRow?.alternate_mobile ?? null,
        candRow?.gender ?? null,
        candRow?.date_of_birth ?? null,
        toStoredName(candRow?.father_name),
        candRow?.marital_status ?? null,
        candRow?.current_address ?? null,
        candRow?.permanent_address ?? null,
        candRow?.branch_id ?? null,
        candRow?.process_id ?? null,
        offer.department_id ?? null,
        offer.designation_id ?? null,
        costCentreId,
        offer.date_of_joining,
        salaryStartDate,
        offer.emp_type,
        offer.reporting_manager_id ?? null,
      ]
    );

    // Create related records (statutory, salary, nominee, leave, pf-opt-out)
    await createRelatedEmployeeRecords(conn, employeeId, candidateId, offer, candRow, approverId);

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

    // AML screening, once the employee code exists and the hire is committed.
    //
    // Deliberately here rather than during onboarding: this screens someone who
    // has been hired, and a slow or failing provider must never be able to
    // reverse that. Which designations need it is decided by the existing
    // per-role policy, so an executive role is skipped without a new rule being
    // written for it.
    await queueAmlScreening({ candidateId, employeeId, designationId: offer.designation_id ?? null })
      .catch((error) => {
        result.warnings.push('AML screening could not be queued — raise it with Payroll HR');
        console.error(`[EmployeeOrchestrator] AML screening not queued for ${employeeCode}:`, (error as Error)?.message);
      });

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

    // RULE 9: Provisioning failure doesn't block creation — fire-and-forget so
    // sequential SMTP sends inside dispatchJoinProvisioningTasks do not hold
    // the HTTP response open (was causing 30+ second timeouts for Branch Head).
    dispatchJoinProvisioningTasks({
      employeeId,
      employeeCode,
      // Name and branch live on the candidate; the offer has neither column.
      employeeName: candRow?.full_name ?? null,
      branchId: candRow?.branch_id ?? null,
      actorUserId: approverId,
      triggerEventId: offerId,
      joiningDate: offer.date_of_joining,
    }).catch((provErr: unknown) => {
      console.error('[EmployeeOrchestrator] Provisioning dispatch failed:', provErr instanceof Error ? provErr.message : provErr);
    });
    result.provisioningStatus.dispatched = true;

    // Non-blocking LMS provisioning — errors do not block employee creation
    provisionLmsIdentityForEmployee({
      employeeCode,
      createdBy: approverId ?? "system",
    }).catch((err) => {
      console.error('[EmployeeOrchestrator] LMS auto-provisioning failed:', err);
    });

    // Non-blocking COSEC biometric registration — errors do not block employee creation
    registerEmployeeInCosec(employeeId, employeeCode).catch((err) => {
      console.error('[EmployeeOrchestrator] COSEC registration failed:', err);
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

    // Build the joining-document checklist and pre-filled drafts, then
    // automatically queue and dispatch the eSign kit so the candidate receives
    // the sign link without HR needing to click "Send for eSign" manually.
    autoGenerateJoiningDocuments(employeeId, candidateId, approverId)
      .then(() => {
        // Auto-dispatch the eSign kit: fire-and-forget, blocked reason is logged.
        // `hr_fill_pending` block is expected when HR-filled docs aren't ready yet —
        // HR can re-send manually from the control room once they fill those fields.
        return queueJoiningKit({
          employeeId,
          candidateId: candidateId ?? null,
          actorUserId: approverId,
          triggerSource: 'auto_employee_creation',
        }).then(({ kitId }) => dispatchJoiningKit(kitId, approverId))
          .then(outcome => {
            console.log(`[EmployeeOrchestrator] Auto joining kit dispatch: ${outcome.status}`, {
              employeeCode,
              blockedReason: outcome.blockedReason ?? null,
            });
          });
      })
      .catch((err: unknown) => {
        console.error('[EmployeeOrchestrator] Auto joining document/kit failed:', {
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

    // Candidate-portal credentials, deliberately deferred to here rather than
    // interview selection — see issueCandidatePortalAccess for why.
    issueCandidatePortalAccess(candidateId).catch((err: unknown) => {
      console.error('[EmployeeOrchestrator] Portal access issuance failed:', {
        employeeCode,
        error: err instanceof Error ? err.message : String(err),
      });
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
    // The name comes from employees, not auth_user: auth_user has no full_name
    // column (id, email, password_hash, …), so selecting u.full_name threw
    // ER_BAD_FIELD_ERROR and no Payroll HR was ever told a pack was ready. The
    // employees row is already joined here, and it is where the name lives.
    const [hrRows] = await db.execute<RowDataPacket[]>(
      `SELECT u.email, e.full_name
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
 * Refuse conversion while a fraud alert is still open against the candidate.
 *
 * Only `critical` and `high` block. `medium` covers FRAUD_CHECK_FAILED — a
 * check that could not complete, which merits a look but is not evidence
 * against the person, and blocking on it would punish candidates for our own
 * outages.
 *
 * Clearing an alert is a reviewer action that sets its status away from 'open',
 * so a resolved case simply stops matching here. Every blocking alert type is
 * named in the message: a blocker nobody can act on gets overridden blindly.
 *
 * Exported so the gate can be tested directly; the orchestrator's own path is
 * covered by a contract test that also checks this is not wrapped in a
 * try/catch, which is how BGV readiness ended up unable to block anything.
 */
/**
 * Screen the new employee for AML, if their designation calls for it.
 *
 * Runs after the employee record exists, never inside the creation
 * transaction. AML is slow and provider-dependent, and this is screening for
 * someone already hired — letting a provider outage unwind a completed hire
 * would be the wrong trade in every case.
 *
 * The decision is not invented here. getBgvRequirementsByDesignation() already
 * returns an `aml` flag per role, already read by the readiness service, true
 * for six designations and false by default — so an executive role is skipped
 * exactly as intended, and the policy stays in one place.
 *
 * There is no AML provider configured today (nothing in org_settings matches
 * `aml` or `prescreen`). Rather than pass quietly, that records a manual_review
 * check saying so — the same rule applied to face match, because an
 * unconfigured provider must never look like a clean candidate.
 */
async function queueAmlScreening(input: {
  candidateId: string;
  employeeId: string;
  designationId: string | null;
}): Promise<void> {
  if (!input.designationId) return;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT designation_name FROM designation_master WHERE id = ? LIMIT 1`,
    [input.designationId],
  );
  const designationName = String((rows as RowDataPacket[])[0]?.designation_name ?? "").trim();
  if (!designationName) return;

  const { getBgvRequirementsByDesignation } = await import("../ats/bgv-config.js");
  if (!getBgvRequirementsByDesignation(designationName).aml) return;

  const [cfg] = await db.execute<RowDataPacket[]>(
    `SELECT setting_value FROM org_settings
      WHERE setting_key IN ('aml_api_url', 'prescreening_api_url')
        AND setting_value IS NOT NULL AND setting_value <> ''
      LIMIT 1`,
  ).catch(() => [[] as RowDataPacket[]]);

  const configured = (cfg as RowDataPacket[]).length > 0;
  try {
    await db.execute(
      `INSERT INTO candidate_bgv_check
         (id, candidate_id, check_type, provider_key, status, result_summary, result_json)
       VALUES (?, ?, 'aml', ?, 'manual_review', ?, CAST(? AS JSON))`,
      [
        randomUUID(),
        input.candidateId,
        configured ? "prescreening" : "system",
        configured
          ? `AML screening required for ${designationName} — queued.`
          : `AML screening is required for ${designationName}, but no AML provider is configured. A human must clear this.`,
        JSON.stringify({ designation: designationName, providerConfigured: configured, employeeId: input.employeeId }),
      ],
    );
  } catch (error) {
    // check_type is an ENUM and does not list 'aml' until sql/1060 is applied,
    // and production runs SKIP_MIGRATIONS=true. Under STRICT mode that INSERT
    // throws. Named explicitly rather than left as a generic SQL error,
    // because "AML silently recorded nothing" is precisely the failure this
    // whole change exists to stop.
    const message = (error as Error)?.message ?? String(error);
    if (/check_type/i.test(message) || /Data truncated/i.test(message)) {
      throw new Error(
        `AML screening could not be recorded for ${designationName}: candidate_bgv_check.check_type `
        + `does not accept 'aml' yet. Apply backend/sql/1060_bgv_check_type_aml.sql. (${message})`,
      );
    }
    throw error;
  }
}

export async function validateNoOpenFraudAlerts(
  conn: PoolConnection,
  candidateId: string,
): Promise<{ valid: boolean; blockers: Array<{ type: string; reason: string; severity: 'critical' | 'warning' }> }> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT id, alert_type, severity
       FROM candidate_fraud_alert
      WHERE candidate_id = ?
        AND LOWER(COALESCE(status, 'open')) = 'open'
        AND LOWER(COALESCE(severity, '')) IN ('critical', 'high')
      ORDER BY created_at ASC`,
    [candidateId],
  );

  // The severity filter is applied here as well as in the query. Leaving it
  // only in the SQL means the rule that decides whether someone can be hired
  // exists nowhere a reader or a test can see it, and a later edit to the
  // WHERE clause would silently widen what blocks.
  const BLOCKING_SEVERITIES = new Set(['critical', 'high']);
  const open = (rows as RowDataPacket[]).filter((row) =>
    BLOCKING_SEVERITIES.has(String(row.severity ?? '').toLowerCase()));
  if (!open.length) return { valid: true, blockers: [] };

  const types = [...new Set(open.map((row) => String(row.alert_type)))];
  return {
    valid: false,
    blockers: [{
      type: 'FRAUD_ALERT_OPEN',
      severity: 'critical',
      reason:
        `${open.length} unresolved fraud alert(s) on this candidate: ${types.join(', ')}. `
        + `Payroll HR must review and clear them before an employee record can be created.`,
    }],
  };
}

/**
 * Validate statutory info (PAN format, duplicate check)
 */
async function validateStatutoryInfo(
  conn: PoolConnection,
  candidateId: string
): Promise<{ valid: boolean; blockers: Array<{ type: string; reason: string; severity: 'critical' }> }> {
  const blockers: Array<{ type: string; reason: string; severity: 'critical' }> = [];

  // PAN and Aadhaar come from the candidate only — the same rule the employee
  // INSERT above already follows. candidate_onboarding_profile has no
  // pan_number or aadhar_number column at all; it stores pan_number_masked,
  // pan_number_hash, pan_number_encrypted and aadhaar_number_masked. So
  // COALESCE(p.pan_number, ...) was not a fallback, it was
  // ER_BAD_FIELD_ERROR: Unknown column 'p.pan_number' in 'field list' on every
  // approval — the same 500 as c.fresher, one query further along the path.
  //
  // Reading the masked column instead would be worse than reading nothing: a
  // masked PAN passes the format check, gets stored as though it were real, and
  // cannot be filed with anyone.
  const [candRows] = await conn.execute<RowDataPacket[]>(
    `SELECT c.pan_number, c.aadhar_number
     FROM ats_candidate c
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
      //
      // This used to read employee_statutory_info ALONE, and that made it a
      // guard in name only. Measured 2026-08-08: the table holds 33,436 rows,
      // but only 36 of the 1,125 ACTIVE employees join to one carrying a PAN —
      // 3.2% coverage, so 97% of the workforce could be re-onboarded without
      // tripping it. The employees table itself is the populated source:
      // pan_number on 915 of 1,125 active (81%), aadhaar_number on 1,043 (93%).
      // Both are consulted now; statutory_info stays because the few rows it
      // does have are still true.
      const existing = await findActiveEmployeeByStatutoryId(conn, 'pan', panNumber);
      if (existing) {
        blockers.push({
          type: 'duplicate_pan',
          reason: `PAN ${panNumber} already registered to ACTIVE employee ${existing.employee_code} (${existing.full_name}). This candidate is already employed — converting them would create a second employee record for one person. If this is a genuine rehire, close the existing employment first.`,
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
  } else if (aadhaarNumber) {
    // Aadhaar had NO duplicate check at all — only a format test. It is the
    // better key of the two here: 93% of active employees carry one against
    // PAN's 81%. This is the check that would have stopped MAS63086, a full
    // joining kit and e-sign chase raised on 2026-08-05 for someone already
    // working under MAS62457 with attendance through 2026-08-06.
    const existing = await findActiveEmployeeByStatutoryId(conn, 'aadhaar', aadhaarNumber);
    if (existing) {
      blockers.push({
        type: 'duplicate_aadhaar',
        reason: `Aadhaar already registered to ACTIVE employee ${existing.employee_code} (${existing.full_name}). This candidate is already employed — converting them would create a second employee record for one person. If this is a genuine rehire, close the existing employment first.`,
        severity: 'critical',
      });
    }
  }

  return { valid: blockers.length === 0, blockers };
}

/**
 * The employee, if any, currently ACTIVE under this PAN or Aadhaar.
 *
 * Keyed on active_status = 1 deliberately, so a genuine rehire still converts:
 * a resigned or previously-onboarding record is active_status = 0 and does not
 * block. It also means a half-finished conversion cannot block its own retry —
 * a freshly created employee is still `preboarding` / active_status = 0.
 *
 * Reads the candidate's raw value against the employees table and against
 * employee_statutory_info. Deliberately NOT pan_blind_index: that column is
 * present but empty on every one of the 1,125 active employees, so joining on it
 * would silently match nothing and reinstate the hole this closes.
 */
async function findActiveEmployeeByStatutoryId(
  conn: PoolConnection,
  kind: 'pan' | 'aadhaar',
  value: string
): Promise<{ employee_code: string; full_name: string } | null> {
  const employeeColumn = kind === 'pan' ? 'e.pan_number' : 'e.aadhaar_number';
  // employee_statutory_info spells it aadhaar_id, not aadhaar_number — the two
  // tables disagree, and guessing the employees-table name here would throw
  // ER_BAD_FIELD_ERROR on every conversion. Verified against live schema.
  const statutoryColumn = kind === 'pan' ? 's.pan_number' : 's.aadhaar_id';

  try {
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT e.employee_code,
              TRIM(CONCAT_WS(' ', e.first_name, e.last_name)) AS full_name
         FROM employees e
    LEFT JOIN employee_statutory_info s ON s.employee_id = e.id
        WHERE e.active_status = 1
          AND ( (${employeeColumn} IS NOT NULL AND ${employeeColumn} <> '' AND ${employeeColumn} = ?)
             OR (${statutoryColumn} IS NOT NULL AND ${statutoryColumn} <> '' AND ${statutoryColumn} = ?) )
        LIMIT 1`,
      [value, value]
    );
    const hit = rows[0] as { employee_code?: string; full_name?: string } | undefined;
    return hit?.employee_code
      ? { employee_code: String(hit.employee_code), full_name: String(hit.full_name ?? '').trim() }
      : null;
  } catch (error) {
    // employee_statutory_info.aadhaar_number may not exist on every environment.
    // A duplicate check that throws must not fail OPEN — that is how the
    // original guard came to pass everything — so fall back to the employees
    // table, which is the source with real coverage, and only give up if that
    // also fails.
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT employee_code, TRIM(CONCAT_WS(' ', first_name, last_name)) AS full_name
         FROM employees
        WHERE active_status = 1
          AND ${employeeColumn.replace('e.', '')} IS NOT NULL
          AND ${employeeColumn.replace('e.', '')} <> ''
          AND ${employeeColumn.replace('e.', '')} = ?
        LIMIT 1`,
      [value]
    );
    const hit = rows[0] as { employee_code?: string; full_name?: string } | undefined;
    return hit?.employee_code
      ? { employee_code: String(hit.employee_code), full_name: String(hit.full_name ?? '').trim() }
      : null;
  }
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
  candRow: any,
  actorUserId: string
): Promise<void> {
  const panNumber = String(candRow?.pan_number ?? '').trim() || null;
  const aadhaarNumber = String(candRow?.aadhar_number ?? '').trim() || null;
  const uanNumber = String(candRow?.uan_number ?? '').trim() || null;

  // Statutory info. The column is `aadhaar_id`, not `aadhaar_number`.
  if (panNumber || aadhaarNumber || uanNumber) {
    await conn.execute(
      // pan_number_encrypted / pan_blind_index are written alongside the plaintext. This is
      // the writer for EVERY new employee, so it is the one that decides whether the table's
      // encryption coverage holds or decays from here. Plaintext stays until the readers are
      // migrated — the duplicate-employee guard below still matches on s.pan_number.
      // panNumber is already String(...).trim() (line above), which is exactly the
      // normalisation scripts/statutory-identifier-encrypt-backfill.ts applies, so a row
      // written here and a row written by that backfill land in the same index space.
      `INSERT INTO employee_statutory_info
         (id, employee_id, pan_number, pan_number_encrypted, pan_blind_index, aadhaar_id, uan_number,
          pf_eligible, esi_eligible)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`,
      [
        randomUUID(), employeeId, panNumber,
        encryptPanForSync(panNumber, "employee-creation"),
        blindIndexPan(panNumber, "employee-creation"),
        aadhaarNumber, uanNumber,
      ]
    );
  }

  // Salary snapshot. `snapshot_date` is NOT NULL with no default and must be
  // supplied; the effective column is `effective_date`, not `effective_from`.
  await conn.execute(
    // gross and net_in_hand were omitted, and every column on this table
    // DEFAULTs to 0 — so the snapshot recorded a gross of 0.00 while basic, HRA
    // and CTC came through correctly. The employment contract reads
    // salary.monthly_gross from here, so the agreement emailed to the candidate
    // stated their remuneration as "0 (Zero)". 16,136 of 33,443 snapshots carry
    // a zero gross.
    //
    // Every figure below already exists on the offer that was just approved;
    // none is derived or assumed. Note the two renames: the offer calls them
    // pf_employee/pf_employer, this table calls them epf_*.
    `INSERT INTO employee_salary_snapshot
       (id, employee_id, snapshot_date, effective_date,
        ctc_offered, offered_ctc, basic, hra, conveyance, da,
        special_allowance, other_allowance, bonus, gross, net_in_hand,
        epf_employee, epf_employer, esic_employee, esic_employer,
        professional_tax, gratuity, admin_charges, pli,
        pay_mode, salary_payment_mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      offer.da ?? 0,
      offer.special_allowance ?? 0,
      offer.other_allowance ?? 0,
      offer.bonus ?? 0,
      offer.gross ?? 0,
      offer.net_in_hand ?? 0,
      offer.pf_employee ?? 0,
      offer.pf_employer ?? 0,
      offer.esic_employee ?? 0,
      offer.esic_employer ?? 0,
      offer.professional_tax ?? 0,
      offer.gratuity ?? 0,
      offer.admin_charges ?? 0,
      offer.pli ?? 0,
      offer.pay_mode ?? null,
      offer.salary_payment_mode ?? null,
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

  // Form 11 PF opt-out: if the candidate elected PF opt-out during onboarding
  // (Form 11 — only valid for first employment / never-a-PF-member declarations),
  // create a pre-approved employee_statutory_override so payroll does not deduct
  // PF from the very first run. Without this, the onboarding election is silently
  // dropped and PF is deducted until a separate manual request is raised and
  // approved through the Payroll HO queue.
  //
  // INSERT IGNORE: safe to retry — the unique key uq_emp_override_active on
  // (employee_id, override_type, status) prevents a second approved row.
  if (Boolean(candRow?.pf_opt_out_elected)) {
    const joiningDate: Date = offer.date_of_joining instanceof Date
      ? offer.date_of_joining
      : new Date(String(offer.date_of_joining));
    const effectiveFromMonth = `${joiningDate.getFullYear()}-${String(joiningDate.getMonth() + 1).padStart(2, '0')}`;

    await conn.execute(
      `INSERT IGNORE INTO employee_statutory_override
         (id, employee_id, override_type, status,
          requested_by, declaration_text,
          approved_by, approved_at, effective_from_month, audit_note)
       VALUES (UUID(), ?, 'pf_opt_out', 'approved',
               ?, 'PF opt-out elected by employee on Form 11 during onboarding',
               ?, NOW(), ?,
               'Auto-approved from Form 11 election — no Payroll HO review required for first-employment declarations')`,
      [employeeId, actorUserId, actorUserId, effectiveFromMonth]
    );
  }

  // PF/ESIC opt-out elected by Payroll HR at offer creation (owner ruling 2026-08-17: the
  // candidate does not make this decision — Payroll HR does, when the offer is drafted).
  // Mirrors the Form 11 block above but sources from ats_employment_offer.pf_opt_out /
  // esic_opt_out rather than the candidate's own onboarding profile, and names the offer as
  // its own approval record: the offer already went through Branch Head approval before this
  // function runs, so a second approval through the Payroll HO queue would be redundant, not
  // additional scrutiny — the decision was already reviewed.
  //
  // INSERT IGNORE: safe to retry — the unique key uq_emp_override_active on
  // (employee_id, override_type, status) prevents a second approved row, and also means this
  // is naturally idempotent alongside the Form 11 block above if both happened to be true for
  // the same employee (first write for a given override_type wins; the two paths never disagree
  // about approval, only about provenance).
  const offerOptOuts: Array<{ flag: unknown; overrideType: 'pf_opt_out' | 'esic_opt_out'; label: string }> = [
    { flag: offer.pf_opt_out, overrideType: 'pf_opt_out', label: 'PF' },
    { flag: offer.esic_opt_out, overrideType: 'esic_opt_out', label: 'ESIC' },
  ];
  for (const { flag, overrideType, label } of offerOptOuts) {
    if (!Boolean(Number(flag))) continue;
    const joiningDate: Date = offer.date_of_joining instanceof Date
      ? offer.date_of_joining
      : new Date(String(offer.date_of_joining));
    const effectiveFromMonth = `${joiningDate.getFullYear()}-${String(joiningDate.getMonth() + 1).padStart(2, '0')}`;

    await conn.execute(
      `INSERT IGNORE INTO employee_statutory_override
         (id, employee_id, override_type, status,
          requested_by, declaration_text,
          approved_by, approved_at, effective_from_month, audit_note)
       VALUES (UUID(), ?, ?, 'approved',
               ?, ?,
               ?, NOW(), ?, ?)`,
      [
        employeeId, overrideType,
        actorUserId, `${label} opt-out elected by Payroll HR at offer creation`,
        actorUserId, effectiveFromMonth,
        `Auto-approved from offer ${offer.id ?? ''} — Branch Head already approved this offer, ` +
          `which included the ${label} opt-out election; no separate Payroll HO review required.`,
      ]
    );
  }
}
