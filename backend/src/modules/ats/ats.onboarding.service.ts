import { randomUUID, createHash } from 'crypto';
import { RowDataPacket, PoolConnection } from 'mysql2/promise';
import { db } from '../../db/mysql.js';
import { env } from '../../config/env.js';
import { hasScopedAccess } from '../../shared/scopeAccess.js';
import { recordBranchHeadDecision, revertBranchHeadDecision } from './branch-head-approval.record.js';
import { resolveEmployeeIdForAuthUser } from './branch-head-scope.js';
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

/**
 * Turn a submitted Employment Offer into the payroll validation record that
 * employee creation requires.
 *
 * validateSalaryLock (employee-creation-orchestrator.service.ts:591-599) reads
 * ats_payroll_hr_validation and demands validation_status='validated'. The offer
 * carries every NOT NULL column that table needs — candidate_id,
 * employment_type, gross_salary and joining_date — so no figure is invented
 * here; they are copied from what Payroll HR just entered.
 *
 * Idempotent. An existing row is refreshed from the latest offer rather than
 * duplicated, because Payroll HR revising an offer should move the validated
 * salary with it, not leave a stale one behind for the gate to read.
 */
async function deriveSalaryValidationFromOffer(candidateId: string, actorUserId: string): Promise<void> {
  const [offerRows] = await db.execute<RowDataPacket[]>(
    `SELECT o.id, o.emp_type, o.gross, o.date_of_joining, o.date_of_salary,
            o.department_id, o.designation_id, o.cost_centre, o.reporting_manager_id,
            o.basic, o.hra, o.conveyance, o.special_allowance,
            COALESCE(b.id, c.applied_for_branch) AS branch_id
       FROM ats_employment_offer o
       JOIN ats_candidate c ON c.id = o.candidate_id
       LEFT JOIN branch_master b
              ON b.id = c.applied_for_branch
              OR b.branch_name = c.applied_for_branch
              OR b.branch_code = c.applied_for_branch
      WHERE o.candidate_id = ?
      ORDER BY o.created_at DESC
      LIMIT 1`,
    [candidateId],
  );
  const o = offerRows[0];
  // Without a gross or a joining date the row would violate NOT NULL; leave it
  // absent so the branch head's queue keeps flagging it rather than failing here.
  if (!o || o.gross == null || !o.date_of_joining) return;

  // payroll_hr_id references employees; the caller gives us an auth user id.
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1`,
    [actorUserId],
  );
  const payrollHrId = empRows[0]?.id ? String(empRows[0].id) : null;

  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM ats_payroll_hr_validation WHERE candidate_id = ?
      ORDER BY COALESCE(validated_at, created_at) DESC LIMIT 1`,
    [candidateId],
  );

  if (existing[0]) {
    await db.execute(
      `UPDATE ats_payroll_hr_validation
          SET employment_type = ?, gross_salary = ?, joining_date = ?,
              salary_start_date = COALESCE(?, joining_date),
              department_id = ?, designation_id = ?, cost_centre_id = ?,
              reporting_manager_id = ?, branch_id = ?,
              basic_salary = ?, hra = ?, conveyance = ?, special_allowance = ?,
              payroll_hr_id = COALESCE(?, payroll_hr_id),
              validation_status = 'validated', validated_at = NOW(), updated_at = NOW()
        WHERE id = ?`,
      [o.emp_type ?? 'onroll', o.gross, o.date_of_joining, o.date_of_salary ?? null,
       o.department_id ?? null, o.designation_id ?? null, o.cost_centre ?? null,
       o.reporting_manager_id ?? null, o.branch_id ?? null,
       o.basic ?? null, o.hra ?? null, o.conveyance ?? null, o.special_allowance ?? null,
       payrollHrId, String(existing[0].id)],
    );
  } else {
    await db.execute(
      `INSERT INTO ats_payroll_hr_validation
         (id, candidate_id, branch_id, payroll_hr_id, employment_type,
          department_id, designation_id, cost_centre_id, reporting_manager_id,
          gross_salary, basic_salary, hra, conveyance, special_allowance,
          joining_date, salary_start_date, validation_status, validated_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'validated', NOW())`,
      [candidateId, o.branch_id ?? null, payrollHrId, o.emp_type ?? 'onroll',
       o.department_id ?? null, o.designation_id ?? null, o.cost_centre ?? null,
       o.reporting_manager_id ?? null,
       o.gross, o.basic ?? null, o.hra ?? null, o.conveyance ?? null, o.special_allowance ?? null,
       o.date_of_joining, o.date_of_salary ?? o.date_of_joining],
    );
  }

  // The branch head queue also filters on this stage.
  await db.execute(
    `UPDATE ats_candidate SET current_stage = 'payroll_validated', updated_at = NOW()
      WHERE id = ? AND COALESCE(current_stage, '') <> 'offer_approved'`,
    [candidateId],
  ).catch(() => undefined);
}

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
    // Submitting the offer IS the Payroll HR salary validation — the same
    // person entered the same figures a moment ago. Deriving the record here
    // keeps one source of truth; the alternative is a second screen asking for
    // the salary again, which is what the old flow did and what its deprecation
    // set out to remove.
    //
    // Not fatal if it fails: the offer is saved and the branch head can still
    // see it. The queue shows a "payroll not validated" flag on the row, so the
    // gap is visible rather than silent.
    await deriveSalaryValidationFromOffer(String(req.candidate_id), createdBy)
      .catch((e) => console.error('[saveOffer] could not derive payroll validation:', e));

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

/**
 * Pull a submitted offer back to draft so the submitter can revise it.
 *
 * Without this the only way to correct a submitted offer is for the Branch Head
 * to reject it, which records an adverse decision on the candidate for what is
 * usually a keying error.
 */
export async function withdrawOffer(offerId: string, actorUserId: string, reason: string) {
  if (!reason || !reason.trim()) {
    throw Object.assign(new Error('A reason is required to withdraw an offer.'), { statusCode: 400 });
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT o.id, o.status, o.candidate_id, o.onboarding_request_id, c.full_name
       FROM ats_employment_offer o
       JOIN ats_candidate c ON c.id = o.candidate_id
      WHERE o.id = ? LIMIT 1`,
    [offerId],
  );
  const offer = rows[0];
  if (!offer) throw Object.assign(new Error('Offer not found'), { statusCode: 404 });

  // Only a still-pending offer is the submitter's to take back. After approval
  // the decision belongs to the Branch Head and an employee may already exist.
  if (String(offer.status) !== 'submitted') {
    throw Object.assign(
      new Error(
        String(offer.status) === 'bh_approved'
          ? 'This offer has already been approved by the Branch Head and cannot be withdrawn.'
          : `This offer is '${offer.status}', not pending approval, so there is nothing to withdraw.`,
      ),
      { statusCode: 409 },
    );
  }

  // Belt and braces: an employee existing at all means the chain has moved past
  // the point where withdrawing is meaningful.
  const [emp] = await db.execute<RowDataPacket[]>(
    `SELECT employee_id FROM ats_onboarding_bridge
      WHERE candidate_id = ? AND employee_id IS NOT NULL LIMIT 1`,
    [offer.candidate_id],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  if (emp[0]) {
    throw Object.assign(
      new Error('An employee record already exists for this candidate, so the offer cannot be withdrawn.'),
      { statusCode: 409 },
    );
  }

  await db.execute(
    `UPDATE ats_employment_offer
        SET status = 'draft', submitted_at = NULL, updated_at = NOW()
      WHERE id = ? AND status = 'submitted'`,
    [offerId],
  );

  await db.execute(
    `UPDATE ats_onboarding_request SET status = 'profile_submitted', updated_at = NOW() WHERE id = ?`,
    [offer.onboarding_request_id],
  ).catch(() => undefined);

  // Visible on the candidate's journey: the offer went back for revision. A
  // salary that changes with no recorded reason is exactly what an audit of
  // this flow would ask about.
  await db.execute(
    `INSERT INTO ats_candidate_stage_log
       (id, candidate_id, from_stage, to_stage, remarks, updated_by)
     VALUES (UUID(), ?, 'Offer Submitted', 'Offer Withdrawn', ?, ?)`,
    [offer.candidate_id, `Offer withdrawn for revision: ${reason.trim()}`, actorUserId],
  ).catch(() => undefined);

  return { offerId, candidateId: String(offer.candidate_id), status: 'draft' };
}

/**
 * The submitted offer, as the submitter needs to see it back.
 *
 * Returns the full salary breakdown with names rather than ids, plus any
 * decision taken on it. Read-only — this is the "what did I send?" view that
 * had no data source behind it.
 */
export async function getOfferDetail(requestId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT o.id AS offer_id, o.status, o.emp_type, o.salary_band, o.role_type, o.profile,
            o.date_of_joining, o.date_of_salary,
            o.offered_ctc, o.basic, o.hra, o.conveyance, o.da,
            o.special_allowance, o.other_allowance, o.bonus, o.gross,
            o.pf_employee, o.pf_employer, o.esic_employee, o.esic_employer,
            o.professional_tax, o.gratuity, o.admin_charges, o.net_in_hand,
            o.pf_eligible, o.esi_eligible,
            o.submitted_at, o.approved_at, o.created_at, o.updated_at,
            o.candidate_id, c.candidate_code, c.full_name,
            d.designation_name, dept.dept_name AS department_name,
            cc.cost_centre_name,
            mgr.full_name AS reporting_manager_name,
            sub.full_name AS submitted_by_name
       FROM ats_employment_offer o
       JOIN ats_candidate c ON c.id = o.candidate_id
       LEFT JOIN designation_master d ON d.id = o.designation_id
       LEFT JOIN department_master dept ON dept.id = o.department_id
       LEFT JOIN cost_centre_master cc ON cc.id = o.cost_centre
       LEFT JOIN employees mgr ON mgr.id = o.reporting_manager_id
       LEFT JOIN employees sub ON sub.id = o.created_by OR sub.user_id = o.created_by
      WHERE o.onboarding_request_id = ?
      ORDER BY o.created_at DESC
      LIMIT 1`,
    [requestId],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);

  const offer = rows[0] ?? null;
  if (!offer) return { offer: null, decisions: [] };

  // Who decided it, when, and why — the part that is invisible today even after
  // the Branch Head has acted.
  const [decisions] = await db.execute<RowDataPacket[]>(
    `SELECT a.action, a.remarks, a.action_at,
            e.full_name AS actor_name, e.employee_code AS actor_code
       FROM ats_offer_approval a
       LEFT JOIN employees e ON e.id = a.approver_id OR e.user_id = a.approver_id
      WHERE a.offer_id = ?
      ORDER BY a.action_at DESC`,
    [String(offer.offer_id)],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);

  return { offer, decisions };
}

// ── Branch Head: List Pending Approvals ───────────────────────────────────────

export async function listPendingApprovals(scopeFilter: { sql: string; params: unknown[] }) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT o.id AS offer_id, o.offered_ctc, o.gross, o.net_in_hand,
            o.emp_type, o.date_of_joining, o.salary_band, o.status AS offer_status,
            r.id AS request_id, r.branch_id,
            c.id AS candidate_id, c.candidate_code, c.full_name, c.email, c.mobile,
            c.father_name, c.date_of_birth, c.profile_status,
            b.branch_name,
            -- Whether Payroll HR has validated this salary. Employee creation
            -- requires it (validateSalaryLock), so without this the branch head
            -- clicks Approve and gets a failure they cannot act on. Surfaced on
            -- the row so the blocker is visible before the click.
            -- True when the salary can be established for this offer: either a
            -- validation row already exists, or the offer carries the figures
            -- to derive one at approve time. Reporting merely "does a row
            -- exist" would warn about offers that approve perfectly well.
            (
              EXISTS (
                SELECT 1 FROM ats_payroll_hr_validation pv
                 WHERE pv.candidate_id = c.id AND pv.validation_status = 'validated'
              )
              OR (o.gross IS NOT NULL AND o.date_of_joining IS NOT NULL)
            ) AS payroll_validated
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

  // approverId is an auth_user id here (ats.onboarding.routes.ts:208), while
  // branch-head-approval.routes.ts:59 passes an employees.id. getApprovalHistory
  // joins employees on branch_head_id, so storing the raw auth id would leave
  // every approval made from this screen showing a blank approver.
  const approverEmployeeId = await resolveEmployeeIdForAuthUser(approverId);

  // Record the decision BEFORE creating the employee. validateSalaryLock
  // (employee-creation-orchestrator.service.ts:572-600) requires this row and
  // nothing on this path ever wrote one, so every approval from the nav-menu
  // screen failed with "Branch Head approval pending".
  //
  // recorded:false means the candidate has no payroll validation. That is not
  // an error to throw at the branch head — they cannot create one, and the
  // orchestrator reports it accurately a moment later. The queue flags it on
  // the row instead, before the click (listPendingApprovals.payrollValidated).
  // Self-heal offers submitted before the derivation existed. There is no
  // resubmit path — the offer form is hidden once submitted
  // (NativeHROnboardingRequests.tsx:1472) — so without this an existing offer
  // could only be unblocked by rejecting it first, purely to re-open the form.
  // The offer already holds the salary Payroll HR entered; nothing is invented.
  await deriveSalaryValidationFromOffer(candidateId, approverId)
    .catch((e) => console.error('[approveOffer] could not derive payroll validation:', e));

  const decision = await recordBranchHeadDecision({
    candidateId,
    branchHeadEmployeeId: approverEmployeeId,
    decision: 'approved',
    remarks: remarks ?? null,
  });

  // Use orchestrator with all business rules.
  //
  // Wrapped: createEmployeeFromCandidate THROWS on a SQL error rather than
  // returning success:false, and the revert below was only guarded by
  // !result.success. A throw skipped it entirely and left the approval standing
  // with no employee behind it — which is precisely what happened on the
  // c.fresher failure.
  let result: Awaited<ReturnType<typeof createEmployeeFromCandidate>>;
  try {
    result = await createEmployeeFromCandidate({ candidateId, offerId, approverId });
  } catch (creationErr) {
    if (decision.recorded && !decision.alreadyDecided && decision.payrollValidationId) {
      await revertBranchHeadDecision({ payrollValidationId: decision.payrollValidationId })
        .catch((e) => console.error('[approveOffer] could not revert after a thrown error:', e));
    }
    throw creationErr;
  }

  if (!result.success) {
    // Undo our own write. Creation fails for reasons unrelated to the branch
    // head's judgement — an inactive reporting manager, a missing statutory
    // field — and leaving the row 'approved' would strand the offer as decided
    // with no employee behind it and no way to decide it again.
    if (decision.recorded && !decision.alreadyDecided && decision.payrollValidationId) {
      await revertBranchHeadDecision({ payrollValidationId: decision.payrollValidationId })
        .catch((e) => console.error('[approveOffer] could not revert branch head decision:', e));
    }
    throw Object.assign(
      new Error(`Employee creation failed: ${result.blockers.map(b => b.reason).join(', ')}`),
      {
        statusCode: 400,
        blockers: result.blockers,
        warnings: result.warnings,
      }
    );
  }

  // The decision trail the Approved tab reads. Only rejectOffer wrote one of
  // these before, so approvals left no entry at all. Skipped when the decision
  // was already recorded elsewhere (processBranchHeadApproval writes at :186
  // and then calls this function), so nothing is duplicated.
  // Each write below is individually idempotent, so it runs every time rather
  // than only when this call recorded the decision. Gating them on
  // !alreadyDecided meant that after any earlier partial attempt the retry
  // skipped them all — leaving the candidate at 'payroll_validated' with an
  // approved offer and no stage log.
  {
    await db.execute(
      `INSERT INTO ats_offer_approval (id, offer_id, approver_id, action, remarks)
       SELECT UUID(), ?, ?, 'approved', ?
         FROM DUAL
        WHERE NOT EXISTS (SELECT 1 FROM ats_offer_approval x
                           WHERE x.offer_id = ? AND x.action = 'approved')`,
      [offerId, approverId, remarks ?? null, offerId],
    ).catch((e) => console.error('[approveOffer] offer approval trail insert failed:', e));

    await db.execute(
      `UPDATE ats_candidate SET current_stage = 'offer_approved', updated_at = NOW()
        WHERE id = ? AND COALESCE(current_stage, '') <> 'offer_approved'`,
      [candidateId],
    ).catch(() => undefined);

    await db.execute(
      `INSERT INTO ats_candidate_stage_log
         (id, candidate_id, from_stage, to_stage, remarks, updated_by)
       SELECT UUID(), ?, 'payroll_validated', 'offer_approved', ?, ?
         FROM DUAL
        WHERE NOT EXISTS (SELECT 1 FROM ats_candidate_stage_log x
                           WHERE x.candidate_id = ? AND x.to_stage = 'offer_approved')`,
      [candidateId, remarks || 'Branch Head approved final offer', approverEmployeeId, candidateId],
    ).catch(() => undefined);

    if (result.employeeCode && decision.payrollValidationId) {
      // employee_code_generated is absent under migration 138; guarded so a
      // divergent environment cannot fail an otherwise successful approval.
      await db.execute(
        `UPDATE ats_branch_head_approval SET employee_code_generated = ?
          WHERE payroll_validation_id = ?`,
        [result.employeeCode, decision.payrollValidationId],
      ).catch(() => undefined);
    }
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

  // Mirror the approve path, or everything rejected from this screen is missing
  // from the Rejected tab and from the candidate's journey.
  await recordBranchHeadDecision({
    candidateId: String(row.candidate_id),
    branchHeadEmployeeId: await resolveEmployeeIdForAuthUser(approverId),
    decision: 'rejected',
    remarks,
  }).catch((e) => console.error('[rejectOffer] could not record branch head decision:', e));

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
