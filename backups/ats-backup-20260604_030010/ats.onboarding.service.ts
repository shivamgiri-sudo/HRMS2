import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { RowDataPacket, PoolConnection } from 'mysql2/promise';
import { db } from '../../db/mysql.js';
import { env } from '../../config/env.js';
import { calculateSalary, SalaryComponents } from './salary.calculator.js';
import {
  sendOnboardingTokenEmail,
  sendOfferReviewEmail,
  sendWelcomeEmail,
} from './ats.email.service.js';

// ── Token Generation ──────────────────────────────────────────────────────────

export async function sendOnboardingToken(
  candidateId: string,
  requestedBy: string,
): Promise<{ token: string; expiresAt: Date }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.id, c.full_name, c.email, c.mobile, c.applied_for_branch,
            b.branch_name
     FROM ats_candidate c
     LEFT JOIN branch_master b ON b.id = c.applied_for_branch
     WHERE c.id = ? AND c.active_status = 1`,
    [candidateId],
  );
  if (!rows.length) throw Object.assign(new Error('Candidate not found'), { status: 404 });
  const cand = rows[0];

  const rawToken = randomUUID() + '-' + randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await db.execute(
    `INSERT INTO ats_onboarding_request (id, candidate_id, branch_id, requested_by, status)
     VALUES (UUID(), ?, ?, ?, 'pending')
     ON DUPLICATE KEY UPDATE status = IF(status = 'rejected', 'pending', status), updated_at = NOW()`,
    [candidateId, cand.applied_for_branch ?? null, requestedBy],
  );

  await db.execute(
    `INSERT INTO ats_onboarding_bridge
       (id, candidate_id, status, onboarding_token, onboarding_token_expires_at, created_by)
     VALUES (UUID(), ?, 'pending', ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       onboarding_token = VALUES(onboarding_token),
       onboarding_token_expires_at = VALUES(onboarding_token_expires_at)`,
    [candidateId, rawToken, expiresAt, requestedBy],
  );

  await db.execute(
    `UPDATE ats_candidate SET profile_status = 'onboarding_sent' WHERE id = ?`,
    [candidateId],
  );

  const baseUrl = env.FRONTEND_URL || 'http://localhost:5173';
  if (cand.email) {
    await sendOnboardingTokenEmail({
      candidateId,
      to: cand.email,
      candidateName: cand.full_name,
      onboardingLink: `${baseUrl}/onboard?token=${rawToken}`,
    });
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
     LEFT JOIN branch_master br ON br.id = c.applied_for_branch
     WHERE b.onboarding_token = ?`,
    [token],
  );
  if (!rows.length) throw Object.assign(new Error('Invalid token'), { status: 400 });
  const row = rows[0];
  if (new Date(row.onboarding_token_expires_at) < new Date()) {
    throw Object.assign(new Error('Token expired'), { status: 410 });
  }
  return row;
}

// ── Profile Submission ────────────────────────────────────────────────────────

export async function submitProfile(token: string, profile: Record<string, unknown>) {
  const tokenData = await validateToken(token);
  const candidateId: string = tokenData.candidate_id;

  await db.execute(
    `UPDATE ats_candidate SET
       father_name = ?, current_address = ?, permanent_address = ?,
       date_of_birth = ?,
       aadhar_number = ?, pan_number = ?, uan_number = ?,
       bank_account_no = ?, bank_ifsc = ?, bank_name = ?,
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
      profile.aadhar_number ?? null,
      profile.pan_number ?? null,
      profile.uan_number ?? null,
      profile.bank_account_no ?? null,
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

export async function listOnboardingRequests(branchId?: string) {
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
     WHERE (? IS NULL OR r.branch_id = ?)
     ORDER BY r.created_at DESC`,
    [branchId ?? null, branchId ?? null],
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
  if (!reqRows.length) throw Object.assign(new Error('Request not found'), { status: 404 });
  const req = reqRows[0];

  // Fetch branch head email separately to avoid complex role joins
  let bhEmail: string | null = null;
  if (submit && req.branch_id) {
    const [bhRows] = await db.execute<RowDataPacket[]>(
      `SELECT u.email FROM auth_user u
       JOIN user_roles ur ON ur.user_id = u.id
       WHERE ur.role_key IN ('branch_head', 'admin') AND u.branch_id = ?
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

export async function listPendingApprovals(branchId?: string) {
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
       AND (? IS NULL OR r.branch_id = ?)
     ORDER BY o.submitted_at ASC`,
    [branchId ?? null, branchId ?? null],
  );
  return rows;
}

// ── Branch Head: Approve ──────────────────────────────────────────────────────

export async function approveOffer(offerId: string, approverId: string, remarks?: string) {
  const [offerRows] = await db.execute<RowDataPacket[]>(
    `SELECT o.*, o.onboarding_request_id,
            c.full_name, c.email, c.mobile, c.applied_for_branch,
            c.applied_for_process,
            r.candidate_id AS req_candidate_id
     FROM ats_employment_offer o
     JOIN ats_onboarding_request r ON r.id = o.onboarding_request_id
     JOIN ats_candidate c ON c.id = r.candidate_id
     WHERE o.id = ?`,
    [offerId],
  );
  if (!offerRows.length) throw Object.assign(new Error('Offer not found'), { status: 404 });
  const offer = offerRows[0];
  const candidateId: string = offer.req_candidate_id;

  // Pre-compute values that don't need a DB connection
  const mobile: string = offer.mobile ?? '0000';
  const tempPassword = `${mobile.slice(-4)}@MAS`;
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  const nameParts: string[] = ((offer.full_name as string) ?? '').trim().split(/\s+/);
  const firstName = nameParts[0] ?? '';
  const lastName = nameParts.slice(1).join(' ') || firstName;

  const employeeId = randomUUID();
  const authUserId = randomUUID();

  // All DB writes inside a single transaction — partial failures roll back cleanly
  const conn: PoolConnection = await db.getConnection();
  let employeeCode = '';
  let resolvedAuthUserId = authUserId;

  try {
    await conn.beginTransaction();

    // Employee code — lock via FOR UPDATE to prevent concurrent duplicates
    const [codeRows] = await conn.execute<RowDataPacket[]>(
      `SELECT MAX(CAST(SUBSTRING(employee_code, 4) AS UNSIGNED)) AS last_seq
       FROM employees WHERE employee_code LIKE 'MAS%' FOR UPDATE`,
    );
    const lastSeq: number = (codeRows as RowDataPacket[])[0]?.last_seq ?? 0;
    employeeCode = `MAS${String(lastSeq + 1).padStart(5, '0')}`;

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

    await conn.execute(
      `INSERT INTO employees
         (id, employee_code, first_name, last_name, email, mobile,
          branch_id, process_id, department_id, designation_id,
          date_of_joining, employment_type, reporting_manager_id,
          user_id, active_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        employeeId, employeeCode, firstName, lastName,
        offer.email, offer.mobile,
        offer.applied_for_branch, offer.applied_for_process,
        offer.department_id ?? null, offer.designation_id ?? null,
        offer.date_of_joining, offer.emp_type,
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
       SET status = 'joined', hr_approved_by = ?, hr_approved_at = NOW()
       WHERE candidate_id = ?`,
      [approverId, candidateId],
    );

    await conn.execute(
      `UPDATE ats_candidate
       SET profile_status = 'onboarded', current_stage = 'converted', updated_at = NOW()
       WHERE id = ?`,
      [candidateId],
    );

    await conn.execute(
      `INSERT IGNORE INTO user_roles (id, user_id, role_key, active_status)
       VALUES (UUID(), ?, 'employee', 1)`,
      [resolvedAuthUserId],
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  // Send welcome email after transaction commits — email failure should not roll back employee creation
  const baseUrl = env.FRONTEND_URL || 'http://localhost:5173';
  if (offer.email) {
    await sendWelcomeEmail({
      candidateId,
      to: offer.email,
      candidateName: offer.full_name,
      employeeCode,
      loginEmail: offer.email,
      tempPassword,
      loginUrl: baseUrl,
    });
  }

  return { employeeId, employeeCode };
}

// ── Branch Head: Reject ───────────────────────────────────────────────────────

export async function rejectOffer(offerId: string, approverId: string, remarks: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT o.onboarding_request_id, r.candidate_id
     FROM ats_employment_offer o
     JOIN ats_onboarding_request r ON r.id = o.onboarding_request_id
     WHERE o.id = ?`,
    [offerId],
  );
  if (!rows.length) throw Object.assign(new Error('Offer not found'), { status: 404 });

  await db.execute(
    `INSERT INTO ats_offer_approval (id, offer_id, approver_id, action, remarks)
     VALUES (UUID(), ?, ?, 'rejected', ?)`,
    [offerId, approverId, remarks],
  );

  await db.execute(
    `UPDATE ats_onboarding_request SET status = 'rejected', updated_at = NOW() WHERE id = ?`,
    [(rows as RowDataPacket[])[0].onboarding_request_id],
  );

  // Remove the offer from the pending list by updating its status
  await db.execute(
    `UPDATE ats_employment_offer SET status = 'draft', updated_at = NOW() WHERE id = ?`,
    [offerId],
  );
}
