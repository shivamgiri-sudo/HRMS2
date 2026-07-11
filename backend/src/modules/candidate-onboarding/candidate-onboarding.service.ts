import bcrypt from "bcryptjs";
import { createHash, randomBytes, randomInt, randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { sendOtpSms } from "../auth/sms.helper.js";
import { validateOnboardingToken, getFullOnboardingStatus } from "../ats/onboarding-full.service.js";
import { getBgvStatusByToken } from "../ats/bgv-verification.service.js";

const OTP_TTL_MINUTES = 10;
const SESSION_TTL_HOURS = 12;
const OTP_RESEND_WINDOW_MINUTES = 15;
const OTP_RESEND_LIMIT = 5;

type RequestMeta = {
  ip?: string;
  userAgent?: string;
};

function sha256(value: unknown): string {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function normalizeMobile(value: unknown): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function maskMobile(value: unknown): string {
  const mobile = normalizeMobile(value);
  return mobile ? `XXXXXX${mobile.slice(-4)}` : "";
}

function sessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function otpCode(): string {
  return String(randomInt(100000, 1000000));
}

async function onboardingIdForCandidate(candidateId: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM ats_onboarding_bridge WHERE candidate_id = ? ORDER BY updated_at DESC LIMIT 1`,
    [candidateId]
  );
  return rows[0]?.id ? String(rows[0].id) : null;
}

async function resolveTokenCandidate(token: string) {
  if (!token) throw Object.assign(new Error("Onboarding token is required"), { statusCode: 400 });
  const tokenData = await validateOnboardingToken(token);
  const candidateId = String(tokenData.candidate_id);
  return {
    tokenData,
    candidateId,
    onboardingId: await onboardingIdForCandidate(candidateId),
    registeredMobile: normalizeMobile(tokenData.mobile),
  };
}

async function ensureProgress(candidateId: string, onboardingId: string | null) {
  await db.execute(
    `INSERT INTO candidate_onboarding_progress
       (id, candidate_id, onboarding_id, current_step_key, current_step_idx, completion_percent, pending_action_count)
     VALUES (?, ?, ?, 'welcome', 0, 0, 0)
     ON DUPLICATE KEY UPDATE onboarding_id = COALESCE(VALUES(onboarding_id), onboarding_id), updated_at = NOW()`,
    [randomUUID(), candidateId, onboardingId]
  );
}

async function latestActiveSession(candidateId: string, tokenHash: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, expires_at
       FROM candidate_onboarding_sessions
      WHERE candidate_id = ?
        AND session_token_hash = ?
        AND revoked_at IS NULL
        AND expires_at > NOW()
      LIMIT 1`,
    [candidateId, tokenHash]
  );
  return rows[0] ?? null;
}

export async function startCandidateOnboarding(token: string, input: { mobile?: string }) {
  const { tokenData, registeredMobile } = await resolveTokenCandidate(token);
  const requestedMobile = normalizeMobile(input.mobile);
  const mobile = requestedMobile || registeredMobile;
  if (requestedMobile && registeredMobile && requestedMobile !== registeredMobile) {
    throw Object.assign(new Error("Mobile number change requires HR approval before onboarding can continue."), { statusCode: 409 });
  }

  return {
    candidateCode: tokenData.candidate_code,
    candidateName: tokenData.full_name,
    branchName: tokenData.branch_name,
    processName: tokenData.process_name,
    mobileMasked: maskMobile(mobile),
    mobilePrefilled: Boolean(registeredMobile),
    otpRequired: true,
  };
}

export async function sendCandidateOnboardingOtp(token: string, input: { mobile?: string }, meta: RequestMeta) {
  const { candidateId, onboardingId, registeredMobile } = await resolveTokenCandidate(token);
  const requestedMobile = normalizeMobile(input.mobile);
  const mobile = requestedMobile || registeredMobile;
  if (!/^\d{10}$/.test(mobile)) {
    throw Object.assign(new Error("A valid 10-digit mobile number is required"), { statusCode: 400 });
  }
  if (requestedMobile && registeredMobile && requestedMobile !== registeredMobile) {
    throw Object.assign(new Error("Mobile number change requires HR approval before onboarding can continue."), { statusCode: 409 });
  }

  const mobileHash = sha256(mobile);
  const [recentRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt
       FROM candidate_otp_logs
      WHERE mobile_hash = ?
        AND purpose = 'onboarding_login'
        AND created_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
    [mobileHash, OTP_RESEND_WINDOW_MINUTES]
  );
  if (Number(recentRows[0]?.cnt ?? 0) >= OTP_RESEND_LIMIT) {
    throw Object.assign(new Error("Too many OTP requests. Please try again later."), { statusCode: 429 });
  }

  const code = otpCode();
  const hash = await bcrypt.hash(code, 10);
  const deliverySent = await sendOtpSms(mobile, code);
  await db.execute(
    `INSERT INTO candidate_otp_logs
       (id, candidate_id, onboarding_id, mobile_hash, mobile_last4, otp_hash, purpose,
        delivery_channel, delivery_status, expires_at, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, 'onboarding_login', 'sms', ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), ?, ?)`,
    [
      randomUUID(),
      candidateId,
      onboardingId,
      mobileHash,
      mobile.slice(-4),
      hash,
      deliverySent ? "sent" : "failed",
      OTP_TTL_MINUTES,
      meta.ip ?? null,
      meta.userAgent ?? null,
    ]
  );

  return {
    mobileMasked: maskMobile(mobile),
    expiresInSeconds: OTP_TTL_MINUTES * 60,
    deliveryStatus: deliverySent ? "sent" : "queued",
    message: "If the mobile number is valid, an OTP has been sent.",
  };
}

export async function verifyCandidateOnboardingOtp(
  token: string,
  input: { mobile?: string; otp?: string; deviceId?: string },
  meta: RequestMeta
) {
  const { candidateId, onboardingId, registeredMobile } = await resolveTokenCandidate(token);
  const mobile = normalizeMobile(input.mobile) || registeredMobile;
  const otp = String(input.otp ?? "").trim();
  if (!/^\d{6}$/.test(otp)) {
    throw Object.assign(new Error("Enter the 6-digit OTP"), { statusCode: 400 });
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, otp_hash, attempts, max_attempts
       FROM candidate_otp_logs
      WHERE candidate_id = ?
        AND mobile_hash = ?
        AND purpose = 'onboarding_login'
        AND verified_at IS NULL
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1`,
    [candidateId, sha256(mobile)]
  );
  const challenge = rows[0];
  if (!challenge) throw Object.assign(new Error("Invalid or expired OTP"), { statusCode: 401 });
  if (Number(challenge.attempts) >= Number(challenge.max_attempts)) {
    throw Object.assign(new Error("Maximum OTP attempts exceeded. Request a new OTP."), { statusCode: 429 });
  }

  const valid = await bcrypt.compare(otp, String(challenge.otp_hash));
  await db.execute(`UPDATE candidate_otp_logs SET attempts = attempts + 1, updated_at = NOW() WHERE id = ?`, [challenge.id]);
  if (!valid) throw Object.assign(new Error("Invalid or expired OTP"), { statusCode: 401 });

  await db.execute(`UPDATE candidate_otp_logs SET verified_at = NOW(), updated_at = NOW() WHERE id = ?`, [challenge.id]);

  const rawToken = sessionToken();
  const tokenHash = sha256(rawToken);
  await db.execute(
    `INSERT INTO candidate_onboarding_sessions
       (id, candidate_id, onboarding_id, session_token_hash, device_id, mobile_last4,
        ip_address, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))`,
    [
      randomUUID(),
      candidateId,
      onboardingId,
      tokenHash,
      input.deviceId ?? null,
      mobile.slice(-4),
      meta.ip ?? null,
      meta.userAgent ?? null,
      SESSION_TTL_HOURS,
    ]
  );
  await ensureProgress(candidateId, onboardingId);
  await db.execute(
    `INSERT INTO candidate_onboarding_readiness (id, candidate_id, onboarding_id, otp_verified, readiness_status)
     VALUES (?, ?, ?, 1, 'candidate_action_pending')
     ON DUPLICATE KEY UPDATE otp_verified = 1, readiness_status = IF(readiness_status = 'not_ready', 'candidate_action_pending', readiness_status), updated_at = NOW()`,
    [randomUUID(), candidateId, onboardingId]
  );

  return {
    sessionToken: rawToken,
    expiresInSeconds: SESSION_TTL_HOURS * 60 * 60,
    candidateId,
  };
}

export async function validateCandidateSession(rawSessionToken: string | undefined, candidateId?: string) {
  const token = String(rawSessionToken ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw Object.assign(new Error("Candidate onboarding session required"), { statusCode: 401 });
  const tokenHash = sha256(token);
  const params: unknown[] = [tokenHash];
  let sql = `SELECT * FROM candidate_onboarding_sessions WHERE session_token_hash = ? AND revoked_at IS NULL AND expires_at > NOW()`;
  if (candidateId) {
    sql += ` AND candidate_id = ?`;
    params.push(candidateId);
  }
  sql += ` LIMIT 1`;
  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  const session = rows[0];
  if (!session) throw Object.assign(new Error("Candidate onboarding session expired. Please verify OTP again."), { statusCode: 401 });
  return session;
}

export async function resumeCandidateOnboarding(token: string, rawSessionToken: string | undefined) {
  const { candidateId } = await resolveTokenCandidate(token);
  await validateCandidateSession(rawSessionToken, candidateId);
  const [progressRows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM candidate_onboarding_progress WHERE candidate_id = ? LIMIT 1`,
    [candidateId]
  );
  const [docMaster] = await db.execute<RowDataPacket[]>(
    `SELECT document_type, document_name, display_name, mandatory_flag, conditional_flag,
            condition_rule, required_count, allowed_file_types, max_file_size_mb,
            verification_method, requires_api_verification, requires_bgv,
            requires_manual_fallback, dpdp_purpose_code, sort_order
       FROM onboarding_document_master
      WHERE candidate_visible = 1 AND active_flag = 1
      ORDER BY sort_order ASC`
  );
  const [readinessRows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM candidate_onboarding_readiness WHERE candidate_id = ? LIMIT 1`,
    [candidateId]
  );
  return {
    progress: progressRows[0] ?? null,
    onboarding: await getFullOnboardingStatus(token),
    bgv: await getBgvStatusByToken(token),
    documentMaster: docMaster,
    readiness: readinessRows[0] ?? null,
  };
}

export async function refreshCandidateOnboardingSession(rawSessionToken: string | undefined) {
  const session = await validateCandidateSession(rawSessionToken);
  await db.execute(
    `UPDATE candidate_onboarding_sessions
        SET expires_at = DATE_ADD(NOW(), INTERVAL ? HOUR), updated_at = NOW()
      WHERE id = ?`,
    [SESSION_TTL_HOURS, session.id]
  );
  return { expiresInSeconds: SESSION_TTL_HOURS * 60 * 60 };
}

export async function logoutCandidateOnboarding(rawSessionToken: string | undefined) {
  const token = String(rawSessionToken ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { loggedOut: true };
  await db.execute(
    `UPDATE candidate_onboarding_sessions SET revoked_at = NOW(), updated_at = NOW() WHERE session_token_hash = ?`,
    [sha256(token)]
  );
  return { loggedOut: true };
}
