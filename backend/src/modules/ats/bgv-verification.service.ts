import { randomUUID, createHash } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getConfiguredBgvProviderAdapter, type AddressDocInput, type EducationVerificationInput } from "./bgv-provider.adapter.js";
import { withProviderFailureLogged, getBgvApiCostReport } from "./bgv-api-log.service.js";
import { receiptFlagsFromDocuments } from "./bgv-document-receipt.js";
import { syncBridgePennyDropStatus } from "./onboarding-bridge-status.js";
import { loadAsyncBgvTriggerContext, validateOnboardingToken } from "./onboarding-full.service.js";
import { resolveBankNameVariance } from "./bank-name-corroboration.js";
import { digilockerVerifiedCheckTypes, type DigilockerEvidence } from "./digilocker-evidence.js";
import { propagateIdentityVerification } from "../../shared/identityVerificationPropagation.js";

const hashValue = (value: unknown) => {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized ? createHash("sha256").update(normalized).digest("hex") : null;
};
const maskLast4 = (value: unknown, prefix = "XXXXXX") => {
  const clean = String(value ?? "").replace(/\s/g, "");
  return clean ? `${prefix}${clean.slice(-4)}` : null;
};

type BankVerificationMethod = "penny_drop" | "penny_less" | "upi" | "manual" | "mock";

export function resolveBankVerificationMethod(result: {
  status: string;
  providerKey?: string | null;
  raw?: unknown;
}): BankVerificationMethod {
  const providerKey = String(result.providerKey ?? "").trim().toLowerCase();
  const raw = result.raw && typeof result.raw === "object"
    ? result.raw as Record<string, unknown>
    : null;
  const rawMode = String(raw?.mode ?? raw?.verificationMode ?? "").trim().toLowerCase();

  if (providerKey.includes("mock")) return "mock";
  if (result.status === "manual_review" || rawMode === "provider_error_fallback" || rawMode === "manual_fallback") {
    return "manual";
  }
  if (providerKey === "digio" || providerKey === "infinity_ai" || rawMode.includes("pennyless")) {
    return "penny_less";
  }
  if (rawMode.includes("upi")) return "upi";
  return "penny_drop";
}

function buildBankManualReviewFallback(reason: string, detail: Record<string, unknown> = {}) {
  return {
    status: "manual_review" as const,
    providerKey: "system",
    providerRequestId: randomUUID(),
    providerReferenceId: randomUUID(),
    matchScore: null,
    matchedName: null,
    resultSummary: reason,
    riskFlags: ["BANK_INPUT_MISSING"],
    raw: {
      mode: "missing_bank_input_fallback",
      ...detail,
    },
  };
}

async function logEvent(candidateId: string, eventType: string, payload?: unknown, checkId?: string | null, meta?: { actorType?: "candidate" | "hr" | "system" | "provider"; actorId?: string | null; ip?: string; userAgent?: string }) {
  const eventStatus =
    payload && typeof payload === "object" && "status" in payload
      ? String((payload as { status?: unknown }).status ?? null)
      : null;
  await db.execute(
    `INSERT INTO candidate_bgv_verification_event
       (id, candidate_id, check_id, event_type, event_status, event_payload, actor_type, actor_id, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), candidateId, checkId ?? null, eventType, eventStatus, payload ? JSON.stringify(payload) : null, meta?.actorType ?? "system", meta?.actorId ?? null, meta?.ip ?? null, meta?.userAgent ?? null]
  );
}

// Returns the most recent verified check row, or null. Used to skip live API calls when DigiLocker already verified.
async function getVerifiedCheck(candidateId: string, checkType: string): Promise<RowDataPacket | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, check_type, status, provider_key, provider_request_id, provider_reference_id,
            match_score, matched_name, result_summary, risk_flags_json, verified_at
       FROM candidate_bgv_check
      WHERE candidate_id = ? AND check_type = ? AND status = 'verified'
      ORDER BY updated_at DESC LIMIT 1`,
    [candidateId, checkType]
  );
  return (rows as RowDataPacket[])[0] ?? null;
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
    `SELECT c.id, c.full_name, c.email, c.mobile, c.date_of_birth, c.pan_number, c.aadhar_number,
            p.employee_name, p.pan_number_hash, p.aadhaar_number_hash, p.pan_number_masked, p.aadhaar_number_masked
       FROM ats_candidate c
       LEFT JOIN candidate_onboarding_profile p ON p.candidate_id = c.id
      WHERE c.id = ? LIMIT 1`,
    [candidateId]
  );
  if (!rows.length) throw Object.assign(new Error("Candidate not found"), { statusCode: 404 });
  return rows[0];
}

/**
 * Resolve the Aadhaar last-4 for an offline check. Prefers what the client sent,
 * then the raw number on the candidate row, then the stored masked value
 * ("XXXXXXXX0118"). Legacy rows hold a literal "0" and must not match.
 */
function resolveAadhaarLast4(supplied: string | undefined, candidate: RowDataPacket): string | undefined {
  for (const value of [supplied, candidate.aadhar_number, candidate.aadhaar_number_masked]) {
    const digits = String(value ?? "").replace(/\D/g, "");
    if (digits.length >= 4 && digits !== "0") return digits.slice(-4);
  }
  return undefined;
}

async function createOrUpdateCheck(candidateId: string, checkType: string, status: string, input: Record<string, unknown>) {
  // Computed once and reused by both the update and insert paths below, so the timestamp
  // stored on the check and the one propagated to the employee record cannot diverge.
  const verifiedAt = status === "verified" ? new Date() : null;

  /**
   * Carry a passed identity check onto employees.pan_verified_on / aadhaar_verified_on.
   *
   * Those columns are read in four places to decide "verified" vs "pending", and until now
   * NOTHING wrote them — NULL on all 58,814 employees, so every profile read "pending" for
   * ever and identity.executor.ts's KYC report was a permanent 0% verified returning zero
   * rows. The verifications were real all along (20 PAN checks at status='verified' with
   * provider timestamps); the result simply had nowhere to go.
   *
   * Deliberately non-fatal, and deliberately NOT a silent catch: a failure to mirror the
   * result must not roll back the BGV check that genuinely passed, but it is logged loudly
   * because swallow-and-continue is exactly how the original gap stayed invisible.
   */
  const propagate = async () => {
    if (!verifiedAt) return;
    try {
      const r = await propagateIdentityVerification(candidateId, checkType, verifiedAt);
      if (r.updated) {
        console.log(`[bgv] ${checkType} verified — stamped employees.${r.column} for ${r.employeeId}`);
      }
    } catch (err) {
      console.error(
        `[bgv] could not propagate ${checkType} verification for candidate ${candidateId} ` +
        `to the employee record:`, err instanceof Error ? err.message : err,
      );
    }
  };

  // Single atomic upsert — was SELECT-existing-then-branch-UPDATE-or-INSERT, which raced
  // under near-simultaneous calls for the same (candidate_id, check_type): both could see
  // "no existing row" before either INSERT committed, producing duplicates. Observed live:
  // one candidate accumulated 39 duplicate aadhaar rows and 18 duplicate bank rows, all
  // fired milliseconds apart (cleaned up separately; see
  // sql/1230_bgv_check_unique_constraint.sql, which this statement depends on — the
  // UNIQUE(candidate_id, check_type) constraint it adds is what makes ON DUPLICATE KEY
  // UPDATE resolve to the SAME row instead of racing). Row-alias syntax (MySQL 8.0.19+),
  // not the VALUES() function form, which is deprecated on this server version.
  //
  // A freshly generated UUID is used for the insert branch. On the update branch MySQL
  // keeps the EXISTING row's id, not this one — a CHAR(36) id can't round-trip through
  // LAST_INSERT_ID() (that mechanism is for numeric ids), so the follow-up SELECT below
  // is the correct way to learn which id actually won, verified live: a 20-way genuinely
  // concurrent Promise.all race against a scratch table with the same unique constraint
  // resolved to exactly one row every time.
  const generatedCheckId = randomUUID();
  await db.execute(
    `INSERT INTO candidate_bgv_check
       (id, candidate_id, check_type, source_document_id, provider_key, provider_request_id,
        provider_reference_id, status, match_score, matched_name, matched_dob, result_summary,
        result_json, risk_flags_json, verified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) AS new_check
     ON DUPLICATE KEY UPDATE
       status = new_check.status,
       source_document_id = new_check.source_document_id,
       provider_key = new_check.provider_key,
       provider_request_id = new_check.provider_request_id,
       provider_reference_id = new_check.provider_reference_id,
       match_score = new_check.match_score,
       matched_name = new_check.matched_name,
       matched_dob = new_check.matched_dob,
       result_summary = new_check.result_summary,
       result_json = new_check.result_json,
       risk_flags_json = new_check.risk_flags_json,
       verified_at = new_check.verified_at,
       updated_at = NOW()`,
    [
      generatedCheckId,
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
      verifiedAt,
    ]
  );

  const [afterUpsert] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM candidate_bgv_check WHERE candidate_id = ? AND check_type = ? LIMIT 1`,
    [candidateId, checkType]
  );
  const checkId = ((afterUpsert as RowDataPacket[])[0]?.id as string | undefined) ?? generatedCheckId;

  // Sync report status columns + score after every check write, fire-and-forget.
  // Runs on BOTH the update and insert paths now — it used to run only on first insert
  // (guarded by an early `return existingId` on the update branch), so a check that
  // changed status later — e.g. HR flipping manual_review to verified on review — never
  // moved the score. Calls the single exported computeAndSaveScore (bgv-verification.service.ts)
  // instead of a duplicate nested copy that could drift from it — see that function for the
  // one canonical set of weights, also now used by getBgvStatusForCandidate.
  setImmediate(() => {
    void syncBgvChecksToReport(candidateId).catch(() => {});
    void computeAndSaveScore(candidateId).catch(() => {});
  });

  await propagate();
  return checkId;
}

// Normalize check_type aliases so they don't double-count the same verification category.
function normalizeCheckType(checkType: string): string {
  if (checkType === "aadhaar_offline") return "aadhaar";
  if (checkType === "address_doc") return "address";
  if (checkType === "education_doc") return "education";
  if (checkType === "court") return "criminal"; // same category
  if (checkType === "experience") return "employment"; // same category
  return checkType;
}

// Weights per canonical check category (denominator is dynamic per candidate).
const CHECK_WEIGHTS: Record<string, number> = {
  aadhaar: 25,
  pan: 20,
  bank: 15,
  education: 10,
  address: 10,
  employment: 10,
  criminal: 10,
};

/**
 * Determine which checks are applicable for this candidate based on their
 * designation, department, and whether they are a fresher.
 *
 * Rules:
 * - Base (everyone): aadhaar(25) + pan(20) + bank(15) + education(10) + address(10) = 80
 * - employment (+10): only when candidate is NOT a fresher
 * - criminal (+10): only for Finance/Accounts/Compliance/Sales & Marketing depts
 *                   OR Manager-and-above designations
 *
 * DigiLocker note: handled in computeAndSaveScore — if digilocker is verified
 * it covers both aadhaar and pan without requiring separate manual checks.
 */
async function getApplicableChecks(candidateId: string): Promise<{
  includeEmployment: boolean;
  includeCriminal: boolean;
  denominator: number;
}> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       exp.working_experience,
       exp.experience_year,
       dept.dept_name AS department_name,
       desig.designation_name,
       desig.bgv_requirements
     FROM ats_candidate c
     LEFT JOIN ats_employment_offer o
            ON o.candidate_id = c.id AND o.status != 'cancelled'
     LEFT JOIN department_master dept  ON dept.id  = o.department_id
     LEFT JOIN designation_master desig ON desig.id = o.designation_id
     LEFT JOIN candidate_onboarding_experience exp ON exp.candidate_id = c.id
     WHERE c.id = ?
     ORDER BY o.submitted_at DESC, o.created_at DESC
     LIMIT 1`,
    [candidateId]
  );

  const row = (rows as RowDataPacket[])[0];

  // Fresher: no experience record, explicitly 'fresher', years = 0, or null working_experience
  const isFresher = !row
    || !row.working_experience
    || String(row.working_experience).toLowerCase() === "fresher"
    || String(row.working_experience).toLowerCase() === "no"
    || String(row.working_experience) === "0"
    || (row.experience_year !== null && Number(row.experience_year) === 0);

  // Criminal check: designation_master.bgv_requirements.criminal OR dept/designation keywords
  let includeCriminal = false;
  if (row) {
    const bgvReq = row.bgv_requirements
      ? (typeof row.bgv_requirements === "string" ? JSON.parse(row.bgv_requirements) : row.bgv_requirements)
      : null;
    if (bgvReq?.criminal === true) includeCriminal = true;

    const dept = String(row.department_name ?? "").toLowerCase();
    if (/finance|accounts?|accountant|compliance|sales|marketing/.test(dept)) includeCriminal = true;

    const desig = String(row.designation_name ?? "").toLowerCase();
    if (/manager|head|director|vp|vice.?president|ceo|coo|cfo|chief/.test(desig)) includeCriminal = true;
  }

  const includeEmployment = !isFresher;
  const denominator = 80 + (includeEmployment ? 10 : 0) + (includeCriminal ? 10 : 0);

  return { includeEmployment, includeCriminal, denominator };
}

/**
 * Compute and persist BGV score as a percentage (0–100).
 *
 * Denominator is dynamic: only checks applicable to this candidate's
 * profile/designation are counted. DigiLocker verified = covers both
 * aadhaar and pan so manual checks for those are not additionally required.
 */
export async function computeAndSaveScore(candidateId: string): Promise<number> {
  const { includeEmployment, includeCriminal, denominator } = await getApplicableChecks(candidateId);

  const [rawChecks] = await db.execute<RowDataPacket[]>(
    `SELECT check_type, status FROM candidate_bgv_check WHERE candidate_id = ?`,
    [candidateId]
  );

  // Build best-status map per normalized check type (precedence: verified > waived > manual_review > rest)
  const statusPrecedence: Record<string, number> = { verified: 4, waived: 3, manual_review: 2, partial: 1 };
  const bestStatus = new Map<string, string>();
  for (const check of rawChecks as RowDataPacket[]) {
    const norm = normalizeCheckType(String(check.check_type));
    const incoming = statusPrecedence[String(check.status)] ?? 0;
    const existing = statusPrecedence[bestStatus.get(norm) ?? ""] ?? -1;
    if (incoming > existing) bestStatus.set(norm, String(check.status));
  }

  const isClear = (type: string) => {
    const s = bestStatus.get(type);
    return s === "verified" || s === "waived";
  };

  // DigiLocker verified covers both aadhaar and pan
  const digilockerClear = isClear("digilocker");

  let earned = 0;
  if (digilockerClear || isClear("aadhaar")) earned += CHECK_WEIGHTS.aadhaar;   // 25
  if (digilockerClear || isClear("pan"))     earned += CHECK_WEIGHTS.pan;        // 20
  if (isClear("bank"))                       earned += CHECK_WEIGHTS.bank;       // 15
  if (isClear("education"))                  earned += CHECK_WEIGHTS.education;  // 10
  if (isClear("address"))                    earned += CHECK_WEIGHTS.address;    // 10
  if (includeEmployment && isClear("employment")) earned += CHECK_WEIGHTS.employment; // +10
  if (includeCriminal   && isClear("criminal"))   earned += CHECK_WEIGHTS.criminal;   // +10

  // Always store as percentage so the UI/PDF can display score/100 correctly.
  const scorePct = denominator > 0 ? Math.round((earned / denominator) * 100) : 0;

  await db.execute(
    `INSERT INTO candidate_bgv_report (candidate_id, bgv_score, updated_at)
     VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE bgv_score = VALUES(bgv_score), updated_at = NOW()`,
    [candidateId, scorePct]
  );

  return scorePct;
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
  // Mirror consent flag to onboarding profile so getOnboardingBlockers reads it correctly.
  await db.execute(
    `UPDATE candidate_onboarding_profile SET bgv_consent = 1, updated_at = NOW() WHERE candidate_id = ?`,
    [candidateId]
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
  const [rawChecks] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM candidate_bgv_check WHERE candidate_id = ? ORDER BY updated_at DESC`,
    [candidateId]
  );
  // Defense in depth: candidate_bgv_check has no unique constraint on (candidate_id,
  // check_type), and recordFaceMatchSkipped used to insert a fresh photo_match row on
  // every identity-image upload (fixed in onboarding-full.service.ts, but existing
  // production rows need a one-time cleanup). Rows are already ordered by updated_at
  // DESC, so keeping the first occurrence per check_type keeps the most recent one and
  // masks any leftover duplicates from every consumer of this response.
  const seenCheckTypes = new Set<string>();
  const checks = (rawChecks as RowDataPacket[]).filter((c) => {
    const t = String(c.check_type);
    if (seenCheckTypes.has(t)) return false;
    seenCheckTypes.add(t);
    return true;
  });
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
  // Was a second, disagreeing formula (bank weighted 20 here vs 15 in computeAndSaveScore,
  // and this was the only one crediting photo_match — a check that can never reach
  // verified/waived today, so that term was always dead). Two formulas meant the wizard,
  // the admin Onboarding Request page, and the BGV Report view could each show a
  // different score for the same candidate. computeAndSaveScore is the single canonical
  // formula now; call it here too instead of recalculating independently.
  const score = await computeAndSaveScore(candidateId);

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
  // Skip live API call if DigiLocker already verified PAN — prevents double billing
  const existingPan = await getVerifiedCheck(candidateId, "pan");
  if (existingPan && String(existingPan.provider_key) === "digilocker") {
    await logEvent(candidateId, "PAN_VERIFICATION_SKIPPED_DIGILOCKER", { reason: "DigiLocker already verified PAN", check_id: existingPan.id }, existingPan.id as string, meta);
    return getBgvStatusForCandidate(candidateId);
  }
  const candidate = await getCandidateIdentity(candidateId);
  const pan = String(input.panNumber || candidate.pan_number || "").trim().toUpperCase();
  if (!pan) throw Object.assign(new Error("PAN number is required — please save your PAN in the Personal details step first"), { statusCode: 400 });
  const adapter = await getConfiguredBgvProviderAdapter();
  const started = Date.now();
  const result = await withProviderFailureLogged(
    { candidateId, endpointKey: "PAN_VERIFY", providerKey: adapter.providerKey },
    () => adapter.verifyPan({
    candidateName: candidate.employee_name ?? candidate.full_name,
    dateOfBirth: candidate.date_of_birth,
    mobileNumber: candidate.mobile,
    panNumber: pan,
  }),
  );
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
  // A completed identity check is the moment there is something new to
  // reconcile across sources, so the cross-source name comparison runs here
  // rather than waiting for an HR user to press it.
  await reconcileNamesAfterVerification(candidateId);
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
  let bankDetailId: string | null = null;
  if (!accountNo || !ifscCode) {
    const [bankRows] = await db.execute<RowDataPacket[]>(`SELECT * FROM candidate_onboarding_bank_detail WHERE candidate_id = ? LIMIT 1`, [candidateId]);
    const bank = bankRows[0] as RowDataPacket & { id?: string | null; ifsc_code?: string | null; account_holder_name?: string | null; account_no_encrypted?: string | null } | undefined;
    if (!bank) throw Object.assign(new Error("Bank details are required before verification"), { statusCode: 400 });
    bankDetailId = String(bank.id ?? "").trim() || null;
    ifscCode = ifscCode || String(bank.ifsc_code ?? "");
    accountHolderName = accountHolderName || String(bank.account_holder_name ?? "");
    // Try to decrypt stored encrypted account number (no re-entry needed)
    if (!accountNo && bank.account_no_encrypted) {
      try {
        // Format-aware: this column holds legacy AES-CBC values from the onboarding flow and
        // canonical AES-GCM values from the DPDP backfill. utils/encryption.decrypt reads only
        // the former and rejects the latter, which would land here as "account number missing"
        // and force needless re-entry.
        const { decryptPii } = await import("../../shared/piiCiphertext.js");
        accountNo = decryptPii(bank.account_no_encrypted);
      } catch (e) {
        console.error("[BGV] Failed to decrypt account number:", (e as Error).message);
      }
    }

    if (!accountNo || !ifscCode) {
      const context = await loadAsyncBgvTriggerContext(candidateId);
      accountNo = accountNo || String(context.bank.accountNo ?? "").trim();
      ifscCode = ifscCode || String(context.bank.ifscCode ?? "").trim().toUpperCase();
      accountHolderName = accountHolderName || context.bank.accountHolderName || undefined;
    }
  }
  const adapter = await getConfiguredBgvProviderAdapter();
  const started = Date.now();
  let result;
  if (!accountNo) {
    result = buildBankManualReviewFallback(
      "Bank verification queued for manual HR review because the raw account number is unavailable in saved onboarding records.",
      { candidateId, ifscCode, bankDetailId },
    );
  } else {
    try {
      result = await adapter.verifyBank({ candidateName: candidate.employee_name ?? candidate.full_name, accountHolderName, accountNo, ifscCode });
    } catch (error: any) {
      // If IP whitelist or provider unavailable, fall back to manual_review
      if (error.statusCode === 503 || error.isIpWhitelistError) {
        console.error(`[BGV] Bank verification provider unavailable: ${error.message}`);
        result = {
          status: "manual_review" as const,
          providerKey: "luckpay",
          providerRequestId: randomUUID(),
          providerReferenceId: randomUUID(),
          matchScore: null,
          matchedName: null,
          resultSummary: "Bank verification service temporarily unavailable. Bank details saved for manual HR review.",
          riskFlags: ['PROVIDER_UNAVAILABLE'],
          raw: { mode: "provider_error_fallback", error_message: error.message },
        };
      } else {
        throw error;
      }
    }
  }
  // Before troubling a human with a name variance, see whether the candidate's
  // verified PAN already settles it.
  //
  // The adapter only knows the two names in front of it, so anything that
  // disagrees with the candidate's record comes back as a divergence. Most of
  // those are the same person written differently, and sending them all to
  // Payroll HR produces a queue big enough to be rubber-stamped — a weaker
  // control than a short queue read properly. A verified PAN is the strongest
  // corroboration available and costs nothing: if the bank's registered owner
  // matches the name on it, the account belongs to the person that PAN was
  // issued to.
  if (result.riskFlags?.includes("BANK_HOLDER_NAME_DIVERGENCE")) {
    const [panRows] = await db.execute<RowDataPacket[]>(
      `SELECT matched_name FROM candidate_bgv_check
        WHERE candidate_id = ? AND check_type = 'pan' AND status = 'verified'
          AND matched_name IS NOT NULL AND matched_name <> ''
        ORDER BY COALESCE(verified_at, updated_at) DESC LIMIT 1`,
      [candidateId],
    ).catch(() => [[] as RowDataPacket[]]);

    const resolution = resolveBankNameVariance({
      candidateName: candidate.employee_name ?? candidate.full_name,
      bankRegisteredName: result.matchedName,
      verifiedPanName: (panRows as RowDataPacket[])[0]?.matched_name ?? null,
    });

    result = {
      ...result,
      status: resolution.status,
      resultSummary: resolution.reason,
      riskFlags: resolution.outcome === "auto_cleared"
        ? []
        : resolution.outcome === "third_party_account"
          ? ["BANK_THIRD_PARTY_ACCOUNT"]
          : result.riskFlags,
    };
    await logEvent(candidateId, "BANK_NAME_VARIANCE_RESOLVED", {
      outcome: resolution.outcome,
      reason: resolution.reason,
    }, null, { actorType: "system" });
  }

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
       (id, candidate_id, bank_detail_id, account_no_last4, account_no_hash, ifsc_code, input_account_holder_name,
        provider_account_holder_name, name_match_score, verification_method, provider_key, provider_reference_id,
        verification_status, result_json, verified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
    [
      randomUUID(),
      candidateId,
      bankDetailId,
      accountNo ? String(accountNo).slice(-4) : null,
      accountNo ? hashValue(accountNo) : null,
      ifscCode || null,
      accountHolderName ?? null,
      result.matchedName ?? null,
      result.matchScore ?? null,
      resolveBankVerificationMethod(result),
      result.providerKey,
      result.providerReferenceId,
      result.status,
      JSON.stringify(result.raw ?? result),
      result.status === "verified" ? new Date() : null,
    ]
  );
  await db.execute(
    `UPDATE candidate_onboarding_bank_detail
        SET account_no_masked = COALESCE(?, account_no_masked), account_no_hash = COALESCE(?, account_no_hash),
            ifsc_code = COALESCE(?, ifsc_code), verification_status = ?,
            provider_name = ?, verification_ref = ?, verified_account_holder_name = ?, verified_at = ?, updated_at = NOW()
      WHERE candidate_id = ?`,
    [
      accountNo ? maskLast4(accountNo) : null,
      accountNo ? hashValue(accountNo) : null,
      ifscCode || null,
      result.status,
      result.providerKey,
      result.providerReferenceId,
      result.matchedName ?? null,
      result.status === "verified" ? new Date() : null,
      candidateId,
    ]
  );
  await db.execute(
    `INSERT INTO candidate_bgv_api_request_log
       (id, candidate_id, check_id, provider_key, endpoint_key, request_ref, request_payload_hash, response_status_code, response_payload, duration_ms, success_flag)
     VALUES (?, ?, ?, ?, 'BANK_VERIFY', ?, ?, 200, ?, ?, ?)` ,
    [randomUUID(), candidateId, checkId, result.providerKey, result.providerRequestId, accountNo ? hashValue(`${accountNo}|${ifscCode}`) : null, JSON.stringify(result.raw ?? result), Date.now() - started, result.status === "verified" ? 1 : 0]
  );
  await logEvent(candidateId, "BANK_VERIFICATION_COMPLETED", result, checkId, meta);
  // Mirror onto the onboarding bridge, which nothing was writing — four
  // candidates had a verified penny drop while all 304 bridge rows still read
  // 'not_started'.
  await syncBridgePennyDropStatus(db, candidateId, result.status, result.riskFlags);
  // A completed identity check is the moment there is something new to
  // reconcile across sources, so the cross-source name comparison runs here
  // rather than waiting for an HR user to press it.
  await reconcileNamesAfterVerification(candidateId);
  return getBgvStatusForCandidate(candidateId);
}

export async function verifyUanByToken(token: string, input: { uanNumber?: string }, meta?: { ip?: string; userAgent?: string }) {
  const tokenData = await validateOnboardingToken(token);
  return verifyUanForCandidate(tokenData.candidate_id as string, input, { actorType: "candidate", ip: meta?.ip, userAgent: meta?.userAgent });
}

export async function verifyUanForCandidate(candidateId: string, input: { uanNumber?: string }, meta?: { actorType?: "candidate" | "hr" | "system"; actorId?: string | null; ip?: string; userAgent?: string }) {
  await ensureConsent(candidateId);
  const candidate = await getCandidateIdentity(candidateId);
  const uanNumber = String(input.uanNumber ?? "").replace(/\s/g, "");
  if (!uanNumber) throw Object.assign(new Error("UAN number is required"), { statusCode: 400 });
  if (!/^\d{12}$/.test(uanNumber)) throw Object.assign(new Error("UAN number must be 12 digits"), { statusCode: 400 });

  const adapter = await getConfiguredBgvProviderAdapter();
  if (!adapter.verifyUan) throw Object.assign(new Error("UAN verification is not configured for the active BGV provider"), { statusCode: 503 });

  const started = Date.now();
  const result = await withProviderFailureLogged(
    { candidateId, endpointKey: "UAN_VERIFY", providerKey: adapter.providerKey },
    // verifyUan is optional on the interface; the guard above proves it exists
    // but that narrowing does not survive into the callback.
    () => adapter.verifyUan!({ candidateName: candidate.employee_name ?? candidate.full_name, uanNumber }),
  );
  const checkId = await createOrUpdateCheck(candidateId, "employment", result.status, {
    providerKey: result.providerKey,
    providerRequestId: result.providerRequestId,
    providerReferenceId: result.providerReferenceId,
    matchScore: result.matchScore,
    matchedName: result.matchedName,
    resultSummary: result.resultSummary,
    resultJson: {
      ...(result.raw && typeof result.raw === "object" ? result.raw as Record<string, unknown> : { raw: result.raw }),
      employmentHistory: result.employmentHistory ?? [],
    },
    riskFlags: result.riskFlags,
  });
  await db.execute(
    `INSERT INTO candidate_bgv_api_request_log
       (id, candidate_id, check_id, provider_key, endpoint_key, request_ref, request_payload_hash, response_status_code, response_payload, duration_ms, success_flag)
     VALUES (?, ?, ?, ?, 'UAN_VERIFY', ?, ?, 200, ?, ?, ?)`,
    [randomUUID(), candidateId, checkId, result.providerKey, result.providerRequestId, hashValue(uanNumber), JSON.stringify(result.raw ?? result), Date.now() - started, result.status === "verified" ? 1 : 0]
  );
  await logEvent(candidateId, "UAN_VERIFICATION_COMPLETED", result, checkId, meta);
  return getBgvStatusForCandidate(candidateId);
}

export async function verifyAadhaarOfflineByToken(token: string, input: { documentId?: string; aadhaarLast4?: string }, meta?: { ip?: string; userAgent?: string }) {
  const tokenData = await validateOnboardingToken(token);
  return verifyAadhaarOfflineForCandidate(tokenData.candidate_id as string, input, { actorType: "candidate", ip: meta?.ip, userAgent: meta?.userAgent });
}

export async function verifyAadhaarOfflineForCandidate(candidateId: string, input: { documentId?: string; aadhaarLast4?: string }, meta?: { actorType?: "candidate" | "hr" | "system"; actorId?: string | null; ip?: string; userAgent?: string }) {
  await ensureConsent(candidateId);
  // Skip live API call if DigiLocker already verified Aadhaar — prevents double billing
  const existingAadhaar = await getVerifiedCheck(candidateId, "aadhaar");
  if (existingAadhaar && String(existingAadhaar.provider_key) === "digilocker") {
    await logEvent(candidateId, "AADHAAR_VERIFICATION_SKIPPED_DIGILOCKER", { reason: "DigiLocker already verified Aadhaar", check_id: existingAadhaar.id }, existingAadhaar.id as string, meta);
    return getBgvStatusForCandidate(candidateId);
  }
  const candidate = await getCandidateIdentity(candidateId);
  // The candidate form never holds the raw Aadhaar after a page reload, so the
  // client may legitimately omit aadhaarLast4. Derive it from what is already
  // stored rather than failing the check.
  const aadhaarLast4 = resolveAadhaarLast4(input.aadhaarLast4, candidate);
  const adapter = await getConfiguredBgvProviderAdapter();
  const result = await withProviderFailureLogged(
    { candidateId, endpointKey: "AADHAAR_OFFLINE_VERIFY", providerKey: adapter.providerKey },
    () => adapter.verifyAadhaarOffline({ candidateName: candidate.employee_name ?? candidate.full_name, aadhaarLast4, documentId: input.documentId }),
  );
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
  // A completed identity check is the moment there is something new to
  // reconcile across sources, so the cross-source name comparison runs here
  // rather than waiting for an HR user to press it.
  await reconcileNamesAfterVerification(candidateId);
  return getBgvStatusForCandidate(candidateId);
}

export async function startDigilockerByToken(token: string, requestedDocuments: string[], meta?: { ip?: string; userAgent?: string }) {
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;
  await ensureConsent(candidateId);
  const adapter = await getConfiguredBgvProviderAdapter();
  /**
   * Resolved once, so the provider and our own record cannot disagree.
   *
   * The default used to be applied inline in the adapter call while the INSERT below
   * stored the raw parameter. The onboarding screen sends no list, so every live session
   * asked the provider for Aadhaar and PAN and then recorded requested_documents_json as
   * `[]` — true of all 33 befisc_luckpay rows in production, while the six older mock
   * sessions, whose caller passed an explicit list, recorded it correctly.
   *
   * Nothing was fetched wrongly; the provider always received the right list. What was
   * lost is the answer to "what did we ask this candidate to share", which is exactly
   * what a consent-based KYC flow has to be able to show afterwards.
   */
  const documentsToRequest = requestedDocuments.length ? requestedDocuments : ["AADHAAR", "PAN"];
  const session = await adapter.startDigilocker(candidateId, documentsToRequest);

  // Production has thrown "Data too long for column 'auth_url'" here 10 times. auth_url is
  // TEXT (65,535 bytes), so the provider is returning something that is not a redirect URL —
  // most likely an error body in the field the adapter reads. The root cause is on the
  // provider side and is not diagnosable from this end, but failing as an opaque MySQL error
  // several layers down is what made it hard to see at all. Reject it here instead, naming
  // the provider and the actual size, and do not write a session row that cannot be used.
  const authUrl = String(session.authUrl ?? "");
  if (!/^https?:\/\//i.test(authUrl) || authUrl.length > 2048) {
    await logEvent(candidateId, "DIGILOCKER_SESSION_FAILED", {
      providerKey: adapter.providerKey,
      reason: !/^https?:\/\//i.test(authUrl) ? "auth_url is not an http(s) URL" : "auth_url exceeds 2048 chars",
      authUrlLength: authUrl.length,
      authUrlPrefix: authUrl.slice(0, 120),
    }, null, { actorType: "candidate", ip: meta?.ip, userAgent: meta?.userAgent });
    throw new Error(
      `DigiLocker provider '${adapter.providerKey}' returned an unusable auth_url ` +
      `(${authUrl.length} chars, starts "${authUrl.slice(0, 60)}"). No session was created.`,
    );
  }

  await db.execute(
    `INSERT INTO candidate_digilocker_session
       (id, candidate_id, state_token, provider_key, auth_url, session_status, requested_documents_json, expires_at)
     VALUES (?, ?, ?, ?, ?, 'created', ?, ?)`,
    [randomUUID(), candidateId, session.state, adapter.providerKey, authUrl, JSON.stringify(documentsToRequest), session.expiresAt]
  );
  // syncDigilockerStatus reads ats_provider_transaction_log and needs BOTH the
  // client transaction id and the provider's own reference to poll. Writing the
  // session row alone is why 30 sessions exist and none ever completed: the
  // sync path looked here, found nothing pollable, and returned 'not_started'.
  //
  // Non-fatal. The candidate already has a working authorisation URL by this
  // point, and failing the whole start because a log row could not be written
  // would take away a flow that otherwise works.
  if (session.providerReferenceId) {
    await db.execute(
      `INSERT INTO ats_provider_transaction_log
         (id, candidate_id, provider, service_type, client_transaction_id, provider_reference_id, status, initiated_by_type)
       VALUES (?, ?, 'luckpay', 'digilocker', ?, ?, 'initiated', 'candidate')`,
      [randomUUID(), candidateId, session.state, session.providerReferenceId],
    ).catch(async (error) => {
      await logEvent(candidateId, "DIGILOCKER_LOG_WRITE_FAILED", {
        state: session.state,
        error: (error as Error)?.message ?? String(error),
      }, null, { actorType: "system" });
    });
  } else {
    // Without it the candidate can still authorise, but we will never be able
    // to fetch the result — worth recording rather than discovering later from
    // a session stuck at 'created'.
    await logEvent(candidateId, "DIGILOCKER_NO_PROVIDER_REFERENCE", {
      state: session.state,
      providerKey: adapter.providerKey,
    }, null, { actorType: "system" });
  }

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

  // CRITICAL: If this is a Digilocker success callback, auto-create verified Aadhaar + PAN checks
  // Digilocker fetches from government = already verified at source, no separate API calls needed
  if (check.check_type === 'digilocker' && status === 'verified') {
    await autoCreateDigilockerVerifiedChecks(check.candidate_id);
  }

  return getBgvStatusForCandidate(check.candidate_id);
}

export async function autoCreateDigilockerVerifiedChecks(
  candidateId: string,
  evidence: DigilockerEvidence = {},
) {
  // Mark verified only what the session actually returned.
  //
  // This used to credit both Aadhaar and PAN unconditionally. That assumption
  // does not hold: the ["AADHAAR","PAN"] request never reaches Luckpay (their
  // API takes only a transaction id, a name and a mobile), and
  // downloadKycDocument returns ONE document chosen by what the candidate
  // consented to share. Crediting PAN off an Aadhaar-only pull would record a
  // verification that never happened and skip the paid check that would have
  // caught it — worse than simply paying for that check.
  const checkTypes = digilockerVerifiedCheckTypes(evidence);

  for (const checkType of checkTypes) {
    const [existing] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM candidate_bgv_check WHERE candidate_id = ? AND check_type = ? LIMIT 1`,
      [candidateId, checkType]
    );

    if (existing.length > 0) {
      // Update existing check
      await db.execute(
        `UPDATE candidate_bgv_check
         SET status = 'verified', provider_key = 'digilocker', result_summary = 'Verified via DigiLocker',
             verified_at = NOW(), updated_at = NOW()
         WHERE id = ?`,
        [existing[0].id]
      );
    } else {
      // Create new verified check
      await db.execute(
        `INSERT INTO candidate_bgv_check
         (id, candidate_id, check_type, provider_key, status, result_summary, verified_at, created_at, updated_at)
         VALUES (?, ?, ?, 'digilocker', 'verified', 'Verified via DigiLocker', NOW(), NOW(), NOW())`,
        [randomUUID(), candidateId, checkType]
      );
    }

    await logEvent(candidateId, "BGV_AUTO_VERIFIED", { checkType, source: "digilocker" }, null, { actorType: "system" });
  }
  // Recompute score after auto-verifying checks
  await computeAndSaveScore(candidateId);
}

export async function manualReview(candidateId: string, input: { checkId?: string; status: "verified" | "mismatch" | "failed" | "manual_review"; remarks: string }, actorUserId: string) {
  if (input.checkId) {
    await db.execute(
      `UPDATE candidate_bgv_check SET status = ?, reviewed_by = ?, reviewed_at = NOW(), review_remarks = ?, updated_at = NOW(), verified_at = IF(?='verified', NOW(), verified_at) WHERE id = ? AND candidate_id = ?`,
      [input.status, actorUserId, input.remarks, input.status, input.checkId, candidateId]
    );
  }
  await logEvent(candidateId, "BGV_MANUAL_REVIEW", input, input.checkId ?? null, { actorType: "hr", actorId: actorUserId });
  // Recompute score after status change
  await computeAndSaveScore(candidateId);
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
  // Recompute score after waiver
  await computeAndSaveScore(candidateId);
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
  const adapter = await getConfiguredBgvProviderAdapter();
  const started = Date.now();
  const result = await withProviderFailureLogged(
    { candidateId, endpointKey: "ADDRESS_DOC_VERIFY", providerKey: adapter.providerKey },
    () => adapter.verifyAddressDoc({
    docType: input.docType,
    documentNumber: input.documentNumber,
    candidateName: candidate.employee_name ?? candidate.full_name,
    dateOfBirth: candidate.date_of_birth ?? null,
  }),
  );
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
  const adapter = await getConfiguredBgvProviderAdapter();
  const started = Date.now();
  const result = await withProviderFailureLogged(
    { candidateId, endpointKey: "EDUCATION_VERIFY", providerKey: adapter.providerKey },
    () => adapter.verifyEducation({
    boardType: input.boardType,
    rollNumber: input.rollNumber ?? null,
    certificateNumber: input.certificateNumber ?? null,
    yearOfPassing: input.yearOfPassing,
    candidateName: candidate.employee_name ?? candidate.full_name,
    institutionName: input.institutionName ?? null,
  }),
  );
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
  const adapter = await getConfiguredBgvProviderAdapter();
  const started = Date.now();
  const result = await withProviderFailureLogged(
    { candidateId, endpointKey: "COURT_VERIFY", providerKey: adapter.providerKey },
    () => adapter.verifyCourt({
    candidateName,
    dateOfBirth: dob,
    fatherName: profile?.father_husband_name ?? null,
    address: profile?.permanent_address ?? null,
    state: profile?.permanent_state ?? null,
    pincode: profile?.permanent_pincode ?? null,
  }),
  );
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
    // Recompute score after vendor result sync
    await computeAndSaveScore(candidateId);
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
  // status may be a comma-separated list (e.g. "manual_review,failed,pending") — build IN clause
  const statusList = status ? status.split(',').map(s => s.trim()).filter(Boolean) : [];
  const statusSQL = statusList.length
    ? `ch.status IN (${statusList.map(() => '?').join(',')})`
    : '1=1';
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.id AS candidate_id, c.candidate_code, c.full_name, c.mobile, c.email,
            br.branch_name, pm.process_name,
            MAX(ch.updated_at) AS last_check_at,
            SUM(CASE WHEN ch.status IN ('mismatch','failed','manual_review') THEN 1 ELSE 0 END) AS issue_count,
            SUM(CASE WHEN ch.status = 'verified' THEN 1 ELSE 0 END) AS verified_count,
            SUM(CASE WHEN ch.status = 'pending' THEN 1 ELSE 0 END) AS checks_pending,
            SUM(CASE WHEN ch.status IN ('failed','mismatch') THEN 1 ELSE 0 END) AS checks_failed,
            SUM(CASE WHEN ch.status = 'manual_review' THEN 1 ELSE 0 END) AS checks_manual,
            COUNT(ch.id) AS total_checks
       FROM ats_candidate c
       LEFT JOIN candidate_bgv_check ch ON ch.candidate_id = c.id
       LEFT JOIN branch_master br ON br.id = c.applied_for_branch
       LEFT JOIN process_master pm ON pm.id = c.applied_for_process
      WHERE ${statusSQL}
        AND (${scopeClause.sql})
      GROUP BY c.id, c.candidate_code, c.full_name, c.mobile, c.email, br.branch_name, pm.process_name
      HAVING COUNT(ch.id) > 0
      ORDER BY last_check_at DESC
      LIMIT 200`,
    [...statusList, ...scopeClause.params]
  );
  return rows;
}

/**
 * Sync real API check results from candidate_bgv_check into candidate_bgv_report.
 * Only updates status columns that have an actual API result — does not overwrite
 * locked reports or manually set remarks.
 */
export async function syncBgvChecksToReport(candidateId: string): Promise<{ synced: number }> {
  const [[checks], [docs]] = await Promise.all([
    db.execute<RowDataPacket[]>(
      `SELECT check_type, status FROM candidate_bgv_check WHERE candidate_id = ?`,
      [candidateId]
    ),
    // Drives the report's "Documents Received" checklist. Nothing used to write
    // those nine flags at all, so the checklist printed entirely unticked even
    // for candidates who had uploaded eight documents — which reads as "not
    // provided" rather than "never recorded".
    db.execute<RowDataPacket[]>(
      `SELECT doc_type FROM candidate_onboarding_document
        WHERE candidate_id = ? AND deleted_at IS NULL`,
      [candidateId]
    ),
  ]);

  if (!checks.length && !docs.length) return { synced: 0 };

  const columnMap: Record<string, string> = {
    pan:        "pan_status",
    bank:       "bank_status",
    aadhaar:    "aadhaar_status",
    // aadhaar_offline is the Befisc XML path — it proves the same identity, so
    // it feeds the same column rather than being dropped.
    aadhaar_offline: "aadhaar_status",
    court:      "criminal_status",
    criminal:   "criminal_status",
    education:  "education_status",
    education_doc: "education_status",
    employment: "employment_status",
    experience: "employment_status", // alias — same verification category
    address:    "address_status",
    address_doc: "address_status",
    digilocker: "digilocker_status",
  };

  // Report columns use ENUM('not_run','passed','failed','partial') — map check
  // statuses to those values only. 'discrepancy' is not a valid ENUM value.
  // waived = partial (HR explicitly decided the check is not required — it is a
  // positive disposition but not a full-pass, so partial is the honest display).
  const statusMap: Record<string, string> = {
    verified:      "passed",
    waived:        "partial",
    mismatch:      "failed",
    failed:        "failed",
    manual_review: "partial",
    not_started:   "not_run",
    pending:       "not_run",
    initiated:     "not_run",
  };

  // Several check types can feed one report column (e.g. aadhaar and
  // aadhaar_offline both prove identity). Collapse them per column instead of
  // emitting duplicate SET clauses, where evaluation order would silently decide
  // the winner and could let a 'pending' overwrite a 'passed'.
  const precedence: Record<string, number> = { passed: 4, partial: 3, failed: 2, not_run: 1 };
  const bestByColumn = new Map<string, string>();
  for (const row of checks as RowDataPacket[]) {
    const col = columnMap[String(row.check_type)];
    if (!col) continue;
    const mapped = statusMap[String(row.status)] ?? "pending";
    const current = bestByColumn.get(col);
    if (!current || (precedence[mapped] ?? 0) > (precedence[current] ?? 0)) {
      bestByColumn.set(col, mapped);
    }
  }

  const setClauses: string[] = [];
  const updateParams: unknown[] = [];
  for (const [col, mapped] of bestByColumn) {
    setClauses.push(`${col} = IF(locked = 1, ${col}, ?)`);
    updateParams.push(mapped);
  }

  // Only ever tick a box, never clear one: `flag OR ?`. A signed-off report is
  // left alone entirely, same as the status columns above.
  const receipts = receiptFlagsFromDocuments(docs.map((d) => d.doc_type));
  for (const [flag, received] of Object.entries(receipts)) {
    if (!received) continue;
    setClauses.push(`${flag} = IF(locked = 1, ${flag}, ${flag} OR ?)`);
    updateParams.push(1);
  }

  if (!setClauses.length) return { synced: 0 };

  updateParams.push(candidateId);
  await db.execute(
    `INSERT INTO candidate_bgv_report (candidate_id) VALUES (?)
     ON DUPLICATE KEY UPDATE ${setClauses.join(", ")}, updated_at = NOW()`,
    [candidateId, ...updateParams]
  );

  return { synced: setClauses.length };
}

// ── BGV API Cost Configuration ────────────────────────────────────────────────

/**
 * Get BGV API costs per check type from org_settings
 */
export async function getBgvApiCosts(): Promise<Record<string, number>> {
  /*
   * org_settings is a flat key/value store - id, setting_key, setting_value, label, updated_by,
   * updated_at. It has no category column, so this raised ER_BAD_FIELD_ERROR and every BGV cost
   * read returned nothing, defaulting every check type to 0.
   *
   * The grouping was always carried by the key prefix, which the loop below already relies on
   * when it strips "bgv_api_cost_" to get the check type. The ten rows are present and
   * populated: aadhaar 5, address 8, bank 4, court 12, criminal 15, digilocker 2, education 10,
   * employment 10, pan 3, uan 6.
   *
   * The underscores are escaped because _ is a single-character wildcard in LIKE.
   */
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT setting_key, setting_value FROM org_settings
      WHERE setting_key LIKE 'bgv\\_api\\_cost\\_%'`
  );
  const costs: Record<string, number> = {};
  for (const row of rows as RowDataPacket[]) {
    // bgv_api_cost_aadhaar -> aadhaar
    const checkType = String(row.setting_key).replace("bgv_api_cost_", "");
    costs[checkType] = parseFloat(String(row.setting_value)) || 0;
  }
  return costs;
}

// ── Name-match verification functions ─────────────────────────────────────────
// Migrated from bgv.enhanced.service.ts to use canonical candidate_bgv_check table

function normalizeName(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameMatches(expected: string, actual: string): boolean {
  const left = normalizeName(expected);
  const right = normalizeName(actual);
  if (!left || !right) return false;
  return left === right || left.split(" ").sort().join(" ") === right.split(" ").sort().join(" ");
}

/**
 * Reconcile the candidate's names across sources, triggered by the system.
 *
 * runNameMatchCheck is correct and was unreachable from the candidate journey —
 * only HR-authenticated routes called it, so it ran only if someone thought to
 * press it, and nobody did: production holds zero name_match rows. A completed
 * verification is exactly when there is something new to compare, so it runs
 * from there now.
 *
 * Never allowed to fail the verification that triggered it. A candidate must
 * not lose a successful PAN check because a follow-up comparison threw.
 */
async function reconcileNamesAfterVerification(candidateId: string): Promise<void> {
  try {
    await runNameMatchCheck(candidateId, "system");
  } catch (error) {
    console.error(`[BGV] name reconciliation failed for ${candidateId}:`, (error as Error)?.message);
  }
}

export async function runNameMatchCheck(candidateId: string, actorUserId: string): Promise<{
  success: boolean;
  status: "verified" | "manual_review";
  result: Record<string, unknown>;
}> {
  // Query candidate data and existing BGV check results from canonical table
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.full_name AS candidate_name,
            p.employee_name AS profile_name,
            p.full_name_aadhaar,
            aadhaar_chk.matched_name AS aadhaar_name,
            pan_chk.matched_name AS pan_name,
            bank_chk.matched_name AS bank_verified_name,
            education_chk.matched_name AS education_name,
            b.account_holder_name,
            q.institution_name
       FROM ats_candidate c
       LEFT JOIN candidate_onboarding_profile p ON p.candidate_id = c.id
       LEFT JOIN candidate_onboarding_bank_detail b ON b.candidate_id = c.id
       LEFT JOIN candidate_onboarding_qualification q ON q.candidate_id = c.id
       LEFT JOIN candidate_bgv_check aadhaar_chk
         ON aadhaar_chk.candidate_id = c.id AND aadhaar_chk.check_type IN ('aadhaar', 'aadhaar_offline')
       LEFT JOIN candidate_bgv_check pan_chk
         ON pan_chk.candidate_id = c.id AND pan_chk.check_type = 'pan'
       LEFT JOIN candidate_bgv_check bank_chk
         ON bank_chk.candidate_id = c.id AND bank_chk.check_type = 'bank'
       LEFT JOIN candidate_bgv_check education_chk
         ON education_chk.candidate_id = c.id AND education_chk.check_type = 'education'
      WHERE c.id = ?
      LIMIT 1`,
    [candidateId]
  );
  const row = rows[0];
  if (!row) throw Object.assign(new Error("Candidate not found"), { statusCode: 404 });

  const baseline = String(row.profile_name ?? row.candidate_name ?? "").trim();
  const checks = [
    { source: "aadhaar", value: row.aadhaar_name ?? row.full_name_aadhaar },
    { source: "pan", value: row.pan_name },
    // Only the name the BANK returned counts here. Falling back to
    // account_holder_name would compare the candidate against a value the
    // candidate typed, so anyone submitting another person's account and
    // typing that person's name would reconcile perfectly against themselves —
    // the same hole closed in the bank adapter. No verified name means no
    // bank evidence, which is a truthful gap rather than a false match.
    { source: "bank", value: row.bank_verified_name },
    { source: "education", value: row.education_name },
  ].map((item) => {
    const value = String(item.value ?? "").trim();
    return {
      source: item.source,
      available: Boolean(value),
      matched: value ? nameMatches(baseline, value) : null,
    };
  });
  const hasMismatch = checks.some((item) => item.matched === false);
  const status = hasMismatch ? "manual_review" : "verified";
  const result = {
    baseline_name: baseline,
    checks,
    decision: status,
  };

  // Insert or update name_match check in canonical table
  await createOrUpdateCheck(candidateId, "name_match", status, {
    providerKey: "system",
    resultSummary: hasMismatch ? "Name mismatch requires HR manual review" : "Name match verified",
    resultJson: result,
    matchScore: hasMismatch ? 0 : 100,
    matchedName: baseline,
  });

  await logEvent(candidateId, "BGV_NAME_MATCH_CHECKED", result, null, { actorType: "hr", actorId: actorUserId });

  return { success: true, status, result };
}

export async function overrideNameMatchReview(params: {
  candidateId: string;
  actorUserId: string;
  reason: string;
}): Promise<{ success: boolean }> {
  if (!params.reason.trim()) {
    throw Object.assign(new Error("Override reason is required"), { statusCode: 400 });
  }

  // Find the name_match check in canonical table
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, result_json
       FROM candidate_bgv_check
      WHERE candidate_id = ? AND check_type = 'name_match'
      ORDER BY updated_at DESC
      LIMIT 1`,
    [params.candidateId]
  );
  const check = rows[0];
  if (!check) throw Object.assign(new Error("Name match review not found"), { statusCode: 404 });

  // Update to verified status with HR override note
  await db.execute(
    `UPDATE candidate_bgv_check
        SET status = 'verified',
            review_remarks = CONCAT(COALESCE(review_remarks, ''), '\nHR override: ', ?),
            reviewed_by = ?,
            reviewed_at = NOW(),
            verified_at = NOW(),
            updated_at = NOW()
      WHERE id = ?`,
    [params.reason.trim(), params.actorUserId, check.id]
  );

  await logEvent(params.candidateId, "BGV_NAME_MATCH_HR_OVERRIDE", {
    check_id: check.id,
    reason: params.reason.trim(),
    override: true,
  }, check.id, { actorType: "hr", actorId: params.actorUserId });

  return { success: true };
}
