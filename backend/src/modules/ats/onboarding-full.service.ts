import { randomUUID, createHash } from "crypto";
import fs from "fs";
import path from "path";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { getUserRoleContext } from "../../shared/roleResolver.js";
import { hasScopedAccess } from "../../shared/scopeAccess.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { luckpayClient, sanitizeProviderPayload } from "../integrations/luckpay/luckpay.client.js";

type ActorType = "candidate" | "hr" | "system";
type AuthenticatedUser = NonNullable<AuthenticatedRequest["authUser"]>;
export type OnboardingScopeFilter = { sql: string; params: unknown[] };
export type OnboardingDocumentPermission = {
  canPreview: boolean;
  canDownload: boolean;
  category: "general" | "sensitive" | "payroll";
  reason?: string;
};
export type OnboardingDocumentAccessDecision = { allowed: boolean; reason?: string; roleKeys?: string[] };
export type OnboardingDocumentAccessParams = {
  user?: AuthenticatedUser & { roleKeys?: string[] };
  candidateTokenData?: { candidate_id?: string | null };
  document: Record<string, unknown>;
  action: "preview" | "download";
};

interface BgvCheckRow extends RowDataPacket {
  check_type: string;
  status: string;
}

interface OnboardingProfileBlockerRow extends RowDataPacket {
  otp_verified: number | null;
  statutory_declaration_accepted: number | null;
  dpdp_consent: number | null;
  bgv_consent: number | null;
}

const PAYROLL_DOCUMENT_KEYWORDS = [
  "bank",
  "account",
  "ifsc",
  "cheque",
  "check",
  "passbook",
  "salary",
  "ctc",
  "pf",
  "epf",
  "uan",
  "esic",
  "form11",
  "statutory",
  "payroll",
];

const SENSITIVE_DOCUMENT_KEYWORDS = [
  ...PAYROLL_DOCUMENT_KEYWORDS,
  "aadhaar",
  "aadhar",
  "aadhaar_front",
  "aadhaar_back",
  "pan",
  "passport",
  "voter",
  "driving",
  "licence",
  "license",
  "kyc",
  "identity",
  "address",
  "address_proof",
  "bgv",
  "court",
  "criminal",
];

function normalizeDocumentText(doc: Partial<{ doc_type: unknown; doc_name: unknown; file_original_name: unknown }>) {
  return [doc.doc_type, doc.doc_name, doc.file_original_name]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
}

function classifyOnboardingDocument(doc: Partial<{ doc_type: unknown; doc_name: unknown; file_original_name: unknown }>) {
  const text = normalizeDocumentText(doc);
  const isPayrollRelated = PAYROLL_DOCUMENT_KEYWORDS.some((keyword) => text.includes(keyword));
  const isSensitive = isPayrollRelated || SENSITIVE_DOCUMENT_KEYWORDS.some((keyword) => text.includes(keyword));
  return {
    isPayrollRelated,
    isSensitive,
    category: (isPayrollRelated ? "payroll" : isSensitive ? "sensitive" : "general") as OnboardingDocumentPermission["category"],
  };
}

function buildOnboardingDocumentUrl(documentId: string, options?: { token?: string; download?: boolean }) {
  const base = options?.download
    ? `/api/ats/onboarding-full/documents/${documentId}/download`
    : `/api/ats/onboarding-full/documents/preview/${documentId}`;
  if (!options?.token) return base;
  const params = new URLSearchParams({ token: options.token });
  return `${base}?${params.toString()}`;
}

function sanitizeOnboardingDocument(
  row: Record<string, unknown>,
  options?: { token?: string; permission?: OnboardingDocumentPermission }
) {
  const permission = options?.permission ?? { canPreview: true, canDownload: Boolean(options?.token), category: "general" };
  if (!permission.canPreview) return null;
  const { file_path: _filePath, ...rest } = row;
  const id = String(row.id ?? "");
  const previewUrl = buildOnboardingDocumentUrl(id, { token: options?.token });
  const downloadUrl = permission.canDownload || Boolean(options?.token)
    ? buildOnboardingDocumentUrl(id, { token: options?.token, download: true })
    : null;

  return {
    ...rest,
    file_url: previewUrl,
    preview_url: previewUrl,
    download_url: downloadUrl,
    can_preview: true,
    can_download: Boolean(downloadUrl),
    document_category: permission.category,
  };
}

export function getOnboardingDocumentPermission(
  row: Partial<{ doc_type: unknown; doc_name: unknown; file_original_name: unknown }>,
  roleKeys: string[]
): OnboardingDocumentPermission {
  const roles = new Set(roleKeys);
  const classification = classifyOnboardingDocument(row);

  if (roles.has("super_admin") || roles.has("admin") || roles.has("hr")) {
    return { canPreview: true, canDownload: true, category: classification.category };
  }

  if (roles.has("payroll_hr") || roles.has("payroll")) {
    if (!classification.isPayrollRelated) {
      return {
        canPreview: false,
        canDownload: false,
        category: classification.category,
        reason: "Payroll access is restricted to payroll-related documents.",
      };
    }
    return { canPreview: true, canDownload: true, category: classification.category };
  }

  if (roles.has("manager") || roles.has("process_manager")) {
    return { canPreview: true, canDownload: false, category: classification.category };
  }

  if (roles.has("recruiter")) {
    if (classification.isSensitive) {
      return {
        canPreview: false,
        canDownload: false,
        category: classification.category,
        reason: "Recruiters cannot access sensitive payroll or statutory documents.",
      };
    }
    return { canPreview: true, canDownload: false, category: classification.category };
  }

  return {
    canPreview: false,
    canDownload: false,
    category: classification.category,
    reason: "Your role does not have access to this document.",
  };
}

export async function canAccessOnboardingDocument(
  params: OnboardingDocumentAccessParams
): Promise<OnboardingDocumentAccessDecision> {
  const candidateId = String(params.document.candidate_id ?? "");
  if (!candidateId) {
    return { allowed: false, reason: "Document is missing candidate ownership metadata." };
  }

  if (params.candidateTokenData) {
    if (String(params.candidateTokenData.candidate_id ?? "") !== candidateId) {
      return { allowed: false, reason: "Candidate token cannot access another candidate's document." };
    }
    return { allowed: true, roleKeys: ["candidate"] };
  }

  if (!params.user?.id) {
    return { allowed: false, reason: "Authentication required." };
  }

  const roleKeys = params.user.roleKeys?.length
    ? params.user.roleKeys
    : (await getUserRoleContext(params.user.id)).roleKeys;

  if (!roleKeys.some((role) => [
    "admin",
    "super_admin",
    "hr",
    "manager",
    "process_manager",
    "payroll_hr",
    "payroll",
    "recruiter",
  ].includes(role))) {
    return { allowed: false, reason: "You are not authorized to access onboarding documents." };
  }

  const scopedAllowed = await hasScopedAccess(
    params.user.id,
    ["hr", "manager", "process_manager", "payroll_hr", "payroll", "recruiter"],
    {
      branchId: params.document.applied_for_branch ? String(params.document.applied_for_branch) : undefined,
      processId: params.document.applied_for_process ? String(params.document.applied_for_process) : undefined,
    },
    { allowAdminBypass: true, requireScopeForNonAdmin: true }
  );

  if (!scopedAllowed) {
    return { allowed: false, reason: "Forbidden for this branch/process scope.", roleKeys };
  }

  const permission = getOnboardingDocumentPermission(params.document, roleKeys);
  const allowed = params.action === "download" ? permission.canDownload : permission.canPreview;
  if (!allowed) {
    return { allowed: false, reason: permission.reason ?? "Access denied for this document.", roleKeys };
  }

  return { allowed: true, roleKeys };
}

const hashValue = (value: unknown) => {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized ? createHash("sha256").update(normalized).digest("hex") : null;
};

const maskAadhaar = (value: unknown) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return `XXXX-XXXX-${digits.slice(-4)}`;
};

const maskPan = (value: unknown) => {
  const pan = String(value ?? "").trim().toUpperCase();
  if (!pan) return null;
  return `${pan.slice(0, 3)}XXXX${pan.slice(-2)}`;
};

const maskAccount = (value: unknown) => {
  const account = String(value ?? "").replace(/\s/g, "");
  if (!account) return null;
  return `XXXXXX${account.slice(-4)}`;
};

async function logCandidateAction(candidateId: string, actionType: string, payload?: unknown, meta?: { ip?: string; userAgent?: string; actorType?: ActorType; actorId?: string | null }) {
  await db.execute(
    `INSERT INTO candidate_onboarding_submission_log
       (id, candidate_id, action_type, action_by_type, action_by, action_payload, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      candidateId,
      actionType,
      meta?.actorType ?? "candidate",
      meta?.actorId ?? null,
      payload ? JSON.stringify(payload) : null,
      meta?.ip ?? null,
      meta?.userAgent ?? null,
    ]
  );
}

export async function auditOnboardingDocumentAccess(
  row: Record<string, unknown>,
  actionType:
    | "PREVIEW_DOCUMENT"
    | "DOWNLOAD_DOCUMENT"
    | "PREVIEW_DOCUMENT_DENIED"
    | "DOWNLOAD_DOCUMENT_DENIED",
  meta?: { ip?: string; userAgent?: string; actorType?: ActorType; actorId?: string | null; roleKeys?: string[] }
) {
  const candidateId = String(row.candidate_id ?? "");
  await logCandidateAction(candidateId, actionType, {
    documentId: row.id ?? null,
    docType: row.doc_type ?? null,
    fileName: row.file_original_name ?? null,
  }, meta);

  if (meta?.actorType === "candidate" || !meta?.actorId) return;

  await logSensitiveAction({
    actor_user_id: meta.actorId,
    actor_role: meta.roleKeys?.join(",") ?? "hr",
    action_type: actionType,
    module_key: "ATS_ONBOARDING",
    entity_type: "candidate_onboarding_document",
    entity_id: String(row.id ?? ""),
    change_summary: {
      candidate_id: candidateId,
      doc_type: row.doc_type ?? null,
      file_name: row.file_original_name ?? null,
      access_mode: actionType.includes("DOWNLOAD") ? "download" : "preview",
      access_outcome: actionType.endsWith("_DENIED") ? "denied" : "allowed",
    },
    ip_address: meta.ip,
    user_agent: meta.userAgent,
  });
}

async function ensureCandidateWithinScope(candidateId: string, scopeFilter?: OnboardingScopeFilter) {
  const whereSql = scopeFilter?.sql ? ` AND (${scopeFilter.sql})` : "";
  const params = scopeFilter?.params ?? [];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.id
       FROM ats_candidate c
      WHERE c.id = ?${whereSql}
      LIMIT 1`,
    [candidateId, ...params]
  );
  if (!(rows as RowDataPacket[]).length) {
    throw Object.assign(new Error("Forbidden for this branch/process scope"), { statusCode: 403 });
  }
}

async function getLatestDigilockerStatus(candidateId: string) {
  const [providerRows] = await db.execute<RowDataPacket[]>(
    `SELECT service_type, status, provider_url, client_transaction_id, updated_at
       FROM ats_provider_transaction_log
      WHERE candidate_id = ? AND provider = 'luckpay' AND service_type = 'digilocker'
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1`,
    [candidateId]
  ).catch(() => [[] as RowDataPacket[]]);

  if ((providerRows as RowDataPacket[]).length) {
    const row = (providerRows as RowDataPacket[])[0];
    return {
      provider: "luckpay",
      status: row.status ?? "initiated",
      verification_url: row.provider_url ?? null,
      client_transaction_id: row.client_transaction_id ?? null,
      updated_at: row.updated_at ?? null,
    };
  }

  const [sessionRows] = await db.execute<RowDataPacket[]>(
    `SELECT session_id, status, auth_url, completed_at, initiated_at
       FROM candidate_digilocker_sessions
      WHERE candidate_id = ?
      ORDER BY initiated_at DESC
      LIMIT 1`,
    [candidateId]
  ).catch(() => [[] as RowDataPacket[]]);

  if ((sessionRows as RowDataPacket[]).length) {
    const row = (sessionRows as RowDataPacket[])[0];
    return {
      provider: "existing",
      status: row.status ?? "not_started",
      verification_url: row.auth_url ?? null,
      client_transaction_id: row.session_id ?? null,
      updated_at: row.completed_at ?? row.initiated_at ?? null,
    };
  }

  return { provider: "luckpay", status: "not_started", verification_url: null, client_transaction_id: null, updated_at: null };
}

async function getLatestEsignStatus(candidateId: string) {
  const [requestRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, current_state, candidate_esign_status, candidate_esign_url, esign_provider,
            esign_transaction_id, updated_at
       FROM appointment_letter_request
      WHERE candidate_id = ?
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1`,
    [candidateId]
  ).catch(() => [[] as RowDataPacket[]]);

  if ((requestRows as RowDataPacket[]).length) {
    const row = (requestRows as RowDataPacket[])[0];
    return {
      request_id: row.id ?? null,
      provider: row.esign_provider ?? "manual",
      status: row.candidate_esign_status ?? row.current_state ?? "not_started",
      verification_url: row.candidate_esign_url ?? null,
      client_transaction_id: row.esign_transaction_id ?? null,
      updated_at: row.updated_at ?? null,
    };
  }

  return { request_id: null, provider: "manual", status: "not_started", verification_url: null, client_transaction_id: null, updated_at: null };
}

async function createProviderTransactionLog(params: {
  candidateId: string;
  provider: string;
  serviceType: string;
  clientTransactionId: string;
  status: string;
  requestPayload?: unknown;
  initiatedBy?: string | null;
  initiatedByType?: string | null;
}) {
  await db.execute(
    `INSERT INTO ats_provider_transaction_log
       (id, candidate_id, provider, service_type, client_transaction_id, status, request_payload, initiated_by, initiated_by_type)
     VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?)`,
    [
      randomUUID(),
      params.candidateId,
      params.provider,
      params.serviceType,
      params.clientTransactionId,
      params.status,
      JSON.stringify(sanitizeProviderPayload(params.requestPayload ?? null)),
      params.initiatedBy ?? null,
      params.initiatedByType ?? null,
    ]
  );
}

async function updateProviderTransactionLog(params: {
  provider: string;
  clientTransactionId: string;
  status: string;
  providerReferenceId?: string | null;
  responsePayload?: unknown;
  providerUrl?: string | null;
  errorMessage?: string | null;
}) {
  await db.execute(
    `UPDATE ats_provider_transaction_log
        SET status = ?,
            provider_reference_id = ?,
            response_payload = CAST(? AS JSON),
            provider_url = ?,
            error_message = ?,
            updated_at = NOW()
      WHERE provider = ? AND client_transaction_id = ?`,
    [
      params.status,
      params.providerReferenceId ?? null,
      JSON.stringify(sanitizeProviderPayload(params.responsePayload ?? null)),
      params.providerUrl ?? null,
      params.errorMessage ?? null,
      params.provider,
      params.clientTransactionId,
    ]
  );
}

async function resolveEsignSource(candidateId: string) {
  const [requestRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, vault_path
       FROM appointment_letter_request
      WHERE candidate_id = ?
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1`,
    [candidateId]
  ).catch(() => [[] as RowDataPacket[]]);

  const requestRow = (requestRows as RowDataPacket[])[0];
  const requestId = requestRow?.id ? String(requestRow.id) : null;
  const requestPath = requestRow?.vault_path ? String(requestRow.vault_path) : null;
  if (requestPath && fs.existsSync(requestPath)) {
    return { requestId, filePath: requestPath };
  }

  const [offerRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, pdf_path
       FROM ats_offer_letters
      WHERE candidate_id = ? AND pdf_path IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [candidateId]
  ).catch(() => [[] as RowDataPacket[]]);

  const offerRow = (offerRows as RowDataPacket[])[0];
  const offerPath = offerRow?.pdf_path ? String(offerRow.pdf_path) : null;
  if (offerPath && fs.existsSync(offerPath)) {
    return {
      requestId,
      offerId: offerRow?.id ? String(offerRow.id) : null,
      filePath: offerPath,
    };
  }

  throw Object.assign(new Error("No generated appointment or offer letter PDF was found for eSign."), { statusCode: 400 });
}

async function triggerBgvAfterOnboardingSubmit(candidateId: string, meta?: { ip?: string; userAgent?: string }) {
  const checkTypes = ["aadhaar", "digilocker", "pan", "court", "education_doc", "employment", "address"];
  for (const checkType of checkTypes) {
    const [existing] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM candidate_bgv_check WHERE candidate_id = ? AND check_type = ? LIMIT 1`,
      [candidateId, checkType]
    );
    if (existing.length) continue;
    await db.execute(
      `INSERT INTO candidate_bgv_check
         (id, candidate_id, check_type, provider_key, status, result_summary, result_json)
       VALUES (?, ?, ?, 'system', 'pending', 'Auto-created after onboarding submit', CAST(? AS JSON))`,
      [randomUUID(), candidateId, checkType, JSON.stringify({ source: "onboarding_submit" })]
    );
  }

  await db.execute(
    `INSERT INTO candidate_bgv_report (id, candidate_id, overall_status, bgv_score, hr_remarks)
     VALUES (?, ?, 'in_progress', 0, 'Auto-triggered after onboarding profile submission')
     ON DUPLICATE KEY UPDATE overall_status = IF(overall_status = 'verified', overall_status, 'in_progress'), updated_at = NOW()`,
    [randomUUID(), candidateId]
  );

  await db.execute(
    `INSERT INTO candidate_bgv_verification_event
       (id, candidate_id, event_type, event_status, event_payload, actor_type, ip_address, user_agent)
     VALUES (?, ?, 'BGV_AUTO_TRIGGERED', 'in_progress', CAST(? AS JSON), 'system', ?, ?)`,
    [randomUUID(), candidateId, JSON.stringify({ checkTypes }), meta?.ip ?? null, meta?.userAgent ?? null]
  );
}

export async function validateOnboardingToken(token: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT b.candidate_id, b.onboarding_token_expires_at,
            c.id, c.candidate_code, c.full_name, c.mobile, c.email,
            c.gender, c.date_of_birth, c.applied_for_branch, c.applied_for_process,
            c.sourcing_channel, c.source_details, c.resume_url, c.selfie_url,
            c.profile_status, br.branch_name, pm.process_name
       FROM ats_onboarding_bridge b
       JOIN ats_candidate c ON c.id = b.candidate_id
       LEFT JOIN branch_master br ON br.id = c.applied_for_branch
       LEFT JOIN process_master pm ON pm.id = c.applied_for_process
      WHERE b.onboarding_token = ?
      LIMIT 1`,
    [token]
  );

  if (!rows.length) throw Object.assign(new Error("Invalid onboarding token"), { statusCode: 400 });
  const row = rows[0];
  if (new Date(row.onboarding_token_expires_at as string) < new Date()) {
    throw Object.assign(new Error("Onboarding token expired"), { statusCode: 410 });
  }

  const [profileRows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM candidate_onboarding_profile WHERE candidate_id = ? LIMIT 1`,
    [row.candidate_id]
  );

  return {
    candidate_id: row.candidate_id,
    candidate_code: row.candidate_code,
    full_name: row.full_name,
    mobile: row.mobile,
    email: row.email,
    gender: row.gender,
    date_of_birth: row.date_of_birth,
    branch_id: row.applied_for_branch,
    branch_name: row.branch_name,
    process_id: row.applied_for_process,
    process_name: row.process_name,
    source_type: row.sourcing_channel ?? null,
    source: row.source_details ?? row.sourcing_channel ?? null,
    resume_url: row.resume_url,
    selfie_url: row.selfie_url,
    profile_status: row.profile_status,
    saved_profile: profileRows[0] ?? null,
  };
}

export async function getFullOnboardingStatus(token: string) {
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;

  const [documents] = await db.execute<RowDataPacket[]>(
    `SELECT id, doc_type, doc_name, page_no, file_original_name, file_url, mime_type, file_size_bytes,
            document_status, verification_method, verification_ref, uploaded_at
       FROM candidate_onboarding_document
      WHERE candidate_id = ? AND deleted_at IS NULL
      ORDER BY uploaded_at DESC`,
    [candidateId]
  );
  const [bankRows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM candidate_onboarding_bank_detail WHERE candidate_id = ? LIMIT 1`,
    [candidateId]
  );
  const [qualificationRows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM candidate_onboarding_qualification WHERE candidate_id = ? ORDER BY created_at DESC`,
    [candidateId]
  );
  const [familyRows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM candidate_onboarding_family WHERE candidate_id = ? LIMIT 1`,
    [candidateId]
  );
  const [experienceRows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM candidate_onboarding_experience WHERE candidate_id = ? LIMIT 1`,
    [candidateId]
  );

  const sanitizedDocuments = (documents as RowDataPacket[])
    .map((row) => sanitizeOnboardingDocument(row as Record<string, unknown>, { token }))
    .filter(Boolean);
  const [digilocker, esign] = await Promise.all([
    getLatestDigilockerStatus(candidateId),
    getLatestEsignStatus(candidateId),
  ]);

  return {
    token: tokenData,
    documents: sanitizedDocuments,
    bank: bankRows[0] ?? null,
    qualifications: qualificationRows,
    family: familyRows[0] ?? null,
    experience: experienceRows[0] ?? null,
    digilocker,
    esign,
  };
}

export async function saveEmployeeDetails(token: string, input: Record<string, unknown>, meta?: { ip?: string; userAgent?: string }) {
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;
  const id = randomUUID();
  const panMasked = maskPan(input.panNumber ?? input.pan_number ?? input.pan_number_masked);
  const panHash = hashValue(input.panNumber ?? input.pan_number);
  const aadhaarMasked = maskAadhaar(input.aadhaarNumber ?? input.aadhar_number ?? input.aadhaar_number);
  const aadhaarHash = hashValue(input.aadhaarNumber ?? input.aadhar_number ?? input.aadhaar_number);

  await db.execute(
    `INSERT INTO candidate_onboarding_profile
       (id, candidate_id, onboarding_token_hash, title, employee_name, relation, father_husband_name,
        gender, marital_status, date_of_birth, blood_group,
        nominee_name, nominee_relation, nominee_date_of_birth, nominee1_share_pct,
        nominee2_name, nominee2_relation, nominee2_dob, nominee2_share_pct,
        permanent_address, permanent_state, permanent_city, permanent_pincode,
        present_address, present_state, present_city, present_pincode, mobile_number, alt_mobile_number,
        personal_email_id, official_email_id, pan_number_masked, pan_number_hash, aadhaar_number_masked,
        aadhaar_number_hash, passport_no, driving_license_no,
        uan_number, epf_number, esic_number,
        source_type, source, profile_status,
        mother_name, emergency_contact_name, emergency_contact_relation, emergency_contact_mobile,
        nationality, religion, category, address_proof_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'employee_details_saved', ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
        title = VALUES(title), employee_name = VALUES(employee_name), relation = VALUES(relation),
        father_husband_name = VALUES(father_husband_name), gender = VALUES(gender), marital_status = VALUES(marital_status),
        date_of_birth = VALUES(date_of_birth), blood_group = VALUES(blood_group),
        nominee_name = VALUES(nominee_name), nominee_relation = VALUES(nominee_relation),
        nominee_date_of_birth = VALUES(nominee_date_of_birth), nominee1_share_pct = VALUES(nominee1_share_pct),
        nominee2_name = VALUES(nominee2_name), nominee2_relation = VALUES(nominee2_relation),
        nominee2_dob = VALUES(nominee2_dob), nominee2_share_pct = VALUES(nominee2_share_pct),
        permanent_address = VALUES(permanent_address), permanent_state = VALUES(permanent_state), permanent_city = VALUES(permanent_city),
        permanent_pincode = VALUES(permanent_pincode), present_address = VALUES(present_address), present_state = VALUES(present_state),
        present_city = VALUES(present_city), present_pincode = VALUES(present_pincode), mobile_number = VALUES(mobile_number),
        alt_mobile_number = VALUES(alt_mobile_number), personal_email_id = VALUES(personal_email_id), official_email_id = VALUES(official_email_id),
        pan_number_masked = VALUES(pan_number_masked), pan_number_hash = VALUES(pan_number_hash),
        aadhaar_number_masked = VALUES(aadhaar_number_masked), aadhaar_number_hash = VALUES(aadhaar_number_hash),
        passport_no = VALUES(passport_no), driving_license_no = VALUES(driving_license_no),
        uan_number = VALUES(uan_number), epf_number = VALUES(epf_number), esic_number = VALUES(esic_number),
        source_type = VALUES(source_type), source = VALUES(source),
        mother_name = VALUES(mother_name), emergency_contact_name = VALUES(emergency_contact_name),
        emergency_contact_relation = VALUES(emergency_contact_relation), emergency_contact_mobile = VALUES(emergency_contact_mobile),
        nationality = VALUES(nationality), religion = VALUES(religion), category = VALUES(category),
        address_proof_type = VALUES(address_proof_type),
        profile_status = IF(profile_status='submitted', profile_status, 'employee_details_saved'), updated_at = NOW()`,
    [
      id,
      candidateId,
      hashValue(token),
      input.title ?? null,
      input.employeeName ?? tokenData.full_name ?? null,
      input.relation ?? null,
      input.fatherHusbandName ?? input.father_name ?? null,
      input.gender ?? tokenData.gender ?? null,
      input.maritalStatus ?? null,
      input.dateOfBirth ?? tokenData.date_of_birth ?? null,
      input.bloodGroup ?? null,
      input.nominee ?? input.nomineeName ?? null,
      input.nomineeRelation ?? null,
      input.nomineeDateOfBirth ?? null,
      input.nominee1SharePct ?? null,
      input.nominee2Name ?? null,
      input.nominee2Relation ?? null,
      input.nominee2Dob ?? null,
      input.nominee2SharePct ?? null,
      input.permanentAddress ?? null,
      input.permanentState ?? null,
      input.permanentCity ?? null,
      input.permanentPincode ?? null,
      input.presentAddress ?? input.current_address ?? null,
      input.presentState ?? null,
      input.presentCity ?? null,
      input.presentPincode ?? null,
      input.mobileNumber ?? tokenData.mobile ?? null,
      input.altMobileNumber ?? null,
      input.personalEmailId ?? tokenData.email ?? null,
      input.officialEmailId ?? null,
      panMasked,
      panHash,
      aadhaarMasked,
      aadhaarHash,
      input.passportNo ?? input["passportNumber"] ?? input["passport_number"] ?? null,
      input.drivingLicenseNo ?? input["dlNumber"] ?? input["dl_number"] ?? null,
      input.uanNumber ?? null,
      input.epfNumber ?? null,
      input.esicNumber ?? null,
      input.sourceType ?? tokenData.source_type ?? null,
      input.source ?? tokenData.source ?? null,
      input.motherName ?? null,
      input.emergencyContactName ?? null,
      input.emergencyContactRelation ?? null,
      input.emergencyContactMobile ?? null,
      input.nationality ?? 'Indian',
      input.religion ?? null,
      input.category ?? null,
      input.addressProofType ?? null,
    ]
  );

  await db.execute(
    `UPDATE ats_candidate SET
       title = ?, relation = ?, father_husband_name = ?, father_name = ?, gender = ?, marital_status = ?,
       date_of_birth = ?, blood_group = ?, nominee_name = ?, nominee_relation = ?, nominee_date_of_birth = ?,
       permanent_address = ?, permanent_state = ?, permanent_city = ?, permanent_pincode = ?,
       current_address = ?, present_state = ?, present_city = ?, present_pincode = ?, alt_mobile_number = ?,
       personal_email_id = ?, official_email_id = ?,
       pan_number = COALESCE(?, pan_number), pan_number_hash = COALESCE(?, pan_number_hash),
       aadhar_number = COALESCE(?, aadhar_number), aadhar_number_hash = COALESCE(?, aadhar_number_hash),
       source_type = ?, source = ?, profile_status = 'profile_in_progress', updated_at = NOW()
     WHERE id = ?`,
    [
      input.title ?? null,
      input.relation ?? null,
      input.fatherHusbandName ?? input.father_name ?? null,
      input.fatherHusbandName ?? input.father_name ?? null,
      input.gender ?? tokenData.gender ?? null,
      input.maritalStatus ?? null,
      input.dateOfBirth ?? tokenData.date_of_birth ?? null,
      input.bloodGroup ?? null,
      input.nominee ?? input.nomineeName ?? null,
      input.nomineeRelation ?? null,
      input.nomineeDateOfBirth ?? null,
      input.permanentAddress ?? null,
      input.permanentState ?? null,
      input.permanentCity ?? null,
      input.permanentPincode ?? null,
      input.presentAddress ?? input.current_address ?? null,
      input.presentState ?? null,
      input.presentCity ?? null,
      input.presentPincode ?? null,
      input.altMobileNumber ?? null,
      input.personalEmailId ?? tokenData.email ?? null,
      input.officialEmailId ?? null,
      panMasked,
      panHash,
      aadhaarMasked,
      aadhaarHash,
      input.sourceType ?? tokenData.source_type ?? null,
      input.source ?? tokenData.source ?? null,
      candidateId,
    ]
  );
  // Update extra identity/statutory fields on ats_candidate if columns exist
  // These are safe UPDATE SET with COALESCE to not overwrite non-null existing values
  await db.execute(
    `UPDATE ats_candidate SET
       passport_no = COALESCE(?, passport_no),
       driving_license_no = COALESCE(?, driving_license_no),
       uan_number = COALESCE(?, uan_number),
       epf_number = COALESCE(?, epf_number),
       esic_number = COALESCE(?, esic_number),
       updated_at = NOW()
     WHERE id = ?`,
    [
      input.passportNo ?? input["passportNumber"] ?? input["passport_number"] ?? null,
      input.drivingLicenseNo ?? input["dlNumber"] ?? input["dl_number"] ?? null,
      input.uanNumber ?? null,
      input.epfNumber ?? null,
      input.esicNumber ?? null,
      candidateId,
    ]
  ).catch(() => { /* columns may not exist on older schema — safe to ignore */ });

  await logCandidateAction(candidateId, "SAVE_EMPLOYEE_DETAILS", { fields: Object.keys(input) }, meta);
  return getFullOnboardingStatus(token);
}

export async function saveBankDetails(token: string, input: Record<string, unknown>, meta?: { ip?: string; userAgent?: string }) {
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;
  const accountNo = input.accountNo ?? input.bank_account_no ?? input.account_no;
  const id = randomUUID();

  await db.execute(
    `INSERT INTO candidate_onboarding_bank_detail
       (id, candidate_id, bank_name, branch_name, account_holder_name, account_no_masked,
        account_no_hash, ifsc_code, account_type, cancelled_cheque_document_id, verification_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_started')
     ON DUPLICATE KEY UPDATE
       bank_name = VALUES(bank_name), branch_name = VALUES(branch_name), account_holder_name = VALUES(account_holder_name),
       account_no_masked = VALUES(account_no_masked), account_no_hash = VALUES(account_no_hash), ifsc_code = VALUES(ifsc_code),
       account_type = VALUES(account_type), cancelled_cheque_document_id = VALUES(cancelled_cheque_document_id),
       updated_at = NOW()`,
    [
      id,
      candidateId,
      input.bankName ?? input.bank_name ?? null,
      input.branchName ?? null,
      input.accountHolderName ?? null,
      maskAccount(accountNo),
      hashValue(accountNo),
      String(input.ifscCode ?? input.bank_ifsc ?? "").trim().toUpperCase() || null,
      input.accountType ?? null,
      input.cancelledChequeDocumentId ?? null,
    ]
  );

  await db.execute(
    `UPDATE candidate_onboarding_profile SET profile_status = IF(profile_status='submitted', profile_status, 'bank_saved'), updated_at = NOW()
      WHERE candidate_id = ?`,
    [candidateId]
  );
  await db.execute(
    `UPDATE ats_candidate SET
       bank_name = ?,
       bank_ifsc = ?,
       bank_account_no = COALESCE(?, bank_account_no),
       bank_account_no_hash = COALESCE(?, bank_account_no_hash),
       updated_at = NOW()
     WHERE id = ?`,
    [
      input.bankName ?? input.bank_name ?? null,
      input.ifscCode ?? input.bank_ifsc ?? null,
      maskAccount(accountNo),
      hashValue(accountNo),
      candidateId,
    ]
  );

  // Cheque name validation: compare name_on_cheque against account_holder_name.
  // Mismatch is queued for Payroll HO review — onboarding is NEVER blocked.
  const nameOnCheque = String(input.nameOnCheque ?? input.name_on_cheque ?? '').trim();
  const accountHolderName = String(input.accountHolderName ?? '').trim();
  const chequeDocId = (input.cancelledChequeDocumentId ?? null) as string | null;

  if (nameOnCheque && accountHolderName) {
    const namesMatch = nameOnCheque.toLowerCase() === accountHolderName.toLowerCase();

    // Fetch the bank_detail row we just upserted
    const [bdRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM candidate_onboarding_bank_detail WHERE candidate_id = ? ORDER BY updated_at DESC LIMIT 1`,
      [candidateId]
    );
    const bankDetailId = bdRows[0]?.id ?? null;

    if (namesMatch) {
      await db.execute(
        `UPDATE candidate_onboarding_bank_detail SET name_validation_status = 'matched' WHERE id = ?`,
        [bankDetailId]
      );
    } else {
      // Insert mismatch record and route to Payroll HO queue
      const valId = randomUUID();
      await db.execute(
        `INSERT INTO cheque_name_validation
           (id, candidate_id, bank_detail_id, cheque_document_id, name_on_cheque, name_in_profile, match_status)
         VALUES (?, ?, ?, ?, ?, ?, 'mismatch')
         ON DUPLICATE KEY UPDATE
           name_on_cheque = VALUES(name_on_cheque), name_in_profile = VALUES(name_in_profile),
           match_status = 'mismatch', validated_by = NULL, validated_at = NULL`,
        [valId, candidateId, bankDetailId, chequeDocId, nameOnCheque, accountHolderName]
      );
      await db.execute(
        `UPDATE candidate_onboarding_bank_detail
            SET name_validation_status = 'pending_review', cheque_validation_id = ?
          WHERE id = ?`,
        [valId, bankDetailId]
      );
    }
  }

  await logCandidateAction(candidateId, "SAVE_BANK_DETAILS", { bankName: input.bankName ?? input.bank_name, ifsc: input.ifscCode ?? input.bank_ifsc }, meta);
  return getFullOnboardingStatus(token);
}

export async function addQualification(token: string, input: Record<string, unknown>, meta?: { ip?: string; userAgent?: string }) {
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;
  const id = randomUUID();
  await db.execute(
    `INSERT INTO candidate_onboarding_qualification
      (id, candidate_id, qualification, specialization_course_name, passed_out_year,
       passed_out_state, passed_out_city, passed_out_percentage, document_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      candidateId,
      input.qualification ?? null,
      input.specializationCourseName ?? input.specialization ?? null,
      input.passedOutYear ?? null,
      input.passedOutState ?? null,
      input.passedOutCity ?? null,
      input.passedOutPercentage ?? input.percentage ?? null,
      input.documentId ?? null,
    ]
  );
  await logCandidateAction(candidateId, "ADD_QUALIFICATION", input, meta);
  return getFullOnboardingStatus(token);
}

export async function saveFamilyDetails(token: string, input: Record<string, unknown>, meta?: { ip?: string; userAgent?: string }) {
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;
  await db.execute(
    `INSERT INTO candidate_onboarding_family (id, candidate_id, annual_income, count_of_dependents)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE annual_income = VALUES(annual_income), count_of_dependents = VALUES(count_of_dependents), updated_at = NOW()`,
    [randomUUID(), candidateId, input.annualIncome ?? null, input.countOfDependents ?? null]
  );
  await logCandidateAction(candidateId, "SAVE_FAMILY_DETAILS", input, meta);
  return getFullOnboardingStatus(token);
}

export async function saveExperienceDetails(token: string, input: Record<string, unknown>, meta?: { ip?: string; userAgent?: string }) {
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;
  await db.execute(
    `INSERT INTO candidate_onboarding_experience
       (id, candidate_id, working_experience, experience_year, experience_doc_type,
        experience_document_id, employer_name, last_designation, last_ctc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       working_experience = VALUES(working_experience), experience_year = VALUES(experience_year),
       experience_doc_type = VALUES(experience_doc_type), experience_document_id = VALUES(experience_document_id),
       employer_name = VALUES(employer_name), last_designation = VALUES(last_designation), last_ctc = VALUES(last_ctc), updated_at = NOW()`,
    [
      randomUUID(),
      candidateId,
      input.workingExperience ?? "fresher",
      input.experienceYear ?? null,
      input.experienceDocType ?? null,
      input.experienceDocumentId ?? null,
      input.employerName ?? null,
      input.lastDesignation ?? null,
      input.lastCtc ?? null,
    ]
  );
  await logCandidateAction(candidateId, "SAVE_EXPERIENCE_DETAILS", input, meta);
  return getFullOnboardingStatus(token);
}

export async function saveFinalSection(token: string, input: Record<string, unknown>, meta?: { ip?: string; userAgent?: string }) {
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;
  await db.execute(
    `UPDATE candidate_onboarding_profile SET profile_status = IF(profile_status='submitted', profile_status, 'final_saved'), updated_at = NOW()
      WHERE candidate_id = ?`,
    [candidateId]
  );
  await logCandidateAction(candidateId, "SAVE_FINAL_SECTION", input, meta);
  return getFullOnboardingStatus(token);
}

export async function savePfOptOutConsent(token: string, input: Record<string, unknown>, meta?: { ip?: string; userAgent?: string }) {
  await logCandidateAction((await validateOnboardingToken(token)).candidate_id as string, "SAVE_PF_OPT_OUT_CONSENT", input, meta);
  return saveStatutory(token, { ...input, pf_opt_out_consent: true });
}

export async function submitFullOnboarding(token: string, meta?: { ip?: string; userAgent?: string }) {
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;

  const [profileRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_name, mobile_number, personal_email_id, pan_number_hash, aadhaar_number_hash
       FROM candidate_onboarding_profile WHERE candidate_id = ? LIMIT 1`,
    [candidateId]
  );
  if (!profileRows.length) throw Object.assign(new Error("Employee details are required before submit"), { statusCode: 400 });

  const [bankRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM candidate_onboarding_bank_detail WHERE candidate_id = ? LIMIT 1`,
    [candidateId]
  );
  if (!bankRows.length) throw Object.assign(new Error("Bank details are required before submit"), { statusCode: 400 });

  await db.execute(
    `UPDATE candidate_onboarding_profile SET profile_status = 'submitted', submitted_at = NOW(), updated_at = NOW()
      WHERE candidate_id = ?`,
    [candidateId]
  );
  // Keep all three status tables in sync via syncOnboardingStatus
  await syncOnboardingStatus(candidateId, 'submitted', 'profile_submitted', 'profile_submitted');
  await db.execute(
    `UPDATE ats_candidate SET profile_submitted_at = NOW() WHERE id = ?`,
    [candidateId]
  );
  await db.execute(
    `INSERT INTO ats_candidate_stage_log
       (id, candidate_id, from_stage, to_stage, remarks, updated_by)
     VALUES (UUID(), ?, 'Onboarding Link Sent', 'Profile Submitted', 'Candidate completed onboarding profile', NULL)`,
    [candidateId]
  );
  await triggerBgvAfterOnboardingSubmit(candidateId, meta);
  await db.execute(
    `INSERT INTO ats_candidate_stage_log
       (id, candidate_id, from_stage, to_stage, remarks, updated_by)
     VALUES (UUID(), ?, 'Profile Submitted', 'BGV In Progress', 'BGV checks auto-created after onboarding profile submission', NULL)`,
    [candidateId]
  );
  await logCandidateAction(candidateId, "SUBMIT_ONBOARDING", null, meta);
  return { candidateId, status: "submitted" };
}

const MAGIC_BYTES: Record<string, Uint8Array[]> = {
  pdf: [new Uint8Array([0x25, 0x50, 0x44, 0x46])],
  jpg: [new Uint8Array([0xFF, 0xD8, 0xFF])],
  jpeg: [new Uint8Array([0xFF, 0xD8, 0xFF])],
  png: [new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])],
  webp: [new Uint8Array([0x52, 0x49, 0x46, 0x46]), new Uint8Array([0x57, 0x45, 0x42, 0x50])],
};

function validateFileMagicBytes(filePath: string, ext: string): boolean {
  const signatures = MAGIC_BYTES[ext.toLowerCase()];
  if (!signatures) return true;
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, buf, 0, 16, 0);
    if (bytesRead < signatures[0].length) return false;
    for (const sig of signatures) {
      if (sig.length > bytesRead) continue;
      const matches = sig.every((b, i) => buf[i] === b);
      if (matches) return true;
    }
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

export async function uploadOnboardingDocument(token: string, file: Express.Multer.File, input: Record<string, unknown>, meta?: { ip?: string; userAgent?: string }) {
  if (!file) throw Object.assign(new Error("File is required"), { statusCode: 400 });
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;

  const ext = path.extname(file.originalname).toLowerCase().replace(".", "");
  if (!validateFileMagicBytes(file.path, ext)) {
    fs.unlink(file.path, () => {});
    throw Object.assign(new Error("File content does not match its extension. Upload cancelled."), { statusCode: 400 });
  }

  const id = randomUUID();
  const fileUrl = `secure:onboarding:${file.filename}`;
  await db.execute(
    `INSERT INTO candidate_onboarding_document
       (id, candidate_id, doc_type, doc_name, page_no, file_original_name, file_path, file_url, mime_type, file_size_bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      candidateId,
      input.docType ?? input.doc_type ?? "Other",
      input.docName ?? input.doc_name ?? file.originalname,
      input.pageNo ?? input.page_no ?? null,
      file.originalname,
      file.path,
      fileUrl,
      file.mimetype,
      file.size,
    ]
  );
  await logCandidateAction(candidateId, "UPLOAD_DOCUMENT", { documentId: id, docType: input.docType ?? input.doc_type }, meta);
  return {
    id,
    fileUrl: buildOnboardingDocumentUrl(id, { token }),
    preview_url: buildOnboardingDocumentUrl(id, { token }),
    download_url: buildOnboardingDocumentUrl(id, { token, download: true }),
  };
}

export async function getOnboardingDocument(documentId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT doc.*, c.applied_for_branch, c.applied_for_process
       FROM candidate_onboarding_document doc
       JOIN ats_candidate c ON c.id = doc.candidate_id
      WHERE doc.id = ? AND doc.deleted_at IS NULL
      LIMIT 1`,
    [documentId]
  );
  return (rows as RowDataPacket[])[0] ?? null;
}

export async function deleteOnboardingDocument(token: string, documentId: string, meta?: { ip?: string; userAgent?: string }) {
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;
  await db.execute(
    `UPDATE candidate_onboarding_document
        SET document_status = 'deleted', deleted_at = NOW(), deleted_by = NULL
      WHERE id = ? AND candidate_id = ?`,
    [documentId, candidateId]
  );
  await logCandidateAction(candidateId, "DELETE_DOCUMENT", { documentId }, meta);
  return getFullOnboardingStatus(token);
}

export async function getOnboardingCandidateScope(candidateId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, applied_for_branch, applied_for_process
       FROM ats_candidate
       WHERE c.id = ?
      LIMIT 1`,
    [candidateId]
  );
  return (rows as RowDataPacket[])[0] ?? null;
}

export async function listFullOnboardingRequests(scopeFilter?: OnboardingScopeFilter) {
  const whereSql = scopeFilter?.sql ? `WHERE (${scopeFilter.sql})` : "";
  const params = scopeFilter?.params ?? [];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT req.id, req.status, req.candidate_id,
            p.profile_status,
            c.candidate_code, c.full_name, c.mobile, c.email,
            c.applied_for_process,
            br.branch_name, pm.process_name,
            offer.id AS offer_id,
            offer.status AS offer_status,
            offer.offered_ctc,
            bank.verification_status AS bank_verification_status,
            COUNT(DISTINCT doc.id) AS documents_uploaded
       FROM ats_onboarding_request req
       JOIN ats_candidate c ON c.id = req.candidate_id
       LEFT JOIN candidate_onboarding_profile p ON p.candidate_id = req.candidate_id
       LEFT JOIN branch_master br ON br.id = c.applied_for_branch
       LEFT JOIN process_master pm ON pm.id = c.applied_for_process
       LEFT JOIN candidate_onboarding_bank_detail bank ON bank.candidate_id = req.candidate_id
       LEFT JOIN candidate_onboarding_document doc ON doc.candidate_id = req.candidate_id AND doc.deleted_at IS NULL
       LEFT JOIN ats_employment_offer offer
         ON offer.id = (
           SELECT eo.id
             FROM ats_employment_offer eo
            WHERE eo.candidate_id = req.candidate_id
            ORDER BY eo.updated_at DESC, eo.created_at DESC, eo.id DESC
            LIMIT 1
         )
      ${whereSql}
      GROUP BY req.id, req.status, req.candidate_id, p.profile_status,
               c.candidate_code, c.full_name, c.mobile, c.email, c.applied_for_process,
               br.branch_name, pm.process_name, offer.id, offer.status, offer.offered_ctc,
               bank.verification_status
      ORDER BY COALESCE(p.updated_at, req.updated_at, req.created_at) DESC`,
    params
  );
  return rows;
}

export async function getFullOnboardingByCandidate(
  candidateId: string,
  options?: { viewerRoleKeys?: string[]; scopeFilter?: OnboardingScopeFilter }
) {
  await ensureCandidateWithinScope(candidateId, options?.scopeFilter);
  const [profileRows] = await db.execute<RowDataPacket[]>(`SELECT * FROM candidate_onboarding_profile WHERE candidate_id = ? LIMIT 1`, [candidateId]);
  const [documents] = await db.execute<RowDataPacket[]>(`SELECT * FROM candidate_onboarding_document WHERE candidate_id = ? AND deleted_at IS NULL ORDER BY uploaded_at DESC`, [candidateId]);
  const [bankRows] = await db.execute<RowDataPacket[]>(`SELECT * FROM candidate_onboarding_bank_detail WHERE candidate_id = ? LIMIT 1`, [candidateId]);
  const [qualificationRows] = await db.execute<RowDataPacket[]>(`SELECT * FROM candidate_onboarding_qualification WHERE candidate_id = ? ORDER BY created_at DESC`, [candidateId]);
  const [familyRows] = await db.execute<RowDataPacket[]>(`SELECT * FROM candidate_onboarding_family WHERE candidate_id = ? LIMIT 1`, [candidateId]);
  const [experienceRows] = await db.execute<RowDataPacket[]>(`SELECT * FROM candidate_onboarding_experience WHERE candidate_id = ? LIMIT 1`, [candidateId]);
  const [digilocker, esign] = await Promise.all([
    getLatestDigilockerStatus(candidateId),
    getLatestEsignStatus(candidateId),
  ]);
  const viewerRoleKeys = options?.viewerRoleKeys ?? [];
  const sanitizedDocuments = (documents as RowDataPacket[])
    .map((row) => sanitizeOnboardingDocument(
      row as Record<string, unknown>,
      viewerRoleKeys.length > 0 ? { permission: getOnboardingDocumentPermission(row as Record<string, unknown>, viewerRoleKeys) } : undefined
    ))
    .filter(Boolean);

  return {
    profile: profileRows[0] ?? null,
    documents: sanitizedDocuments,
    bank: bankRows[0] ?? null,
    qualifications: qualificationRows,
    family: familyRows[0] ?? null,
    experience: experienceRows[0] ?? null,
    digilocker,
    esign,
  };
}

export async function reviewFullOnboarding(
  candidateId: string,
  input: { status: "approved" | "rejected" | "hr_review"; remarks?: string },
  reviewedBy: string,
  scopeFilter?: OnboardingScopeFilter
) {
  await ensureCandidateWithinScope(candidateId, scopeFilter);
  const profileStatusMap: Record<string, string> = {
    approved: "hr_approved",
    rejected: "rejected",
    hr_review: "hr_pushback",
  };

  await syncOnboardingStatus(
    candidateId,
    profileStatusMap[input.status] ?? "hr_review",
    profileStatusMap[input.status] ?? "hr_review",
    profileStatusMap[input.status] ?? "hr_review"
  );
  await logCandidateAction(candidateId, "HR_REVIEW", input, { actorType: "hr", actorId: reviewedBy });

  if ((input.status === "rejected" || input.status === "hr_review") && input.remarks) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, review_remarks FROM candidate_onboarding_profile WHERE candidate_id = ? LIMIT 1`, [candidateId]
    );
    if ((rows as RowDataPacket[]).length > 0) {
      await db.execute(
        `UPDATE candidate_onboarding_profile SET review_remarks = ?, updated_at = NOW() WHERE candidate_id = ?`,
        [input.remarks, candidateId]
      );
    }
  }

  return getFullOnboardingByCandidate(candidateId, { scopeFilter });
}

export async function payrollReviewFullOnboarding(
  candidateId: string,
  input: { status: "approved" | "rejected"; remarks?: string },
  reviewedBy: string,
  scopeFilter?: OnboardingScopeFilter
) {
  await ensureCandidateWithinScope(candidateId, scopeFilter);
  const status = input.status === "approved" ? "payroll_hr_approved" : "rejected";
  await syncOnboardingStatus(candidateId, status,
    status,
    status
  );
  await logCandidateAction(candidateId, "PAYROLL_REVIEW", input, { actorType: "hr", actorId: reviewedBy });
  return getFullOnboardingByCandidate(candidateId, { scopeFilter });
}

export async function checkBgvReadiness(candidateId: string): Promise<{ ready: boolean; missing: string[]; score: number }> {
  const [rows] = await db.execute<BgvCheckRow[]>(
    `SELECT check_type, status FROM candidate_bgv_check WHERE candidate_id = ?`, [candidateId]
  );
  const checks = rows;
  const mandatoryChecks = ["pan", "aadhaar_offline", "bank", "address_doc", "education_doc", "employment", "criminal"];
  const missing: string[] = [];

  let score = 0;
  let verifiedCount = 0;

  for (const required of mandatoryChecks) {
    const match = checks.find((c) => c.check_type === required);
    if (!match || match.status === "not_started" || match.status === "failed") {
      missing.push(required);
    } else if (match.status === "verified" || match.status === "waived") {
      verifiedCount++;
    }
  }

  score = mandatoryChecks.length > 0 ? Math.round((verifiedCount / mandatoryChecks.length) * 100) : 0;

  return {
    ready: missing.length === 0 && verifiedCount >= 3,
    missing,
    score,
  };
}

// Single source-of-truth sync: keeps ats_candidate, ats_onboarding_request, and
// candidate_onboarding_profile aligned after each major status transition.
export async function syncOnboardingStatus(
  candidateId: string,
  profileStatus: string,
  requestStatus: string,
  candidateProfileStatus: string
) {
  await db.execute(
    `UPDATE ats_candidate SET profile_status = ?, updated_at = NOW() WHERE id = ?`,
    [candidateProfileStatus, candidateId]
  );
  await db.execute(
    `UPDATE ats_onboarding_request SET status = ?, updated_at = NOW() WHERE candidate_id = ?`,
    [requestStatus, candidateId]
  );
  await db.execute(
    `UPDATE candidate_onboarding_profile SET profile_status = ?, updated_at = NOW() WHERE candidate_id = ?`,
    [profileStatus, candidateId]
  );
}

export async function recordPrivacyConsent(token: string) {
  const { candidate_id } = await validateOnboardingToken(token);
  await db.execute(
    `UPDATE candidate_onboarding_profile SET dpdp_consent = 1, dpdp_consent_at = NOW(), updated_at = NOW() WHERE candidate_id = ?`,
    [candidate_id]
  );
  await logCandidateAction(candidate_id, "PRIVACY_CONSENT", null, { actorType: "candidate" });
  return { candidateId: candidate_id, consented: true };
}

export async function initiateCandidateDigilocker(candidateId: string, actor?: { initiatedBy?: string | null; initiatedByType?: string | null }) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, full_name, mobile
       FROM ats_candidate
      WHERE id = ?
      LIMIT 1`,
    [candidateId]
  );
  const candidate = (rows as RowDataPacket[])[0];
  if (!candidate) throw Object.assign(new Error("Candidate not found"), { statusCode: 404 });

  const mobileNumber = String(candidate.mobile ?? "").replace(/\D/g, "").slice(-10);
  if (mobileNumber.length !== 10) {
    throw Object.assign(new Error("Candidate mobile number is missing or invalid for DigiLocker initiation."), { statusCode: 400 });
  }

  const clientTransactionId = luckpayClient.generateClientTransactionId("DIGI");
  const requestPayload = {
    clientTransactionId,
    customerName: String(candidate.full_name ?? "Candidate"),
    mobileNumber,
  };

  await createProviderTransactionLog({
    candidateId,
    provider: "luckpay",
    serviceType: "digilocker",
    clientTransactionId,
    status: "initiated",
    requestPayload,
    initiatedBy: actor?.initiatedBy ?? null,
    initiatedByType: actor?.initiatedByType ?? null,
  });

  try {
    const result = await luckpayClient.initiateDigilockerWithUrl(requestPayload);
    await updateProviderTransactionLog({
      provider: "luckpay",
      clientTransactionId,
      status: result.status,
      providerReferenceId: result.providerReferenceId,
      responsePayload: result.sanitized,
      providerUrl: result.verificationUrl,
    });
    return {
      success: true,
      clientTransactionId,
      redirectUrl: result.verificationUrl,
      verificationUrl: result.verificationUrl,
      status: result.status,
    };
  } catch (error: unknown) {
    await updateProviderTransactionLog({
      provider: "luckpay",
      clientTransactionId,
      status: "failed",
      errorMessage: String((error as Error)?.message ?? error),
      responsePayload: sanitizeProviderPayload({ error: String((error as Error)?.message ?? error) }),
    });
    throw error;
  }
}

export async function initiateCandidateDigilockerByToken(token: string) {
  const tokenData = await validateOnboardingToken(token);
  return initiateCandidateDigilocker(String(tokenData.candidate_id), {
    initiatedBy: String(tokenData.candidate_id),
    initiatedByType: "candidate",
  });
}

export async function initiateCandidateEsign(
  candidateId: string,
  input: { location?: string; reason?: string },
  actor: { initiatedBy: string; initiatedByType: string }
) {
  const [candidateRows] = await db.execute<RowDataPacket[]>(
    `SELECT c.id, c.full_name, br.branch_name
       FROM ats_candidate c
       LEFT JOIN branch_master br ON br.id = c.applied_for_branch
      WHERE id = ?
      LIMIT 1`,
    [candidateId]
  );
  const candidate = (candidateRows as RowDataPacket[])[0];
  if (!candidate) throw Object.assign(new Error("Candidate not found"), { statusCode: 404 });

  const source = await resolveEsignSource(candidateId);
  const clientTransactionId = luckpayClient.generateClientTransactionId("ESIGN");
  const requestPayload = {
    clientTransactionId,
    signedBy: String(candidate.full_name ?? "Candidate"),
    location: input.location ?? String(candidate.branch_name ?? "Branch"),
    reason: input.reason ?? "Signing Appointment Letter",
  };

  await createProviderTransactionLog({
    candidateId,
    provider: "luckpay",
    serviceType: "esign",
    clientTransactionId,
    status: "initiated",
    requestPayload,
    initiatedBy: actor.initiatedBy,
    initiatedByType: actor.initiatedByType,
  });

  let requestId = source.requestId ?? null;
  if (!requestId) {
    requestId = randomUUID();
    await db.execute(
      `INSERT INTO appointment_letter_request
         (id, candidate_id, created_by, current_state, esign_provider, candidate_esign_status, company_sign_status, pdf_locked, manual_override_approved, created_at)
       VALUES (?, ?, ?, 'candidate_esign_pending', 'luckpay', 'pending', 'pending', 0, 0, NOW())`,
      [requestId, candidateId, actor.initiatedBy]
    );
  }

  try {
    const result = await luckpayClient.initiateEsignWithUrl({
      filePath: source.filePath,
      request: requestPayload,
    });
    await updateProviderTransactionLog({
      provider: "luckpay",
      clientTransactionId,
      status: result.status,
      providerReferenceId: result.providerReferenceId,
      responsePayload: result.sanitized,
      providerUrl: result.verificationUrl,
    });

    await db.execute(
      `UPDATE appointment_letter_request
          SET current_state = 'candidate_esign_pending',
              esign_provider = 'luckpay',
              esign_transaction_id = ?,
              candidate_esign_url = ?,
              candidate_esign_status = ?,
              updated_at = NOW()
        WHERE id = ?`,
      [clientTransactionId, result.verificationUrl, result.status, requestId]
    );

    return {
      success: true,
      requestId,
      clientTransactionId,
      redirectUrl: result.verificationUrl,
      verificationUrl: result.verificationUrl,
      status: result.status,
      sourceOfferId: source.offerId ?? null,
    };
  } catch (error: unknown) {
    await updateProviderTransactionLog({
      provider: "luckpay",
      clientTransactionId,
      status: "failed",
      errorMessage: String((error as Error)?.message ?? error),
      responsePayload: sanitizeProviderPayload({ error: String((error as Error)?.message ?? error) }),
    });
    throw error;
  }
}

export function getLuckpayProviderRuntimeStatus() {
  return luckpayClient.getRuntimeStatus();
}

export async function saveLanguages(
  token: string,
  languages: Array<{ language_name: string; can_read?: boolean; can_write?: boolean; can_speak?: boolean; proficiency?: string }>
) {
  const { candidate_id } = await validateOnboardingToken(token);
  if (!Array.isArray(languages) || languages.length === 0) return { deleted: 0, inserted: 0 };
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [del] = await conn.execute<ResultSetHeader>(`DELETE FROM candidate_onboarding_language WHERE candidate_id = ?`, [candidate_id]);
    for (const lang of languages) {
      if (!lang.language_name?.trim()) continue;
      await conn.execute(
        `INSERT INTO candidate_onboarding_language (id, candidate_id, language_name, can_read, can_write, can_speak, proficiency)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?)`,
        [candidate_id, lang.language_name.trim(), lang.can_read ? 1 : 0, lang.can_write ? 1 : 0, lang.can_speak ? 1 : 0, lang.proficiency ?? null]
      );
    }
    await conn.commit();
    return { candidateId: candidate_id, deleted: del.affectedRows ?? 0, inserted: languages.length };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function saveStatutory(token: string, input: Record<string, unknown>) {
  const { candidate_id } = await validateOnboardingToken(token);
  await db.execute(
    `UPDATE candidate_onboarding_profile SET
       eps_member = ?, international_worker = ?, previous_pf_member = ?,
       statutory_declaration_accepted = ?, statutory_declaration_at = IF(? = 1, NOW(), NULL),
       updated_at = NOW()
     WHERE candidate_id = ?`,
    [
      input.epsMember != null ? (input.epsMember ? 1 : 0) : null,
      input.internationalWorker ? 1 : 0,
      input.previousPfMember != null ? (input.previousPfMember ? 1 : 0) : null,
      input.declarationAccepted ? 1 : 0,
      input.declarationAccepted ? 1 : 0,
      candidate_id,
    ]
  );
  return { candidateId: candidate_id, saved: true };
}

export async function saveProgress(token: string, stepIdx: number) {
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;
  const idx = Math.max(0, Math.min(10, Math.floor(stepIdx)));
  await db.execute(
    `UPDATE candidate_onboarding_profile SET current_step_idx = ?, updated_at = NOW() WHERE candidate_id = ?`,
    [idx, candidateId]
  );
  return { candidateId, currentStepIdx: idx };
}

// ── New functions added by migration 298 ─────────────────────────────────────

export async function saveFamilyMembers(
  token: string,
  members: Array<{
    memberName?: string;
    relation?: string;
    dob?: string;
    occupation?: string;
    isDependent?: boolean;
  }>
) {
  const { candidate_id } = await validateOnboardingToken(token);
  if (!Array.isArray(members)) throw Object.assign(new Error("members must be an array"), { statusCode: 400 });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`DELETE FROM candidate_onboarding_family_member WHERE candidate_id = ?`, [candidate_id]);
    for (const m of members) {
      await conn.execute(
        `INSERT INTO candidate_onboarding_family_member
           (id, candidate_id, member_name, relation, dob, occupation, is_dependent)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?)`,
        [
          candidate_id,
          m.memberName ?? null,
          m.relation ?? null,
          m.dob ?? null,
          m.occupation ?? null,
          m.isDependent ? 1 : 0,
        ]
      );
    }
    await conn.commit();
    return { candidateId: candidate_id, inserted: members.length };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function saveNominees(
  token: string,
  nominees: Array<{
    nomineeName?: string;
    relation?: string;
    dob?: string;
    sharePercentage?: number;
    aadharLast4?: string;
    isPrimary?: boolean;
  }>
) {
  const { candidate_id } = await validateOnboardingToken(token);
  if (!Array.isArray(nominees)) throw Object.assign(new Error("nominees must be an array"), { statusCode: 400 });

  const total = nominees.reduce((sum, n) => sum + (Number(n.sharePercentage) || 0), 0);
  if (total > 100) {
    throw Object.assign(
      new Error(`Total nominee share percentage is ${total}% which exceeds 100%`),
      { statusCode: 400 }
    );
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`DELETE FROM candidate_onboarding_nominee WHERE candidate_id = ?`, [candidate_id]);
    for (const n of nominees) {
      await conn.execute(
        `INSERT INTO candidate_onboarding_nominee
           (id, candidate_id, nominee_name, relation, dob, share_percentage, aadhar_last4, is_primary)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?)`,
        [
          candidate_id,
          n.nomineeName ?? null,
          n.relation ?? null,
          n.dob ?? null,
          n.sharePercentage != null ? n.sharePercentage : null,
          n.aadharLast4 ?? null,
          n.isPrimary ? 1 : 0,
        ]
      );
    }
    await conn.commit();
    return { candidateId: candidate_id, inserted: nominees.length, totalSharePct: total };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function updateSectionStatus(
  candidateId: string,
  section: string,
  isComplete: boolean
) {
  const id = randomUUID();
  await db.execute(
    `INSERT INTO candidate_onboarding_section_status
       (id, candidate_id, section, is_complete, completed_at)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       is_complete = VALUES(is_complete),
       completed_at = IF(VALUES(is_complete) = 1 AND completed_at IS NULL, NOW(), completed_at),
       last_updated = NOW()`,
    [id, candidateId, section, isComplete ? 1 : 0, isComplete ? new Date() : null]
  );
  return { candidateId, section, isComplete };
}

export async function getOnboardingBlockers(
  candidateId: string
): Promise<Array<{ code: string; message: string; severity: "hard" | "soft" }>> {
  const blockers: Array<{ code: string; message: string; severity: "hard" | "soft" }> = [];

  const [profileRows] = await db.execute<OnboardingProfileBlockerRow[]>(
    `SELECT otp_verified, statutory_declaration_accepted, dpdp_consent, bgv_consent
       FROM candidate_onboarding_profile WHERE candidate_id = ? LIMIT 1`,
    [candidateId]
  );
  const profile = profileRows[0] ?? {
    otp_verified: null,
    statutory_declaration_accepted: null,
    dpdp_consent: null,
    bgv_consent: null,
  };

  if (!profile.otp_verified) {
    blockers.push({ code: "OTP_NOT_VERIFIED", message: "Mobile OTP verification is required before submission.", severity: "hard" });
  }
  if (!profile.statutory_declaration_accepted) {
    blockers.push({ code: "DECLARATION_NOT_ACCEPTED", message: "Statutory declaration must be accepted before submission.", severity: "hard" });
  }
  if (!profile.dpdp_consent) {
    blockers.push({ code: "DPDP_CONSENT_MISSING", message: "DPDP data privacy consent is required.", severity: "hard" });
  }

  const [bankRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM candidate_onboarding_bank_detail WHERE candidate_id = ? LIMIT 1`,
    [candidateId]
  );
  if (!bankRows.length) {
    blockers.push({ code: "BANK_DETAILS_MISSING", message: "Bank account details must be saved before submission.", severity: "hard" });
  }

  const [qualRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM candidate_onboarding_qualification WHERE candidate_id = ? LIMIT 1`,
    [candidateId]
  );
  if (!qualRows.length) {
    blockers.push({ code: "QUALIFICATION_MISSING", message: "At least one qualification record is recommended.", severity: "soft" });
  }

  if (!profile.bgv_consent) {
    blockers.push({ code: "BGV_CONSENT_MISSING", message: "BGV consent is recommended for faster background verification.", severity: "soft" });
  }

  return blockers;
}
