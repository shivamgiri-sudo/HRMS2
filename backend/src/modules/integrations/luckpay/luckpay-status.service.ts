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
import { withProviderFailureLogged, writeBgvApiLog } from "../../ats/bgv-api-log.service.js";
import { syncBridgeDigilockerStatus } from "../../ats/onboarding-bridge-status.js";

/** Same private (never web-served) location the onboarding uploader writes to. */
export const STORAGE_DIR = path.resolve(process.cwd(), "private-storage/onboarding-documents");

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

/**
 * Where joining-document artefacts live. Mirrors the layout writeSecureFile uses
 * in employeeJoiningDocuments.service.ts, so a signed file retrieved here is
 * found by the same readers that serve HR-uploaded and generated files.
 */
export function joiningDocumentStorageDir(employeeId: string, documentCode: string) {
  return path.resolve(
    process.cwd(),
    "private-storage/employee-joining-documents",
    employeeId,
    documentCode.toLowerCase(),
    "signed",
  );
}

/** Writes provider bytes to private storage. Returns the absolute path, or null when nothing inline was returned. */
async function persistDocument(
  doc: LuckpayDocumentResult,
  fallbackExt: string,
  targetDir: string = STORAGE_DIR,
): Promise<string | null> {
  if (!doc.buffer?.length) return null;
  await fs.promises.mkdir(targetDir, { recursive: true });
  const filePath = path.join(targetDir, `${randomUUID()}${extensionFor(doc, fallbackExt)}`);
  await fs.promises.writeFile(filePath, doc.buffer);
  return filePath;
}

/**
 * Mirror the DigiLocker outcome into candidate_bgv_check so it reaches the BGV
 * report. Without this the report's digilocker column stays 'not_run' forever,
 * because syncBgvChecksToReport reads exclusively from that table.
 */
async function upsertDigilockerCheck(params: {
  candidateId: string;
  state: LuckpayStatusResult["state"];
  providerRequestId: string;
  providerReferenceId: string;
  summary: string | null;
  raw: unknown;
}) {
  const status =
    params.state === "completed" ? "verified"
    : params.state === "failed" ? "failed"
    : params.state === "expired" ? "failed"
    : "pending";

  await db.execute(
    `INSERT INTO candidate_bgv_check
       (id, candidate_id, check_type, provider_key, provider_request_id, provider_reference_id,
        status, result_summary, result_json, verified_at)
     VALUES (?, ?, 'digilocker', 'luckpay', ?, ?, ?, ?, CAST(? AS JSON), ?)
     ON DUPLICATE KEY UPDATE
       provider_request_id   = VALUES(provider_request_id),
       provider_reference_id = VALUES(provider_reference_id),
       status                = VALUES(status),
       result_summary        = VALUES(result_summary),
       result_json           = VALUES(result_json),
       verified_at           = VALUES(verified_at),
       updated_at            = NOW()`,
    [
      randomUUID(),
      params.candidateId,
      params.providerRequestId,
      params.providerReferenceId,
      status,
      params.summary,
      JSON.stringify(sanitizeProviderPayload(params.raw)),
      status === "verified" ? new Date() : null,
    ],
  ).catch(() => undefined);
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

  // Logged into the same table the BGV API monitor and cost panel read, so
  // DigiLocker stops being invisible there — it previously only ever reached
  // ats_provider_transaction_log.
  const status = await withProviderFailureLogged(
    { candidateId, endpointKey: "DIGILOCKER_STATUS", providerKey: "luckpay" },
    () => luckpayClient.checkKycStatus({ clientTransactionId, transactionId }),
  );
  await writeBgvApiLog({
    candidateId,
    endpointKey: "DIGILOCKER_STATUS",
    providerKey: "luckpay",
    requestRef: transactionId,
    httpStatus: 200,
    outcome: status.state === "completed" ? "success" : status.state === "pending" ? "manual_review" : "provider_error",
    errorMessage: status.state === "failed" || status.state === "expired" ? status.message : null,
    responsePayload: status.sanitized,
  });

  if (status.state !== "completed") {
    await updateProviderLog({
      clientTransactionId,
      status: status.state,
      providerReferenceId: status.transactionId,
      responsePayload: status.sanitized,
      errorMessage: status.state === "failed" ? status.message : null,
    });
    await upsertDigilockerCheck({
      candidateId,
      state: status.state,
      providerRequestId: clientTransactionId,
      providerReferenceId: status.transactionId,
      summary: status.message ?? `DigiLocker: ${status.providerStatus ?? status.state}`,
      raw: status.sanitized,
    });
    return { state: status.state, providerStatus: status.providerStatus, clientTransactionId, transactionId, message: status.message, changed: true };
  }

  const storedFiles: string[] = [];
  let documentMeta: Record<string, unknown> = {};
  try {
    const doc = await withProviderFailureLogged(
      { candidateId, endpointKey: "DIGILOCKER_DOWNLOAD", providerKey: "luckpay" },
      () => luckpayClient.downloadKycDocument({ clientTransactionId, transactionId }),
    );
    const stored = await persistDocument(doc, ".pdf");
    if (stored) storedFiles.push(stored);
    documentMeta = { documentUrl: doc.url, fileName: doc.fileName, contentType: doc.contentType, stored: Boolean(stored) };
  } catch (error) {
    // The session genuinely completed; a download failure must not erase that.
    // Record it and let a later retry pick the documents up.
    documentMeta = { downloadError: String((error as Error)?.message ?? error) };
  }

  await db.execute(
    // The columns here must exist on the table, which is: id, candidate_id,
    // state_token, provider_key, auth_url, session_status,
    // requested_documents_json, returned_documents_json, expires_at,
    // created_at, updated_at.
    //
    // This previously set fetched_documents_json and completed_at — neither of
    // which exists — under a .catch(() => undefined). So every completion write
    // failed silently and no session could ever leave 'created', which is a
    // large part of why DigiLocker appeared to do nothing at all.
    `UPDATE candidate_digilocker_session
        SET session_status = 'completed',
            returned_documents_json = CAST(? AS JSON),
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

  await upsertDigilockerCheck({
    candidateId,
    state: "completed",
    providerRequestId: clientTransactionId,
    providerReferenceId: status.transactionId,
    summary: status.message ?? "DigiLocker KYC completed",
    raw: { ...status.sanitized, ...documentMeta },
  });

  // DigiLocker fetched Aadhaar and PAN from the issuing authority, so mark both
  // verified and stop the paid checks being offered for them.
  //
  // autoCreateDigilockerVerifiedChecks has existed for this since the start —
  // "to avoid redundant separate API calls" — but was only reachable from
  // providerCallback(). This sync path is how a session actually completes, so
  // without this call no candidate has ever had those rows written, and every
  // one of them was billed for a Befisc/Luckpay Aadhaar and PAN check that
  // repeated what the government had already confirmed.
  //
  // Imported dynamically to keep this integration module free of a static edge
  // into modules/ats, matching how the OTP sender and face-match module are
  // loaded elsewhere. Non-fatal: the documents are already fetched and stored by
  // this point, and losing that over a convenience row would be a far worse
  // outcome than the row being missing.
  try {
    const { autoCreateDigilockerVerifiedChecks } = await import("../../ats/bgv-verification.service.js");
    // Only what the session actually returned is credited. documentMeta carries
    // the downloaded file's name, or a downloadError if nothing came back —
    // Aadhaar is evidenced by the session completing at all, PAN only if a PAN
    // document is named. Crediting PAN off an Aadhaar-only pull would skip the
    // paid check that would have caught it.
    // Fill the candidate's blank profile fields from what DigiLocker returned.
    //
    // status.sanitized carries documentList[0] (name, dob, gender, masked
    // Aadhaar) and both address blocks — structured, from the issuing
    // authority. This is the largest single reduction available in
    // form-filling time, and it was sitting in the response all along; the
    // stored PDF is a red herring, its text being a subset font behind a CMap.
    //
    // Blanks only: the candidate may have typed something before connecting,
    // and overwriting what a person entered about themselves is how you get a
    // form nobody trusts.
    try {
      const { extractDigilockerDemographics, applyDigilockerDemographics } =
        await import("../../ats/digilocker-demographics.js");
      const filled = await applyDigilockerDemographics(
        db, candidateId, extractDigilockerDemographics(status.sanitized),
      );
      if (filled.length) {
        console.info(`[DigiLocker] pre-filled ${filled.length} field(s) for ${candidateId}: ${filled.join(", ")}`);
      }
    } catch (error) {
      console.error(`[DigiLocker] demographics pre-fill failed for ${candidateId}:`, (error as Error)?.message);
    }

    await autoCreateDigilockerVerifiedChecks(candidateId, {
      fileName: documentMeta.fileName,
      downloadError: documentMeta.downloadError,
    });
  } catch (error) {
    console.error(
      `[DigiLocker] completed for ${candidateId} but Aadhaar/PAN could not be auto-verified:`,
      (error as Error)?.message,
    );
  }

  // Mirror onto the BGV report immediately so HR sees it without a manual sync.
  await db.execute(
    `UPDATE candidate_bgv_report
        SET digilocker_status = IF(locked = 1, digilocker_status, 'passed'),
            digilocker_documents_json = IF(locked = 1, digilocker_documents_json, CAST(? AS JSON)),
            digilocker_completed_at = IF(locked = 1, digilocker_completed_at, NOW()),
            updated_at = NOW()
      WHERE candidate_id = ?`,
    [JSON.stringify({ count: storedFiles.length, ...documentMeta }), candidateId],
  ).catch(() => undefined);

  // And onto the onboarding bridge, which uses its own vocabulary
  // ('documents_received', not 'passed'). Nothing wrote this column before, so
  // the digilockerDone gate in onboarding-full.service.ts could never open no
  // matter how many candidates finished.
  await syncBridgeDigilockerStatus(db, candidateId, "completed");

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

export type DigilockerFile = {
  /** candidate_digilocker_session.id — stable, globally unique, safe to use anywhere a document id would normally go (e.g. candidate_face_match.id_document_id) since this file has no candidate_onboarding_document row of its own. */
  sessionId: string;
  filePath: string;
  fileName: string;
  contentType: string;
  sessionStatus: string;
  updatedAt: Date | string | null;
};

/**
 * The single downloaded DigiLocker KYC file for a candidate, if one was
 * stored — used by the fraud-comparison panel, which previously had no way
 * to see this at all: DigiLocker completion only ever wrote the file path
 * into candidate_digilocker_session.returned_documents_json, never into
 * candidate_onboarding_document, so nothing downstream could find it.
 *
 * Picks the most recent COMPLETED session with a file actually recorded —
 * a session can be 'completed' with no file (see syncDigilockerStatus's
 * documentMeta.downloadError branch), which this treats the same as no
 * session at all.
 */
export async function getLatestDigilockerFile(candidateId: string): Promise<DigilockerFile | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, session_status, returned_documents_json, updated_at
       FROM candidate_digilocker_session
      WHERE candidate_id = ? AND session_status = 'completed' AND returned_documents_json IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT 1`,
    [candidateId],
  );
  const row = rows[0];
  if (!row) return null;

  try {
    const meta = typeof row.returned_documents_json === "string"
      ? JSON.parse(row.returned_documents_json)
      : row.returned_documents_json;
    const filePath = Array.isArray(meta?.files) ? meta.files[0] : null;
    if (!filePath) return null;
    return {
      sessionId: row.id,
      filePath,
      fileName: typeof meta.fileName === "string" ? meta.fileName : "digilocker-document",
      contentType: typeof meta.contentType === "string" ? meta.contentType : "application/octet-stream",
      sessionStatus: row.session_status,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

/**
 * Reconcile a joining-document eSign transaction against Luckpay and, on
 * success, download the signed PDF and attach it to the checklist item.
 */
export async function syncEsignStatus(clientTransactionId: string): Promise<SyncOutcome> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, checklist_id, employee_id, candidate_id, document_code,
            client_transaction_id, provider_reference_id, status, signed_file_id,
            scope, kit_id
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
  // Short-circuit only when the artefact is genuinely in hand. Returning early on
  // status alone left every 'signed but signed_file_id IS NULL' row permanently
  // unrecoverable — exactly the state the identifier bug created, and the state a
  // failed download creates. Those rows must be able to heal on a later pass.
  if (["signed", "completed"].includes(String(row.status ?? "")) && row.signed_file_id) {
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

  // Kit transactions cover several documents under one signature. Delegate to
  // finalizeKitEsign which closes ALL member checklists, sets the kit row to
  // 'signed', clears open_marker, and consumes the token by kit_id. Without
  // this branch the reconciliation worker only updated the anchor checklist,
  // leaving the kit perpetually open and reminders firing indefinitely.
  if (String(row.scope ?? "document") === "kit" && row.kit_id) {
    const { finalizeKitEsign } = await import("../../employees/joiningKitDispatch.service.js");
    await finalizeKitEsign({
      kitId: String(row.kit_id),
      transactionId: String(row.id),
      clientTransactionId: clientTransactionId,
      providerReferenceId: transactionId,
    });
    return { state: "completed", providerStatus: status.providerStatus, clientTransactionId, transactionId, changed: true };
  }

  const storedFiles: string[] = [];
  let documentMeta: Record<string, unknown> = {};
  let signedFileId: string | null = null;
  try {
    const doc = await luckpayClient.downloadESignDocument({ clientTransactionId, transactionId });
    // Joining-document artefacts belong beside the rest of that employee's
    // documents. persistDocument's default lands them in the onboarding tree,
    // which leaves employee_joining_document_file.storage_path pointing outside
    // the directory every joining-document reader looks in.
    const stored = await persistDocument(doc, ".pdf", joiningDocumentStorageDir(String(row.employee_id), String(row.document_code)));
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

  // Mirror finalizeChecklistEsign: status alone leaves fill_status, signature_mode
  // and final_file_locked_at unset, so the document reads as signed on one screen
  // and unsigned on another. signature_mode stays honest about whether the
  // provider's artefact was actually retrieved.
  await db.execute(
    `UPDATE employee_joining_document_checklist
        SET status = 'esign_completed',
            fill_status = 'esign_completed',
            signature_mode = ?,
            final_file_locked_at = NOW(),
            completed_at = NOW(),
            updated_at = NOW()
      WHERE id = ?`,
    [signedFileId ? "aadhaar_esign_verified" : "aadhaar_esign_pending_artefact", row.checklist_id],
  ).catch(() => undefined);

  // recalculateDocumentProgress is the documented single writer of
  // employees.joining_document_completion_pct. Without this the employee stays
  // below 100% forever even with every document signed.
  try {
    const { recalculateDocumentProgress } = await import("../../employees/employeeJoiningDocuments.service.js");
    await recalculateDocumentProgress(String(row.employee_id));
  } catch (error) {
    console.warn("[syncEsignStatus] progress recalculation failed:", (error as Error)?.message ?? error);
  }

  // Consume the public signing token so a completed link cannot be replayed.
  await db.execute(
    `UPDATE employee_joining_document_public_token
        SET token_status = 'consumed', consumed_at = NOW()
      WHERE checklist_id = ? AND token_status = 'active'`,
    [row.checklist_id],
  ).catch(() => undefined);

  // candidate_bgv_report.esignature_status has existed since the original BGV
  // schema but was never written by anything. Populate it now that a real
  // signature outcome exists. Its enum is not_done/validated/invalid — distinct
  // from the not_run/passed/failed vocabulary used by the other columns.
  if (row.candidate_id) {
    await db.execute(
      `UPDATE candidate_bgv_report
          SET esignature_status = IF(locked = 1, esignature_status, 'validated'),
              esignature_remarks = IF(locked = 1, esignature_remarks, ?),
              updated_at = NOW()
        WHERE candidate_id = ?`,
      [`Aadhaar eSign completed via Luckpay (${row.document_code})`, row.candidate_id],
    ).catch(() => undefined);
  }

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
