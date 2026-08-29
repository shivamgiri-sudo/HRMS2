import { randomUUID, createHash } from 'crypto';
import { RowDataPacket, PoolConnection } from 'mysql2/promise';
import { db } from '../../db/mysql.js';
import { env } from '../../config/env.js';
import { hasScopedAccess } from '../../shared/scopeAccess.js';
import { recordBranchHeadDecision, revertBranchHeadDecision } from './branch-head-approval.record.js';
import { resolveEmployeeIdForAuthUser, resolveBranchHeadScope } from './branch-head-scope.js';
import { inboxService } from '../inbox/inbox.service.js';
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
import { buildSMS } from '../communication/smartping-dlt-registry.js';
import { hasLiveSelfieDocument } from './onboarding-full.service.js';

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
  overrideEmail?: string,
): Promise<{ token: string; expiresAt: Date; emailSent: boolean; emailError?: string; smsSent: boolean; sentTo?: string }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.id, c.full_name, c.email, c.mobile, c.applied_for_branch, c.candidate_status,
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
  // Same guard as sendOnboardingProgressReminder — a candidate marked not
  // joining must not get a (re)sent link either, whether this is the first
  // send or the "Resend Onboarding Link" HR action.
  if (cand.candidate_status === 'not_joining') {
    throw Object.assign(
      new Error('This candidate is marked as not joining — no further onboarding links are sent'),
      { statusCode: 409 },
    );
  }

  const rawToken = randomUUID() + '-' + randomUUID();
  const expiresAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);

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

  // Re-read the token from DB to ensure email uses whatever is actually saved.
  // If a concurrent call overwrote our token, we send the email with THEIR token
  // (which is valid) rather than ours (which was replaced and is now invalid).
  const [bridgeRows] = await db.execute<RowDataPacket[]>(
    `SELECT onboarding_token, onboarding_token_expires_at FROM ats_onboarding_bridge WHERE candidate_id = ? LIMIT 1`,
    [candidateId],
  );
  const savedToken = bridgeRows[0]?.onboarding_token ?? rawToken;
  const savedExpiry = bridgeRows[0]?.onboarding_token_expires_at
    ? new Date(bridgeRows[0].onboarding_token_expires_at as string)
    : expiresAt;

  await db.execute(
    `UPDATE ats_candidate SET profile_status = 'onboarding_sent' WHERE id = ?`,
    [candidateId],
  );
  // overrideEmail is one-off only — never written back to ats_candidate.email. A typo'd stored
  // email shouldn't get silently "corrected" as a side effect of someone just wanting this one
  // resend to land somewhere else; that's a deliberate profile edit, not a resend action.
  const stageLogRemarks = overrideEmail
    ? `Secure onboarding link issued (resent to override address, not saved to candidate record)`
    : 'Secure onboarding link issued';
  await db.execute(
    `INSERT INTO ats_candidate_stage_log
       (id, candidate_id, from_stage, to_stage, remarks, updated_by)
     VALUES (UUID(), ?, 'Selected', 'Onboarding Link Sent', ?, ?)`,
    [candidateId, stageLogRemarks, requestedBy],
  );

  const baseUrl = env.FRONTEND_URL || 'http://localhost:5173';
  const onboardingLink = `${baseUrl}/onboard-full?token=${savedToken}`;

  const sendTo = overrideEmail || cand.email;
  // Previously swallowed into console.error only — the route handler then always answered
  // {ok: true}, so the UI showed "link sent" on every SMTP failure, including the account-wide
  // Gmail lockout that made every real send fail for over 30 minutes on 2026-08-26 while HR kept
  // being told each resend had worked. Tracked and returned instead so the caller can tell HR
  // the truth.
  let emailSent = false;
  let emailError: string | undefined;
  if (sendTo) {
    try {
      await withDeliveryTimeout(
        sendOnboardingTokenEmail({
          candidateId,
          to: sendTo,
          candidateName: cand.full_name,
          onboardingLink,
        }),
        `email delivery for ${candidateId}`,
      );
      emailSent = true;
    } catch (emailErr) {
      emailError = emailErr instanceof Error ? emailErr.message : String(emailErr);
      console.error('[onboarding] email delivery failed for', candidateId, emailError);
    }
  } else {
    emailError = 'No email address on file for this candidate';
  }

  // SMS/WhatsApp fallback for candidates without email (walk-ins)
  let smsSent = false;
  if (cand.mobile) {
    // SmartPing (the live SMS provider) requires a numeric TRAI DLT template id where this
    // used to pass the literal string 'Onboarding Link' — rejected on every send, same class
    // of bug as dispatch.service.ts's (see event-sms-template-map.ts). Fixed by using the
    // already-registered 'onboarding_link' DLT template instead of free text.
    //
    // Known content gap, not fixable in code: that registered template's approved text is
    // "Dear {#var#}, your onboarding process has been initiated. Please complete your details
    // using the HRMS onboarding link sent to you. - Ispark" — one variable slot (name), no URL
    // slot. DLT templates can't include arbitrary free text, so this SMS cannot actually carry
    // the clickable onboardingLink for a candidate with no email — it can only notify them a
    // link exists. Getting the real link to a mobile-only walk-in candidate needs either a new
    // DLT template registered with a URL variable, or a different delivery mechanism; that's a
    // product/compliance decision outside what this fix can resolve.
    try {
      const smsProvider = providerFactory.getProvider('sms');
      const { dltContentId, body: smsBody } = buildSMS('onboarding_link', { name: cand.full_name });
      await withDeliveryTimeout(
        smsProvider.send(cand.mobile, dltContentId, smsBody),
        `SMS delivery for ${candidateId}`,
      );
      smsSent = true;
    } catch (smsErr) {
      // SMS failure must not block token generation — log and continue
      console.error('[onboarding] SMS delivery failed for', candidateId, smsErr instanceof Error ? smsErr.message : String(smsErr));
    }
    // WhatsApp delivery attempt (best-effort) — left as free text deliberately: WhatsApp isn't
    // DLT-regulated the way SMS is, and fixing its own separate reliability issues is out of
    // scope for this SMS-specific change.
    const waBody =
      `Hi ${cand.full_name}, you have been selected! Complete your onboarding at: ${onboardingLink} (valid 15 days)`;
    try {
      const waProvider = providerFactory.getProvider('whatsapp');
      await withDeliveryTimeout(
        waProvider.send(cand.mobile, 'Onboarding Link', waBody),
        `WhatsApp delivery for ${candidateId}`,
      );
    } catch (waErr) {
      console.error('[onboarding] WhatsApp delivery failed for', candidateId, waErr instanceof Error ? waErr.message : String(waErr));
    }
  }

  return { token: savedToken, expiresAt: savedExpiry, emailSent, emailError, smsSent, sentTo: sendTo || undefined };
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

  // This "legacy short form" used to accept a free-text selfie_url with no
  // validation, which silently defeated the mandatory live-capture rule the
  // canonical full-onboarding flow enforces (see findMissingMandatoryDocuments
  // / hasLiveSelfieDocument in onboarding-full.service.ts). Require the same
  // real Live Selfie document here before allowing submission — the frontend
  // now uploads it via the same document endpoint the full flow uses before
  // calling this route. Only the selfie is enforced here; the other 6
  // mandatory document types are out of scope for this short form.
  const hasSelfie = await hasLiveSelfieDocument(candidateId);
  if (!hasSelfie) {
    throw Object.assign(
      new Error('Please capture a live selfie before submitting.'),
      { statusCode: 400, code: 'MISSING_REQUIRED_DOCUMENTS' },
    );
  }

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
    `UPDATE ats_onboarding_request SET status = 'profile_submitted', updated_at = NOW()
     WHERE candidate_id = ?`,
    [candidateId],
  );
  // Ensure a candidate_onboarding_profile row exists so the joining control room
  // profile_status gate is not permanently blocked for candidates who used the
  // legacy short form instead of the canonical full form.
  await db.execute(
    `INSERT INTO candidate_onboarding_profile
       (id, candidate_id, profile_status, submitted_at, created_at, updated_at)
     VALUES (UUID(), ?, 'submitted', NOW(), NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       profile_status = IF(profile_status IN ('pending','draft',''), 'submitted', profile_status),
       submitted_at   = COALESCE(submitted_at, NOW()),
       updated_at     = NOW()`,
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
            c.candidate_status,
            r.branch_id,
            COALESCE(b.branch_name, c.branch_display_name, c.branch_text, c.applied_for_branch) AS branch_name,
            o.id AS offer_id, o.status AS offer_status, o.offered_ctc,
            ob.employee_id, e.employee_code,
            e.joining_document_status, e.joining_document_completion_pct,
            p.profile_status AS form_step,
            p.current_step_idx,
            p.updated_at AS form_last_activity,
            (SELECT COUNT(*) FROM candidate_onboarding_document d
               WHERE d.candidate_id = c.id AND d.deleted_at IS NULL) AS documents_uploaded,
            bank.verification_status AS bank_verification_status
     FROM ats_onboarding_request r
     JOIN ats_candidate c ON c.id = r.candidate_id
     LEFT JOIN branch_master b ON b.id = r.branch_id
     LEFT JOIN ats_employment_offer o ON o.onboarding_request_id = r.id
     LEFT JOIN ats_onboarding_bridge ob ON ob.candidate_id = c.id
     LEFT JOIN employees e ON e.id = ob.employee_id
     LEFT JOIN candidate_onboarding_profile p ON p.candidate_id = c.id
     LEFT JOIN candidate_onboarding_bank_detail bank ON bank.candidate_id = c.id
     WHERE (${scopeFilter.sql})
     ORDER BY r.created_at DESC`,
    scopeFilter.params,
  );
  return rows;
}

// ── HR: Mark candidate as dropped out / not joining ──────────────────────────
//
// Once set, every automated and manual follow-up path (the nightly
// ats-reminders cron, the manual "Send Reminder" button, and "Resend
// Onboarding Link") checks candidate_status and stops contacting this
// candidate. Deliberately written to ats_candidate.candidate_status — a
// free-text VARCHAR(50) column, unlike ats_onboarding_request.status and
// ats_candidate.profile_status, which are both strict ENUMs with no
// "not joining" value today and would need a schema migration to add one.
// The reason/who/when goes to sensitive_action_log (existing audit table,
// already has reason/old_value_json/new_value_json columns) rather than new
// dedicated columns on ats_candidate, for the same no-migration reason.
export async function markCandidateNotJoining(
  candidateId: string,
  actorUserId: string,
  reason: string,
): Promise<{ candidateId: string; candidateStatus: string }> {
  const trimmedReason = String(reason ?? '').trim();
  if (!trimmedReason) {
    throw Object.assign(new Error('A reason is required to mark a candidate as not joining'), { statusCode: 400 });
  }
  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id, candidate_status FROM ats_candidate WHERE id = ? AND active_status = 1 LIMIT 1`,
    [candidateId],
  );
  if (!existing[0]) {
    throw Object.assign(new Error('Candidate not found'), { statusCode: 404 });
  }
  const previousStatus = (existing[0] as RowDataPacket & { candidate_status?: string | null }).candidate_status;
  await db.execute(
    `UPDATE ats_candidate SET candidate_status = 'not_joining' WHERE id = ?`,
    [candidateId],
  );
  const { logSensitiveAction } = await import('../../shared/auditLog.js');
  await logSensitiveAction({
    actor_user_id: actorUserId,
    action_type: 'CANDIDATE_MARKED_NOT_JOINING',
    module_key: 'ats_onboarding',
    entity_type: 'ats_candidate',
    entity_id: candidateId,
    reason: trimmedReason,
    old_value_json: { candidate_status: previousStatus ?? null },
    new_value_json: { candidate_status: 'not_joining' },
  });
  return { candidateId, candidateStatus: 'not_joining' };
}

// ── HR: Reverse a "not joining" mark (candidate changed their mind) ─────────
export async function clearCandidateNotJoining(candidateId: string, actorUserId: string): Promise<{ candidateId: string }> {
  await db.execute(
    `UPDATE ats_candidate
        SET candidate_status = IF(candidate_status = 'not_joining', 'selected', candidate_status)
      WHERE id = ?`,
    [candidateId],
  );
  const { logSensitiveAction } = await import('../../shared/auditLog.js');
  await logSensitiveAction({
    actor_user_id: actorUserId,
    action_type: 'CANDIDATE_NOT_JOINING_CLEARED',
    module_key: 'ats_onboarding',
    entity_type: 'ats_candidate',
    entity_id: candidateId,
  });
  return { candidateId };
}

// ── HR: Send Progress Reminder to Candidate ──────────────────────────────────

const STEP_REMINDER_MESSAGES: Record<number, string> = {
  0: 'Please start by completing the Welcome & Consent step — accept the privacy policy and verify your mobile OTP to begin.',
  1: 'You left off at the Personal Details step. Please complete your basic personal information to continue.',
  2: 'You stopped at the Address & KYC step. Please fill in your address and upload your Aadhaar/PAN details.',
  3: 'Please upload your required documents (Aadhaar card, PAN card, etc.) on the Documents step to continue.',
  4: 'You need to complete the BGV & Verification step. Please grant consent for background verification to proceed.',
  5: 'Please complete your Bank Details on the onboarding form to continue.',
  6: 'Please fill in your Education details to continue.',
  7: 'Please provide your Work Experience details to continue.',
  8: 'Please complete your Family & Language details to continue.',
  9: "You're almost done! Please open your onboarding form, accept the Statutory Declaration, and click the Submit button to finish.",
};

const STEP_LABELS_SHORT = [
  'Welcome & Consent', 'Personal Details', 'Address & KYC', 'Documents',
  'BGV & Verification', 'Bank Details', 'Education', 'Experience',
  'Family & Language', 'Statutory Declaration',
];

export async function sendOnboardingProgressReminder(
  candidateId: string,
  _requestedBy: string,
): Promise<{ sent: boolean; channel: string[] }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.full_name, c.mobile, c.email, c.candidate_status,
            b.onboarding_token, b.onboarding_token_expires_at,
            p.profile_status AS form_step, p.current_step_idx,
            p.bgv_consent, p.dpdp_consent
     FROM ats_candidate c
     JOIN ats_onboarding_bridge b ON b.candidate_id = c.id
     LEFT JOIN candidate_onboarding_profile p ON p.candidate_id = c.id
     WHERE c.id = ? AND c.active_status = 1
     LIMIT 1`,
    [candidateId],
  );
  if (!rows.length) throw Object.assign(new Error('Candidate not found'), { statusCode: 404 });
  const row = rows[0];
  // Candidate said they're not joining — every follow-up path respects this
  // (see markCandidateNotJoining), so a reminder must not be sent even if
  // someone clicks the button before the UI catches up.
  if (row.candidate_status === 'not_joining') {
    throw Object.assign(
      new Error('This candidate is marked as not joining — no further reminders are sent'),
      { statusCode: 409 },
    );
  }
  if (!row.onboarding_token) throw Object.assign(new Error('No onboarding token found — please resend the link first'), { statusCode: 400 });

  const stepIdx: number = row.current_step_idx ?? 0;
  const stepName = STEP_LABELS_SHORT[stepIdx] ?? `Step ${stepIdx + 1}`;
  const stepMsg = STEP_REMINDER_MESSAGES[stepIdx] ?? STEP_REMINDER_MESSAGES[0];

  // Add consent-specific nudge if blocked
  const consentNote = !row.dpdp_consent
    ? '\n\nImportant: Your Privacy (DPDP) consent has not been recorded. Please complete the Welcome step first.'
    : !row.bgv_consent
    ? '\n\nImportant: Your BGV consent is pending. Please complete the BGV & Verification step.'
    : '';

  const baseUrl = env.FRONTEND_URL || 'http://localhost:5173';
  const onboardingLink = `${baseUrl}/onboard-full?token=${row.onboarding_token}`;
  const whatsappBody = `Hi ${row.full_name},\n\nYour onboarding form is incomplete. You last reached: ${stepName} (step ${stepIdx + 1} of 10).\n\n${stepMsg}${consentNote}\n\nContinue here: ${onboardingLink}\n\n— MAS Callnet HR`;

  const sent: string[] = [];

  if (row.email) {
    try {
      await withDeliveryTimeout(
        sendOnboardingTokenEmail({ candidateId, to: row.email, candidateName: row.full_name, onboardingLink }),
        `reminder email for ${candidateId}`,
      );
      sent.push('email');
    } catch (e) {
      console.error('[reminder] email failed for', candidateId, e instanceof Error ? e.message : String(e));
    }
  }

  if (row.mobile) {
    try {
      const waProvider = providerFactory.getProvider('whatsapp');
      await withDeliveryTimeout(
        waProvider.send(row.mobile, 'Onboarding Reminder', whatsappBody),
        `reminder WhatsApp for ${candidateId}`,
      );
      sent.push('whatsapp');
    } catch (e) {
      console.error('[reminder] WhatsApp failed for', candidateId, e instanceof Error ? e.message : String(e));
    }
    // Not attempted over SMS, deliberately — same 'Onboarding Reminder' human-label-in-DLT-id-slot
    // bug as the two fixed above, but unlike onboarding_link there is no registered DLT template
    // for this content at all: the message is per-step dynamic (stepName/stepMsg/consentNote vary
    // by where the candidate is stuck), and none of the 63 registered SmartPing templates match a
    // "resume your onboarding form" reminder. Calling smsProvider.send with SOME id here would
    // either be rejected (a template that doesn't match the vars) or, worse, a DLT compliance
    // violation if it somehow got accepted with different content than what's registered — so
    // this stays WhatsApp/email only until a matching template is registered upstream.
    console.warn(`[reminder] SMS not attempted for ${candidateId} — no registered DLT template for onboarding reminders`);
  }

  await db.execute(
    `UPDATE ats_onboarding_bridge SET reminder_sent_at = NOW() WHERE candidate_id = ?`,
    [candidateId],
  );

  return { sent: sent.length > 0, channel: sent };
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

  // ats_employment_offer.emp_type stores mixed-case values ('OnRoll','OffRoll','OFFROLL').
  // ats_payroll_hr_validation.employment_type is ENUM('onroll','offrole') — strict mode
  // throws Data truncated on any case mismatch, and the .catch() above swallows it
  // silently, leaving no pv row and causing validateSalaryLock to return
  // "Branch Head approval pending". Normalise here once before either branch.
  const empType: string = (() => {
    const raw = String(o.emp_type ?? 'onroll').toLowerCase().replace(/[-_\s]/g, '');
    if (raw.includes('off')) return 'offrole';
    return 'onroll';
  })();

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
      // salary_start_date = COALESCE(?, joining_date): "" is not the NULL
      // sentinel, so a blank salary-start date threw ER_TRUNCATED_WRONG_VALUE
      // instead of falling back to the joining date.
      [empType, o.gross, o.date_of_joining, blankToNull(o.date_of_salary),
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
      [candidateId, o.branch_id ?? null, payrollHrId, empType,
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

/**
 * Syncs the candidate's onboarding "Process Name" to the process linked to
 * the offer's cost centre — only when that link actually resolves. Never
 * overwrites an existing applied_for_process with NULL.
 *
 * This is a safe no-op today: per listPendingApprovals' own note above,
 * cost_centre_master.process_id is NULL on almost every row in production,
 * so most calls will find nothing to sync until that column is backfilled
 * (a separate, Finance-owned data task). Once it is, offers saved against a
 * linked cost centre will keep the candidate's onboarding Process Name in
 * step with HR's actual cost-centre selection instead of the stale value
 * captured at registration.
 */
async function syncCandidateProcessFromCostCentre(
  candidateId: string,
  costCentreId: string | null,
): Promise<void> {
  if (!costCentreId) return;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT process_id FROM cost_centre_master WHERE id = ? LIMIT 1`,
    [costCentreId],
  ).catch(() => [[] as RowDataPacket[], undefined] as unknown as [RowDataPacket[], unknown]);
  const processId = (rows as RowDataPacket[])[0]?.process_id;
  if (!processId) return; // not linked — leave applied_for_process untouched
  await db.execute(
    `UPDATE ats_candidate SET applied_for_process = ?, updated_at = NOW() WHERE id = ?`,
    [String(processId), candidateId],
  ).catch((e) => console.warn('[syncCandidateProcessFromCostCentre] update failed:', e));
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

    // When resubmitting after a Branch Head rejection, the ats_branch_head_approval
    // row still holds approval_status='rejected'. recordBranchHeadDecision's UPDATE
    // guard is AND approval_status='pending', so it would fall through to
    // alreadyDecided:true and validateSalaryLock would find 'rejected' → the candidate
    // would be permanently stuck. Reset the row to 'pending' here so the BH can
    // approve the revised offer. Only touches the row if it exists and is 'rejected'
    // — a fresh offer with no row or a still-pending row is left untouched.
    await db.execute(
      `UPDATE ats_branch_head_approval bha
         JOIN ats_payroll_hr_validation pv ON pv.id = bha.payroll_validation_id
        SET bha.approval_status = 'pending',
            bha.branch_head_id  = NULL,
            bha.remarks         = NULL,
            bha.approved_at     = NULL,
            bha.updated_at      = NOW()
        WHERE pv.candidate_id = ? AND bha.approval_status = 'rejected'`,
      [req.candidate_id],
    ).catch((e) => console.error('[saveOffer] could not reset branch_head_approval:', e));

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

    // Inbox notification to Branch Head — covers both first submission and
    // resubmission after rejection. Resolves the BH by user_assignment_scope
    // (the modern path) or by branch_head_assignments (legacy), same union the
    // approval queue itself uses, so the notification always reaches whoever
    // can actually act on it.
    db.execute<RowDataPacket[]>(
      `SELECT DISTINCT u.id AS user_id
         FROM auth_user u
         JOIN user_roles ur ON ur.user_id = u.id AND ur.role_key = 'branch_head' AND ur.active_status = 1
         JOIN employees e ON e.user_id = u.id AND e.active_status = 1
        WHERE e.id IN (
          SELECT bha2.branch_head_id FROM branch_head_assignments bha2
           WHERE bha2.is_active = TRUE
             AND bha2.branch_name IN (
               SELECT COALESCE(b.branch_name, c2.applied_for_branch)
                 FROM ats_candidate c2
                 LEFT JOIN branch_master b
                        ON b.id = c2.applied_for_branch
                        OR b.branch_name = c2.applied_for_branch
                        OR b.branch_code = c2.applied_for_branch
                WHERE c2.id = ?
             )
        )
        UNION
        SELECT DISTINCT u2.id AS user_id
          FROM auth_user u2
          JOIN user_assignment_scope uas ON uas.user_id = u2.id
                 AND uas.role_key = 'branch_head' AND uas.active_status = 1
          JOIN user_roles ur2 ON ur2.user_id = u2.id AND ur2.role_key = 'branch_head' AND ur2.active_status = 1
          JOIN ats_onboarding_request r2 ON r2.id = ?
         WHERE uas.branch_id = r2.branch_id`,
      [req.candidate_id, requestId],
    ).then(async ([bhRows]) => {
      await Promise.allSettled(
        (bhRows as RowDataPacket[]).map((r) =>
          inboxService.createItem({
            user_id: String(r.user_id),
            type: 'offer_pending_approval',
            title: `Offer awaiting approval: ${String(req.full_name)}`,
            description: `Revised salary offer for ${String(req.full_name)} is ready for your approval. CTC: ₹${components.offered_ctc * 12}/year · Joining: ${offerData.date_of_joining}`,
            entity_type: 'candidate',
            entity_id: String(req.candidate_id),
            action_url: '/ats/offer-approvals',
            priority: 'normal',
          })
        )
      );
    }).catch((e) => console.error('[saveOffer] could not send BH inbox notification:', e));
  }

  await syncCandidateProcessFromCostCentre(String(req.candidate_id), (offerData.cost_centre as string | undefined) ?? null);

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
            b.branch_name,
            -- Cost centre and process, so the branch head can see WHAT they are
            -- approving a head against and not just who. The offer already
            -- carries the cost centre; nothing surfaced it.
            cc.cost_centre_code, cc.cost_centre_name, cc.client_name,
            -- Process is not on the offer and not on the cost centre either —
            -- cost_centre_master.process_id is NULL on every row in production,
            -- so it cannot be the source. It comes from the candidate, where
            -- applied_for_process is VARCHAR holding a process_master id on some
            -- rows and a process name on others; resolve both.
            -- Scalar subqueries, not joins. Both masters hold duplicate names —
            -- 'Team Leader' is in designation_master twice, and process_master
            -- has two 'BSS-OTHERS', two 'C-SAT', two 'CMG -OTHERS' — so a join
            -- returns the candidate once per duplicate and the branch head sees
            -- the same person listed twice. A scalar subquery cannot fan out.
            -- Both tables are ~130 rows, so the OR costs nothing here.
            (SELECT p.process_name FROM process_master p
              WHERE p.id = c.applied_for_process OR p.process_name = c.applied_for_process
              ORDER BY (p.id = c.applied_for_process) DESC, p.process_name
              LIMIT 1) AS process_name,
            -- 93 candidates hold a DESIGNATION in applied_for_process rather
            -- than a process — 'Quality Analyst' (62), 'Team Leader' (26),
            -- 'Operations' (5). Echoing that as the process is worse than
            -- showing nothing: it reads as a real mapping and the branch head
            -- has no way to tell. Flagged so the UI can say what is wrong.
            EXISTS (SELECT 1 FROM designation_master d
                     WHERE d.designation_name = c.applied_for_process) AS process_is_designation,
            -- The raw label, only when it is neither an unresolved id nor a
            -- designation. Values like 'Housing' and 'GPI' are real campaigns
            -- that simply are not in process_master, and are worth showing as
            -- unverified rather than hiding.
            CASE
              WHEN c.applied_for_process REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-' THEN NULL
              ELSE NULLIF(TRIM(c.applied_for_process), '')
            END AS process_raw,
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
            ) AS payroll_validated,
            -- The two dates Payroll HR actually commits to, which are NOT the
            -- same field as o.date_of_joining above. That column is whatever was
            -- typed into the Employment Offer form -- in practice the ATS
            -- walk-in date -- and the UI now labels it as such. These are the
            -- operative ones: joining_date is day 1 in office and
            -- salary_start_date is when salary generation begins, both written
            -- by POST /api/ats/payroll-hr/validate.
            --
            -- Scalar subqueries for the reason given above: candidate_id carries
            -- only INDEX idx_candidate, with no unique constraint, so a join
            -- would fan the candidate out once per validation row the day a
            -- second one is written. Ordered so the newest validation wins.
            (SELECT pv2.joining_date FROM ats_payroll_hr_validation pv2
              WHERE pv2.candidate_id = c.id
              ORDER BY pv2.validated_at DESC, pv2.created_at DESC
              LIMIT 1) AS payroll_joining_date,
            (SELECT pv3.salary_start_date FROM ats_payroll_hr_validation pv3
              WHERE pv3.candidate_id = c.id
              ORDER BY pv3.validated_at DESC, pv3.created_at DESC
              LIMIT 1) AS payroll_salary_start_date
     FROM ats_employment_offer o
     JOIN ats_onboarding_request r ON r.id = o.onboarding_request_id
     JOIN ats_candidate c ON c.id = r.candidate_id
     LEFT JOIN branch_master b ON b.id = r.branch_id
     LEFT JOIN cost_centre_master cc ON cc.id = o.cost_centre
     WHERE o.status = 'submitted'
       AND (${scopeFilter.sql})
     ORDER BY o.submitted_at ASC`,
    scopeFilter.params,
  );
  return rows;
}

// ── Branch Head: Approve ──────────────────────────────────────────────────────

import { createEmployeeFromCandidate } from '../employees/employee-creation-orchestrator.service.js';

import { blankToNull } from "../../shared/sql-values.js";
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

  // Undo our own write. Creation fails for reasons unrelated to the branch
  // head's judgement — an inactive reporting manager, a missing statutory
  // field — and leaving the row 'approved' would strand the offer as decided
  // with no employee behind it and no way to decide it again.
  const undoOwnDecision = async () => {
    if (decision.recorded && !decision.alreadyDecided && decision.payrollValidationId) {
      await revertBranchHeadDecision({ payrollValidationId: decision.payrollValidationId })
        .catch((e) => console.error('[approveOffer] could not revert branch head decision:', e));
    }
  };

  // Use orchestrator with all business rules.
  //
  // A THROW has to undo the decision too, not just a returned blocker. Only the
  // blocker path was covered, so when checkBgvReadiness raised
  // ER_BAD_FIELD_ERROR the row stayed 'approved' with no employee behind it and
  // nothing pending for anyone to decide again — the state SOFIYA SULTAN /
  // MAS62457 was left in on 2026-08-04.
  let result: Awaited<ReturnType<typeof createEmployeeFromCandidate>>;
  try {
    result = await createEmployeeFromCandidate({
      candidateId,
      offerId,
      approverId,
    });
  } catch (err) {
    await undoOwnDecision();
    throw err;
  }

  if (!result.success) {
    await undoOwnDecision();
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
  if (!decision.alreadyDecided) {
    await db.execute(
      `INSERT INTO ats_offer_approval (id, offer_id, approver_id, action, remarks)
       VALUES (UUID(), ?, ?, 'approved', ?)`,
      [offerId, approverId, remarks ?? null],
    ).catch((e) => console.error('[approveOffer] offer approval trail insert failed:', e));

    await db.execute(
      `UPDATE ats_candidate SET current_stage = 'offer_approved', updated_at = NOW() WHERE id = ?`,
      [candidateId],
    ).catch(() => undefined);

    await db.execute(
      `INSERT INTO ats_candidate_stage_log
         (id, candidate_id, from_stage, to_stage, remarks, updated_by)
       VALUES (UUID(), ?, 'payroll_validated', 'offer_approved', ?, ?)`,
      [candidateId, remarks || 'Branch Head approved final offer', approverEmployeeId],
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

  // hasScopedAccess compares user_assignment_scope.branch_id (UUID) against
  // applied_for_branch, which stores a branch name or code — never a UUID on
  // legacy candidates. Use resolveBranchHeadScope instead so the name/id union
  // matches correctly. Admin/super_admin bypass via unrestricted flag.
  const scope = await resolveBranchHeadScope(approverId);
  if (!scope.unrestricted) {
    const b = String(row.applied_for_branch ?? '');
    // Resolve applied_for_branch to a branch_master row so we can compare both name and id.
    const [bmRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, branch_name, branch_code FROM branch_master
        WHERE id = ? OR branch_name = ? OR branch_code = ? LIMIT 1`,
      [b, b, b],
    );
    const bm = bmRows[0] as RowDataPacket | undefined;
    const nameMatch = scope.branchNames.some(
      (n) => n === b || n === bm?.branch_name || n === bm?.branch_code,
    );
    const idMatch = bm?.id && scope.branchIds.includes(String(bm.id));
    if (!nameMatch && !idMatch) {
      throw Object.assign(new Error('Access denied'), { statusCode: 403 });
    }
  }

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

  // Inbox notification to the Payroll HR who validated this salary so they know
  // to revise and resubmit. BH rejection was previously silent in-app — HR had
  // to manually poll /ats/onboarding-requests to discover it.
  db.execute<RowDataPacket[]>(
    `SELECT DISTINCT e.user_id
       FROM ats_payroll_hr_validation pv
       JOIN employees e ON e.id = pv.payroll_hr_id AND e.active_status = 1
      WHERE pv.candidate_id = ?
      ORDER BY COALESCE(pv.validated_at, pv.created_at) DESC
      LIMIT 1`,
    [row.candidate_id],
  ).then(async ([hrRows]) => {
    const hrUserId = (hrRows as RowDataPacket[])[0]?.user_id;
    if (!hrUserId) return;
    await inboxService.createItem({
      user_id: String(hrUserId),
      type: 'offer_rejected_by_branch_head',
      title: `Offer rejected: ${String(row.full_name ?? 'Candidate')}`,
      description: `Branch Head rejected the offer for ${String(row.full_name ?? 'this candidate')}${remarks ? ` — "${remarks}"` : ''}. Please revise the salary and resubmit.`,
      entity_type: 'candidate',
      entity_id: String(row.candidate_id),
      action_url: '/ats/onboarding-requests',
      priority: 'high',
    });
  }).catch((e) => console.error('[rejectOffer] could not notify payroll HR:', e));
}
