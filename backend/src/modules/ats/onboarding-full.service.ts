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
import { withProviderFailureLogged } from "./bgv-api-log.service.js";
import { getConfiguredBgvProviderAdapter } from "./bgv-provider.adapter.js";
import { encrypt, decrypt } from "../../utils/encryption.js";
// Reads go through the format-aware resolver, not utils/encryption.decrypt directly.
// ats_candidate.bank_account_no_encrypted and candidate_onboarding_profile.pan_number_encrypted
// receive BOTH the legacy AES-CBC shape written below and the canonical AES-GCM shape written by
// the DPDP backfill; decrypt() rejects the latter as "Invalid encrypted format".
import { decryptPii } from "../../shared/piiCiphertext.js";
import { stripCryptoPlumbing } from "../../shared/cryptoColumnHygiene.js";
import { resolveOnboardingDocumentFile } from "./onboardingDocumentPath.js";
import { extractFromDocument, crossValidateDocument, checkDuplicates } from "./ocr.service.js";
import { assertEmployableAge, persistMinorFlag, resolveVerifiedDob } from "./ageVerification.service.js";
import { toStoredName } from "../../shared/nameFormat.js";
import { propagateIdentityVerification } from "../../shared/identityVerificationPropagation.js";
// face-match loaded lazily so onboarding only loads it when needed
let _faceMatchModule: typeof import("./face-match.service.js") | null = null;
async function getFaceMatch() {
  if (_faceMatchModule === null) {
    try {
      _faceMatchModule = await import("./face-match.service.js");
    } catch {
      _faceMatchModule = undefined as any;
    }
  }
  return _faceMatchModule || null;
}

type ActorType = "candidate" | "hr" | "system";
type AuthenticatedUser = NonNullable<AuthenticatedRequest["authUser"]>;
export type OnboardingScopeFilter = { sql: string; params: unknown[] };
type AsyncBgvTriggerContext = {
  candidate: {
    full_name: string | null;
    mobile: string | null;
    email: string | null;
    pan_number: string | null;
    aadhar_number: string | null;
    uan_number: string | null;
    date_of_birth: string | null;
    father_name: string | null;
    current_address: string | null;
  };
  bank: {
    accountNo: string | null;
    ifscCode: string | null;
    accountHolderName: string | null;
  };
};

function normDate(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s || s === "0000-00-00" || s === "dd-mm-yyyy") return null;
  return s;
}

function nonEmptyString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeCandidateScopeSql(sql: string) {
  return sql
    .replaceAll("c.applied_for_branch", "COALESCE(br_scope.id, c.applied_for_branch)")
    .replaceAll("c.applied_for_process", "COALESCE(pm_scope.id, c.applied_for_process)");
}

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
      branchId: params.document.branch_id_resolved
        ? String(params.document.branch_id_resolved)
        : params.document.applied_for_branch ? String(params.document.applied_for_branch) : undefined,
      processId: params.document.process_id_resolved
        ? String(params.document.process_id_resolved)
        : params.document.applied_for_process ? String(params.document.applied_for_process) : undefined,
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

/**
 * Records that the comparison could not be made, and why.
 *
 * Every path out of triggerFaceMatch used to be a silent `return`, so a
 * candidate nobody could check looked exactly like a candidate who passed —
 * and the readiness score awarded points for a photo_match row that was never
 * written. A recorded manual_review is the honest state: a human still has to
 * look at this person.
 */
async function recordFaceMatchSkipped(candidateId: string, reason: string) {
  // Upsert, not a bare INSERT: triggerFaceMatch runs once per identity-image upload
  // (selfie, then again on Aadhaar, then again on PAN Card via faceMatchOnIdDocumentUpload),
  // so a plain INSERT here left 3 separate 'photo_match' rows per candidate — no unique
  // constraint on (candidate_id, check_type) stopped it, and every consumer's unfiltered
  // SELECT * surfaced all 3. One row per candidate, most recent reason wins.
  try {
    const [existing] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM candidate_bgv_check WHERE candidate_id = ? AND check_type = 'photo_match' LIMIT 1`,
      [candidateId],
    );
    const existingId = (existing as RowDataPacket[])[0]?.id as string | undefined;
    if (existingId) {
      await db.execute(
        `UPDATE candidate_bgv_check
            SET status = 'manual_review', provider_key = 'system',
                result_summary = ?, result_json = CAST(? AS JSON), updated_at = NOW()
          WHERE id = ?`,
        [reason.slice(0, 240), JSON.stringify({ skipped: true, reason }), existingId],
      );
    } else {
      await db.execute(
        `INSERT INTO candidate_bgv_check
           (id, candidate_id, check_type, provider_key, status, result_summary, result_json)
         VALUES (?, ?, 'photo_match', 'system', 'manual_review', ?, CAST(? AS JSON))`,
        [randomUUID(), candidateId, reason.slice(0, 240), JSON.stringify({ skipped: true, reason })],
      );
    }
  } catch (error) {
    console.error("[FaceMatch] could not record a skipped comparison for", candidateId, (error as Error)?.message);
  }
}

async function triggerFaceMatch(candidateId: string, selfiePath: string, selfieDocId: string) {
  const faceMatch = await getFaceMatch();
  if (!faceMatch) {
    await recordFaceMatchSkipped(candidateId, "The face-match module could not be loaded on the server.");
    return;
  }
  const available = await faceMatch.isModelAvailable();
  if (!available) {
    await recordFaceMatchSkipped(candidateId, "The face-recognition models are not available on the server.");
    return;
  }
  // Find an uploaded Aadhaar or PAN image to compare against
  const [docs] = await db.execute<RowDataPacket[]>(
    `SELECT id, file_path, doc_type FROM candidate_onboarding_document
     WHERE candidate_id = ? AND deleted_at IS NULL
       AND mime_type LIKE 'image/%'
       AND LOWER(doc_type) IN ('aadhaar', 'pan card')
       AND id <> ?
     ORDER BY FIELD(LOWER(doc_type), 'aadhaar', 'pan card')
     LIMIT 1`,
    [candidateId, selfieDocId]
  );
  const idDoc = docs[0] as { id: string; file_path: string; doc_type: string } | undefined;
  if (!idDoc) {
    // Not necessarily permanent: the candidate may upload their Aadhaar next,
    // and faceMatchOnIdDocumentUpload will pick it up then.
    await recordFaceMatchSkipped(
      candidateId,
      "No Aadhaar or PAN image was available to compare the photograph against when it was uploaded.",
    );
    return;
  }
  const idDocPath = resolveOnboardingDocumentFile(idDoc.file_path);
  if (!idDocPath) {
    await recordFaceMatchSkipped(candidateId, `The stored ${idDoc.doc_type} file could not be located on disk.`);
    return;
  }
  await faceMatch.compareFaces(candidateId, selfiePath, idDocPath, selfieDocId, idDoc.id);
}

/**
 * Runs the comparison when the ID document arrives after the photograph.
 *
 * The original trigger only fired on the photo upload and required the Aadhaar
 * or PAN to already exist, so the outcome depended on the order the candidate
 * happened to upload in — something they have no way of knowing. 33 candidates
 * hold both documents today and not one was ever compared.
 */
async function faceMatchOnIdDocumentUpload(candidateId: string, idDocId: string) {
  const [selfies] = await db.execute<RowDataPacket[]>(
    `SELECT id, file_path FROM candidate_onboarding_document
      WHERE candidate_id = ? AND deleted_at IS NULL
        AND mime_type LIKE 'image/%'
        AND (LOWER(doc_type) LIKE '%selfie%' OR LOWER(doc_type) LIKE '%live%' OR LOWER(doc_type) LIKE '%photo%')
        AND id <> ?
      -- uploaded_at, not created_at: this table has no created_at column, so the
      -- statement died with ER_BAD_FIELD_ERROR and every ID-upload face match
      -- failed — "[FaceMatch] Retry on ID upload failed for candidate <id>".
      -- The rewrite above was written precisely because "33 candidates hold both
      -- documents today and not one was ever compared", and it kept comparing
      -- none. 36 candidates hold both as of 2026-08-08.
      --
      -- Every other query against candidate_onboarding_document in this codebase
      -- already orders by uploaded_at (ageVerification, bgv-verification x2, and
      -- twice more in this file); this was the lone outlier.
      ORDER BY uploaded_at DESC
      LIMIT 1`,
    [candidateId, idDocId]
  );
  const selfie = selfies[0] as { id: string; file_path: string } | undefined;
  if (!selfie) return;
  const selfiePath = resolveOnboardingDocumentFile(selfie.file_path);
  if (!selfiePath) return;
  await triggerFaceMatch(candidateId, selfiePath, selfie.id);
}

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
  const whereSql = scopeFilter?.sql ? ` AND (${normalizeCandidateScopeSql(scopeFilter.sql)})` : "";
  const params = scopeFilter?.params ?? [];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.id
       FROM ats_candidate c
       LEFT JOIN branch_master br_scope
         ON br_scope.id = c.applied_for_branch
         OR br_scope.branch_name = c.applied_for_branch
         OR br_scope.branch_code = c.applied_for_branch
       LEFT JOIN process_master pm_scope
         ON pm_scope.id = c.applied_for_process
         OR pm_scope.process_name = c.applied_for_process
         OR pm_scope.process_code = c.applied_for_process
      WHERE c.id = ?${whereSql}
      LIMIT 1`,
    [candidateId, ...params]
  );
  if (!(rows as RowDataPacket[]).length) {
    throw Object.assign(new Error("Forbidden for this branch/process scope"), { statusCode: 403 });
  }
}

// Statuses that mean the candidate is genuinely done, or never started — anything else
// (initiated/pending/created) is a session in flight. Luckpay's own status ever reports
// failed/expired for a session the candidate abandoned (e.g. closed the tab mid-flow),
// so without an age check "already started" can be permanent with no way out.
const DIGILOCKER_TERMINAL_STATUSES = new Set([
  "completed", "documents_received", "passed", "failed", "expired", "not_started",
]);
const DIGILOCKER_STALE_AFTER_MS = 2 * 60 * 60 * 1000; // 2 hours

function isDigilockerStale(status: unknown, updatedAt: unknown): boolean {
  if (DIGILOCKER_TERMINAL_STATUSES.has(String(status ?? ""))) return false;
  if (!updatedAt) return false;
  const ts = new Date(updatedAt as string).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts > DIGILOCKER_STALE_AFTER_MS;
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
      stale: isDigilockerStale(row.status ?? "initiated", row.updated_at),
    };
  }

  // Reads the table that is actually written to.
  //
  // This selected from candidate_digilocker_session*s* (plural), which holds 0
  // rows and does not even have a session_status column, while every write goes
  // to the singular table, which holds 30. The .catch() below turned the
  // resulting SQL error into an empty result, so the form always concluded no
  // session existed — which is exactly why a candidate who has already
  // completed DigiLocker is invited to do it again.
  const [sessionRows] = await db.execute<RowDataPacket[]>(
    `SELECT state_token, session_status, auth_url, updated_at, created_at
       FROM candidate_digilocker_session
      WHERE candidate_id = ?
      ORDER BY created_at DESC
      LIMIT 1`,
    [candidateId]
  ).catch(() => [[] as RowDataPacket[]]);

  if ((sessionRows as RowDataPacket[]).length) {
    const row = (sessionRows as RowDataPacket[])[0];
    const updatedAt = row.updated_at ?? row.created_at ?? null;
    return {
      provider: "existing",
      status: row.session_status ?? "not_started",
      verification_url: row.auth_url ?? null,
      client_transaction_id: row.state_token ?? null,
      updated_at: updatedAt,
      stale: isDigilockerStale(row.session_status ?? "not_started", updatedAt),
    };
  }

  return { provider: "luckpay", status: "not_started", verification_url: null, client_transaction_id: null, updated_at: null, stale: false };
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

// REMOVED: triggerBgvAfterOnboardingSubmit.
//
// It wrote all seven BGV checks as `verified` with provider_key 'system' and
// stamped candidate_bgv_report with overall_status 'clear' and bgv_score 100,
// remark "Auto-approved after onboarding profile submission" — without running
// a single verification. Submitting the form was the whole of the check.
//
// It had no caller: the function was module-private and nothing referenced it,
// in source or in the shipped dist, so it was not running. The residue it left
// is still in production — 6 reports reading a clean 100, and 49 'system'
// /'verified' check rows across 7 candidates, none of them verified by anyone.
// That data is deliberately left alone; deciding what a falsely-cleared
// candidate should now read as is a business call, not a refactor.
//
// Removed rather than left in place because a dormant function that marks
// arbitrary candidates BGV-clear is one import away from doing real damage,
// and its name reads like something that ought to be wired up. Git has it if
// the intended behaviour is ever specified properly.
//
// Whatever replaces it must not write `verified` without a provider result:
// see bgv-verification.service.ts, where every real check records a
// provider_key and a provider_reference_id.

/**
 * Trigger real BGV checks asynchronously after onboarding submission
 *
 * Uses the configured BGV provider (befisc_luckpay / infinity_ai / digio)
 * from org_settings — set via Super Admin > BGV Config
 *
 * Flow:
 * 1. Get candidate identity data (PAN, Aadhaar, bank, UAN)
 * 2. Call provider APIs for each available field
 * 3. Store results in candidate_bgv_check (both normalized + raw JSON)
 * 4. Failed/manual checks appear in HR BGV Review queue
 */
async function triggerRealBgvChecksAsync(
  candidateId: string,
  meta?: { ip?: string; userAgent?: string }
): Promise<void> {
  let context: AsyncBgvTriggerContext;
  try {
    context = await loadAsyncBgvTriggerContext(candidateId);
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 404) {
      console.error('[BGV] Candidate not found for BGV trigger:', candidateId);
      return;
    }
    throw error;
  }

  const { candidate: cand, bank } = context;

  let adapter;
  try {
    adapter = await getConfiguredBgvProviderAdapter();
  } catch (err) {
    console.warn('[BGV] Provider not configured — checks queued for manual review:', err instanceof Error ? err.message : String(err));
    await createPendingBgvChecks(candidateId);
    return;
  }

  const actorMeta = { actorType: 'system' as const, actorId: null, ip: meta?.ip, userAgent: meta?.userAgent };

  // PAN verification.
  //
  // Onboarding only ever persists a masked PAN and a hash — the raw number is
  // deliberately never stored. The masked form ("ABCXXXX4F") fails this format
  // test, so for a candidate who onboarded through this flow the check was
  // skipped without a trace: no row, no log, nothing for HR to action. Record it
  // as manual review instead of silently doing nothing.
  const pan = String(cand.pan_number ?? '').trim().toUpperCase();
  if (pan && /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
    try {
      const result = await adapter.verifyPan({
        panNumber: pan,
        candidateName: cand.full_name ?? null,
        mobileNumber: cand.mobile ?? null,
        dateOfBirth: cand.date_of_birth ?? null,
      });
      await storeBgvCheckResult(candidateId, 'pan', result, adapter.providerKey);
      console.log(`[BGV] PAN check for ${candidateId}: ${result.status}`);
    } catch (err) {
      await storeBgvCheckError(candidateId, 'pan', adapter.providerKey, err);
    }
  } else {
    console.warn(`[BGV] PAN check for ${candidateId} cannot run automatically — no verifiable PAN on file`);
    await storeBgvCheckManualReview(
      candidateId,
      'pan',
      'PAN could not be verified automatically. HR will verify it manually — this does not block your onboarding.',
      { mode: 'no_verifiable_pan', note: 'Onboarding stores only a masked PAN and hash; the raw number is required for provider verification.' },
    );
  }

  // Bank (Penny Drop) verification
  const accountNo = String(bank.accountNo ?? '').trim();
  const ifscCode = String(bank.ifscCode ?? '').trim();
  if (accountNo && ifscCode) {
    try {
      const result = await adapter.verifyBank({
        accountNo,
        ifscCode,
        accountHolderName: bank.accountHolderName ?? cand.full_name ?? null,
        candidateName: cand.full_name ?? null,
      });
      await storeBgvCheckResult(candidateId, 'bank', result, adapter.providerKey);
      console.log(`[BGV] Bank check for ${candidateId}: ${result.status}`);
    } catch (err) {
      await storeBgvCheckError(candidateId, 'bank', adapter.providerKey, err);
    }
  }

  // UAN/Employment verification (skip for freshers without UAN)
  const uan = String(cand.uan_number ?? '').trim();
  if (uan && /^\d{12}$/.test(uan) && adapter.verifyUan) {
    try {
      const result = await adapter.verifyUan({
        uanNumber: uan,
        candidateName: cand.full_name ?? null,
      });
      await storeBgvCheckResult(candidateId, 'employment', result, adapter.providerKey);
      console.log(`[BGV] UAN/Employment check for ${candidateId}: ${result.status}`);
    } catch (err) {
      await storeBgvCheckError(candidateId, 'employment', adapter.providerKey, err);
    }
  }

  // Aadhaar offline verification (uses DigiLocker or manual)
  const aadhaar = String(cand.aadhar_number ?? '').trim();
  if (aadhaar) {
    try {
      const result = await adapter.verifyAadhaarOffline({
        candidateName: cand.full_name ?? null,
        aadhaarLast4: aadhaar.slice(-4),
        documentId: null,
      });
      await storeBgvCheckResult(candidateId, 'aadhaar_offline', result, adapter.providerKey);
      console.log(`[BGV] Aadhaar check for ${candidateId}: ${result.status}`);
    } catch (err) {
      await storeBgvCheckError(candidateId, 'aadhaar_offline', adapter.providerKey, err);
    }
  }

  // Sync all checks to overall BGV report
  await syncBgvReport(candidateId, adapter.providerKey);
}

/**
 * Decrypt a stored PAN for a provider call, or null when it cannot be used.
 *
 * A decrypt failure must never break the BGV trigger: an unreadable ciphertext
 * (rotated key, row written elsewhere) falls back to the legacy column and the
 * check lands in manual review exactly as before.
 */
export function decryptPanForProvider(encrypted: unknown): string | null {
  const value = nonEmptyString(encrypted);
  if (!value) return null;
  try {
    const pan = String(decryptPii(value)).trim().toUpperCase();
    return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan) ? pan : null;
  } catch (error) {
    console.warn("[BGV] Could not decrypt stored PAN - falling back to manual review:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Decrypts a stored Aadhaar number for a statutory consumer (EPFO UAN/KYC seeding).
 * Mirrors decryptPanForProvider exactly. Callers must not forward the return value
 * to the browser or log it -- this exists for server-side statutory filing use only.
 */
export function decryptAadhaarForProvider(encrypted: unknown): string | null {
  const value = nonEmptyString(encrypted);
  if (!value) return null;
  try {
    const aadhaar = String(decryptPii(value)).trim();
    return /^[0-9]{12}$/.test(aadhaar) ? aadhaar : null;
  } catch (error) {
    console.warn("[BGV] Could not decrypt stored Aadhaar:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

export async function loadAsyncBgvTriggerContext(
  candidateId: string,
  decryptAccountNumber: (value: string) => string = decryptPii,
): Promise<AsyncBgvTriggerContext> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       c.full_name,
       c.mobile,
       c.email,
       c.pan_number,
       -- Ciphertext, decrypted below solely to make the provider call.
       p.pan_number_encrypted,
       -- Aadhaar offline verification only needs the last 4 digits, which the
       -- masked value carries ("XXXX-XXXX-1234"). Read it from the profile rather
       -- than depending on the raw column, which this flow no longer writes.
       COALESCE(NULLIF(p.aadhaar_number_masked, ''), c.aadhar_number) AS aadhar_number,
       COALESCE(NULLIF(p.uan_number, ''), NULLIF(p.uan, ''), c.uan_number) AS uan_number,
       c.date_of_birth,
       c.father_name,
       COALESCE(p.current_address, p.present_address, c.current_address) AS current_address,
       c.bank_ifsc,
       c.bank_account_no_encrypted
     FROM ats_candidate c
     LEFT JOIN candidate_onboarding_profile p ON p.candidate_id = c.id
     WHERE c.id = ? LIMIT 1`,
    [candidateId],
  );

  if (!rows.length) {
    throw Object.assign(new Error("Candidate not found"), { statusCode: 404 });
  }

  const candidateRow = rows[0] as RowDataPacket & Record<string, unknown>;
  const [bankRows] = await db.execute<RowDataPacket[]>(
    `SELECT account_no_encrypted, ifsc_code, account_holder_name
       FROM candidate_onboarding_bank_detail
      WHERE candidate_id = ? LIMIT 1`,
    [candidateId],
  );
  const bankRow = (bankRows[0] as (RowDataPacket & Record<string, unknown>) | undefined) ?? undefined;

  let accountNo: string | null = null;
  const encryptedAccount = nonEmptyString(bankRow?.account_no_encrypted) ?? nonEmptyString(candidateRow.bank_account_no_encrypted);
  if (encryptedAccount) {
    try {
      accountNo = nonEmptyString(decryptAccountNumber(encryptedAccount));
    } catch (error) {
      console.error("[BGV] Failed to decrypt onboarding bank account for async trigger:", error instanceof Error ? error.message : String(error));
    }
  }

  return {
    candidate: {
      full_name: nonEmptyString(candidateRow.full_name),
      mobile: nonEmptyString(candidateRow.mobile),
      email: nonEmptyString(candidateRow.email),
      pan_number: decryptPanForProvider(candidateRow.pan_number_encrypted) ?? nonEmptyString(candidateRow.pan_number),
      aadhar_number: nonEmptyString(candidateRow.aadhar_number),
      uan_number: nonEmptyString(candidateRow.uan_number),
      date_of_birth: nonEmptyString(candidateRow.date_of_birth),
      father_name: nonEmptyString(candidateRow.father_name),
      current_address: nonEmptyString(candidateRow.current_address),
    },
    bank: {
      accountNo,
      ifscCode: nonEmptyString(bankRow?.ifsc_code) ?? nonEmptyString(candidateRow.bank_ifsc),
      accountHolderName: nonEmptyString(bankRow?.account_holder_name),
    },
  };
}

/**
 * Store a successful BGV check result
 */
export async function storeBgvCheckResult(
  candidateId: string,
  checkType: string,
  result: { status: string; providerKey: string; providerRequestId: string; providerReferenceId: string; matchScore?: number | null; matchedName?: string | null; resultSummary: string; raw?: Record<string, unknown> },
  providerKey: string
): Promise<void> {
  const verifiedAt = result.status === 'verified' ? new Date() : null;
  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM candidate_bgv_check WHERE candidate_id = ? AND check_type = ? LIMIT 1`,
    [candidateId, checkType]
  );

  if ((existing as any[]).length > 0) {
    await db.execute(
      `UPDATE candidate_bgv_check
       SET status = ?, provider_key = ?, provider_request_id = ?, provider_reference_id = ?,
           match_score = ?, matched_name = ?, result_summary = ?, result_json = ?,
           verified_at = ?, is_auto_approved = 0, updated_at = NOW()
       WHERE candidate_id = ? AND check_type = ?`,
      [
        result.status, providerKey, result.providerRequestId, result.providerReferenceId,
        result.matchScore ?? null, result.matchedName ?? null, result.resultSummary,
        result.raw ? JSON.stringify(result.raw) : null,
        verifiedAt,
        candidateId, checkType,
      ]
    );
  } else {
    await db.execute(
      `INSERT INTO candidate_bgv_check
         (id, candidate_id, check_type, provider_key, status, provider_request_id,
          provider_reference_id, match_score, matched_name, result_summary, result_json,
          verified_at, is_auto_approved)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        randomUUID(), candidateId, checkType, providerKey, result.status,
        result.providerRequestId, result.providerReferenceId,
        result.matchScore ?? null, result.matchedName ?? null, result.resultSummary,
        result.raw ? JSON.stringify(result.raw) : null,
        verifiedAt,
      ]
    );
  }

  /*
   * BUG FIX (2026-08-25): this is the REAL async onboarding BGV path — the one that actually
   * runs live (triggerRealBgvChecksAsync → storeBgvCheckResult for pan/bank/employment/
   * aadhaar_offline). identityVerificationPropagation.ts was wired into
   * bgv-verification.service.ts's createOrUpdateCheck() on 2026-08-12, but that function is
   * only reached by a separate set of manually/API-triggered verify* entry points — NOT by
   * this one. Result: live DB check, 2026-08-25 — 32 pan and 33 aadhaar checks reached
   * status='verified' (some as recently as yesterday), 9 and 8 of them respectively have a
   * resolvable employee via ats_onboarding_bridge, and employees.pan_verified_on /
   * aadhaar_verified_on were STILL 0 of 58,918 populated. The propagation call was on the
   * wrong copy of the write path.
   *
   * Same non-fatal, idempotent, no-invented-dates contract as the other call site: a failure
   * here must not roll back a BGV check that genuinely passed, and is logged loudly rather
   * than swallowed silently (see identityVerificationPropagation.ts's own doc comment for why
   * that swallow is exactly how the original gap stayed invisible for so long).
   *
   * Does NOT help the ~58,900 employees migrated from legacy systems with no
   * ats_onboarding_bridge row at all (only 15 of 58,918 employees have one) — those employees
   * were never run through this digital BGV pipeline, so there is no genuine verification
   * event to propagate. That is a data-coverage gap, not a wiring bug, and per this file's own
   * design intent must not be papered over with a fabricated verification date.
   */
  if (verifiedAt) {
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
  }
}

/** Candidate-facing names for each BGV check type. */
const CHECK_LABELS: Record<string, string> = {
  pan: "PAN verification",
  aadhaar: "Aadhaar verification",
  aadhaar_offline: "Aadhaar verification",
  bank: "Bank account verification",
  employment: "Employment / UAN verification",
  criminal: "Criminal record check",
};

/**
 * Store a BGV check that errored — marks as manual_review
 */
async function storeBgvCheckError(
  candidateId: string,
  checkType: string,
  providerKey: string,
  err: unknown
): Promise<void> {
  const errMsg = err instanceof Error ? err.message : String(err);
  console.error(`[BGV] ${checkType} check failed for ${candidateId}:`, errMsg);

  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM candidate_bgv_check WHERE candidate_id = ? AND check_type = ? LIMIT 1`,
    [candidateId, checkType]
  );

  // result_summary is rendered to the candidate on Step 5, so it must not carry raw
  // provider text (which has leaked credential and IP-whitelist errors verbatim).
  // The technical detail is kept in result_json for HR and support.
  const errorSummary = `${CHECK_LABELS[checkType] ?? "This check"} could not be completed automatically. HR will verify it manually — this does not block your onboarding.`;
  const errorDetail = JSON.stringify({ mode: "provider_error", provider_key: providerKey, error_message: errMsg.slice(0, 500) });

  if ((existing as any[]).length > 0) {
    await db.execute(
      `UPDATE candidate_bgv_check
       SET status = 'manual_review', provider_key = ?, result_summary = ?, result_json = ?, is_auto_approved = 0, updated_at = NOW()
       WHERE candidate_id = ? AND check_type = ?`,
      [providerKey, errorSummary, errorDetail, candidateId, checkType]
    );
  } else {
    await db.execute(
      `INSERT INTO candidate_bgv_check
         (id, candidate_id, check_type, provider_key, status, result_summary, result_json, is_auto_approved)
       VALUES (?, ?, ?, ?, 'manual_review', ?, ?, 0)`,
      [randomUUID(), candidateId, checkType, providerKey, errorSummary, errorDetail]
    );
  }
}

/**
 * Create pending BGV checks when provider is not configured
 */
/**
 * Park a check as manual review with a candidate-safe summary. Used when a check
 * cannot run at all — distinct from storeBgvCheckError, which records a provider
 * that was reached and failed.
 */
async function storeBgvCheckManualReview(
  candidateId: string,
  checkType: string,
  summary: string,
  detail: Record<string, unknown>,
): Promise<void> {
  const detailJson = JSON.stringify(detail);
  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM candidate_bgv_check WHERE candidate_id = ? AND check_type = ? LIMIT 1`,
    [candidateId, checkType],
  );
  if ((existing as unknown[]).length > 0) {
    await db.execute(
      `UPDATE candidate_bgv_check
          SET status = 'manual_review', result_summary = ?, result_json = ?, is_auto_approved = 0, updated_at = NOW()
        WHERE candidate_id = ? AND check_type = ?`,
      [summary, detailJson, candidateId, checkType],
    );
    return;
  }
  await db.execute(
    `INSERT INTO candidate_bgv_check
       (id, candidate_id, check_type, provider_key, status, result_summary, result_json, is_auto_approved)
     VALUES (?, ?, ?, NULL, 'manual_review', ?, ?, 0)`,
    [randomUUID(), candidateId, checkType, summary, detailJson],
  );
}

async function createPendingBgvChecks(candidateId: string): Promise<void> {
  const checks = ['pan', 'aadhaar_offline', 'bank', 'employment', 'criminal'];
  for (const checkType of checks) {
    const [existing] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM candidate_bgv_check WHERE candidate_id = ? AND check_type = ? LIMIT 1`,
      [candidateId, checkType]
    );
    if ((existing as any[]).length === 0) {
      // 'queued', not 'pending': candidate_bgv_check.status is an enum of
      // (not_started, consent_pending, queued, in_progress, verified, mismatch,
      // failed, manual_review, waived, expired). 'pending' is not a member, so
      // under STRICT_TRANS_TABLES this INSERT raised "Data truncated for column
      // 'status'" on the very first check and aborted the whole loop — meaning
      // that whenever the BGV provider was unconfigured, the fallback that is
      // supposed to queue every check for manual review created nothing at all.
      await db.execute(
        `INSERT INTO candidate_bgv_check
           (id, candidate_id, check_type, provider_key, status, result_summary, is_auto_approved)
         VALUES (?, ?, ?, NULL, 'queued', 'Awaiting BGV provider configuration', 0)`,
        [randomUUID(), candidateId, checkType]
      );
    }
  }
}

/**
 * Sync all checks to the overall BGV report
 */
async function syncBgvReport(candidateId: string, providerKey: string): Promise<void> {
  const [checks] = await db.execute<RowDataPacket[]>(
    `SELECT status FROM candidate_bgv_check WHERE candidate_id = ?`,
    [candidateId]
  );

  const statuses = (checks as any[]).map(c => c.status);
  const allVerified = statuses.length > 0 && statuses.every(s => s === 'verified');
  const anyFailed = statuses.some(s => s === 'failed');
  const anyManualReview = statuses.some(s => s === 'manual_review');

  const overallStatus = allVerified ? 'clear'
    : anyFailed ? 'negative'
    : anyManualReview ? 'refer'
    : 'in_progress';

  const score = allVerified ? 100 : anyFailed ? 0 : 50;

  await db.execute(
    `INSERT INTO candidate_bgv_report (id, candidate_id, overall_status, bgv_score, is_auto_approved, hr_remarks)
     VALUES (?, ?, ?, ?, 0, ?)
     ON DUPLICATE KEY UPDATE
       overall_status = VALUES(overall_status),
       bgv_score = VALUES(bgv_score),
       is_auto_approved = 0,
       hr_remarks = VALUES(hr_remarks),
       updated_at = NOW()`,
    [
      randomUUID(), candidateId, overallStatus, score,
      `BGV checks via ${providerKey} — ${statuses.join(', ')}`,
    ]
  );
}

export async function validateOnboardingToken(token: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT b.candidate_id, b.onboarding_token_expires_at,
            c.id, c.candidate_code, c.full_name, c.mobile, c.email,
            c.gender, c.date_of_birth, c.applied_for_branch, c.applied_for_process,
            c.sourcing_channel, c.source_details, c.resume_url, c.selfie_url,
            c.profile_status, c.is_minor, br.branch_name, pm.process_name
       FROM ats_onboarding_bridge b
       JOIN ats_candidate c ON c.id = b.candidate_id
       LEFT JOIN branch_master br ON br.id = c.applied_for_branch
                                  OR br.branch_name = c.applied_for_branch
                                  OR br.branch_code = c.applied_for_branch
       LEFT JOIN process_master pm ON pm.id = c.applied_for_process
                                   OR pm.process_name = c.applied_for_process
                                   OR pm.process_code = c.applied_for_process
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
    branch_name: row.branch_name ?? row.applied_for_branch ?? null,
    process_id: row.applied_for_process,
    process_name: row.process_name ?? row.applied_for_process ?? null,
    source_type: row.sourcing_channel ?? null,
    source: row.source_details ?? row.sourcing_channel ?? null,
    resume_url: row.resume_url,
    selfie_url: row.selfie_url,
    profile_status: row.profile_status,
    // Drives the DPDP s.9 guardian-consent banner. Absent from this payload
    // until now, so the banner in OnboardingSteps1to5.tsx could never render.
    is_minor: Boolean((row as { is_minor?: number }).is_minor),
    // SELECT *, and this one is reached through the PUBLIC token-driven onboarding routes
    // that mount before global requireAuth. It was returning onboarding_token_hash — the
    // stored hash of the very token being used to make the call — alongside
    // pan_number_encrypted and the lookup hashes.
    saved_profile: stripCryptoPlumbing(profileRows[0] ?? null),
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
  // Both of these are written by the journey and were never read back, so a
  // returning candidate saw an empty table and re-entered what they had already
  // supplied. It also silently capped section completeness: sectionComplete is
  // derived purely from this payload, so a step whose data never returns can
  // never tick. `family` above is the aggregate row (income, dependents) — a
  // different table from the per-member list below.
  const [familyMemberRows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM candidate_onboarding_family_member WHERE candidate_id = ? ORDER BY created_at ASC`,
    [candidateId]
  );
  const [languageRows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM candidate_onboarding_language WHERE candidate_id = ? ORDER BY created_at ASC`,
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
    familyMembers: familyMemberRows,
    languages: languageRows,
    experience: experienceRows[0] ?? null,
    digilocker,
    esign,
  };
}

export async function saveEmployeeDetails(token: string, input: Record<string, unknown>, meta?: { ip?: string; userAgent?: string }) {
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;

  // Mobile and Emergency Contact numbers must differ — the frontend already
  // blocks this, but that check is bypassable (dev tools, a direct API call),
  // so it must also be enforced here before any write.
  const normPhone = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-10);
  const mobileNorm = normPhone(input.mobileNumber ?? tokenData.mobile);
  const emergencyNorm = normPhone(input.emergencyContactMobile);
  if (mobileNorm && emergencyNorm && mobileNorm === emergencyNorm) {
    throw Object.assign(
      new Error("Emergency contact number must be different from your own mobile number."),
      { statusCode: 400, code: "MOBILE_EQUALS_EMERGENCY_CONTACT" },
    );
  }

  const id = randomUUID();
  // The frontend's KYC step (onboarding-v2/sections/S3_KYCDocuments.tsx) seeds its PAN
  // input from the server's own MASKED value on mount so the field isn't blank on reload,
  // then autosaves ~800ms later even with no user edit — sending the masked string
  // ("ABCXXXX4F" shape) straight back as if it were the real PAN. Without this guard that
  // silently overwrote pan_number_hash/pan_number_encrypted with a hash of the mask,
  // breaking hash-based PAN lookup/duplicate detection for anyone who reopened the step.
  // Fixed 2026-09-01: treat an incoming value that already matches our own mask shape as
  // "no new PAN provided" so COALESCE below preserves whatever was already on file.
  const incomingPanRaw = String(input.panNumber ?? input.pan_number ?? "").trim().toUpperCase();
  const incomingPanIsMasked = /^[A-Z0-9]{3}XXXX[A-Z0-9]{2}$/.test(incomingPanRaw);
  const rawPan = incomingPanIsMasked ? "" : incomingPanRaw;
  const panMasked = rawPan ? maskPan(rawPan) : maskPan(input.pan_number_masked);
  const panHash = rawPan ? hashValue(rawPan) : null;
  // Encrypted at rest so PAN verification can actually run. The masked form is not
  // a PAN and the hash is one-way, so neither can be sent to a provider - which is
  // why automatic PAN verification could never fire. Same treatment bank account
  // numbers already get: only the server decrypts it, and the browser still only
  // ever receives the masked value.
  const panEncrypted = /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(rawPan) ? encrypt(rawPan) : null;
  // Same masked-value-echoed-back-on-autosave guard as PAN above (2026-09-01 fix),
  // applied proactively here rather than waiting to reproduce it: a KYC step that
  // seeds its Aadhaar input from maskAadhaar()'s own "XXXX-XXXX-1234" shape would
  // otherwise autosave that mask as if it were the real number.
  const incomingAadhaarRaw = String(input.aadhaarNumber ?? input.aadhar_number ?? input.aadhaar_number ?? "").trim();
  const incomingAadhaarIsMasked = /^XXXX-XXXX-\d{4}$/i.test(incomingAadhaarRaw);
  const rawAadhaar = incomingAadhaarIsMasked ? "" : incomingAadhaarRaw.replace(/\D/g, "");
  const aadhaarMasked = rawAadhaar ? maskAadhaar(rawAadhaar) : maskAadhaar(input.aadhaar_number_masked);
  const aadhaarHash = rawAadhaar ? hashValue(rawAadhaar) : null;
  // candidate_onboarding_profile.aadhaar_number_encrypted DOES NOT EXIST on the live
  // database. Migration 1651_aadhaar_encrypted_storage_candidate_onboarding.sql was
  // written and shipped to the server, but was never added to MIGRATION_MANIFEST, so it
  // has never run — verified 2026-09-02 against mas_hrms: the column is absent and a
  // PREPARE of this INSERT fails ER_BAD_FIELD_ERROR. The code referencing it was
  // deployed anyway, which meant EVERY candidate KYC save (Step 3) returned a 500 and
  // new onboarding was blocked outright. The write is removed rather than the migration
  // added, because the owner's decision is to hold Aadhaar/PAN in plaintext for ESI
  // rather than encrypted — see rawAadhaarForCandidate below.
  //
  // The RAW plaintext values, written to ats_candidate below. Owner decision 2026-09-02:
  // ESI registration needs the real Aadhaar and PAN, and employees.pan_number /
  // employees.aadhaar_number are already plaintext and already populated (923 and 1,050
  // of 1,116 active employees), so this makes the onboarding path consistent with the
  // rest of the system rather than introducing a new practice.
  //
  // Gated on the SAME format check the encryption used, which is the point: the reason
  // the raw columns were previously left unwritten is that this flow can hold a MASKED
  // value, and writing a mask into a column named "raw" corrupted it. A masked PAN
  // ("ABCXXXX12") and a masked Aadhaar ("XXXX-XXXX-1234") both fail these tests, so only
  // a genuine, well-formed number is ever written here.
  const rawPanForCandidate = /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(rawPan) ? rawPan : null;
  const rawAadhaarForCandidate = /^[0-9]{12}$/.test(rawAadhaar) ? rawAadhaar : null;

  // Validate and prepare DOB (allow null, but convert empty strings to null)
  const dobValue = input.dateOfBirth ?? tokenData.date_of_birth;
  const normalizedDob = dobValue === "" || dobValue === "0000-00-00" ? null : dobValue ?? null;

  await db.execute(
    `INSERT INTO candidate_onboarding_profile
       (id, candidate_id, onboarding_token_hash, title, employee_name, relation, father_husband_name,
        gender, marital_status, date_of_birth, blood_group,
        nominee_name, nominee_relation, nominee_date_of_birth, nominee1_share_pct,
        nominee2_name, nominee2_relation, nominee2_dob, nominee2_share_pct,
        permanent_address, permanent_state, permanent_city, permanent_pincode,
        present_address, present_state, present_city, present_pincode, mobile_number, alt_mobile_number,
        personal_email_id, official_email_id, pan_number_masked, pan_number_hash, pan_number_encrypted, aadhaar_number_masked,
        aadhaar_number_hash, passport_no, driving_license_no,
        uan_number, epf_number, esic_number,
        source_type, source, profile_status,
        mother_name, emergency_contact_name, emergency_contact_relation, emergency_contact_mobile,
        nationality, religion, category, address_proof_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'employee_details_saved', ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
        title = VALUES(title), employee_name = VALUES(employee_name), relation = VALUES(relation),
        father_husband_name = VALUES(father_husband_name), gender = VALUES(gender), marital_status = VALUES(marital_status),
        date_of_birth = IF(VALUES(date_of_birth) IS NOT NULL, VALUES(date_of_birth), date_of_birth), blood_group = VALUES(blood_group),
        nominee_name = VALUES(nominee_name), nominee_relation = VALUES(nominee_relation),
        nominee_date_of_birth = VALUES(nominee_date_of_birth), nominee1_share_pct = VALUES(nominee1_share_pct),
        nominee2_name = VALUES(nominee2_name), nominee2_relation = VALUES(nominee2_relation),
        nominee2_dob = VALUES(nominee2_dob), nominee2_share_pct = VALUES(nominee2_share_pct),
        permanent_address = VALUES(permanent_address), permanent_state = VALUES(permanent_state), permanent_city = VALUES(permanent_city),
        permanent_pincode = VALUES(permanent_pincode), present_address = VALUES(present_address), present_state = VALUES(present_state),
        present_city = VALUES(present_city), present_pincode = VALUES(present_pincode), mobile_number = VALUES(mobile_number),
        alt_mobile_number = VALUES(alt_mobile_number), personal_email_id = VALUES(personal_email_id), official_email_id = VALUES(official_email_id),
        pan_number_masked = COALESCE(VALUES(pan_number_masked), pan_number_masked),
        pan_number_hash = COALESCE(VALUES(pan_number_hash), pan_number_hash),
        pan_number_encrypted = COALESCE(VALUES(pan_number_encrypted), pan_number_encrypted),
        aadhaar_number_masked = COALESCE(VALUES(aadhaar_number_masked), aadhaar_number_masked),
        aadhaar_number_hash = COALESCE(VALUES(aadhaar_number_hash), aadhaar_number_hash),
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
      toStoredName(input.employeeName ?? tokenData.full_name),
      input.relation ?? null,
      toStoredName(input.fatherHusbandName ?? input.father_name),
      input.gender ?? tokenData.gender ?? null,
      input.maritalStatus ?? null,
      normalizedDob,
      input.bloodGroup ?? null,
      toStoredName(input.nominee ?? input.nomineeName),
      input.nomineeRelation ?? null,
      normDate(input.nomineeDateOfBirth),
      input.nominee1SharePct || null,
      toStoredName(input.nominee2Name),
      input.nominee2Relation || null,
      normDate(input.nominee2Dob),
      input.nominee2SharePct || null,
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
      panEncrypted,
      aadhaarMasked,
      aadhaarHash,
      input.passportNo ?? input["passportNumber"] ?? input["passport_number"] ?? null,
      input.drivingLicenseNo ?? input["dlNumber"] ?? input["dl_number"] ?? null,
      input.uanNumber ?? null,
      input.epfNumber ?? null,
      input.esicNumber ?? null,
      input.sourceType ?? tokenData.source_type ?? null,
      input.source ?? tokenData.source ?? null,
      toStoredName(input.motherName),
      toStoredName(input.emergencyContactName),
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
       father_name = COALESCE(?, father_name),
       gender = COALESCE(?, gender),
       date_of_birth = COALESCE(?, date_of_birth),
       permanent_address = COALESCE(?, permanent_address),
       current_address = COALESCE(?, current_address),
       mobile = COALESCE(?, mobile),
       email = COALESCE(?, email),
       -- pan_number / aadhar_number are the RAW columns. They were previously left
       -- unwritten because this flow can hold a MASKED value, and writing a mask into a
       -- column named "raw" corrupted it, making PAN look populated to every downstream
       -- reader while never being usable. That hazard is handled at the source now:
       -- rawPanForCandidate / rawAadhaarForCandidate are null unless the value passes the
       -- full-format check (a mask cannot pass it), so only a genuine number reaches these
       -- columns, and COALESCE leaves them untouched otherwise.
       --
       -- They are written because NOT writing them starved three readers of exactly these
       -- columns in employee-creation-orchestrator.service.ts: PAN/Aadhaar format
       -- validation, the duplicate-ACTIVE-employee guard (the check meant to stop one
       -- person being onboarded twice), and the insert into employee_statutory_info that
       -- ESI registration ultimately reads. Owner decision 2026-09-02: hold these in
       -- plaintext, consistent with employees.pan_number / employees.aadhaar_number which
       -- are already plaintext and already populated for 83% / 94% of active employees.
       pan_number = COALESCE(?, pan_number),
       aadhar_number = COALESCE(?, aadhar_number),
       pan_number_masked = COALESCE(?, pan_number_masked),
       pan_number_hash = COALESCE(?, pan_number_hash),
       aadhar_number_masked = COALESCE(?, aadhar_number_masked),
       aadhar_number_hash = COALESCE(?, aadhar_number_hash),
       source_details = COALESCE(?, source_details),
       profile_status = IF(profile_status IN ('profile_submitted', 'onboarded', 'rejected'), profile_status, 'onboarding_sent'),
       updated_at = NOW()
     WHERE id = ?`,
    // Every binding here is COALESCE(?, existing), which means the SENTINEL for
    // "leave this column alone" is NULL — and `??` only falls back on
    // null/undefined, so an untouched form field arriving as "" was passed
    // straight through. Two failures came from that:
    //
    //   1. date_of_birth. COALESCE('', date_of_birth) evaluates to '', and MySQL
    //      rejects '' as a datetime — ER_TRUNCATED_WRONG_VALUE: Incorrect
    //      datetime value: ''. That aborts this whole UPDATE, so a candidate who
    //      left DOB blank had their candidate_onboarding_profile row written by
    //      the statement above and the ats_candidate mirror silently not written.
    //      Observed live twice inside 20 seconds on 2026-08-08.
    //   2. Every varchar. COALESCE('', father_name) is '' — verified against the
    //      live DB — so a blank field WRITES an empty string instead of leaving
    //      the column alone, defeating the point of COALESCE. Whether that ever
    //      destroyed a previously captured value depends on step ordering, and
    //      no such instance was proven: the 26 rows currently holding '' have
    //      the same blank in candidate_onboarding_profile, i.e. blank in, blank
    //      out. Latent rather than demonstrated — but '' and NULL must not be
    //      allowed to mean different things in a column that is COALESCE-guarded.
    //
    // normalizedDob is computed ~100 lines above for exactly this reason and was
    // simply not reused here. nonEmptyString is this file's existing idiom.
    [
      toStoredName(input.fatherHusbandName ?? input.father_name),
      nonEmptyString(input.gender ?? tokenData.gender),
      normalizedDob,
      nonEmptyString(input.permanentAddress),
      nonEmptyString(input.presentAddress ?? input.current_address),
      nonEmptyString(input.mobileNumber ?? tokenData.mobile),
      nonEmptyString(input.personalEmailId ?? tokenData.email),
      rawPanForCandidate,
      rawAadhaarForCandidate,
      panMasked,
      panHash,
      aadhaarMasked,
      aadhaarHash,
      nonEmptyString(input.source ?? tokenData.source),
      candidateId,
    ]
  );
  // Mirror the UAN onto ats_candidate, which is the only one of these columns
  // that table actually has.
  //
  // This used to set passport_no, driving_license_no, epf_number and
  // esic_number here too. Those four live on candidate_onboarding_profile, so
  // MySQL rejected the whole statement with "Unknown column 'passport_no' in
  // 'field list'" on every candidate who reached this step — taking uan_number,
  // which is valid, down with it. An empty `.catch()` carrying the comment
  // "columns may not exist on older schema — safe to ignore" made a rejected
  // write look exactly like a successful one.
  //
  // Nothing is lost by narrowing it: the candidate_onboarding_profile upsert
  // directly above already stores all five, including in its ON DUPLICATE KEY
  // UPDATE clause.
  await db.execute(
    `UPDATE ats_candidate SET
       uan_number = COALESCE(?, uan_number),
       updated_at = NOW()
     WHERE id = ?`,
    // Same COALESCE sentinel problem as the UPDATE above: "" is not NULL, so a
    // blank UAN field overwrote a stored UAN with an empty string instead of
    // leaving it be.
    [nonEmptyString(input.uanNumber), candidateId]
  ).catch((error) => {
    // Still non-fatal — a candidate must not lose their whole submission over
    // a mirrored field — but no longer silent.
    console.error(`[Onboarding] could not mirror UAN onto ats_candidate for ${candidateId}:`, (error as Error)?.message);
  });

  // Fraud detection: check for duplicates (non-blocking)
  if (panHash) {
    checkDuplicates(candidateId, "pan", panHash).catch(e => console.error("[Fraud] PAN duplicate check error:", e.message));
  }
  if (aadhaarHash) {
    checkDuplicates(candidateId, "aadhaar", aadhaarHash).catch(e => console.error("[Fraud] Aadhaar duplicate check error:", e.message));
  }

  await logCandidateAction(candidateId, "SAVE_EMPLOYEE_DETAILS", { fields: Object.keys(input) }, meta);
  return getFullOnboardingStatus(token);
}

export async function saveBankDetails(token: string, input: Record<string, unknown>, meta?: { ip?: string; userAgent?: string }) {
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;
  const accountNo = input.accountNo ?? input.bank_account_no ?? input.account_no;
  const id = randomUUID();

  // Encrypt account number for later penny drop verification (reversible, unlike hash)
  const accountNoEncrypted = accountNo ? encrypt(String(accountNo).trim()) : null;

  // ── Penny-drop gate (owner decision 2026-09-02) ──────────────────────────────────
  // A bank account is only captured once a penny drop has come back positive for THAT
  // account. Previously this INSERT ran unconditionally, which is why the live data shows
  // 32,816 saved bank rows against 41 carrying verification_status='verified' — the
  // account a candidate typed was stored and used downstream whether or not it was ever
  // proven to exist or to belong to them.
  //
  // Matched on account_no_hash, not merely "this candidate has a verified check": without
  // the hash comparison a candidate could verify one account, then save a different one
  // and inherit the pass. 68 of the 79 verified checks carry a usable hash.
  //
  // Deliberately scoped to submissions that actually carry an account number. The form
  // blanks that field on reload ("re-enter for security"), so a resave touching only bank
  // name or branch legitimately arrives without one; those are allowed through because the
  // COALESCE below leaves the stored (already verified) account untouched. Blocking them
  // would lock a candidate out of editing their own branch name after verifying.
  //
  // 'manual_review' counts as having passed, and the row carries that status through.
  // The gate originally demanded 'verified' exactly, which conflated two different
  // answers from the provider: "this account does not check out" and "the bank confirmed
  // the account but spells the owner's name differently". The second is the ordinary
  // shape of an Indian name and was always meant to be a warning for Payroll HR, never a
  // stop — the candidate cannot resolve it, because re-running returns the same bank name
  // every time. On 2026-09-03 that deadlock refused one candidate ten times and charged a
  // real penny drop for each attempt while telling him to keep trying.
  //
  // Nothing unproven reaches payroll by allowing this: employee_bank_detail is written by
  // employee-creation-orchestrator, which still requires verification_status = 'verified'.
  // A manual_review account is captured so onboarding can finish, and stays unusable for
  // payment until a human clears it.
  const submittedAccountNo = String(accountNo ?? "").trim();
  let submittedVerificationStatus: string | null = null;
  if (submittedAccountNo) {
    const [verifiedRows] = await db.execute<RowDataPacket[]>(
      `SELECT verification_status FROM candidate_bank_verification
        WHERE candidate_id = ?
          AND verification_status IN ('verified', 'manual_review')
          AND account_no_hash = ?
        ORDER BY (verification_status = 'verified') DESC, created_at DESC
        LIMIT 1`,
      [candidateId, hashValue(submittedAccountNo)]
    );
    if (!verifiedRows.length) {
      throw Object.assign(
        new Error(
          "This account could not be saved because its penny-drop verification has not passed. "
          + "Run the account verification for this exact account number and IFSC, and save again once it succeeds."
        ),
        { statusCode: 409 }
      );
    }
    submittedVerificationStatus = String(verifiedRows[0].verification_status);
  }

  await db.execute(
    `INSERT INTO candidate_onboarding_bank_detail
       (id, candidate_id, bank_name, branch_name, account_holder_name, account_no_masked,
        account_no_hash, account_no_encrypted, ifsc_code, account_type, cancelled_cheque_document_id, name_on_cheque, verification_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'not_started'))
     ON DUPLICATE KEY UPDATE
       bank_name = VALUES(bank_name), branch_name = VALUES(branch_name), account_holder_name = VALUES(account_holder_name),
       -- The frontend deliberately leaves the account-number field blank on reload
       -- ("re-enter for security"), so a resave that only touches bank name/branch
       -- (or is triggered again after the candidate already verified successfully)
       -- submits no new account number. Overwriting unconditionally here wiped a
       -- previously-saved (and possibly already-verified) account number to NULL —
       -- reproduced against MAS63413: verified 2026-08-24 06:37:56, then the very
       -- next save 24s later already shows account_no_encrypted = NULL. COALESCE
       -- keeps the existing stored value whenever this submission has none.
       account_no_masked = COALESCE(VALUES(account_no_masked), account_no_masked),
       account_no_hash = COALESCE(VALUES(account_no_hash), account_no_hash),
       account_no_encrypted = COALESCE(VALUES(account_no_encrypted), account_no_encrypted),
       ifsc_code = VALUES(ifsc_code),
       account_type = VALUES(account_type), cancelled_cheque_document_id = VALUES(cancelled_cheque_document_id),
       name_on_cheque = VALUES(name_on_cheque),
       -- Carries the answer the gate just read, so Payroll HR sees a manual_review
       -- account as manual_review rather than as an untested 'not_started'. Only
       -- written when this submission actually carried an account number: a resave
       -- of the branch name alone must not reset the status of the stored account.
       verification_status = COALESCE(?, verification_status),
       updated_at = NOW()`,
    [
      id,
      candidateId,
      input.bankName ?? input.bank_name ?? null,
      input.branchName ?? null,
      input.accountHolderName ?? null,
      maskAccount(accountNo),
      hashValue(accountNo),
      accountNoEncrypted,
      String(input.ifscCode ?? input.bank_ifsc ?? "").trim().toUpperCase() || null,
      input.accountType ?? null,
      input.cancelledChequeDocumentId ?? null,
      String(input.nameOnCheque ?? input.name_on_cheque ?? "").trim() || null,
      submittedVerificationStatus,
      submittedVerificationStatus,
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
       bank_account_no_encrypted = COALESCE(?, bank_account_no_encrypted),
       updated_at = NOW()
     WHERE id = ?`,
    [
      input.bankName ?? input.bank_name ?? null,
      input.ifscCode ?? input.bank_ifsc ?? null,
      // The REAL account number, not maskAccount(). This is the plaintext column payroll
      // disbursement ultimately depends on, and 28,255 of its 31,262 populated rows hold
      // genuine numbers from the legacy import. Writing maskAccount() here put "XXXXXX7753"
      // into that same column for every candidate onboarded through this flow — measured
      // 2026-09-02: of every bank save in the preceding 30 days, ZERO produced a usable
      // number and all produced a mask. It looked populated to every reader and was
      // worthless for paying anyone, which is why 59 active employees have no payable
      // account today.
      //
      // Guarded the same way the KYC capture is: only a plausible account number is stored,
      // so the mask the form echoes back on reload (that field is deliberately blanked and
      // re-entered) can never overwrite a good value. COALESCE leaves the column alone when
      // this submission carries nothing.
      /^[0-9]{9,18}$/.test(String(accountNo ?? "").replace(/\s+/g, ""))
        ? String(accountNo).replace(/\s+/g, "")
        : null,
      hashValue(accountNo),
      accountNoEncrypted,
      candidateId,
    ]
  );

  // Fraud detection: check for duplicate bank account (non-blocking)
  const bankHash = hashValue(accountNo);
  if (bankHash) {
    checkDuplicates(candidateId, "bank", bankHash).catch(e => console.error("[Fraud] Bank duplicate check error:", e.message));
  }

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
      input.qualification || null,
      input.specializationCourseName || input.specialization || null,
      input.passedOutYear || null,
      input.passedOutState || null,
      input.passedOutCity || null,
      input.passedOutPercentage || input.percentage || null,
      input.documentId || null,
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
    [randomUUID(), candidateId, input.annualIncome || null, input.countOfDependents || null]
  );
  await logCandidateAction(candidateId, "SAVE_FAMILY_DETAILS", input, meta);
  return getFullOnboardingStatus(token);
}

export async function saveExperienceDetails(token: string, input: Record<string, unknown>, meta?: { ip?: string; userAgent?: string }) {
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;
  // from_date / to_date / reason_for_leaving are collected by the step, posted
  // with the rest of the form and read straight back out of this row, but were
  // missing from the column list — so MySQL accepted every save and discarded
  // them. The table held 74 rows, 12 naming an employer and 0 with either date.
  // Date of exit from the previous establishment is required on EPF Form 11, so
  // the omission pushed a question the candidate had already answered on to HR.
  await db.execute(
    `INSERT INTO candidate_onboarding_experience
       (id, candidate_id, working_experience, experience_year, experience_doc_type,
        experience_document_id, employer_name, last_designation, last_ctc,
        from_date, to_date, reason_for_leaving)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       working_experience = VALUES(working_experience), experience_year = VALUES(experience_year),
       experience_doc_type = VALUES(experience_doc_type), experience_document_id = VALUES(experience_document_id),
       employer_name = VALUES(employer_name), last_designation = VALUES(last_designation), last_ctc = VALUES(last_ctc),
       from_date = VALUES(from_date), to_date = VALUES(to_date),
       reason_for_leaving = VALUES(reason_for_leaving), updated_at = NOW()`,
    [
      randomUUID(),
      candidateId,
      (String(input.workingExperience ?? "fresher")).substring(0, 50),
      (input.experienceYear || input.experienceYear === 0) ? Number(input.experienceYear) || null : null,
      input.experienceDocType || null,
      input.experienceDocumentId || null,
      input.employerName || null,
      input.lastDesignation || null,
      input.lastCtc || null,
      // The date inputs post "" once cleared, which is not a valid DATE and
      // would land as 0000-00-00 under a lax sql_mode. normDate also absorbs
      // the "dd-mm-yyyy" placeholder these fields emit before first use.
      normDate(input.fromDate),
      normDate(input.toDate),
      nonEmptyString(input.reasonForLeaving),
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

/**
 * Documents a candidate must have on file before the profile can be submitted,
 * with the spellings the upload form actually produces. Submit used to check only
 * that a profile row and a bank row existed, so a candidate whose uploads all
 * failed still reached "submitted" with nothing attached — on production that is
 * how 15 of 38 submitted candidates ended up with no identity documents at all,
 * two of them already approved.
 */
// Bank Passbook / Cancelled Cheque deliberately removed (was here) — bank
// account is no longer mandatory at onboarding, see submitFullOnboarding's
// comment. Not made conditional on "bank details were provided" either: the
// Bank step's Save button already unconditionally upserts a row even when
// entirely blank, so "a bank row exists" was never a reliable signal for
// "the candidate actually has an account" without more scope than this
// fix warrants.
const MANDATORY_DOCUMENTS: Array<{ label: string; matches: string[] }> = [
  { label: "Aadhaar Card", matches: ["aadhaar", "aadhar"] },
  { label: "PAN Card", matches: ["pan"] },
  { label: "Address Proof", matches: ["address proof"] },
  { label: "Passport Size Photo", matches: ["passport photo", "passport size", "photo"] },
  // Live Selfie is deliberately its own rule and NOT folded into the photo rule
  // above: a gallery-uploaded passport photo must not satisfy a *live* capture,
  // which exists to prove the candidate was physically present. Every live
  // capture writes doc_type "Live Selfie" (55/55 rows in production), so the
  // "selfie" substring is sufficient and no exact-match special case is needed.
  { label: "Live Selfie", matches: ["selfie"] },
  { label: "10th Marksheet", matches: ["10th"] },
  { label: "12th Marksheet / Diploma", matches: ["12th", "diploma"] },
];

/** Returns the labels of mandatory documents this candidate has not provided. */
export async function findMissingMandatoryDocuments(candidateId: string): Promise<string[]> {
  const [docRows] = await db.execute<RowDataPacket[]>(
    `SELECT doc_type, doc_name FROM candidate_onboarding_document WHERE candidate_id = ? AND deleted_at IS NULL`,
    [candidateId],
  );
  const held = docRows
    .map((r) => `${String(r.doc_type ?? "")} ${String(r.doc_name ?? "")}`.toLowerCase())
    .filter(Boolean);

  // DigiLocker pulls straight from the government source, so a document type it
  // actually verified is satisfied without a manual re-upload -- but ONLY that
  // type. This used to treat any completed session (ats_onboarding_bridge.
  // digilocker_status alone) as a blanket pass for both Aadhaar and PAN. That is
  // wrong: downloadKycDocument returns ONE document, chosen by what the
  // candidate consented to share in the DigiLocker portal -- see
  // digilocker-evidence.ts, which autoCreateDigilockerVerifiedChecks() already
  // uses to record candidate_bgv_check per check_type correctly. This function
  // just wasn't reading that table, so an Aadhaar-only pull silently waived the
  // PAN upload too. Reproduced against MAS63413 (candidate a7edfea8-...):
  // check_type='aadhaar' is verified via digilocker, check_type='pan' is still
  // 'manual_review' -- he has no PAN document on file and this function was
  // reporting nothing missing.
  const [verifiedRows] = await db.execute<RowDataPacket[]>(
    `SELECT check_type FROM candidate_bgv_check
      WHERE candidate_id = ? AND check_type IN ('aadhaar', 'pan') AND status = 'verified'`,
    [candidateId],
  );
  const digilockerVerified = new Set(verifiedRows.map((r) => String(r.check_type)));

  return MANDATORY_DOCUMENTS.filter((req) => {
    if (digilockerVerified.has("aadhaar") && req.matches.includes("aadhaar")) return false;
    if (digilockerVerified.has("pan") && req.matches.includes("pan")) return false;
    // "photo" must not be satisfied by "Photocopy of ..." style names, so compare
    // against the whole doc_type/doc_name text rather than a bare substring of one word.
    return !held.some((text) => req.matches.some((m) => text.includes(m)));
  }).map((r) => r.label);
}

/**
 * Whether this candidate has an active "Live Selfie" onboarding document.
 * Exported so other submission paths (e.g. the legacy submitProfile() in
 * ats.onboarding.service.ts) can enforce the same live-capture requirement
 * without duplicating the query or pulling in the unrelated DigiLocker/
 * Aadhaar/PAN logic that findMissingMandatoryDocuments() also handles.
 */
export async function hasLiveSelfieDocument(candidateId: string): Promise<boolean> {
  const [docRows] = await db.execute<RowDataPacket[]>(
    `SELECT doc_type, doc_name FROM candidate_onboarding_document WHERE candidate_id = ? AND deleted_at IS NULL`,
    [candidateId],
  );
  return docRows.some((r) =>
    `${String(r.doc_type ?? "")} ${String(r.doc_name ?? "")}`.toLowerCase().includes("selfie"),
  );
}

export async function submitFullOnboarding(token: string, meta?: { ip?: string; userAgent?: string }) {
  const tokenData = await validateOnboardingToken(token);
  const candidateId = tokenData.candidate_id as string;

  const [profileRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_name, mobile_number, personal_email_id, pan_number_hash, aadhaar_number_hash,
            bgv_consent, dpdp_consent, marital_status
       FROM candidate_onboarding_profile WHERE candidate_id = ? LIMIT 1`,
    [candidateId]
  );
  if (!profileRows.length) throw Object.assign(new Error("Employee details are required before submit"), { statusCode: 400 });

  const profile = profileRows[0];

  // Marital Status is enforced here rather than in saveEmployeeDetails, which is
  // a progressive draft-save called on every step and must keep accepting
  // partial rows. The client gates it at Step 2 (validateStep2Personal, ref
  // 4a8f9b07), but that gate is invisible to anyone calling the API directly,
  // and an empty value later breaks offer approval with a strict-mode ENUM
  // truncation error.
  if (!String(profile.marital_status ?? "").trim()) {
    throw Object.assign(
      new Error("Marital Status is required before submission. Please go to the Personal Details step and select your marital status."),
      { statusCode: 400, code: "MISSING_MARITAL_STATUS" },
    );
  }

  if (!profile.dpdp_consent) {
    throw Object.assign(
      new Error("Privacy (DPDP) consent is required before submission. Please go to the Welcome & Consent step and accept the privacy policy."),
      { statusCode: 400, code: "DPDP_CONSENT_REQUIRED" }
    );
  }
  if (!profile.bgv_consent) {
    // Fallback: the bgv_consent flag may have been set before the profile row was
    // created (UPDATE matched 0 rows). Check the actual consent table and sync.
    const [consentCheck] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM candidate_bgv_consent WHERE candidate_id = ? AND consent_status = 'granted' LIMIT 1`,
      [candidateId]
    );
    if (!consentCheck.length) {
      throw Object.assign(
        new Error("BGV consent is required before submission. Please go to the BGV & Verification step and grant consent for background verification."),
        { statusCode: 400, code: "BGV_CONSENT_REQUIRED" }
      );
    }
    // Consent exists — sync the flag so subsequent reads are consistent.
    await db.execute(
      `UPDATE candidate_onboarding_profile SET bgv_consent = 1, updated_at = NOW() WHERE candidate_id = ?`,
      [candidateId]
    );
  }

  // Bank account is deliberately NOT required to submit — many new joiners
  // don't have one yet at onboarding time. They add it post-joining via the
  // existing employee self-service flow (POST /me/bank-change-request,
  // Profile.tsx's Bank Account section), which already routes through
  // Payroll HO approval. Confirmed zero downstream dependency: neither
  // employee-creation-orchestrator.service.ts's createEmployeeFromCandidate
  // nor joining-control-room.service.ts's readinessBlockers() reference bank
  // data at all.

  const missingDocuments = await findMissingMandatoryDocuments(candidateId);
  if (missingDocuments.length) {
    throw Object.assign(
      new Error(`Please upload these required documents before submitting: ${missingDocuments.join(", ")}.`),
      { statusCode: 400, code: "MISSING_REQUIRED_DOCUMENTS" },
    );
  }

  // Aadhaar NUMBER is required, not just the card document above -- those are
  // different things. findMissingMandatoryDocuments only proves the card image
  // was captured (uploaded, or via DigiLocker); it says nothing about whether
  // the 12 digits were ever entered into aadhaar_number_hash/_encrypted. Step 3
  // (Address & KYC) already marks the field `required` in the UI
  // (OnboardingSteps1to5V2.tsx), but nothing enforced it server-side -- the
  // same client/server parity gap the qualification check below was already
  // added to close. Decided explicitly 2026-09-02, tradeoff accepted: a
  // candidate who verified via DigiLocker without ever typing the number
  // manually is blocked here until they do.
  if (!profile.aadhaar_number_hash) {
    throw Object.assign(
      new Error("Aadhaar number is required before submitting. Please go to the Address & KYC step and enter your Aadhaar number."),
      { statusCode: 400, code: "MISSING_AADHAAR_NUMBER" },
    );
  }

  // At least one qualification is required. The client gates this too
  // (validateStep7Education), but the gate has to exist here as well: Step 7's
  // "Add Qualification" button POSTs on its own, so a candidate who never
  // pressed it — or who calls this endpoint directly — would otherwise submit
  // with no education at all. That is exactly how 15 candidates reached
  // "profile_submitted" or beyond with zero qualification rows, leaving the HR
  // review page showing "No education records."
  const [qualRows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM candidate_onboarding_qualification WHERE candidate_id = ? LIMIT 1`,
    [candidateId],
  );
  if (!qualRows.length) {
    throw Object.assign(
      new Error("At least one qualification is required before submitting. Please go to the Education & Qualifications step and add your 10th / SSC qualification."),
      { statusCode: 400, code: "MISSING_QUALIFICATIONS" },
    );
  }

  // Employment below 18 is not permitted. Checked here, at the last point the
  // candidate controls, using the most trustworthy date of birth on file
  // (provider-verified, then OCR of the Aadhaar/10th certificate, then
  // self-declared). Judged against the joining date, since that is when
  // employment actually begins.
  //
  // A candidate with no DOB on record anywhere is NOT blocked: that is a data
  // gap, not evidence of a minor, and blocking it would stop most historic
  // candidates outright.
  // No joining date exists at submit time, so age is assessed as of today.
  // createEmployeeFromCandidate re-checks against the offer's real joining
  // date, which is the authoritative one.
  const ageCheck = await assertEmployableAge(candidateId, null);
  // Persist the DPDP minor flag. ats_candidate.is_minor has existed since
  // migration 336 and nothing has ever written it, so the guardian-consent
  // banner in the onboarding UI could never render. persistMinorFlag itself
  // now logs (rather than silently swallows) a write failure, so it's no
  // longer double-wrapped here — see its docstring for why this stays
  // non-fatal to the submission either way.
  await persistMinorFlag(candidateId, ageCheck);

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

  // Trigger real BGV checks asynchronously — fire-and-forget after submission commits
  // Uses configured provider (befisc_luckpay / infinity_ai / digio) from org_settings
  // Failures are logged and visible in BGV review queue — do NOT throw here
  triggerRealBgvChecksAsync(candidateId, meta).catch((err: unknown) => {
    console.error('[onboarding] BGV async trigger failed for', candidateId, ':', err instanceof Error ? err.message : String(err));
  });

  await db.execute(
    `INSERT INTO ats_candidate_stage_log
       (id, candidate_id, from_stage, to_stage, remarks, updated_by)
     VALUES (UUID(), ?, 'Profile Submitted', 'BGV In Progress', 'Real BGV provider checks initiated', NULL)`,
    [candidateId]
  );
  await logCandidateAction(candidateId, "SUBMIT_ONBOARDING", null, meta);
  return { candidateId, status: "submitted" };
}

const MAGIC_BYTES: Record<string, Uint8Array[]> = {
  pdf:  [new Uint8Array([0x25, 0x50, 0x44, 0x46])],
  jpg:  [new Uint8Array([0xFF, 0xD8, 0xFF])],
  jpeg: [new Uint8Array([0xFF, 0xD8, 0xFF])],
  png:  [new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])],
  // WebP: RIFF at offset 0 AND WEBP at offset 8 — checked together, not as alternatives
  webp: [new Uint8Array([0x52, 0x49, 0x46, 0x46])], // Only RIFF at 0; WEBP@8 verified separately
};

function validateFileMagicBytes(filePath: string, ext: string): boolean {
  const normalExt = ext.toLowerCase();
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, buf, 0, 16, 0);

    if (normalExt === "webp") {
      // WebP requires: bytes 0-3 = RIFF, bytes 8-11 = WEBP
      if (bytesRead < 12) return false;
      const riff = [0x52, 0x49, 0x46, 0x46];
      const webp = [0x57, 0x45, 0x42, 0x50];
      return riff.every((b, i) => buf[i] === b) && webp.every((b, i) => buf[8 + i] === b);
    }

    const signatures = MAGIC_BYTES[normalExt];
    if (!signatures) return true; // Unknown extension — allow (validated by ext filter already)
    if (bytesRead < signatures[0].length) return false;
    for (const sig of signatures) {
      if (sig.length > bytesRead) continue;
      if (sig.every((b, i) => buf[i] === b)) return true;
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
  const docTypeRaw = (input.docType ?? input.doc_type ?? "Other") as unknown as string;
  // Hoisted from further down (was computed again, unchanged, right before the OCR
  // trigger) so the supersede check below and the face-match routing further down
  // share one definition of "this is an identity document" instead of two that could
  // drift apart.
  const docType = String(input.docType ?? input.doc_type ?? "").toLowerCase();
  const isFaceImage = docType.includes("selfie") || docType.includes("live") || docType.includes("photo");
  const isIdImage = docType.includes("aadhaar") || docType.includes("pan");

  // Identity documents are already singular by the app's own logic: triggerFaceMatch
  // picks "the one" Aadhaar/PAN/face image to compare against, with no concept of
  // history. A candidate asked to re-upload a corrected copy (e.g. after the
  // onboarding link is resent) left the old one active too — deleteOnboardingDocument
  // is a separate, explicit action nobody was calling first. Auto-retire the previous
  // active document of the same identity type here, in the same transaction as the
  // new insert, so a candidate is never left with zero active documents of that type
  // if the insert fails. Non-identity types (education certs, experience letters,
  // etc.) are untouched — those can legitimately have more than one active document
  // of the same doc_type, and this never runs for them.
  const supersedesPriorDocument = isFaceImage || isIdImage;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    if (supersedesPriorDocument) {
      await conn.execute(
        `UPDATE candidate_onboarding_document
            SET document_status = 'deleted', deleted_at = NOW(), deleted_by = NULL
          WHERE candidate_id = ? AND LOWER(doc_type) = ? AND deleted_at IS NULL`,
        [candidateId, docType]
      );
    }
    await conn.execute(
      `INSERT INTO candidate_onboarding_document
         (id, candidate_id, doc_type, doc_name, page_no, file_original_name, file_path, file_url, mime_type, file_size_bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        candidateId,
        docTypeRaw,
        input.docName ?? input.doc_name ?? file.originalname,
        (input.pageNo || input.page_no) ? Number(input.pageNo ?? input.page_no) || null : null,
        file.originalname,
        file.path,
        fileUrl,
        file.mimetype,
        file.size,
      ]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  await logCandidateAction(candidateId, "UPLOAD_DOCUMENT", { documentId: id, docType: docTypeRaw }, meta);

  // Async OCR extraction and cross-validation (non-blocking — never delays upload response)
  const isIdentityDoc = docType.includes("aadhaar") || docType.includes("aadhar") || docType.includes("pan") || docType.includes("cheque") || docType.includes("passbook") || docType.includes("bank");
  if (isIdentityDoc && file.mimetype.startsWith("image/")) {
    extractFromDocument(file.path, docType)
      .then(ocrResult => crossValidateDocument(candidateId, id, docType, ocrResult))
      .catch(e => {
        console.error("[OCR] Extraction failed for document", id, ":", e.message);
        db.execute(
          `UPDATE candidate_onboarding_document SET ocr_extraction_status = 'failed' WHERE id = ?`,
          [id]
        ).catch(() => {});
      });
  }

  // Face matching, in whichever order the candidate uploads.
  //
  // This used to fire only on a document typed "selfie" or "live". Production
  // holds 3 such documents against 34 typed "Passport Photo", so for 92% of the
  // face images candidates actually send, no comparison was ever attempted —
  // which is most of why there is not a single photo_match result on record.
  // A passport photo is a photograph of the candidate's face; it is exactly
  // what this check wants.
  //
  // The second call handles the reverse order. The comparison needs a face
  // image and an ID image, and previously only ran if the ID already existed
  // when the face arrived. Which document a candidate uploads first is not
  // something they know matters.
  // (isFaceImage / isIdImage computed earlier, above the supersede transaction.)
  if (file.mimetype.startsWith("image/")) {
    if (isFaceImage) {
      triggerFaceMatch(candidateId, file.path, id).catch(e =>
        console.error("[FaceMatch] Failed for candidate", candidateId, ":", e.message)
      );
    } else if (isIdImage) {
      faceMatchOnIdDocumentUpload(candidateId, id).catch(e =>
        console.error("[FaceMatch] Retry on ID upload failed for candidate", candidateId, ":", e.message)
      );
    }
  }

  return {
    id,
    fileUrl: buildOnboardingDocumentUrl(id, { token }),
    preview_url: buildOnboardingDocumentUrl(id, { token }),
    download_url: buildOnboardingDocumentUrl(id, { token, download: true }),
  };
}

export async function getOnboardingDocument(documentId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT doc.*,
            c.applied_for_branch,
            c.applied_for_process,
            COALESCE(bm.id, emp.branch_id, c.applied_for_branch) AS branch_id_resolved,
            COALESCE(pm.id, c.applied_for_process)               AS process_id_resolved
       FROM candidate_onboarding_document doc
       JOIN ats_candidate c ON c.id = doc.candidate_id
       LEFT JOIN branch_master  bm  ON bm.id = c.applied_for_branch
                                    OR LOWER(bm.branch_name) = LOWER(c.applied_for_branch)
       LEFT JOIN process_master pm  ON pm.id = c.applied_for_process
                                    OR LOWER(pm.process_name) = LOWER(c.applied_for_process)
       LEFT JOIN employees      emp ON emp.employee_code = c.candidate_code
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
    `SELECT c.id,
            c.applied_for_branch,
            c.applied_for_process,
            COALESCE(bm.id, c.applied_for_branch) AS branch_id_resolved,
            COALESCE(pm.id, c.applied_for_process) AS process_id_resolved
       FROM ats_candidate c
       LEFT JOIN branch_master  bm ON bm.id = c.applied_for_branch
                                   OR LOWER(bm.branch_name) = LOWER(c.applied_for_branch)
       LEFT JOIN process_master pm ON pm.id = c.applied_for_process
                                   OR LOWER(pm.process_name) = LOWER(c.applied_for_process)
       WHERE c.id = ?
      LIMIT 1`,
    [candidateId]
  );
  return (rows as RowDataPacket[])[0] ?? null;
}

export async function listFullOnboardingRequests(scopeFilter?: OnboardingScopeFilter) {
  const whereSql = scopeFilter?.sql ? `WHERE (${normalizeCandidateScopeSql(scopeFilter.sql)})` : "";
  const params = scopeFilter?.params ?? [];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT req.id, req.status, req.candidate_id,
            req.created_at, req.updated_at,
            p.profile_status, p.reviewed_at,
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
       LEFT JOIN branch_master br_scope
         ON br_scope.id = c.applied_for_branch
         OR br_scope.branch_name = c.applied_for_branch
         OR br_scope.branch_code = c.applied_for_branch
       LEFT JOIN process_master pm_scope
         ON pm_scope.id = c.applied_for_process
         OR pm_scope.process_name = c.applied_for_process
         OR pm_scope.process_code = c.applied_for_process
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
      GROUP BY req.id, req.status, req.candidate_id, req.created_at, req.updated_at,
               p.profile_status, p.reviewed_at,
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
  // Mirrors getFullOnboardingStatus: HR reviewing a candidate must see the same
  // family and language rows the candidate entered, not a blank where they are.
  const [familyMemberRows] = await db.execute<RowDataPacket[]>(`SELECT * FROM candidate_onboarding_family_member WHERE candidate_id = ? ORDER BY created_at ASC`, [candidateId]);
  const [languageRows] = await db.execute<RowDataPacket[]>(`SELECT * FROM candidate_onboarding_language WHERE candidate_id = ? ORDER BY created_at ASC`, [candidateId]);
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
    // Both SELECT *. The documents beside them are already sanitized; these were not.
    profile: stripCryptoPlumbing(profileRows[0] ?? null),
    documents: sanitizedDocuments,
    bank: stripCryptoPlumbing(bankRows[0] ?? null),
    qualifications: qualificationRows,
    family: familyRows[0] ?? null,
    familyMembers: familyMemberRows,
    languages: languageRows,
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
  const profileAllowed = new Set([
    "draft",
    "employee_details_saved",
    "bank_details_saved",
    "statutory_saved",
    "qualifications_saved",
    "experience_saved",
    "family_saved",
    "nominee_saved",
    "language_saved",
    "final_saved",
    "submitted",
    "hr_review",
    "hr_pushback",
    "rejected",
  ]);
  const requestAllowed = new Set([
    "pending",
    "in_progress",
    "approved",
    "selected",
    "onboarding_link_sent",
    "profile_in_progress",
    "profile_submitted",
    "hr_review",
    "hr_pushback",
    "hr_approved",
    "offer_draft",
    "offer_submitted",
    "branch_head_pending",
    "branch_head_approved",
    "payroll_hr_pending",
    "payroll_hr_approved",
    "bgv_pending",
    "bgv_completed",
    "appointment_pending",
    "appointment_sent",
    "appointment_signed",
    "employee_creation_pending",
    "employee_created",
    "onboarded",
    "rejected",
    "cancelled",
    "payroll_pending",
    "payroll_approved",
  ]);
  const candidateAllowed = new Set([
    "registered",
    "selected",
    "onboarding_sent",
    "profile_submitted",
    "onboarded",
    "rejected",
  ]);
  const candidateStatusMap: Record<string, string> = {
    submitted: "profile_submitted",
    profile_in_progress: "onboarding_sent",
    profile_submitted: "profile_submitted",
    hr_review: "profile_submitted",
    hr_pushback: "profile_submitted",
    hr_approved: "profile_submitted",
    payroll_hr_approved: "profile_submitted",
    employee_created: "onboarded",
    onboarded: "onboarded",
    rejected: "rejected",
  };
  const profileStatusMap: Record<string, string> = {
    hr_approved: "submitted",
    payroll_hr_approved: "submitted",
    employee_created: "submitted",
    onboarded: "submitted",
  };
  const mappedProfileStatus = profileStatusMap[profileStatus] ?? profileStatus;
  const safeProfileStatus = profileAllowed.has(mappedProfileStatus) ? mappedProfileStatus : "submitted";
  const safeRequestStatus = requestAllowed.has(requestStatus) ? requestStatus : "profile_submitted";
  const mappedCandidateStatus = candidateStatusMap[candidateProfileStatus] ?? candidateProfileStatus;
  const safeCandidateStatus = candidateAllowed.has(mappedCandidateStatus) ? mappedCandidateStatus : "profile_submitted";

  await db.execute(
    `UPDATE ats_candidate SET profile_status = ?, status = ?, updated_at = NOW() WHERE id = ?`,
    [safeCandidateStatus, safeRequestStatus, candidateId]
  );
  const [reqResult] = await db.execute<ResultSetHeader>(
    `UPDATE ats_onboarding_request SET status = ?, updated_at = NOW() WHERE candidate_id = ?`,
    [safeRequestStatus, candidateId]
  );
  if (reqResult.affectedRows === 0) {
    // No ats_onboarding_request row exists (candidate's link was sent via a legacy path that skipped row creation).
    // Create it now so all downstream HR views can track this candidate correctly.
    await db.execute(
      `INSERT INTO ats_onboarding_request (id, candidate_id, status, created_at, updated_at)
       VALUES (UUID(), ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE status = VALUES(status), updated_at = NOW()`,
      [candidateId, safeRequestStatus]
    );
  }
  await db.execute(
    `UPDATE candidate_onboarding_profile SET profile_status = ?, updated_at = NOW() WHERE candidate_id = ?`,
    [safeProfileStatus, candidateId]
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
    const result = await withProviderFailureLogged(
      { candidateId, endpointKey: "DIGILOCKER_INITIATE", providerKey: "luckpay",
        actorType: actor?.initiatedByType ?? null, actorId: actor?.initiatedBy ?? null },
      () => luckpayClient.initiateDigilockerWithUrl(requestPayload),
    );
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

export async function initiateCandidateESignByToken(token: string, documentId: string) {
  const tokenData = await validateOnboardingToken(token);
  const candidateId = String(tokenData.candidate_id);

  // Fetch document from candidate_onboarding_document
  const [docRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, doc_name, file_path FROM candidate_onboarding_document WHERE id = ? AND candidate_id = ? LIMIT 1`,
    [documentId, candidateId]
  );
  if (!docRows.length) throw Object.assign(new Error("Document not found"), { statusCode: 404 });
  const doc = docRows[0];

  // Read file buffer
  const fs = await import("fs/promises");
  const filePath = resolveOnboardingDocumentFile(doc.file_path);
  if (!filePath) {
    throw Object.assign(new Error("Document file is not available on this server"), { statusCode: 409 });
  }
  const documentBuffer = await fs.readFile(filePath);

  // Get candidate details
  const [candidateRows] = await db.execute<RowDataPacket[]>(
    `SELECT full_name, applied_for_branch FROM ats_candidate WHERE id = ? LIMIT 1`,
    [candidateId]
  );
  const candidate = candidateRows[0];
  if (!candidate) throw Object.assign(new Error("Candidate not found"), { statusCode: 404 });

  // Get branch name
  const [branchRows] = await db.execute<RowDataPacket[]>(
    `SELECT branch_name FROM branch_master WHERE id = ? LIMIT 1`,
    [candidate.applied_for_branch]
  );
  const branchName = branchRows[0]?.branch_name ?? "India";

  // Initiate e-Sign via BGV provider
  const adapter = await getConfiguredBgvProviderAdapter();
  if (!adapter.initiateESign) {
    throw Object.assign(new Error("e-Sign not supported by current BGV provider"), { statusCode: 501 });
  }

  const session = await adapter.initiateESign({
    candidateId,
    documentBuffer,
    documentName: String(doc.doc_name ?? "document.pdf"),
    signedBy: String(candidate.full_name ?? "Candidate"),
    location: branchName,
    reason: "Digital Signature for Employment Document",
  });

  // Store e-sign session
  await db.execute(
    `INSERT INTO candidate_digilocker_session
       (id, candidate_id, state_token, provider_key, auth_url, session_status, requested_documents_json, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, 'luckpay_esign', ?, 'created', ?, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       state_token = VALUES(state_token),
       auth_url = VALUES(auth_url),
       session_status = VALUES(session_status),
       expires_at = VALUES(expires_at),
       updated_at = NOW()`,
    [
      randomUUID(),
      candidateId,
      session.state,
      session.authUrl,
      JSON.stringify({ documentId, documentName: doc.doc_name }),
      session.expiresAt,
    ]
  );

  return {
    authUrl: session.authUrl,
    state: session.state,
    expiresAt: session.expiresAt,
    requestId: session.requestId,
  };
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
    const result = await withProviderFailureLogged(
      { candidateId, endpointKey: "ESIGN_INITIATE", providerKey: "luckpay" },
      () => luckpayClient.initiateEsignWithUrl({
        filePath: source.filePath,
        request: requestPayload,
      }),
    );
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

/**
 * The member's family, as declared for EPF Form 2 Part B (Pension Scheme).
 *
 * Part B asks the member to list their family; it is not derivable from the PF
 * nominee, and inventing one there would be a false statutory declaration. So
 * the candidate supplies it here and the form fills from what they wrote.
 *
 * `address` and `isEpsNominee` arrive with migration 428. The EPS block on the
 * form is a fallback for a member with no eligible family, so it is a flag on a
 * row rather than a second table: a flagged row renders into eps_nominee.*, the
 * rest into family_1..4.
 */
export async function saveFamilyMembers(
  token: string,
  members: Array<{
    memberName?: string;
    relation?: string;
    dob?: string;
    address?: string;
    occupation?: string;
    isDependent?: boolean;
    isEpsNominee?: boolean;
  }>
) {
  const { candidate_id } = await validateOnboardingToken(token);
  if (!Array.isArray(members)) throw Object.assign(new Error("members must be an array"), { statusCode: 400 });
  // A row with no name is not a family member. saveLanguages already skips its
  // blank drafts; this writer did not, so an untouched draft row was stored as
  // an all-NULL family member and would have printed an empty Part B line.
  const rows = members.filter((m) => nonEmptyString(m.memberName));
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`DELETE FROM candidate_onboarding_family_member WHERE candidate_id = ?`, [candidate_id]);
    for (const m of rows) {
      await conn.execute(
        `INSERT INTO candidate_onboarding_family_member
           (id, candidate_id, member_name, relation, dob, address, occupation, is_dependent, is_eps_nominee)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          candidate_id,
          nonEmptyString(m.memberName),
          nonEmptyString(m.relation),
          // normDate, not the raw value: a cleared date input posts '' which is
          // not a valid DATE and lands as 0000-00-00 under a lax sql_mode.
          normDate(m.dob),
          nonEmptyString(m.address),
          nonEmptyString(m.occupation),
          m.isDependent ? 1 : 0,
          m.isEpsNominee ? 1 : 0,
        ]
      );
    }
    await conn.commit();
    return { candidateId: candidate_id, inserted: rows.length, skipped: members.length - rows.length };
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
