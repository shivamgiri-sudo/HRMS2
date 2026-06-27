import { randomUUID, createHash } from 'crypto';
import { RowDataPacket, PoolConnection } from 'mysql2/promise';
import { db } from '../../db/mysql.js';
import { env } from '../../config/env.js';
import { hasScopedAccess } from '../../shared/scopeAccess.js';
import { calculateSalary, SalaryComponents } from './salary.calculator.js';
import { appendJourneyEvent } from '../employees/journeyLog.service.js';
import {
  sendOnboardingTokenEmail,
  sendOfferReviewEmail,
  sendWelcomeEmail,
  sendRejectedEmail,
} from './ats.email.service.js';
import { createTemporaryPasswordCredential } from '../auth/tempPassword.service.js';
import { logSensitiveAction } from '../../shared/auditLog.js';
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
    await sendOnboardingTokenEmail({
      candidateId,
      to: cand.email,
      candidateName: cand.full_name,
      onboardingLink,
    });
  }

  // SMS/WhatsApp fallback for candidates without email (walk-ins)
  if (cand.mobile) {
    const smsBody =
      `Hi ${cand.full_name}, you have been selected! Complete your onboarding at: ${onboardingLink} (valid 7 days)`;
    try {
      const smsProvider = providerFactory.getProvider('sms');
      await smsProvider.send(cand.mobile, 'Onboarding Link', smsBody);
    } catch (smsErr) {
      // SMS failure must not block token generation — log and continue
      console.error('[onboarding] SMS delivery failed for', candidateId, smsErr instanceof Error ? smsErr.message : String(smsErr));
    }
    // WhatsApp delivery attempt (best-effort)
    try {
      const waProvider = providerFactory.getProvider('whatsapp');
      await waProvider.send(cand.mobile, 'Onboarding Link', smsBody);
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
            b.branch_name,
            o.id AS offer_id, o.status AS offer_status, o.offered_ctc
     FROM ats_onboarding_request r
     JOIN ats_candidate c ON c.id = r.candidate_id
     LEFT JOIN branch_master b ON b.id = r.branch_id
     LEFT JOIN ats_employment_offer o ON o.onboarding_request_id = r.id
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

  // Fetch branch head email — auth_user has no branch_id, so join through employees
  let bhEmail: string | null = null;
  if (submit && req.branch_id) {
    const [bhRows] = await db.execute<RowDataPacket[]>(
      `SELECT u.email FROM auth_user u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN employees e ON e.user_id = u.id
       WHERE ur.role_key IN ('branch_head', 'admin')
         AND e.branch_id = ?
         AND e.active_status = 1
       LIMIT 1`,
      [req.branch_id],
    );
    bhEmail = (bhRows as RowDataPacket[])[0]?.email ?? null;
  }

  const [bandRows] = await db.execute<RowDataPacket[]>(
    `SELECT basic_pct, hra_pct FROM salary_band_master WHERE band_code = ?`,
    [offerData.salary_band ?? 'D'],
  );
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
        offerData.cost_centre ?? null, offerData.reporting_manager_id ?? null, offerData.role_type ?? null,
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
        offerData.cost_centre ?? null, offerData.reporting_manager_id ?? null, offerData.role_type ?? null,
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

export async function approveOffer(offerId: string, approverId: string, remarks?: string) {
  const [offerRows] = await db.execute<RowDataPacket[]>(
    `SELECT o.*, o.onboarding_request_id,
            c.full_name, c.email, c.mobile, c.applied_for_branch,
            c.applied_for_process,
            br.id AS resolved_branch_id,
            pm.id AS resolved_process_id,
            r.candidate_id AS req_candidate_id
     FROM ats_employment_offer o
     JOIN ats_onboarding_request r ON r.id = o.onboarding_request_id
     JOIN ats_candidate c ON c.id = r.candidate_id
     LEFT JOIN branch_master br
       ON br.id = c.applied_for_branch
       OR br.branch_name = c.applied_for_branch
       OR br.branch_code = c.applied_for_branch
     LEFT JOIN process_master pm
       ON pm.id = c.applied_for_process
       OR pm.process_name = c.applied_for_process
       OR pm.process_code = c.applied_for_process
     WHERE o.id = ? OR o.onboarding_request_id = ?
     ORDER BY CASE WHEN o.id = ? THEN 0 ELSE 1 END
     LIMIT 1`,
    [offerId, offerId, offerId],
  );
  if (!offerRows.length) throw Object.assign(new Error('Offer not found'), { statusCode: 404 });
  const offer = offerRows[0];
  const candidateId: string = offer.req_candidate_id;
  if (!offer.email) {
    throw Object.assign(new Error('Candidate email is required before employee account creation'), { statusCode: 400 });
  }

  const allowed = await hasScopedAccess(
    approverId,
    ['branch_head'],
    {
      branchId: offer.resolved_branch_id ?? offer.applied_for_branch,
      processId: offer.resolved_process_id ?? offer.applied_for_process,
    },
    { allowAdminBypass: true },
  );
  if (!allowed) throw Object.assign(new Error('Access denied'), { statusCode: 403 });

  // Pre-compute the one-time password credential. The raw value is never logged.
  const { temporaryPassword, passwordHash } = await createTemporaryPasswordCredential();

  const nameParts: string[] = ((offer.full_name as string) ?? '').trim().split(/\s+/);
  const firstName = nameParts[0] ?? '';
  const lastName = nameParts.slice(1).join(' ') || firstName;

  const employeeId = randomUUID();
  const authUserId = randomUUID();

  // All DB writes inside a single transaction — partial failures roll back cleanly
  const conn: PoolConnection = await db.getConnection();
  let employeeCode = '';
  let resolvedAuthUserId = authUserId;
  let passwordRecipientEmail = '';

  try {
    await conn.beginTransaction();

    // Employee code — 4-format logic based on entity (branch) + emp_type
    // MAS+ONROLL  → MAS#####   e.g. MAS62857
    // IDC+ONROLL  → IDC#####   e.g. IDC62857
    // MAS+TRAINEE → #####C     e.g. 62857C  (no prefix)
    // IDC+TRAINEE → IDC#####C  e.g. IDC62857C
    // All share one global sequential counter.
    const empTypeLower = String(offer.emp_type ?? 'OnRoll').toLowerCase().trim();
    const isTrainee = empTypeLower.includes('mgmt') || empTypeLower.includes('trainee');

    // Detect entity from branch name (IDC / ISPARK branches belong to IDC entity)
    let branchNameForCode = '';
    if (offer.resolved_branch_id) {
      const [brRows] = await conn.execute<RowDataPacket[]>(
        `SELECT branch_name FROM branch_master WHERE id = ? LIMIT 1`,
        [offer.resolved_branch_id],
      );
      branchNameForCode = String((brRows as RowDataPacket[])[0]?.branch_name ?? '').toUpperCase();
    }
    const isIDC = branchNameForCode.includes('IDC') || branchNameForCode.includes('ISPARK');
    const entityPrefix = isIDC ? 'IDC' : 'MAS';

    // Lock the shared sequence row to prevent concurrent duplicate codes
    const [seqRows] = await conn.execute<RowDataPacket[]>(
      `SELECT current_sequence FROM employee_code_sequence
       WHERE company_prefix = ? AND is_offrole = FALSE
       LIMIT 1 FOR UPDATE`,
      [entityPrefix],
    );
    // If sequence row missing, fall back to reading max from live employees
    let nextSeq: number;
    if ((seqRows as RowDataPacket[]).length > 0) {
      nextSeq = ((seqRows as RowDataPacket[])[0].current_sequence as number) + 1;
    } else {
      const [maxRows] = await conn.execute<RowDataPacket[]>(
        `SELECT GREATEST(
           IFNULL((SELECT MAX(CAST(SUBSTRING(employee_code,4) AS UNSIGNED)) FROM employees WHERE employee_code REGEXP '^MAS[0-9]+$'),0),
           IFNULL((SELECT MAX(CAST(SUBSTRING(employee_code,4) AS UNSIGNED)) FROM employees WHERE employee_code REGEXP '^IDC[0-9]+$'),0),
           IFNULL((SELECT MAX(CAST(SUBSTRING(employee_code,1,CHAR_LENGTH(employee_code)-1) AS UNSIGNED)) FROM employees WHERE employee_code REGEXP '^[0-9]+C$'),0),
           IFNULL((SELECT MAX(CAST(SUBSTRING(employee_code,4,CHAR_LENGTH(employee_code)-4) AS UNSIGNED)) FROM employees WHERE employee_code REGEXP '^IDC[0-9]+C$'),0)
         ) AS global_max`,
      );
      nextSeq = ((maxRows as RowDataPacket[])[0]?.global_max as number ?? 0) + 1;
    }

    // Advance ALL four sequence rows so they stay in sync regardless of which path runs next
    await conn.execute(
      `UPDATE employee_code_sequence SET current_sequence = ?, last_generated_at = NOW()
       WHERE current_sequence < ?`,
      [nextSeq, nextSeq],
    );

    // Build the code in the correct format
    if (isTrainee) {
      employeeCode = isIDC ? `IDC${nextSeq}C` : `${nextSeq}C`;
    } else {
      employeeCode = `${entityPrefix}${nextSeq}`;
    }

    await conn.execute(
      `INSERT INTO auth_user (id, email, password_hash, must_change_password)
       VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE must_change_password = 1`,
      [authUserId, offer.email, passwordHash],
    );
    const [existingAuth] = await conn.execute<RowDataPacket[]>(
      `SELECT id FROM auth_user WHERE email = ?`, [offer.email],
    );
    resolvedAuthUserId = (existingAuth as RowDataPacket[])[0]?.id ?? authUserId;

    // salary_start_date: use date_of_salary if set (some processes have unpaid training post-joining)
    const salaryStartDate: string | null = (offer.date_of_salary as string | null) ?? (offer.date_of_joining as string | null) ?? null;

    const candidateData = await conn.execute<RowDataPacket[]>(
      `SELECT
              COALESCE(p.gender, c.gender) AS gender,
              COALESCE(p.date_of_birth, c.date_of_birth) AS date_of_birth,
              COALESCE(p.personal_email_id, c.email) AS personal_email,
              c.mobile AS personal_phone,
              p.alternate_mobile,
              NULL AS pan_number,
              NULL AS aadhar_number,
              NULL AS uan_number,
              p.current_address,
              p.personal_email_id
       FROM ats_candidate c
       LEFT JOIN candidate_onboarding_profile p ON p.candidate_id = c.id
       WHERE c.id = ? LIMIT 1`,
      [candidateId]
    );
    const candRow = candidateData[0][0] as any;
    passwordRecipientEmail = String(candRow?.personal_email ?? '').trim();

    await conn.execute(
      `INSERT INTO employees
         (id, employee_code, first_name, last_name, email, official_email, mobile,
          personal_email, personal_phone, alternate_mobile,
          gender, date_of_birth, address1, city, country,
          branch_id, process_id, department_id, designation_id,
          date_of_joining, salary_start_date, employment_type, reporting_manager_id,
          user_id, active_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        employeeId, employeeCode, firstName, lastName,
        offer.email, offer.email, offer.mobile,
        candRow?.personal_email ?? null, candRow?.personal_phone ?? null, candRow?.alternate_mobile ?? null,
        candRow?.gender ?? null, candRow?.date_of_birth ?? null, candRow?.current_address ?? null, null, null,
        offer.resolved_branch_id ?? null, offer.resolved_process_id ?? null,
        offer.department_id ?? null, offer.designation_id ?? null,
        offer.date_of_joining, salaryStartDate, offer.emp_type,
        offer.reporting_manager_id ?? null,
        resolvedAuthUserId,
      ],
    );

    await conn.execute(
      `INSERT INTO employee_salary_snapshot
         (id, employee_id, snapshot_date, ctc_offered, basic, hra, conveyance,
          da, special_allowance, other_allowance, bonus, gross,
          epf_employee, epf_employer, esic_employee, esic_employer,
          professional_tax, gratuity, admin_charges, net_in_hand)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        employeeId, offer.date_of_joining,
        offer.offered_ctc, offer.basic, offer.hra, offer.conveyance,
        offer.da, offer.special_allowance, offer.other_allowance, offer.bonus, offer.gross,
        offer.pf_employee, offer.pf_employer, offer.esic_employee, offer.esic_employer,
        offer.professional_tax, offer.gratuity, offer.admin_charges, offer.net_in_hand,
      ],
    );

    // Create payroll salary assignment so monthly payroll can run immediately.
    // Requires a valid structure_id — use the first available structure as default.
    const [structRows] = await conn.execute<RowDataPacket[]>(
      `SELECT id FROM salary_structure_master ORDER BY created_at ASC LIMIT 1`,
    );
    if ((structRows as RowDataPacket[]).length > 0) {
      const defaultStructureId = (structRows as RowDataPacket[])[0].id;
      await conn.execute(
        `INSERT IGNORE INTO employee_salary_assignment
           (id, employee_id, structure_id, ctc_annual, effective_from, active_status)
         VALUES (UUID(), ?, ?, ?, ?, 1)`,
        [employeeId, defaultStructureId, offer.offered_ctc ?? 0, salaryStartDate ?? new Date().toISOString().slice(0, 10)],
      );
    }

    // Migrate nominee data from onboarding profile to employee_nominee
    const [nomineeData] = await conn.execute<RowDataPacket[]>(
      `SELECT nominee_name, nominee_relation, nominee_date_of_birth, nominee1_share_pct,
              nominee2_name, nominee2_relation, nominee2_dob, nominee2_share_pct
       FROM candidate_onboarding_profile WHERE candidate_id = ? LIMIT 1`,
      [candidateId]
    );
    const nomRow = nomineeData[0] as any;
    if (nomRow?.nominee_name) {
      await conn.execute(
        `INSERT INTO employee_nominee
           (id, employee_id, nominee_name, relationship, date_of_birth, share_percentage, nominee_for, mobile, address)
         VALUES (UUID(), ?, ?, ?, ?, ?, 'gratuity', NULL, NULL)`,
        [employeeId, nomRow.nominee_name, nomRow.nominee_relation, nomRow.nominee_date_of_birth, nomRow.nominee1_share_pct ?? 100]
      );
    }
    if (nomRow?.nominee2_name) {
      await conn.execute(
        `INSERT INTO employee_nominee
           (id, employee_id, nominee_name, relationship, date_of_birth, share_percentage, nominee_for, mobile, address)
         VALUES (UUID(), ?, ?, ?, ?, ?, 'gratuity', NULL, NULL)`,
        [employeeId, nomRow.nominee2_name, nomRow.nominee2_relation, nomRow.nominee2_dob, nomRow.nominee2_share_pct ?? 0]
      );
    }

    // Initialize leave balance ledger for the joining year (allocated_days = 0; HR can top-up later)
    const joiningYear = offer.date_of_joining
      ? new Date(offer.date_of_joining as string).getFullYear()
      : new Date().getFullYear();
    const [leaveTypes] = await conn.execute<RowDataPacket[]>(
      `SELECT id FROM leave_type_master WHERE active_status = 1`,
    );
    for (const lt of leaveTypes as RowDataPacket[]) {
      await conn.execute(
        `INSERT IGNORE INTO leave_balance_ledger
           (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
         VALUES (UUID(), ?, ?, ?, 0, 0, 0)`,
        [employeeId, lt.id, joiningYear],
      );
    }

    await conn.execute(
      `INSERT INTO ats_offer_approval (id, offer_id, approver_id, action, remarks)
       VALUES (UUID(), ?, ?, 'approved', ?)`,
      [offerId, approverId, remarks ?? null],
    );

    await conn.execute(
      `UPDATE ats_onboarding_request SET status = 'approved', updated_at = NOW() WHERE id = ?`,
      [offer.onboarding_request_id],
    );

    await conn.execute(
      `UPDATE ats_onboarding_bridge
       SET status = 'joined', employee_id = ?, hr_approved_by = ?, hr_approved_at = NOW()
       WHERE candidate_id = ?`,
      [employeeId, approverId, candidateId],
    );

    await conn.execute(
      `UPDATE ats_candidate
       SET profile_status = 'onboarded', current_stage = 'converted', updated_at = NOW()
       WHERE id = ?`,
      [candidateId],
    );

    await conn.execute(
      `INSERT INTO ats_candidate_stage_log
         (id, candidate_id, from_stage, to_stage, remarks, updated_by)
       VALUES (UUID(), ?, 'Offer Submitted', 'Converted', 'Offer approved and employee account created', ?)`,
      [candidateId, approverId],
    );

    await conn.execute(
      `INSERT IGNORE INTO user_roles (id, user_id, role_key, active_status)
       VALUES (UUID(), ?, 'employee', 1)`,
      [resolvedAuthUserId],
    );

    await conn.execute(
      `INSERT INTO appointment_letter_request
         (id, employee_id, candidate_id, status, aadhaar_esign_status, company_signature_status)
       VALUES (UUID(), ?, ?, 'draft', 'not_sent', 'pending')
       ON DUPLICATE KEY UPDATE candidate_id = VALUES(candidate_id), updated_at = NOW()`,
      [employeeId, candidateId],
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  appendJourneyEvent({
    employeeId,
    eventType: 'hiring',
    eventDate: offer.date_of_joining,
    description: `Joined through ATS as ${employeeCode}`,
    module: 'ATS',
    triggeredBy: approverId,
    metadata: { candidate_id: candidateId, offer_id: offerId },
  }).catch((err: unknown) => {
    // Employee creation is already committed; journey logging can be retried independently.
    console.error('[onboarding] Journey log failed for employee', employeeId, ':', err instanceof Error ? err.message : String(err));
  });

  await logSensitiveAction({
    actor_user_id: approverId,
    action_type: 'employee_temp_password_created',
    module_key: 'ats',
    entity_type: 'auth_user',
    entity_id: resolvedAuthUserId,
    employee_id: employeeId,
    change_summary: {
      candidate_id: candidateId,
      employee_code: employeeCode,
      must_change_password: true,
      delivery_channel: 'personal_email',
    },
  });

  // Fire IT provisioning tasks — runs after transaction commits, fire-and-forget
  const branchIdForProvisioning: string | null = (offer.resolved_branch_id ?? offer.applied_for_branch) || null;
  import('../it-provisioning/it-provisioning.service.js').then(({ dispatchJoinProvisioningTasks }) => {
    dispatchJoinProvisioningTasks({
      employeeId,
      employeeCode,
      employeeName: offer.full_name,
      branchId: branchIdForProvisioning,
      actorUserId: approverId,
      triggerEventId: offerId,
    }).catch((err: unknown) => console.error('[it-provisioning] join dispatch failed:', err));
  }).catch((err: unknown) => console.error('[it-provisioning] module load failed:', err));

  // Send welcome email after transaction commits — email failure should not roll back employee creation
  const baseUrl = env.FRONTEND_URL || 'http://localhost:5173';
  if (passwordRecipientEmail) {
    await sendWelcomeEmail({
      candidateId,
      to: passwordRecipientEmail,
      candidateName: offer.full_name,
      employeeCode,
      loginEmail: offer.email,
      tempPassword: temporaryPassword,
      loginUrl: baseUrl,
    });
  }

  return { employeeId, employeeCode };
}

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

  // Remove the offer from the pending list by updating its status
  await db.execute(
    `UPDATE ats_employment_offer SET status = 'draft', updated_at = NOW() WHERE id = ?`,
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
