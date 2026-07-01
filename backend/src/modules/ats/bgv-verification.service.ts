import { randomUUID, createHash } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getBgvProviderAdapter, type AddressDocInput, type EducationVerificationInput } from "./bgv-provider.adapter.js";
import { validateOnboardingToken } from "./onboarding-full.service.js";

const hashValue = (value: unknown) => {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized ? createHash("sha256").update(normalized).digest("hex") : null;
};
const maskLast4 = (value: unknown, prefix = "XXXXXX") => {
  const clean = String(value ?? "").replace(/\s/g, "");
  return clean ? `${prefix}${clean.slice(-4)}` : null;
};

async function logEvent(candidateId: string, eventType: string, payload?: unknown, checkId?: string | null, meta?: { actorType?: "candidate" | "hr" | "system" | "provider"; actorId?: string | null; ip?: string; userAgent?: string }) {
  await db.execute(
    `INSERT INTO candidate_bgv_verification_event
       (id, candidate_id, check_id, event_type, event_status, event_payload, actor_type, actor_id, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), candidateId, checkId ?? null, eventType, (payload as any)?.status ?? null, payload ? JSON.stringify(payload) : null, meta?.actorType ?? "system", meta?.actorId ?? null, meta?.ip ?? null, meta?.userAgent ?? null]
  );
}

async function ensureConsent(candidateId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM candidate_bgv_consent WHERE candidate_id = ? AND consent_status = 'granted' ORDER BY granted_at DESC LIMIT 1`,
    [candidateId]
  );
  if (!rows.length) throw Object.assign(new Error("BGV consent is required before verification"), { statusCode: 403 });
}

async function getCandidateIdentity(candidateId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.id, c.full_name, c.email, c.mobile, c.date_of_birth,
            p.employee_name, p.pan_number_hash, p.aadhaar_number_hash, p.pan_number_masked, p.aadhaar_number_masked
       FROM ats_candidate c
       LEFT JOIN candidate_onboarding_profile p ON p.candidate_id = c.id
      WHERE c.id = ? LIMIT 1`,
    [candidateId]
  );
  if (!rows.length) throw Object.assign(new Error("Candidate not found"), { statusCode: 404 });
  return rows[0];
}

async function createOrUpdateCheck(candidateId: string, checkType: string, status: string, input: Record<string, unknown>) {
  const checkId = randomUUID();
  await db.execute(
    `INSERT INTO candidate_bgv_check
       (id, candidate_id, check_type, source_document_id, provider_key, provider_request_id,
        provider_reference_id, status, match_score, matched_name, matched_dob, result_summary,
        result_json, risk_flags_json, verified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE updated_at = NOW()`,
    [
      checkId,
      candidateId,
      checkType,
      input.sourceDocumentId ?? null,
      input.providerKey ?? null,
      input.providerRequestId ?? null,
      input.providerReferenceId ?? null,
      status,
      input.matchScore ?? null,
      input.matchedName ?? null,
      input.matchedDob ?? null,
      input.resultSummary ?? null,
      input.resultJson ? JSON.stringify(input.resultJson) : null,
      input.riskFlags ? JSON.stringify(input.riskFlags) : null,
      status === "verified" ? new Date() : null,
    ]
  );
  return checkId;
}

export async function saveBgvConsentByToken(token: string, input: { consentText?: string; purposes?: unknown }, meta?: { ip?: string; userAgent?: string }) {
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;
  const consentTextHash = input.consentText ? createHash("sha256").update(input.consentText).digest("hex") : null;
  await db.execute(
    `INSERT INTO candidate_bgv_consent
       (id, candidate_id, consent_version, consent_text_hash, purpose_json, consent_status, ip_address, user_agent)
     VALUES (?, ?, 'BGV-DPDP-v1', ?, ?, 'granted', ?, ?)`,
    [randomUUID(), candidateId, consentTextHash, input.purposes ? JSON.stringify(input.purposes) : null, meta?.ip ?? null, meta?.userAgent ?? null]
  );
  await logEvent(candidateId, "BGV_CONSENT_GRANTED", { status: "granted", purposes: input.purposes }, null, { actorType: "candidate", ip: meta?.ip, userAgent: meta?.userAgent });
  return getBgvStatusForCandidate(candidateId);
}

export async function getBgvStatusByToken(token: string) {
  const tokenData = await validateOnboardingToken(token);
  return getBgvStatusForCandidate(tokenData.candidate_id as string);
}

export async function getBgvStatusForCandidate(candidateId: string) {
  const [consents] = await db.execute<RowDataPacket[]>(
    `SELECT id, consent_version, consent_status, granted_at, withdrawn_at FROM candidate_bgv_consent WHERE candidate_id = ? ORDER BY granted_at DESC`,
    [candidateId]
  );
  const [checks] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM candidate_bgv_check WHERE candidate_id = ? ORDER BY updated_at DESC`,
    [candidateId]
  );
  const [documents] = await db.execute<RowDataPacket[]>(
    `SELECT id, doc_type, doc_name, document_status, verification_method, verification_ref, uploaded_at
       FROM candidate_onboarding_document
      WHERE candidate_id = ? AND deleted_at IS NULL
      ORDER BY uploaded_at DESC`,
    [candidateId]
  );
  const [bankRows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM candidate_bank_verification WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 5`,
    [candidateId]
  );

  const required = ["aadhaar", "pan"];
  const clearChecks = new Set(checks.filter((c) => ["verified", "waived"].includes(String(c.status))).map((c) => String(c.check_type)));
  const criticalMismatch = checks.some((c) => ["aadhaar", "pan", "bank"].includes(String(c.check_type)) && String(c.status) === "mismatch");
  const bankClear = bankRows.some((b) => ["verified", "waived"].includes(String(b.verification_status)));
  const missing = required.filter((check) => !clearChecks.has(check));
  const score = Math.max(0, Math.min(100,
    (clearChecks.has("aadhaar") ? 25 : 0) +
    (clearChecks.has("pan") ? 20 : 0) +
    (bankClear ? 20 : 0) +
    (clearChecks.has("address") ? 10 : 0) +
    (clearChecks.has("education") ? 10 : 0) +
    (clearChecks.has("experience") ? 10 : 0) +
    (clearChecks.has("photo_match") ? 5 : 0)
  ));

  return {
    candidate_id: candidateId,
    consent: consents[0] ?? null,
    checks,
    documents,
    bank_verifications: bankRows,
    score,
    overall_status: criticalMismatch ? "hold" : missing.length === 0 ? "clear" : score >= 60 ? "conditional" : "pending",
    missing_mandatory_checks: missing,
    employee_creation_ready: !criticalMismatch && missing.length === 0,
    payroll_activation_ready: !criticalMismatch && clearChecks.has("pan") && bankClear,
  };
}

export async function verifyPanByToken(token: string, input: { panNumber?: string }, meta?: { ip?: string; userAgent?: string }) {
  const tokenData = await validateOnboardingToken(token);
  return verifyPanForCandidate(tokenData.candidate_id as string, input, { actorType: "candidate", ip: meta?.ip, userAgent: meta?.userAgent });
}

export async function verifyPanForCandidate(candidateId: string, input: { panNumber?: string }, meta?: { actorType?: "candidate" | "hr" | "system"; actorId?: string | null; ip?: string; userAgent?: string }) {
  await ensureConsent(candidateId);
  const candidate = await getCandidateIdentity(candidateId);
  const pan = String(input.panNumber ?? "").trim().toUpperCase();
  if (!pan) throw Object.assign(new Error("PAN number is required"), { statusCode: 400 });
  const adapter = getBgvProviderAdapter();
  const started = Date.now();
  const result = await adapter.verifyPan({ candidateName: candidate.employee_name ?? candidate.full_name, dateOfBirth: candidate.date_of_birth, panNumber: pan });
  const checkId = await createOrUpdateCheck(candidateId, "pan", result.status, {
    providerKey: result.providerKey,
    providerRequestId: result.providerRequestId,
    providerReferenceId: result.providerReferenceId,
    matchScore: result.matchScore,
    matchedName: result.matchedName,
    matchedDob: result.matchedDob,
    resultSummary: result.resultSummary,
    resultJson: result.raw,
    riskFlags: result.riskFlags,
  });
  await db.execute(
    `INSERT INTO candidate_bgv_api_request_log
       (id, candidate_id, check_id, provider_key, endpoint_key, request_ref, request_payload_hash, response_status_code, response_payload, duration_ms, success_flag)
     VALUES (?, ?, ?, ?, 'PAN_VERIFY', ?, ?, 200, ?, ?, ?)`,
    [randomUUID(), candidateId, checkId, result.providerKey, result.providerRequestId, hashValue(pan), JSON.stringify(result.raw ?? result), Date.now() - started, result.status === "verified" ? 1 : 0]
  );
  await db.execute(
    `UPDATE candidate_onboarding_profile SET pan_number_masked = ?, pan_number_hash = ?, updated_at = NOW() WHERE candidate_id = ?`,
    [maskLast4(pan, "XXX-"), hashValue(pan), candidateId]
  );
  await logEvent(candidateId, "PAN_VERIFICATION_COMPLETED", result, checkId, meta);
  return getBgvStatusForCandidate(candidateId);
}

export async function verifyBankByToken(token: string, input: { accountNo?: string; ifscCode?: string; accountHolderName?: string }, meta?: { ip?: string; userAgent?: string }) {
  const tokenData = await validateOnboardingToken(token);
  return verifyBankForCandidate(tokenData.candidate_id as string, input, { actorType: "candidate", ip: meta?.ip, userAgent: meta?.userAgent });
}

export async function verifyBankForCandidate(candidateId: string, input: { accountNo?: string; ifscCode?: string; accountHolderName?: string }, meta?: { actorType?: "candidate" | "hr" | "system"; actorId?: string | null; ip?: string; userAgent?: string }) {
  await ensureConsent(candidateId);
  const candidate = await getCandidateIdentity(candidateId);
  let accountNo = String(input.accountNo ?? "").trim();
  let ifscCode = String(input.ifscCode ?? "").trim().toUpperCase();
  let accountHolderName = input.accountHolderName;
  if (!accountNo || !ifscCode) {
    const [bankRows] = await db.execute<RowDataPacket[]>(`SELECT * FROM candidate_onboarding_bank_detail WHERE candidate_id = ? LIMIT 1`, [candidateId]);
    const bank = bankRows[0];
    if (!bank) throw Object.assign(new Error("Bank details are required before verification"), { statusCode: 400 });
    ifscCode = ifscCode || String(bank.ifsc_code ?? "");
    accountHolderName = accountHolderName || String(bank.account_holder_name ?? "");
    // Raw account is intentionally not recoverable once hashed. Candidate must enter raw account for verification.
  }
  if (!accountNo) throw Object.assign(new Error("Raw account number is required for digital verification"), { statusCode: 400 });
  const adapter = getBgvProviderAdapter();
  const started = Date.now();
  const result = await adapter.verifyBank({ candidateName: candidate.employee_name ?? candidate.full_name, accountHolderName, accountNo, ifscCode });
  const checkId = await createOrUpdateCheck(candidateId, "bank", result.status, {
    providerKey: result.providerKey,
    providerRequestId: result.providerRequestId,
    providerReferenceId: result.providerReferenceId,
    matchScore: result.matchScore,
    matchedName: result.matchedName,
    resultSummary: result.resultSummary,
    resultJson: result.raw,
    riskFlags: result.riskFlags,
  });
  await db.execute(
    `INSERT INTO candidate_bank_verification
       (id, candidate_id, account_no_last4, account_no_hash, ifsc_code, input_account_holder_name,
        provider_account_holder_name, name_match_score, verification_method, provider_key, provider_reference_id,
        verification_status, result_json, verified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'mock', ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      candidateId,
      String(accountNo).slice(-4),
      hashValue(accountNo),
      ifscCode,
      accountHolderName ?? null,
      result.matchedName ?? null,
      result.matchScore ?? null,
      result.providerKey,
      result.providerReferenceId,
      result.status,
      JSON.stringify(result.raw ?? result),
      result.status === "verified" ? new Date() : null,
    ]
  );
  await db.execute(
    `UPDATE candidate_onboarding_bank_detail
        SET account_no_masked = ?, account_no_hash = ?, ifsc_code = ?, verification_status = ?,
            provider_name = ?, verification_ref = ?, verified_account_holder_name = ?, verified_at = ?, updated_at = NOW()
      WHERE candidate_id = ?`,
    [maskLast4(accountNo), hashValue(accountNo), ifscCode, result.status, result.providerKey, result.providerReferenceId, result.matchedName ?? null, result.status === "verified" ? new Date() : null, candidateId]
  );
  await db.execute(
    `INSERT INTO candidate_bgv_api_request_log
       (id, candidate_id, check_id, provider_key, endpoint_key, request_ref, request_payload_hash, response_status_code, response_payload, duration_ms, success_flag)
     VALUES (?, ?, ?, ?, 'BANK_VERIFY', ?, ?, 200, ?, ?, ?)`,
    [randomUUID(), candidateId, checkId, result.providerKey, result.providerRequestId, hashValue(`${accountNo}|${ifscCode}`), JSON.stringify(result.raw ?? result), Date.now() - started, result.status === "verified" ? 1 : 0]
  );
  await logEvent(candidateId, "BANK_VERIFICATION_COMPLETED", result, checkId, meta);
  return getBgvStatusForCandidate(candidateId);
}

export async function verifyAadhaarOfflineByToken(token: string, input: { documentId?: string; aadhaarLast4?: string }, meta?: { ip?: string; userAgent?: string }) {
  const tokenData = await validateOnboardingToken(token);
  return verifyAadhaarOfflineForCandidate(tokenData.candidate_id as string, input, { actorType: "candidate", ip: meta?.ip, userAgent: meta?.userAgent });
}

export async function verifyAadhaarOfflineForCandidate(candidateId: string, input: { documentId?: string; aadhaarLast4?: string }, meta?: { actorType?: "candidate" | "hr" | "system"; actorId?: string | null; ip?: string; userAgent?: string }) {
  await ensureConsent(candidateId);
  const candidate = await getCandidateIdentity(candidateId);
  const adapter = getBgvProviderAdapter();
  const result = await adapter.verifyAadhaarOffline({ candidateName: candidate.employee_name ?? candidate.full_name, aadhaarLast4: input.aadhaarLast4, documentId: input.documentId });
  const checkId = await createOrUpdateCheck(candidateId, "aadhaar", result.status, {
    sourceDocumentId: input.documentId ?? null,
    providerKey: result.providerKey,
    providerRequestId: result.providerRequestId,
    providerReferenceId: result.providerReferenceId,
    matchScore: result.matchScore,
    matchedName: result.matchedName,
    resultSummary: result.resultSummary,
    resultJson: result.raw,
    riskFlags: result.riskFlags,
  });
  if (input.documentId) {
    await db.execute(
      `UPDATE candidate_onboarding_document SET document_status = ?, verification_method = 'aadhaar_offline', verification_ref = ? WHERE id = ? AND candidate_id = ?`,
      [result.status === "verified" ? "verified" : "manual_review", result.providerReferenceId, input.documentId, candidateId]
    );
  }
  await logEvent(candidateId, "AADHAAR_OFFLINE_VERIFICATION_COMPLETED", result, checkId, meta);
  return getBgvStatusForCandidate(candidateId);
}

export async function startDigilockerByToken(token: string, requestedDocuments: string[], meta?: { ip?: string; userAgent?: string }) {
  await ensureConsent((await validateOnboardingToken(token)).candidate_id as string);
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;
  const adapter = getBgvProviderAdapter();
  const session = await adapter.startDigilocker(candidateId, requestedDocuments.length ? requestedDocuments : ["AADHAAR", "PAN"]);
  await db.execute(
    `INSERT INTO candidate_digilocker_session
       (id, candidate_id, state_token, provider_key, auth_url, session_status, requested_documents_json, expires_at)
     VALUES (?, ?, ?, 'mock_digilocker', ?, 'created', ?, ?)`,
    [randomUUID(), candidateId, session.state, session.authUrl, JSON.stringify(requestedDocuments), session.expiresAt]
  );
  await logEvent(candidateId, "DIGILOCKER_SESSION_CREATED", { state: session.state, requestedDocuments }, null, { actorType: "candidate", ip: meta?.ip, userAgent: meta?.userAgent });
  return session;
}

export async function providerCallback(input: Record<string, unknown>) {
  const providerRequestId = String(input.providerRequestId ?? input.request_id ?? "");
  const status = String(input.status ?? "in_progress");
  if (!providerRequestId) throw Object.assign(new Error("providerRequestId required"), { statusCode: 400 });
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT * FROM candidate_bgv_check WHERE provider_request_id = ? LIMIT 1`, [providerRequestId]);
  if (!rows.length) throw Object.assign(new Error("Check not found"), { statusCode: 404 });
  const check = rows[0];
  await db.execute(
    `UPDATE candidate_bgv_check SET status = ?, result_json = ?, updated_at = NOW(), verified_at = IF(? = 'verified', NOW(), verified_at) WHERE id = ?`,
    [status, JSON.stringify(input), status, check.id]
  );
  await logEvent(check.candidate_id, "PROVIDER_CALLBACK", { status, input }, check.id, { actorType: "provider" });
  return getBgvStatusForCandidate(check.candidate_id);
}

export async function manualReview(candidateId: string, input: { checkId?: string; status: "verified" | "mismatch" | "failed" | "manual_review"; remarks: string }, actorUserId: string) {
  if (input.checkId) {
    await db.execute(
      `UPDATE candidate_bgv_check SET status = ?, reviewed_by = ?, reviewed_at = NOW(), review_remarks = ?, updated_at = NOW(), verified_at = IF(?='verified', NOW(), verified_at) WHERE id = ? AND candidate_id = ?`,
      [input.status, actorUserId, input.remarks, input.status, input.checkId, candidateId]
    );
  }
  await logEvent(candidateId, "BGV_MANUAL_REVIEW", input, input.checkId ?? null, { actorType: "hr", actorId: actorUserId });
  return getBgvStatusForCandidate(candidateId);
}

export async function waiveCheck(candidateId: string, input: { checkId?: string; exceptionType?: "waiver" | "manual_clear" | "conditional_clear" | "temporary_hold"; reason: string; expiryDate?: string }, actorUserId: string) {
  await db.execute(
    `INSERT INTO candidate_bgv_exception
       (id, candidate_id, check_id, exception_type, reason, approved_by, expiry_date)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), candidateId, input.checkId ?? null, input.exceptionType ?? "waiver", input.reason, actorUserId, input.expiryDate ?? null]
  );
  if (input.checkId) {
    await db.execute(`UPDATE candidate_bgv_check SET status = 'waived', reviewed_by = ?, reviewed_at = NOW(), review_remarks = ?, updated_at = NOW() WHERE id = ? AND candidate_id = ?`, [actorUserId, input.reason, input.checkId, candidateId]);
  }
  await logEvent(candidateId, "BGV_EXCEPTION_APPROVED", input, input.checkId ?? null, { actorType: "hr", actorId: actorUserId });
  return getBgvStatusForCandidate(candidateId);
}

export async function verifyAddressDocByToken(
  token: string,
  input: { docType: AddressDocInput['docType']; documentNumber: string },
  meta?: { ip?: string; userAgent?: string }
) {
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;
  await ensureConsent(candidateId);
  const candidate = await getCandidateIdentity(candidateId);
  const adapter = getBgvProviderAdapter();
  const started = Date.now();
  const result = await adapter.verifyAddressDoc({
    docType: input.docType,
    documentNumber: input.documentNumber,
    candidateName: candidate.employee_name ?? candidate.full_name,
    dateOfBirth: candidate.date_of_birth ?? null,
  });
  const checkId = await createOrUpdateCheck(candidateId, 'address_doc', result.status, {
    providerKey: result.providerKey,
    providerRequestId: result.providerRequestId,
    providerReferenceId: result.providerReferenceId,
    matchScore: result.matchScore,
    matchedName: result.matchedName,
    matchedDob: result.matchedDob,
    resultSummary: result.resultSummary,
    resultJson: result.raw,
    riskFlags: result.riskFlags,
  });
  await db.execute(
    `INSERT INTO candidate_bgv_api_request_log
       (id, candidate_id, check_id, provider_key, endpoint_key, request_ref, request_payload_hash, response_status_code, response_payload, duration_ms, success_flag)
     VALUES (?, ?, ?, ?, 'ADDRESS_DOC_VERIFY', ?, ?, 200, ?, ?, ?)`,
    [randomUUID(), candidateId, checkId, result.providerKey, result.providerRequestId, hashValue(input.documentNumber), JSON.stringify(result.raw ?? result), Date.now() - started, result.status === 'verified' ? 1 : 0]
  );
  await db.execute(
    `UPDATE candidate_bgv_report SET address_doc_type = ?, updated_at = NOW() WHERE candidate_id = ?`,
    [input.docType, candidateId]
  );
  await logEvent(candidateId, 'ADDRESS_DOC_VERIFICATION_COMPLETED', result, checkId, { actorType: 'candidate', ip: meta?.ip, userAgent: meta?.userAgent });
  return getBgvStatusForCandidate(candidateId);
}

export async function verifyEducationByToken(
  token: string,
  input: { boardType: EducationVerificationInput['boardType']; rollNumber?: string; certificateNumber?: string; yearOfPassing: number; institutionName?: string },
  meta?: { ip?: string; userAgent?: string }
) {
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;
  await ensureConsent(candidateId);
  const candidate = await getCandidateIdentity(candidateId);
  const adapter = getBgvProviderAdapter();
  const started = Date.now();
  const result = await adapter.verifyEducation({
    boardType: input.boardType,
    rollNumber: input.rollNumber ?? null,
    certificateNumber: input.certificateNumber ?? null,
    yearOfPassing: input.yearOfPassing,
    candidateName: candidate.employee_name ?? candidate.full_name,
    institutionName: input.institutionName ?? null,
  });
  const checkId = await createOrUpdateCheck(candidateId, 'education_doc', result.status, {
    providerKey: result.providerKey,
    providerRequestId: result.providerRequestId,
    providerReferenceId: result.providerReferenceId,
    matchScore: result.matchScore,
    matchedName: result.matchedName,
    resultSummary: result.resultSummary,
    resultJson: result.raw,
    riskFlags: result.riskFlags,
  });
  await db.execute(
    `INSERT INTO candidate_bgv_api_request_log
       (id, candidate_id, check_id, provider_key, endpoint_key, request_ref, request_payload_hash, response_status_code, response_payload, duration_ms, success_flag)
     VALUES (?, ?, ?, ?, 'EDUCATION_VERIFY', ?, ?, 200, ?, ?, ?)`,
    [randomUUID(), candidateId, checkId, result.providerKey, result.providerRequestId, hashValue(input.rollNumber ?? input.certificateNumber ?? ''), JSON.stringify(result.raw ?? result), Date.now() - started, result.status === 'verified' ? 1 : 0]
  );
  await db.execute(
    `UPDATE candidate_bgv_report SET education_board_type = ?, updated_at = NOW() WHERE candidate_id = ?`,
    [input.boardType, candidateId]
  );
  await logEvent(candidateId, 'EDUCATION_VERIFICATION_COMPLETED', result, checkId, { actorType: 'candidate', ip: meta?.ip, userAgent: meta?.userAgent });
  return getBgvStatusForCandidate(candidateId);
}

export async function verifyCourtByToken(
  token: string,
  meta?: { ip?: string; userAgent?: string }
) {
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;
  await ensureConsent(candidateId);
  const candidate = await getCandidateIdentity(candidateId);
  // Fetch profile for court check fields
  const [profileRows] = await db.execute<RowDataPacket[]>(
    `SELECT father_husband_name, permanent_address, permanent_state, permanent_pincode FROM candidate_onboarding_profile WHERE candidate_id = ? LIMIT 1`,
    [candidateId]
  );
  const profile = profileRows[0];
  const candidateName = String(candidate.employee_name ?? candidate.full_name ?? '');
  if (!candidateName) throw Object.assign(new Error("Candidate name required for court check"), { statusCode: 400 });
  const dob = String(candidate.date_of_birth ?? '');
  if (!dob) throw Object.assign(new Error("Date of birth required for court check"), { statusCode: 400 });
  const adapter = getBgvProviderAdapter();
  const started = Date.now();
  const result = await adapter.verifyCourt({
    candidateName,
    dateOfBirth: dob,
    fatherName: profile?.father_husband_name ?? null,
    address: profile?.permanent_address ?? null,
    state: profile?.permanent_state ?? null,
    pincode: profile?.permanent_pincode ?? null,
  });
  const checkId = await createOrUpdateCheck(candidateId, 'court', result.status, {
    providerKey: result.providerKey,
    providerRequestId: result.providerRequestId,
    providerReferenceId: result.providerReferenceId,
    matchScore: result.matchScore,
    matchedName: result.matchedName,
    resultSummary: result.resultSummary,
    resultJson: result.raw,
    riskFlags: result.riskFlags,
  });
  await db.execute(
    `INSERT INTO candidate_bgv_api_request_log
       (id, candidate_id, check_id, provider_key, endpoint_key, request_ref, request_payload_hash, response_status_code, response_payload, duration_ms, success_flag)
     VALUES (?, ?, ?, ?, 'COURT_VERIFY', ?, ?, 200, ?, ?, ?)`,
    [randomUUID(), candidateId, checkId, result.providerKey, result.providerRequestId, hashValue(candidateName + dob), JSON.stringify(result.raw ?? result), Date.now() - started, result.status === 'verified' ? 1 : 0]
  );
  // Update court_status in bgv_report
  const courtDbStatus =
    result.status === 'verified' ? 'passed'
    : result.status === 'failed' ? 'failed'
    : result.status === 'manual_review' ? 'manual_review'
    : 'queued';
  await db.execute(
    `UPDATE candidate_bgv_report SET court_status = ?, court_remarks = ?, updated_at = NOW() WHERE candidate_id = ?`,
    [courtDbStatus, result.resultSummary, candidateId]
  );
  await logEvent(candidateId, 'COURT_VERIFICATION_COMPLETED', result, checkId, { actorType: 'candidate', ip: meta?.ip, userAgent: meta?.userAgent });
  return getBgvStatusForCandidate(candidateId);
}

// ── Vendor Dispatch ──────────────────────────────────────────────────────────

export async function dispatchToVendor(
  candidateId: string,
  input: {
    checkType: string;
    checkId?: string;
    vendorName: string;
    vendorContactEmail?: string;
    vendorContactPhone?: string;
    documentIds?: string[];
    dispatchNotes?: string;
  },
  actorUserId: string
) {
  const id = randomUUID();
  await db.execute(
    `INSERT INTO candidate_bgv_vendor_dispatch
       (id, candidate_id, check_id, check_type, vendor_name, vendor_contact_email, vendor_contact_phone,
        document_ids, dispatch_notes, status, sent_by, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?, NOW())`,
    [
      id, candidateId,
      input.checkId ?? null,
      input.checkType,
      input.vendorName,
      input.vendorContactEmail ?? null,
      input.vendorContactPhone ?? null,
      input.documentIds?.length ? JSON.stringify(input.documentIds) : null,
      input.dispatchNotes ?? null,
      actorUserId,
    ]
  );
  // Move the bgv check to manual_review status so it shows as escalated
  if (input.checkId) {
    await db.execute(
      `UPDATE candidate_bgv_check
          SET status = 'manual_review', review_remarks = ?, reviewed_by = ?, reviewed_at = NOW(), updated_at = NOW()
        WHERE id = ? AND candidate_id = ?`,
      [`Dispatched to vendor: ${input.vendorName}`, actorUserId, input.checkId, candidateId]
    );
  }
  await logEvent(candidateId, "BGV_VENDOR_DISPATCHED", { vendorName: input.vendorName, checkType: input.checkType }, input.checkId ?? null, { actorType: "hr", actorId: actorUserId });
  return { dispatch_id: id };
}

export async function updateVendorResult(
  dispatchId: string,
  candidateId: string,
  input: {
    vendorReferenceNo?: string;
    vendorResult: "verified" | "not_verified" | "inconclusive";
    vendorRemarks?: string;
    updateBgvCheck?: boolean;
  },
  actorUserId: string
) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, check_id, check_type, candidate_id FROM candidate_bgv_vendor_dispatch WHERE id = ? AND candidate_id = ? LIMIT 1`,
    [dispatchId, candidateId]
  );
  const dispatch = (rows as RowDataPacket[])[0];
  if (!dispatch) throw Object.assign(new Error("Vendor dispatch not found"), { statusCode: 404 });

  await db.execute(
    `UPDATE candidate_bgv_vendor_dispatch
        SET vendor_reference_no = ?, vendor_result = ?, vendor_remarks = ?,
            result_received_at = NOW(), result_updated_by = ?,
            status = 'result_received', bgv_check_updated = ?, updated_at = NOW()
      WHERE id = ?`,
    [
      input.vendorReferenceNo ?? null,
      input.vendorResult,
      input.vendorRemarks ?? null,
      actorUserId,
      input.updateBgvCheck ? 1 : 0,
      dispatchId,
    ]
  );

  // If HR opts to sync result back to bgv check
  if (input.updateBgvCheck && dispatch.check_id) {
    const checkStatus = input.vendorResult === "verified" ? "verified"
      : input.vendorResult === "not_verified" ? "failed"
      : "manual_review";
    await db.execute(
      `UPDATE candidate_bgv_check
          SET status = ?, review_remarks = ?, reviewed_by = ?, reviewed_at = NOW(),
              verified_at = IF(? = 'verified', NOW(), verified_at), updated_at = NOW()
        WHERE id = ? AND candidate_id = ?`,
      [checkStatus, `Vendor: ${input.vendorRemarks ?? input.vendorResult}`, actorUserId, checkStatus, dispatch.check_id, candidateId]
    );
    await db.execute(
      `UPDATE candidate_bgv_vendor_dispatch SET status = 'completed', updated_at = NOW() WHERE id = ?`,
      [dispatchId]
    );
  }

  await logEvent(candidateId, "BGV_VENDOR_RESULT_RECEIVED", input, dispatch.check_id ?? null, { actorType: "hr", actorId: actorUserId });
  return getBgvStatusForCandidate(candidateId);
}

export async function listVendorDispatches(candidateId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT d.*, u.full_name AS sent_by_name, u2.full_name AS result_updated_by_name
       FROM candidate_bgv_vendor_dispatch d
       LEFT JOIN employees u  ON u.user_id  = d.sent_by
       LEFT JOIN employees u2 ON u2.user_id = d.result_updated_by
      WHERE d.candidate_id = ?
      ORDER BY d.sent_at DESC`,
    [candidateId]
  );
  return rows;
}

export async function listBgvQueueScoped(status: string | undefined, scopeClause: { sql: string; params: unknown[] }) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.id AS candidate_id, c.candidate_code, c.full_name, c.mobile, c.email,
            br.branch_name, pm.process_name,
            MAX(ch.updated_at) AS last_check_at,
            SUM(CASE WHEN ch.status IN ('mismatch','failed','manual_review') THEN 1 ELSE 0 END) AS issue_count,
            SUM(CASE WHEN ch.status = 'verified' THEN 1 ELSE 0 END) AS verified_count
       FROM ats_candidate c
       LEFT JOIN candidate_bgv_check ch ON ch.candidate_id = c.id
       LEFT JOIN branch_master br ON br.id = c.applied_for_branch
       LEFT JOIN process_master pm ON pm.id = c.applied_for_process
      WHERE (? IS NULL OR ch.status = ?)
        AND (${scopeClause.sql})
      GROUP BY c.id, c.candidate_code, c.full_name, c.mobile, c.email, br.branch_name, pm.process_name
      HAVING COUNT(ch.id) > 0
      ORDER BY last_check_at DESC
      LIMIT 200`,
    [status ?? null, status ?? null, ...scopeClause.params]
  );
  return rows;
}
