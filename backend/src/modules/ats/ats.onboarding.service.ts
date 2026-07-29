import { randomUUID, createHash } from 'crypto';
import { RowDataPacket, PoolConnection } from 'mysql2/promise';
import { db } from '../../db/mysql.js';
import { env } from '../../config/env.js';
import { hasScopedAccess } from '../../shared/scopeAccess.js';
import { calculateSalary, SalaryComponents } from './salary.calculator.js';
import {
  sendOnboardingTokenEmail,
  sendOfferReviewEmail,
  sendWelcomeEmail,
  sendRejectedEmail,
} from './ats.email.service.js';
import { createTemporaryPasswordCredential } from '../auth/tempPassword.service.js';
import { getIstDateString } from '../../utils/dateUtils.js';
import { providerFactory } from '../communication/providers/provider.factory.js';

// ── PII Helpers ───────────────────────────────────────────────────────────────

function hashPii(value: unknown): string | null {
  if (value == null || value === '') return null;
  return createHash('sha256').update(String(value)).digest('hex');
}

function maskAadhaar(value: unknown): string | null {
  if (value == null || value === '') return null;
  const s = String(value).replace(/\D/g, '');
  return s.length >= 4 ? `XXXX-XXXX-${s.slice(-4)}` : 'XXXX-XXXX-XXXX';
}

function maskPan(value: unknown): string | null {
  if (value == null || value === '') return null;
  const s = String(value).toUpperCase();
  // PAN format ABCDE1234F — mask middle 5 digits: AB***1234F
  return s.length === 10 ? `${s.slice(0, 2)}XXXXX${s.slice(7)}` : 'XXXXXXXXXX';
}

function maskBankAccount(value: unknown): string | null {
  if (value == null || value === '') return null;
  const s = String(value).replace(/\s/g, '');
  return s.length >= 4 ? `XXXXXX${s.slice(-4)}` : 'XXXXXXXXXX';
}

async function withDeliveryTimeout<T>(
  task: Promise<T>,
  label: string,
  timeoutMs = 8000,
): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          console.error(`[onboarding] ${label} timed out after ${timeoutMs}ms`);
          resolve(null);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeOfferRoleType(value: unknown): 'Analyst' | 'SupportStaff' {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (normalized === 'supportstaff' || normalized === 'support') return 'SupportStaff';
  return 'Analyst';
}

// ── Token Generation ──────────────────────────────────────────────────────────

export async function sendOnboardingToken(
  candidateId: string,
  requestedBy: string,
): Promise<{ token: string; expiresAt: Date }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.id, c.full_name, c.email, c.mobile, c.applied_for_branch,
            b.id AS resolved_branch_id, b.branch_name
     FROM ats_candidate c
     LEFT JOIN branch_master b
       ON b.id = c.applied_for_branch
       OR b.branch_name = c.applied_for_branch
       OR b.branch_code = c.applied_for_branch
     WHERE c.id = ? AND c.active_status = 1`,
    [candidateId],
  );
  if (!rows.length) throw Object.assign(new Error('Candidate not found'), { statusCode: 404 });
  const cand = rows[0];

  const rawToken = randomUUID() + '-' + randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await db.execute(
    `INSERT INTO ats_onboarding_request (id, candidate_id, branch_id, requested_by, status)
     VALUES (UUID(), ?, ?, ?, 'pending')
     ON DUPLICATE KEY UPDATE status = IF(status = 'rejected', 'pending', status), updated_at = NOW()`,
    [candidateId, cand.resolved_branch_id ?? null, requestedBy],
  );

  await db.execute(
    `INSERT INTO ats_onboarding_bridge
       (id, candidate_id, bridge_date, status, onboarding_token, onboarding_token_expires_at, created_by)
     VALUES (UUID(), ?, CURDATE(), 'pending', ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       onboarding_token = VALUES(onboarding_token),
       onboarding_token_expires_at = VALUES(onboarding_token_expires_at)`,
    [candidateId, rawToken, expiresAt, requestedBy],
  );

  await db.execute(
    `UPDATE ats_candidate SET profile_status = 'onboarding_sent' WHERE id = ?`,
    [candidateId],
  );
  await db.execute(
    `INSERT INTO ats_candidate_stage_log
       (id, candidate_id, from_stage, to_stage, remarks, updated_by)
     VALUES (UUID(), ?, 'Selected', 'Onboarding Link Sent', 'Secure onboarding link issued', ?)`,
    [candidateId, requestedBy],
  );

  const baseUrl = env.FRONTEND_URL || 'http://localhost:5173';
  const onboardingLink = `${baseUrl}/onboard-full?token=${rawToken}`;

  if (cand.email) {
    try {
      await withDeliveryTimeout(
        sendOnboardingTokenEmail({
          candidateId,
          to: cand.email,
          candidateName: cand.full_name,
          onboardingLink,
        }),
        `email delivery for ${candidateId}`,
      );
    } catch (emailErr) {
      console.error('[onboarding] email delivery failed for', candidateId, emailErr instanceof Error ? emailErr.message : String(emailErr));
    }
  }

  // SMS/WhatsApp fallback for candidates without email (walk-ins)
  if (cand.mobile) {
    const smsBody =
      `Hi ${cand.full_name}, you have been selected! Complete your onboarding at: ${onboardingLink} (valid 7 days)`;
    try {
      const smsProvider = providerFactory.getProvider('sms');
      await withDeliveryTimeout(
        smsProvider.send(cand.mobile, 'Onboarding Link', smsBody),
        `SMS delivery for ${candidateId}`,
      );
    } catch (smsErr) {
      // SMS failure must not block token generation — log and continue
      console.error('[onboarding] SMS delivery failed for', candidateId, smsErr instanceof Error ? smsErr.message : String(smsErr));
    }
    // WhatsApp delivery attempt (best-effort)
    try {
      const waProvider = providerFactory.getProvider('whatsapp');
      await withDeliveryTimeout(
        waProvider.send(cand.mobile, 'Onboarding Link', smsBody),
        `WhatsApp delivery for ${candidateId}`,
      );
    } catch (waErr) {
      console.error('[onboarding] WhatsApp delivery failed for', candidateId, waErr instanceof Error ? waErr.message : String(waErr));
    }
  }

  return { token: rawToken, expiresAt };
}

// ── Token Validation ──────────────────────────────────────────────────────────

export async function validateToken(token: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT b.candidate_id, b.onboarding_token_expires_at,
            c.full_name, c.mobile, c.email, c.applied_for_branch,
            c.applied_for_process, c.profile_status,
            br.branch_name
     FROM ats_onboarding_bridge b
     JOIN ats_candidate c ON c.id = b.candidate_id
     LEFT JOIN branch_master br
       ON br.id = c.applied_for_branch
       OR br.branch_name = c.applied_for_branch
       OR br.branch_code = c.applied_for_branch
     WHERE b.onboarding_token = ?`,
    [token],
  );
  if (!rows.length) throw Object.assign(new Error('Invalid token'), { statusCode: 400 });
  const row = rows[0];
  // mysql2 returns DATETIME columns as JS Date objects (UTC epoch); compare directly with Date.now()
  const expiresMs = row.onboarding_token_expires_at instanceof Date
    ? row.onboarding_token_expires_at.getTime()
    : new Date(row.onboarding_token_expires_at as string).getTime();
  if (expiresMs < Date.now()) {
    throw Object.assign(new Error('Token expired'), { statusCode: 410 });
  }
  return row;
}

// ── Profile Submission ────────────────────────────────────────────────────────

export async function submitProfile(token: string, profile: Record<string, unknown>) {
  const tokenData = await validateToken(token);
  const candidateId: string = tokenData.candidate_id;

  // CI-001 fix: store masked display values and SHA-256 hashes; never write raw PII to ats_candidate
  const aadharMasked = maskAadhaar(profile.aadhar_number);
  const aadharHash = hashPii(profile.aadhar_number);
  const panMasked = maskPan(profile.pan_number);
  const panHash = hashPii(profile.pan_number);
  const bankMasked = maskBankAccount(profile.bank_account_no);
  const bankHash = hashPii(profile.bank_account_no);

  await db.execute(
    `UPDATE ats_candidate SET
       father_name = ?, current_address = ?, permanent_address = ?,
       date_of_birth = ?,
       aadhar_number = ?, aadhar_number_hash = ?, pan_number = ?, pan_number_hash = ?, uan_number = ?,
       bank_account_no = ?, bank_account_no_hash = ?, bank_ifsc = ?, bank_name = ?,
       emergency_contact_name = ?, emergency_contact_mobile = ?,
       resume_url = ?, selfie_url = ?,
       profile_status = 'profile_submitted', profile_submitted_at = NOW(),
       updated_at = NOW()
     WHERE id = ?`,
    [
      profile.father_name ?? null,
      profile.current_address ?? null,
      profile.permanent_address ?? null,
      profile.date_of_birth ?? null,
      aadharMasked,
      aadharHash,
      panMasked,
      panHash,
      profile.uan_number ?? null,
      bankMasked,
      bankHash,
      profile.bank_ifsc ?? null,
      profile.bank_name ?? null,
      profile.emergency_contact_name ?? null,
      profile.emergency_contact_mobile ?? null,
      profile.resume_url ?? null,
      profile.selfie_url ?? null,
      candidateId,
    ],
  );

  await db.execute(
    `UPDATE ats_onboarding_request SET status = 'in_progress', updated_at = NOW()
     WHERE candidate_id = ?`,
    [candidateId],
  );

  return { candidateId };
}

// ── HR: List Onboarding Requests ──────────────────────────────────────────────

export async function listOnboardingRequests(scopeFilter: { sql: string; params: unknown[] }) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT r.id, r.status, r.created_at,
            c.id AS candidate_id, c.candidate_code, c.full_name, c.mobile,
            c.email, c.profile_status, c.applied_for_process,
            r.branch_id,
            COALESCE(b.branch_name, c.branch_display_name, c.branch_text, c.applied_for_branch) AS branch_name,
            o.id AS offer_id, o.status AS offer_status, o.offered_ctc,
            ob.employee_id, e.employee_code
     FROM ats_onboarding_request r
     JOIN ats_candidate c ON c.id = r.candidate_id
     LEFT JOIN branch_master b ON b.id = r.branch_id
     LEFT JOIN ats_employment_offer o ON o.onboarding_request_id = r.id
     LEFT JOIN ats_onboarding_bridge ob ON ob.candidate_id = c.id
     LEFT JOIN employees e ON e.id = ob.employee_id
     WHERE (${scopeFilter.sql})
     ORDER BY r.created_at DESC`,
    scopeFilter.params,
  );
  return rows;
}

// ── HR: Save / Submit Employment Offer ───────────────────────────────────────

export async function saveOffer(
  requestId: string,
  offerData: Record<string, unknown>,
  createdBy: string,
  submit: boolean,
) {
  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM ats_employment_offer WHERE onboarding_request_id = ?`,
    [requestId],
  );

  const [reqRows] = await db.execute<RowDataPacket[]>(
    `SELECT r.candidate_id, c.full_name, c.email, r.branch_id
     FROM ats_onboarding_request r JOIN ats_candidate c ON c.id = r.candidate_id
     WHERE r.id = ?`,
    [requestId],
  );
  if (!reqRows.length) throw Object.assign(new Error('Request not found'), { statusCode: 404 });
  const req = reqRows[0];

  // Fetch branch head email separately to avoid complex role joins
  let bhEmail: string | null = null;
  if (submit && req.branch_id) {
    const [bhRows] = await db.execute<RowDataPacket[]>(
      `SELECT u.email FROM auth_user u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN employees e ON e.user_id = u.id AND e.active_status = 1
       WHERE ur.role_key = 'branch_head' AND e.branch_id = ?
       LIMIT 1`,
      [req.branch_id],
    );
    bhEmail = (bhRows as RowDataPacket[])[0]?.email ?? null;
  }

  const [bandRows] = await db.execute<RowDataPacket[]>(
    `SELECT basic_pct, hra_pct FROM salary_band_master WHERE band_code = ?`,
    [offerData.salary_band ?? 'D'],
  ).catch(() => [[] as RowDataPacket[]]);
  const band = (bandRows as RowDataPacket[])[0] ?? { basic_pct: 40, hra_pct: 40 };
  const components: SalaryComponents = calculateSalary(
    Number(offerData.offered_ctc),
    Number(band.basic_pct),
    Number(band.hra_pct),
    false,
  );

  const status = submit ? 'submitted' : 'draft';
  const submittedAt = submit ? new Date() : null;

  const offerId: string = (existing as RowDataPacket[]).length
    ? (existing as RowDataPacket[])[0].id
    : randomUUID();

  if ((existing as RowDataPacket[]).length) {
    await db.execute(
      `UPDATE ats_employment_offer SET
         emp_type = ?, date_of_joining = ?, date_of_salary = ?,
         profile = ?, department_id = ?, designation_id = ?,
         cost_centre = ?, reporting_manager_id = ?, role_type = ?,
         salary_band = ?, offered_ctc = ?, basic = ?, hra = ?, conveyance = ?,
         da = ?, special_allowance = ?, other_allowance = ?, bonus = ?, gross = ?,
         pf_employee = ?, pf_employer = ?, esic_employee = ?, esic_employer = ?,
         professional_tax = ?, gratuity = ?, admin_charges = ?, net_in_hand = ?,
         status = ?, submitted_at = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        offerData.emp_type ?? 'OnRoll', offerData.date_of_joining, offerData.date_of_salary ?? null,
        offerData.profile ?? null, offerData.department_id ?? null, offerData.designation_id ?? null,
        offerData.cost_centre ?? null, offerData.reporting_manager_id ?? null, normalizeOfferRoleType(offerData.role_type),
        offerData.salary_band ?? null,
        components.offered_ctc, components.basic, components.hra, components.conveyance,
        components.da, components.special_allowance, components.other_allowance, components.bonus, components.gross,
        components.pf_employee, components.pf_employer, components.esic_employee, components.esic_employer,
        components.professional_tax, components.gratuity, components.admin_charges, components.net_in_hand,
        status, submittedAt,
        offerId,
      ],
    );
  } else {
    await db.execute(
      `INSERT INTO ats_employment_offer
         (id, onboarding_request_id, candidate_id,
          emp_type, date_of_joining, date_of_salary, profile,
          department_id, designation_id, cost_centre, reporting_manager_id, role_type,
          salary_band, offered_ctc, basic, hra, conveyance, da, special_allowance,
          other_allowance, bonus, gross, pf_employee, pf_employer, esic_employee, esic_employer,
          professional_tax, gratuity, admin_charges, net_in_hand,
          status, created_by, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        offerId, requestId, req.candidate_id,
        offerData.emp_type ?? 'OnRoll', offerData.date_of_joining, offerData.date_of_salary ?? null,
        offerData.profile ?? null, offerData.department_id ?? null, offerData.designation_id ?? null,
        offerData.cost_centre ?? null, offerData.reporting_manager_id ?? null, normalizeOfferRoleType(offerData.role_type),
        offerData.salary_band ?? null,
        components.offered_ctc, components.basic, components.hra, components.conveyance,
        components.da, components.special_allowance, components.other_allowance, components.bonus, components.gross,
        components.pf_employee, components.pf_employer, components.esic_employee, components.esic_employer,
        components.professional_tax, components.gratuity, components.admin_charges, components.net_in_hand,
        status, createdBy, submittedAt,
      ],
    );
  }

  if (submit) {
    await db.execute(
      `UPDATE ats_onboarding_request SET status = 'offer_submitted', updated_at = NOW() WHERE id = ?`,
      [requestId],
    );
    await db.execute(
      `INSERT INTO ats_candidate_stage_log
         (id, candidate_id, from_stage, to_stage, remarks, updated_by)
       VALUES (UUID(), ?, 'Profile Submitted', 'Offer Submitted', 'Employment offer submitted for approval', ?)`,
      [req.candidate_id, createdBy],
    );
    if (bhEmail) {
      await sendOfferReviewEmail({
        candidateId: req.candidate_id,
        to: bhEmail,
        candidateName: req.full_name,
        offerSummary: `CTC: ₹${components.offered_ctc * 12}/year | Joining: ${offerData.date_of_joining}`,
      });
    }
  }

  return { offerId, components };
}

// ── Branch Head: List Pending Approvals ───────────────────────────────────────

export async function listPendingApprovals(scopeFilter: { sql: string; params: unknown[] }) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT o.id AS offer_id, o.offered_ctc, o.gross, o.net_in_hand,
            o.emp_type, o.date_of_joining, o.salary_band, o.status AS offer_status,
            r.id AS request_id, r.branch_id,
            c.id AS candidate_id, c.candidate_code, c.full_name, c.email, c.mobile,
            c.father_name, c.date_of_birth, c.profile_status,
            b.branch_name
     FROM ats_employment_offer o
     JOIN ats_onboarding_request r ON r.id = o.onboarding_request_id
     JOIN ats_candidate c ON c.id = r.candidate_id
     LEFT JOIN branch_master b ON b.id = r.branch_id
     WHERE o.status = 'submitted'
       AND (${scopeFilter.sql})
     ORDER BY o.submitted_at ASC`,
    scopeFilter.params,
  );
  return rows;
}

// ── Branch Head: Approve ──────────────────────────────────────────────────────

import { createEmployeeFromCandidate } from '../employees/employee-creation-orchestrator.service.js';

export async function approveOffer(offerId: string, approverId: string, remarks?: string) {
  // CHANGED: Delegate to Employee Creation Orchestrator (Phase 2)
  const [offerRows] = await db.execute<RowDataPacket[]>(
    `SELECT candidate_id FROM ats_employment_offer WHERE id = ? LIMIT 1`,
    [offerId]
  );

  if (offerRows.length === 0) {
    throw Object.assign(new Error('Offer not found'), { statusCode: 404 });
  }

  const candidateId = (offerRows[0] as any).candidate_id;

  // Use orchestrator with all business rules
  const result = await createEmployeeFromCandidate({
    candidateId,
    offerId,
    approverId,
  });

  if (!result.success) {
    throw Object.assign(
      new Error(`Employee creation failed: ${result.blockers.map(b => b.reason).join(', ')}`),
      {
        statusCode: 400,
        blockers: result.blockers,
        warnings: result.warnings,
      }
    );
  }

  // Return result with metadata
  return {
    employeeId: result.employeeId,
    employeeCode: result.employeeCode,
    alreadyExisted: result.alreadyExisted,
    warnings: result.warnings,
    bgvStatus: result.bgvStatus,
    provisioningDispatched: result.provisioningStatus.dispatched,
  };
}

// approveOfferLegacy removed. It was marked DO NOT USE and unrouted, yet it
// held the only copy of the post-employee-code steps (joining-document pack,
// journey event, audit row, Payroll HR notification). Those now live in
// employee-creation-orchestrator.service.ts, which is the single live path.

// ── Branch Head: Reject ───────────────────────────────────────────────────────

export async function rejectOffer(offerId: string, approverId: string, remarks: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT o.onboarding_request_id, r.candidate_id,
            c.full_name, c.email, c.applied_for_branch, c.applied_for_process
     FROM ats_employment_offer o
     JOIN ats_onboarding_request r ON r.id = o.onboarding_request_id
     JOIN ats_candidate c ON c.id = r.candidate_id
     WHERE o.id = ? OR o.onboarding_request_id = ?
     ORDER BY CASE WHEN o.id = ? THEN 0 ELSE 1 END
     LIMIT 1`,
    [offerId, offerId, offerId],
  );
  if (!rows.length) throw Object.assign(new Error('Offer not found'), { statusCode: 404 });
  const row = (rows as RowDataPacket[])[0];

  const allowed = await hasScopedAccess(
    approverId,
    ['branch_head'],
    { branchId: row.applied_for_branch, processId: row.applied_for_process },
    { allowAdminBypass: true },
  );
  if (!allowed) throw Object.assign(new Error('Access denied'), { statusCode: 403 });

  await db.execute(
    `INSERT INTO ats_offer_approval (id, offer_id, approver_id, action, remarks)
     VALUES (UUID(), ?, ?, 'rejected', ?)`,
    [offerId, approverId, remarks],
  );

  await db.execute(
    `UPDATE ats_onboarding_request SET status = 'rejected', updated_at = NOW() WHERE id = ?`,
    [row.onboarding_request_id],
  );

  // Mark offer as rejected so HR can revise and resubmit
  await db.execute(
    `UPDATE ats_employment_offer SET status = 'bh_rejected', updated_at = NOW() WHERE id = ?`,
    [offerId],
  );
  await db.execute(
    `INSERT INTO ats_candidate_stage_log
       (id, candidate_id, from_stage, to_stage, remarks, updated_by)
     VALUES (UUID(), ?, 'Offer Submitted', 'Offer Rejected', ?, ?)`,
    [row.candidate_id, remarks, approverId],
  );

  // Fire-and-forget: notify candidate and HR of rejection
  if (row.email) {
    sendRejectedEmail({
      candidateId: row.candidate_id,
      to: row.email,
      candidateName: row.full_name ?? 'Candidate',
      branchName: row.applied_for_branch ?? '',
    }).catch((err: unknown) => console.error('[rejectOffer] email failed:', err));
  }
}
