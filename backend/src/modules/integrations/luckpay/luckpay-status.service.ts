/**
 * Luckpay completion half: status reconciliation and document retrieval.
 *
 * verifyDigilockerWithURL / eSignWithURL only *start* a provider-hosted flow and
 * hand back a redirect URL. Nothing tells us the candidate finished, and the
 * documents are not pushed to us. These functions close that loop by polling
 * checkKycStatus / checkESignStatus and pulling the artefacts down once the
 * provider reports success.
 *
 * Pull-based on purpose: the DigiLocker callback route is unauthenticated and
 * only fires if Luckpay chooses to call it, so it cannot be the source of truth.
 */
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import { luckpayClient, type LuckpayStatusResult, type LuckpayDocumentResult } from "./luckpay.client.js";
import { sanitizeProviderPayload } from "./luckpay.transport.js";

/** Same private (never web-served) location the onboarding uploader writes to. */
const STORAGE_DIR = path.resolve(process.cwd(), "private-storage/onboarding-documents");

export type SyncOutcome = {
  state: LuckpayStatusResult["state"] | "not_started";
  providerStatus?: string | null;
  clientTransactionId?: string | null;
  transactionId?: string | null;
  message?: string | null;
  /** Paths of documents newly persisted by this call. */
  storedFiles?: string[];
  /** True when this call transitioned the record to a terminal state. */
  changed?: boolean;
};

function extensionFor(doc: LuckpayDocumentResult, fallback: string) {
  const fromName = doc.fileName ? path.extname(doc.fileName).toLowerCase() : "";
  if (fromName) return fromName;
  const ct = (doc.contentType ?? "").toLowerCase();
  if (ct.includes("pdf")) return ".pdf";
  if (ct.includes("png")) return ".png";
  if (ct.includes("jpeg") || ct.includes("jpg")) return ".jpg";
  if (ct.includes("xml")) return ".xml";
  if (ct.includes("zip")) return ".zip";
  return fallback;
}

/** Writes provider bytes to private storage. Returns the absolute path, or null when nothing inline was returned. */
async function persistDocument(doc: LuckpayDocumentResult, fallbackExt: string): Promise<string | null> {
  if (!doc.buffer?.length) return null;
  await fs.promises.mkdir(STORAGE_DIR, { recursive: true });
  const filePath = path.join(STORAGE_DIR, `${randomUUID()}${extensionFor(doc, fallbackExt)}`);
  await fs.promises.writeFile(filePath, doc.buffer);
  return filePath;
}

async function updateProviderLog(params: {
  clientTransactionId: string;
  status: string;
  providerReferenceId?: string | null;
  responsePayload?: unknown;
  errorMessage?: string | null;
}) {
  await db.execute(
    `UPDATE ats_provider_transaction_log
        SET status = ?,
            provider_reference_id = COALESCE(?, provider_reference_id),
            response_payload = COALESCE(CAST(? AS JSON), response_payload),
            error_message = ?,
            updated_at = NOW()
      WHERE provider = 'luckpay' AND client_transaction_id = ?`,
    [
      params.status,
      params.providerReferenceId ?? null,
      params.responsePayload === undefined ? null : JSON.stringify(sanitizeProviderPayload(params.responsePayload)),
      params.errorMessage ?? null,
      params.clientTransactionId,
    ],
  );
}

/**
 * Reconcile the candidate's most recent DigiLocker session against Luckpay and,
 * on success, download and store the KYC documents.
 */
export async function syncDigilockerStatus(candidateId: string): Promise<SyncOutcome> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT client_transaction_id, provider_reference_id, status
       FROM ats_provider_transaction_log
      WHERE candidate_id = ? AND provider = 'luckpay' AND service_type = 'digilocker'
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1`,
    [candidateId],
  );
  const row = (rows as RowDataPacket[])[0];
  if (!row) return { state: "not_started" };

  const clientTransactionId = String(row.client_transaction_id ?? "");
  const transactionId = String(row.provider_reference_id ?? "");
  // Without the provider's transactionId there is nothing to poll — the
  // initiate call never came back successfully.
  if (!clientTransactionId || !transactionId) {
    return { state: "not_started", clientTransactionId: clientTransactionId || null, message: "No provider transaction id recorded" };
  }
  if (["documents_received", "completed"].includes(String(row.status ?? ""))) {
    return { state: "completed", clientTransactionId, transactionId, changed: false };
  }

  const status = await luckpayClient.checkKycStatus({ clientTransactionId, transactionId });

  if (status.state !== "completed") {
    await updateProviderLog({
      clientTransactionId,
      status: status.state,
      providerReferenceId: status.transactionId,
      responsePayload: status.sanitized,
      errorMessage: status.state === "failed" ? status.message : null,
    });
    return { state: status.state, providerStatus: status.providerStatus, clientTransactionId, transactionId, message: status.message, changed: true };
  }

  const storedFiles: string[] = [];
  let documentMeta: Record<string, unknown> = {};
  try {
    const doc = await luckpayClient.downloadKycDocument({ clientTransactionId, transactionId });
    const stored = await persistDocument(doc, ".pdf");
    if (stored) storedFiles.push(stored);
    documentMeta = { documentUrl: doc.url, fileName: doc.fileName, contentType: doc.contentType, stored: Boolean(stored) };
  } catch (error) {
    // The session genuinely completed; a download failure must not erase that.
    // Record it and let a later retry pick the documents up.
    documentMeta = { downloadError: String((error as Error)?.message ?? error) };
  }

  await db.execute(
    `UPDATE candidate_digilocker_session
        SET session_status = 'completed',
            fetched_documents_json = CAST(? AS JSON),
            completed_at = NOW(),
            updated_at = NOW()
      WHERE candidate_id = ? AND state_token = ?`,
    [JSON.stringify({ files: storedFiles, ...documentMeta }), candidateId, clientTransactionId],
  ).catch(() => undefined);

  await updateProviderLog({
    clientTransactionId,
    status: "documents_received",
    providerReferenceId: status.transactionId,
    responsePayload: { ...status.sanitized, ...documentMeta },
  });

  return {
    state: "completed",
    providerStatus: status.providerStatus,
    clientTransactionId,
    transactionId,
    message: status.message,
    storedFiles,
    changed: true,
  };
}

/**
 * Reconcile a joining-document eSign transaction against Luckpay and, on
 * success, download the signed PDF and attach it to the checklist item.
 */
export async function syncEsignStatus(clientTransactionId: string): Promise<SyncOutcome> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, checklist_id, employee_id, candidate_id, document_code,
            client_transaction_id, provider_reference_id, status
       FROM employee_document_esign_transaction
      WHERE provider = 'luckpay' AND client_transaction_id = ?
      LIMIT 1`,
    [clientTransactionId],
  );
  const row = (rows as RowDataPacket[])[0];
  if (!row) return { state: "not_started", message: "No eSign transaction found" };

  const transactionId = String(row.provider_reference_id ?? "");
  if (!transactionId) {
    return { state: "not_started", clientTransactionId, message: "No provider transaction id recorded" };
  }
  if (["signed", "completed"].includes(String(row.status ?? ""))) {
    return { state: "completed", clientTransactionId, transactionId, changed: false };
  }

  const status = await luckpayClient.checkESignStatus({ clientTransactionId, transactionId });

  if (status.state !== "completed") {
    await db.execute(
      `UPDATE employee_document_esign_transaction
          SET status = ?, response_payload = CAST(? AS JSON), error_message = ?, updated_at = NOW()
        WHERE id = ?`,
      [status.state, JSON.stringify(status.sanitized), status.state === "failed" ? status.message : null, row.id],
    );
    return { state: status.state, providerStatus: status.providerStatus, clientTransactionId, transactionId, message: status.message, changed: true };
  }

  const storedFiles: string[] = [];
  let documentMeta: Record<string, unknown> = {};
  let signedFileId: string | null = null;
  try {
    const doc = await luckpayClient.downloadESignDocument({ clientTransactionId, transactionId });
    const stored = await persistDocument(doc, ".pdf");
    if (stored) {
      storedFiles.push(stored);
      const newFileId = randomUUID();
      await db.execute(
        `INSERT INTO employee_joining_document_file
           (id, checklist_id, employee_id, candidate_id, document_code, file_role,
            original_filename, stored_filename, storage_path, mime_type, file_size_bytes,
            uploaded_by_type, uploaded_at)
         VALUES (?, ?, ?, ?, ?, 'signed', ?, ?, ?, ?, ?, 'system', NOW())`,
        [
          newFileId,
          row.checklist_id,
          row.employee_id,
          row.candidate_id ?? null,
          row.document_code,
          doc.fileName ?? path.basename(stored),
          path.basename(stored),
          stored,
          doc.contentType ?? "application/pdf",
          doc.buffer?.length ?? null,
        ],
      );
      signedFileId = newFileId;
    }
    documentMeta = { documentUrl: doc.url, fileName: doc.fileName, contentType: doc.contentType, stored: Boolean(stored) };
  } catch (error) {
    documentMeta = { downloadError: String((error as Error)?.message ?? error) };
  }

  await db.execute(
    `UPDATE employee_document_esign_transaction
        SET status = 'signed',
            response_payload = CAST(? AS JSON),
            signed_file_id = COALESCE(?, signed_file_id),
            error_message = NULL,
            completed_at = NOW(),
            updated_at = NOW()
      WHERE id = ?`,
    [JSON.stringify(sanitizeProviderPayload({ ...status.sanitized, ...documentMeta })), signedFileId, row.id],
  );

  await db.execute(
    `UPDATE employee_joining_document_checklist
        SET status = 'esign_completed', updated_at = NOW()
      WHERE id = ?`,
    [row.checklist_id],
  ).catch(() => undefined);

  return {
    state: "completed",
    providerStatus: status.providerStatus,
    clientTransactionId,
    transactionId,
    message: status.message,
    storedFiles,
    changed: true,
  };
}
