/**
 * Copies a converted candidate's uploaded onboarding documents (Aadhaar,
 * Address Proof, marksheets, etc. — everything except the Live Selfie, which
 * `employee-creation-orchestrator.service.ts` already promotes separately to
 * `employees.avatar_url`) into `employee_documents`, the table the employee
 * Documents tab (`StepDocuments` in EmployeeProfileCompletion.tsx) actually
 * reads.
 *
 * Before this existed, candidate_onboarding_document rows were never copied
 * anywhere at conversion, so every new employee's Documents tab showed "Not
 * uploaded" for documents the candidate genuinely submitted — confirmed live
 * for MAS63440 (Passport Photo, 10th/12th Marksheet, Address Proof uploaded
 * as a candidate on 2026-08-26, still zero rows in employee_documents after
 * conversion on 2026-08-31). See scripts/backfill-employee-documents-from-
 * candidate-onboarding.mjs for repairing employees converted before this fix.
 *
 * A document row is only copied when its file is still readable on disk
 * (resolveOnboardingDocumentFile) — a known, separate class of rows exists
 * where the candidate's file itself was lost (see onboardingDocumentPath.ts);
 * those cannot be "shown" without literally asking the candidate to re-upload.
 */

import { randomUUID, createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { resolveOnboardingDocumentFile } from '../ats/onboardingDocumentPath.js';
import { registerUpload } from '../document-vault/documentVault.service.js';

// Mirrors employee.documents.routes.ts's multer destination exactly, so the
// existing GET /api/employee-docs/:employeeId/:docId/download route (which
// hardcodes this directory) finds the file with no changes to that route.
const EMPLOYEE_DOCS_DIR = path.resolve(process.cwd(), 'uploads', 'employee-documents');

// Live Selfie is promoted separately to the avatar photo, not into
// employee_documents — skip it here so it is never double-handled.
const SKIP_DOC_TYPES = new Set(['Live Selfie']);

export interface DocumentPromotionResult {
  promoted: number;
  skippedFileMissing: number;
  skippedAlreadyPresent: number;
}

export async function promoteCandidateDocumentsToEmployee(
  employeeId: string,
  candidateId: string,
  actorUserId: string,
): Promise<DocumentPromotionResult> {
  const result: DocumentPromotionResult = { promoted: 0, skippedFileMissing: 0, skippedAlreadyPresent: 0 };
  if (!candidateId) return result;

  const [candidateDocs] = await db.execute<RowDataPacket[]>(
    `SELECT id, doc_type, doc_name, file_path, file_url, mime_type, file_size_bytes
       FROM candidate_onboarding_document
      WHERE candidate_id = ? AND deleted_at IS NULL`,
    [candidateId],
  );

  if (!candidateDocs.length) return result;

  const [existingRows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT doc_type FROM employee_documents WHERE employee_id = ?`,
    [employeeId],
  );
  const alreadyPresent = new Set(existingRows.map((r) => String(r.doc_type)));

  fs.mkdirSync(EMPLOYEE_DOCS_DIR, { recursive: true });

  for (const doc of candidateDocs) {
    const docType = String(doc.doc_type ?? '');
    if (!docType || SKIP_DOC_TYPES.has(docType)) continue;

    if (alreadyPresent.has(docType)) {
      result.skippedAlreadyPresent += 1;
      continue;
    }

    const sourcePath = resolveOnboardingDocumentFile(doc.file_path ?? doc.file_url);
    if (!sourcePath) {
      result.skippedFileMissing += 1;
      console.warn(
        `[CandidateDocumentPromotion] File missing on disk for candidate ${candidateId}, doc_type "${docType}" — not copied to employee ${employeeId}.`,
      );
      continue;
    }

    const ext = path.extname(sourcePath) || path.extname(String(doc.file_url ?? '')) || '';
    const storedFilename = `${randomUUID()}${ext}`;
    const destPath = path.join(EMPLOYEE_DOCS_DIR, storedFilename);

    const fileBuffer = fs.readFileSync(sourcePath);
    fs.writeFileSync(destPath, fileBuffer);

    const sha256 = createHash('sha256').update(fileBuffer).digest('hex');
    await registerUpload({
      uploadedByUser: actorUserId,
      category: 'employee-documents',
      storedFilename,
      originalFilename: path.basename(sourcePath),
      mimeType: doc.mime_type ? String(doc.mime_type) : undefined,
      fileSizeBytes: doc.file_size_bytes != null ? Number(doc.file_size_bytes) : fileBuffer.length,
      sha256Hash: sha256,
      accessLevel: 'pii',
      ownerEmployeeId: employeeId,
    });

    const fileUrl = `/api/files/employee-documents/${storedFilename}`;
    await db.execute(
      `INSERT INTO employee_documents (id, employee_id, doc_type, doc_name, file_url, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [randomUUID(), employeeId, docType, doc.doc_name ?? docType, fileUrl, actorUserId],
    );

    alreadyPresent.add(docType);
    result.promoted += 1;
  }

  return result;
}
