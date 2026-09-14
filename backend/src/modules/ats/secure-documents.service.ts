import fs from "fs";
import path from "path";
import type { RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { resolveOnboardingDocumentFile } from "./onboardingDocumentPath.js";

export type CandidateDocument = {
  id: string;
  source: "onboarding" | "portal";
  candidate_id: string;
  document_type: string;
  document_name: string;
  file_name: string;
  mime_type: string | null;
  file_size: number | null;
  verification_status: string;
  mandatory_flag: number;
  sensitive_flag: number;
  name_match_status: string;
  uploaded_at: string | Date | null;
  raw_path: string | null;
  raw_url: string | null;
};

function categoryOf(type: string): string {
  const normalized = type.toLowerCase();
  if (/(aadhaar|aadhar|pan|identity|id)/.test(normalized)) return "identity";
  if (/(bank|cheque|passbook)/.test(normalized)) return "bank";
  if (/(epf|uan|pf|esi|statutory)/.test(normalized)) return "statutory";
  if (/(degree|education|certificate|marksheet)/.test(normalized)) return "education";
  if (/(experience|relieving|salary slip|payslip)/.test(normalized)) return "experience";
  return "general";
}

function maskName(name: string): string {
  if (name.length <= 10) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > -1 ? name.slice(dot) : "";
  return `${name.slice(0, 4)}...${ext}`;
}

export function secureDocumentUrl(documentId: string, action: "stream" | "download" | "metadata" = "stream"): string {
  return `/api/ats/documents/${documentId}/${action}`;
}

async function auditDocumentAccess(
  document: CandidateDocument,
  actorId: string | null,
  accessType: string,
  outcome: "allowed" | "denied",
  meta?: { ip?: string; userAgent?: string },
) {
  await db.execute(
    `INSERT INTO candidate_document_access_log
       (id, document_id, candidate_id, actor_id, access_type, purpose_code, ip_address, user_agent, outcome)
     VALUES (UUID(), ?, ?, ?, ?, 'document_review', ?, ?, ?)`,
    [document.id, document.candidate_id, actorId, accessType, meta?.ip || null, meta?.userAgent || null, outcome],
  );
}

export async function listCandidateDocuments(candidateId: string, actorId: string | null, meta?: { ip?: string; userAgent?: string }) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM (
       SELECT
         id,
         'onboarding' AS source,
         candidate_id,
         doc_type AS document_type,
         COALESCE(doc_name, file_original_name, doc_type) AS document_name,
         COALESCE(file_original_name, doc_name, doc_type) AS file_name,
         mime_type,
         file_size_bytes AS file_size,
         document_status AS verification_status,
         1 AS mandatory_flag,
         1 AS sensitive_flag,
         COALESCE(name_match_status, 'pending') AS name_match_status,
         uploaded_at,
         file_path AS raw_path,
         file_url AS raw_url
       FROM candidate_onboarding_document
       WHERE candidate_id = ? AND deleted_at IS NULL
       UNION ALL
       SELECT
         id,
         'portal' AS source,
         candidate_id,
         document_type,
         COALESCE(file_name, document_type) AS document_name,
         file_name,
         file_mime_type AS mime_type,
         file_size,
         verification_status,
         mandatory_flag,
         sensitive_flag,
         name_match_status,
         uploaded_at,
         NULL AS raw_path,
         file_url AS raw_url
       FROM ats_candidate_documents
       WHERE candidate_id = ?
     ) docs
     ORDER BY uploaded_at DESC`,
    [candidateId, candidateId],
  );
  const docs = rows.map((row) => normalizeDocument(row));
  await Promise.all(docs.map((doc) => auditDocumentAccess(doc, actorId, "list", "allowed", meta)));
  return docs.map(publicDocument);
}

function normalizeDocument(row: RowDataPacket): CandidateDocument {
  return {
    id: String(row.id),
    source: row.source === "portal" ? "portal" : "onboarding",
    candidate_id: String(row.candidate_id),
    document_type: String(row.document_type || "Other"),
    document_name: String(row.document_name || row.file_name || row.document_type || "Document"),
    file_name: String(row.file_name || row.document_name || "document"),
    mime_type: row.mime_type ? String(row.mime_type) : null,
    file_size: row.file_size == null ? null : Number(row.file_size),
    verification_status: String(row.verification_status || "pending"),
    mandatory_flag: Number(row.mandatory_flag || 0),
    sensitive_flag: Number(row.sensitive_flag || 0),
    name_match_status: String(row.name_match_status || "pending"),
    uploaded_at: row.uploaded_at ?? null,
    raw_path: row.raw_path ? String(row.raw_path) : null,
    raw_url: row.raw_url ? String(row.raw_url) : null,
  };
}

function publicDocument(document: CandidateDocument) {
  const category = categoryOf(document.document_type);
  return {
    id: document.id,
    source: document.source,
    candidate_id: document.candidate_id,
    document_type: document.document_type,
    document_category: category,
    document_name: document.sensitive_flag ? maskName(document.document_name) : document.document_name,
    file_name: document.sensitive_flag ? maskName(document.file_name) : document.file_name,
    mime_type: document.mime_type,
    file_size: document.file_size,
    verification_status: document.verification_status,
    mandatory_flag: Boolean(document.mandatory_flag),
    sensitive_flag: Boolean(document.sensitive_flag),
    name_match_status: document.name_match_status,
    uploaded_at: document.uploaded_at,
    preview_url: secureDocumentUrl(document.id, "stream"),
    download_url: secureDocumentUrl(document.id, "download"),
  };
}

export async function getCandidateDocument(documentId: string): Promise<CandidateDocument | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM (
       SELECT
         id,
         'onboarding' AS source,
         candidate_id,
         doc_type AS document_type,
         COALESCE(doc_name, file_original_name, doc_type) AS document_name,
         COALESCE(file_original_name, doc_name, doc_type) AS file_name,
         mime_type,
         file_size_bytes AS file_size,
         document_status AS verification_status,
         1 AS mandatory_flag,
         1 AS sensitive_flag,
         COALESCE(name_match_status, 'pending') AS name_match_status,
         uploaded_at,
         file_path AS raw_path,
         file_url AS raw_url
       FROM candidate_onboarding_document
       WHERE id = ? AND deleted_at IS NULL
       UNION ALL
       SELECT
         id,
         'portal' AS source,
         candidate_id,
         document_type,
         COALESCE(file_name, document_type) AS document_name,
         file_name,
         file_mime_type AS mime_type,
         file_size,
         verification_status,
         mandatory_flag,
         sensitive_flag,
         name_match_status,
         uploaded_at,
         NULL AS raw_path,
         file_url AS raw_url
       FROM ats_candidate_documents
       WHERE id = ?
     ) docs
     LIMIT 1`,
    [documentId, documentId],
  );
  return rows[0] ? normalizeDocument(rows[0]) : null;
}

export async function getDocumentMetadata(documentId: string, actorId: string | null, meta?: { ip?: string; userAgent?: string }) {
  const document = await getCandidateDocument(documentId);
  if (!document) throw Object.assign(new Error("Document not found"), { statusCode: 404 });
  await auditDocumentAccess(document, actorId, "metadata", "allowed", meta);
  return publicDocument(document);
}

export async function getDocumentAudit(documentId: string, actorId: string | null, meta?: { ip?: string; userAgent?: string }) {
  const document = await getCandidateDocument(documentId);
  if (!document) throw Object.assign(new Error("Document not found"), { statusCode: 404 });
  await auditDocumentAccess(document, actorId, "audit", "allowed", meta);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT access_type, actor_id, outcome, ip_address, created_at
       FROM candidate_document_access_log
      WHERE document_id = ?
      ORDER BY created_at DESC
      LIMIT 100`,
    [documentId],
  );
  return rows;
}

export function resolveDocumentPath(document: CandidateDocument): string {
  const raw = document.raw_path || document.raw_url || "";
  if (!raw) throw Object.assign(new Error("Document file path is missing"), { statusCode: 404 });

  // Onboarding documents record an absolute file_path, so the stored value depends on
  // which machine and working directory wrote it. Verified live 2026-08-16: 25 of 470
  // candidate_onboarding_document rows hold a foreign path — 22 Windows, 3 POSIX.
  //
  // The branch below cannot cope with the Windows ones on a Linux server, and fails in
  // the least obvious way: path.isAbsolute() is platform-specific, so on Linux
  // "C:\Users\ADMIN\..." is NOT absolute (a backslash is an ordinary filename character
  // there). It therefore falls through to the relative branch and resolves to
  // <cwd>/C:\Users\ADMIN\..., which can never exist — the caller then reports
  // "Document file is not available on server" for a file that is present on disk.
  //
  // resolveOnboardingDocumentFile already solves exactly this and is used by
  // onboarding-full.{routes,service}.ts; this reader was simply never switched over to
  // it. Applied only to the onboarding source: portal documents come from
  // ats_candidate_documents, whose raw_path is always NULL, so they carry a URL through
  // raw_url and must keep the original handling.
  if (document.source === "onboarding") {
    const resolved = resolveOnboardingDocumentFile(raw);
    if (resolved) return resolved;
    // Fall through when nothing readable is found, so a genuinely missing file still
    // produces the existing 404 rather than a different error.
  }

  if (path.isAbsolute(raw)) return raw;
  const cleaned = raw.replace(/^[/\\]+/, "");
  return path.resolve(process.cwd(), cleaned);
}

export async function getDocumentFile(documentId: string, actorId: string | null, accessType: "stream" | "download", meta?: { ip?: string; userAgent?: string }) {
  const document = await getCandidateDocument(documentId);
  if (!document) throw Object.assign(new Error("Document not found"), { statusCode: 404 });
  const filePath = resolveDocumentPath(document);
  if (!fs.existsSync(filePath)) {
    await auditDocumentAccess(document, actorId, accessType, "denied", meta);
    throw Object.assign(new Error("Document file is not available on server"), { statusCode: 404 });
  }
  await auditDocumentAccess(document, actorId, accessType, "allowed", meta);
  return { document, filePath };
}

export async function verifyCandidateDocument(documentId: string, actorId: string, remarks?: string) {
  const document = await getCandidateDocument(documentId);
  if (!document) throw Object.assign(new Error("Document not found"), { statusCode: 404 });
  if (document.source === "onboarding") {
    await db.execute(
      `UPDATE candidate_onboarding_document
          SET document_status = 'verified', verified_by = ?, verified_at = NOW(), verification_remarks = ?
        WHERE id = ?`,
      [actorId, remarks || null, documentId],
    );
  } else {
    await db.execute(
      `UPDATE ats_candidate_documents
          SET verification_status = 'verified', verified_by = ?, verified_at = NOW(), rejection_reason = NULL
        WHERE id = ?`,
      [actorId, documentId],
    );
  }
  await auditDocumentAccess(document, actorId, "verify", "allowed");
  // Verifying the marksheet is what "education verified" means, so let it reach
  // the BGV report. Without this the two halves never met: 118 candidates had
  // uploaded a degree or marksheet while 117 of their reports still read
  // education_status = 'not_run', which held every appointment letter behind a
  // check whose evidence was already on file.
  if (categoryOf(document.document_type) === "education") {
    await syncEducationStatusFromDocuments(document.candidate_id).catch((err: unknown) => {
      // Never fail the verification itself over the derived status — the document
      // is verified either way, and this can be re-derived by verifying another.
      console.error("[secure-documents] education BGV sync failed:", (err as Error).message);
    });
  }
  return getDocumentMetadata(documentId, actorId);
}

/**
 * Re-derive candidate_bgv_report.education_status from the education documents
 * actually on file, then let computeAndSaveScore re-derive the overall verdict.
 *
 * Mechanical, not a judgement: every education document verified means 'passed',
 * some means 'partial', none leaves the column alone. A human-set 'failed' is
 * never overwritten — an HR rejection outranks a document count — and 'passed' is
 * never walked back to 'partial' for the same reason.
 *
 * Scoped to the onboarding store. Portal uploads live in ats_candidate_documents,
 * which holds no rows on live data; if that changes this needs to count both.
 */
async function syncEducationStatusFromDocuments(candidateId: string): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT doc_type, document_status
       FROM candidate_onboarding_document
      WHERE candidate_id = ? AND deleted_at IS NULL`,
    [candidateId],
  );
  const educationDocs = (rows as Array<{ doc_type: string; document_status: string }>)
    .filter((r) => categoryOf(String(r.doc_type ?? "")) === "education");
  if (educationDocs.length === 0) return;

  const verified = educationDocs.filter((r) => String(r.document_status) === "verified").length;
  if (verified === 0) return;
  const next = verified === educationDocs.length ? "passed" : "partial";

  await db.execute(
    `UPDATE candidate_bgv_report
        SET education_status = ?, updated_at = NOW()
      WHERE candidate_id = ?
        AND locked = 0
        AND COALESCE(education_status, '') NOT IN ('failed', 'passed')`,
    [next, candidateId],
  );

  const { computeAndSaveScore } = await import("./bgv-verification.service.js");
  await computeAndSaveScore(candidateId);
}

export async function rejectCandidateDocument(documentId: string, actorId: string, reason: string) {
  const document = await getCandidateDocument(documentId);
  if (!document) throw Object.assign(new Error("Document not found"), { statusCode: 404 });
  if (!reason.trim()) throw Object.assign(new Error("Rejection reason is required"), { statusCode: 400 });
  if (document.source === "onboarding") {
    await db.execute(
      `UPDATE candidate_onboarding_document
          SET document_status = 'rejected', rejected_by = ?, rejected_at = NOW(), rejection_reason = ?
        WHERE id = ?`,
      [actorId, reason, documentId],
    );
  } else {
    await db.execute(
      `UPDATE ats_candidate_documents
          SET verification_status = 'rejected', rejection_reason = ?
        WHERE id = ?`,
      [reason, documentId],
    );
  }
  await auditDocumentAccess(document, actorId, "reject", "allowed");
  return getDocumentMetadata(documentId, actorId);
}

export async function requestDocumentReupload(documentId: string, actorId: string, reason: string, dueAt?: string) {
  const document = await getCandidateDocument(documentId);
  if (!document) throw Object.assign(new Error("Document not found"), { statusCode: 404 });
  if (!reason.trim()) throw Object.assign(new Error("Re-upload reason is required"), { statusCode: 400 });
  await db.execute(
    `INSERT INTO candidate_document_reupload_request
       (id, document_id, candidate_id, requested_by, reason, due_at)
     VALUES (UUID(), ?, ?, ?, ?, ?)`,
    [documentId, document.candidate_id, actorId, reason, dueAt || null],
  );
  await auditDocumentAccess(document, actorId, "request_reupload", "allowed");
  return getDocumentMetadata(documentId, actorId);
}
