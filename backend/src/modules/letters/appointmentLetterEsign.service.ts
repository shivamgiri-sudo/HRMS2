/**
 * The employee's own Aadhaar eSign of an issued appointment letter.
 *
 * The letter is already signed by the company when it is emailed. This is the
 * second signature: the employee accepts it. It goes through the same provider
 * client the joining kit uses (luckpay esignWithUrl / checkESignStatus /
 * downloadESignDocument), so nothing about how a signature is taken, billed or
 * retrieved is new — only where the resulting state is kept.
 *
 * State lives in appointment_letter_esign_transaction (migration 1858), not in
 * employee_document_esign_transaction: that table is anchored to a joining
 * document checklist row by a NOT NULL foreign key and every joining-document
 * reader joins on it, so a letter row there would surface as a phantom
 * transaction against a real joining document.
 *
 * Lifecycle of appointment_letter_issue.employee_esign_status:
 *   not_sent -> sent (provider session created) -> opened (employee came back to
 *   the same session) -> signed | expired. 'failed' is recoverable and stays
 *   'sent'/'opened', because the provider reports FAILED for states a candidate
 *   later completed on the very same session (see esign-reconciliation.worker.ts).
 */
import { randomUUID, createHash } from "crypto";
import fs from "fs";
import path from "path";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import { auditAppointmentLetter } from "./appointmentLetterAudit.js";

export const PROVIDER = "luckpay";
const PROVIDER_TIMEOUT_MS = 30_000;
/** A row still 'initiating' after this long belongs to a request that died. */
const INITIATING_STALE_SECONDS = 120;
/** After a failed provider call, wait this long before paying for another attempt. */
const PROVIDER_ERROR_COOLDOWN_SECONDS = 30;
/** Minutes to wait before poll N (the last value repeats). Own budget, see reconcile. */
const POLL_LADDER_MINUTES = [5, 15, 60, 120, 240];
const RECONCILE_BATCH = 10;
const RECONCILE_GIVE_UP_DAYS = 14;
const MAX_ARTEFACT_HEAL_ATTEMPTS = 12;

const CLOSED_STATUSES = new Set(["expired", "cancelled", "abandoned_unresolved", "provider_error"]);
const SIGNED_LETTER_STATUSES = new Set(["signed", "completed"]);

export const appointmentLetterStorageRoot = () =>
  path.resolve(process.cwd(), "private-storage", "appointment-letters");

/** What the eSign flow needs to know about a letter. Nothing salary-related. */
export type EsignLetter = {
  id: string;
  letterNumber: string;
  employeeId: string;
  employeeName: string | null;
  branchName: string | null;
  signedFilePath: string | null;
  fileSha256: string | null;
  esignStatus: string;
};

export type StartCode =
  | "OK"
  | "ALREADY_SIGNED"
  | "PROVIDER_UNAVAILABLE"
  | "PREPARING"
  | "DOCUMENT_UNAVAILABLE"
  | "PROVIDER_ERROR"
  | "COOLDOWN";

export type StartOutcome = {
  code: StartCode;
  providerUrl: string | null;
  esignStatus: string;
  alreadySigned: boolean;
  message: string | null;
  retryAfterSeconds?: number;
};

export type AppointmentSyncOutcome = {
  synced: boolean;
  state: "pending" | "completed" | "failed" | "expired" | "not_started";
  providerStatus?: string | null;
  clientTransactionId?: string | null;
  transactionId?: string | null;
  message?: string | null;
  changed?: boolean;
};

type TxRow = RowDataPacket & {
  id: string;
  status: string;
  provider_url: string | null;
  provider_reference_id: string | null;
  client_transaction_id: string;
  age_s: number | null;
};

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000} s`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

const isDuplicateKey = (error: unknown) =>
  (error as { code?: string })?.code === "ER_DUP_ENTRY" || (error as { errno?: number })?.errno === 1062;

function nextPollMinutes(attempts: number): number {
  return POLL_LADDER_MINUTES[Math.min(Math.max(attempts, 1) - 1, POLL_LADDER_MINUTES.length - 1)];
}

async function loadOpenTransaction(issueId: string): Promise<TxRow | undefined> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, status, provider_url, provider_reference_id, client_transaction_id,
            TIMESTAMPDIFF(SECOND, initiated_at, NOW()) AS age_s
       FROM appointment_letter_esign_transaction
      WHERE issue_id = ? AND open_marker = 'Y'
      LIMIT 1`,
    [issueId],
  );
  return (rows as TxRow[])[0];
}

async function closeTransaction(id: string, status: string, error: string | null): Promise<void> {
  await db.execute(
    `UPDATE appointment_letter_esign_transaction
        SET status = ?, open_marker = NULL, error_message = COALESCE(?, error_message)
      WHERE id = ?`,
    [status, error, id],
  );
}

async function loadLetterStatus(issueId: string): Promise<string> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_esign_status FROM appointment_letter_issue WHERE id = ? LIMIT 1`,
    [issueId],
  );
  return String((rows as RowDataPacket[])[0]?.employee_esign_status ?? "not_sent");
}

/** The signed PDF must still be the exact file the company signed. */
async function readableLetterFile(letter: EsignLetter): Promise<string | null> {
  const filePath = letter.signedFilePath;
  if (!filePath) return null;
  try {
    const bytes = await fs.promises.readFile(filePath);
    if (letter.fileSha256 && createHash("sha256").update(bytes).digest("hex") !== letter.fileSha256) return null;
    return filePath;
  } catch {
    return null;
  }
}

function outcome(code: StartCode, letterStatus: string, extra: Partial<StartOutcome> = {}): StartOutcome {
  return {
    code,
    providerUrl: null,
    esignStatus: letterStatus,
    alreadySigned: code === "ALREADY_SIGNED",
    message: null,
    ...extra,
  };
}

/**
 * Hand the employee a provider URL, creating the eSign session only when there
 * is not already a live one.
 *
 * Idempotent, because every session is a billed provider call: a live session is
 * reused, a second click while one is being created is told to wait, and only a
 * dead session (expired at the provider, or a request that died mid-creation) is
 * replaced. UNIQUE(issue_id, open_marker) is what makes "one live session per
 * letter" true under concurrent clicks, not an in-process check.
 */
export async function startAppointmentEsign(letter: EsignLetter, ctx: {
  ipAddress?: string | null; userAgent?: string | null;
}): Promise<StartOutcome> {
  if (SIGNED_LETTER_STATUSES.has(letter.esignStatus)) return outcome("ALREADY_SIGNED", letter.esignStatus);
  if (!env.LUCKPAY_PROVIDER_ENABLED) {
    return outcome("PROVIDER_UNAVAILABLE", letter.esignStatus, {
      message: "Electronic signing is not available right now. Please contact HR — your letter can be accepted another way.",
    });
  }

  let syncedThisCall = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const open = await loadOpenTransaction(letter.id);
    if (open) {
      const status = String(open.status);
      const abandoned = status === "initiating" && Number(open.age_s ?? 0) > INITIATING_STALE_SECONDS;
      if (CLOSED_STATUSES.has(status) || abandoned) {
        await closeTransaction(String(open.id), abandoned ? "abandoned_unresolved" : status, null);
        continue;
      }
      if (!open.provider_url) {
        return outcome("PREPARING", letter.esignStatus, {
          message: "Your signing session is being prepared. Please try again in a few seconds.",
          retryAfterSeconds: 5,
        });
      }
      // Before handing out a session URL, find out whether it is still good — the
      // employee may have signed already, or the provider may have let it lapse.
      if (!syncedThisCall) {
        syncedThisCall = true;
        await syncAppointmentEsignForIssue(letter.id, { minIntervalSeconds: 60, timeoutMs: 8_000 }).catch(() => undefined);
        const current = await loadLetterStatus(letter.id);
        if (SIGNED_LETTER_STATUSES.has(current)) return outcome("ALREADY_SIGNED", current);
        continue;
      }
      await db.execute(
        `UPDATE appointment_letter_issue SET employee_esign_status = 'opened'
          WHERE id = ? AND employee_esign_status = 'sent'`,
        [letter.id],
      );
      await auditAppointmentLetter(letter.id, "ESIGN_OPENED", null, {
        ipAddress: ctx.ipAddress ?? null, userAgent: ctx.userAgent ?? null, reused: true,
      });
      const latest = await loadLetterStatus(letter.id);
      return outcome("OK", latest, { providerUrl: String(open.provider_url) });
    }

    const created = await createSession(letter, ctx);
    if (created !== "retry") return created;
  }
  return outcome("PREPARING", letter.esignStatus, {
    message: "Your signing session is being prepared. Please try again in a few seconds.",
    retryAfterSeconds: 5,
  });
}

async function createSession(letter: EsignLetter, ctx: {
  ipAddress?: string | null; userAgent?: string | null;
}): Promise<StartOutcome | "retry"> {
  const [recent] = await db.execute<RowDataPacket[]>(
    `SELECT 1 AS hit FROM appointment_letter_esign_transaction
      WHERE issue_id = ? AND status = 'provider_error'
        AND updated_at > (NOW() - INTERVAL ${PROVIDER_ERROR_COOLDOWN_SECONDS} SECOND) LIMIT 1`,
    [letter.id],
  );
  if ((recent as RowDataPacket[]).length > 0) {
    return outcome("COOLDOWN", letter.esignStatus, {
      message: "The signing service did not respond. Please wait a moment and try again.",
      retryAfterSeconds: PROVIDER_ERROR_COOLDOWN_SECONDS,
    });
  }

  const filePath = await readableLetterFile(letter);
  if (!filePath) {
    await auditAppointmentLetter(letter.id, "ESIGN_FILE_UNAVAILABLE", null, { letterNumber: letter.letterNumber });
    return outcome("DOCUMENT_UNAVAILABLE", letter.esignStatus, {
      message: "The letter document is not available for signing right now. Please contact HR.",
    });
  }

  const { luckpayClient, esignWithUrl } = await import("../integrations/luckpay/luckpay.client.js");
  const txId = randomUUID();
  const clientTransactionId = luckpayClient.generateClientTransactionId("appointment-letter");
  try {
    await db.execute(
      `INSERT INTO appointment_letter_esign_transaction
         (id, issue_id, employee_id, provider, client_transaction_id, signer_name, status, open_marker)
       VALUES (?, ?, ?, ?, ?, ?, 'initiating', 'Y')`,
      [txId, letter.id, letter.employeeId, PROVIDER, clientTransactionId, letter.employeeName],
    );
  } catch (error) {
    // Another click created the live session first; the loop will find it.
    if (isDuplicateKey(error)) return "retry";
    throw error;
  }

  let providerUrl: string | null = null;
  let providerReferenceId: string | null = null;
  let txStatus = "initiated";
  try {
    const result = await withTimeout(
      esignWithUrl({
        filePath,
        clientTransactionId,
        signedBy: String(letter.employeeName ?? "Employee"),
        location: String(letter.branchName ?? "India"),
        reason: `Appointment Letter ${letter.letterNumber} - acceptance`,
      }),
      PROVIDER_TIMEOUT_MS,
      "eSign provider",
    );
    providerUrl = result.providerUrl ?? null;
    providerReferenceId = result.providerReferenceId ?? null;
    txStatus = String(result.status ?? "initiated").toLowerCase();
  } catch (error) {
    // Never retried under the same id: the vendor records clientTransactionId on
    // first receipt, so a resend answers 409 for ever and the first attempt may
    // already have been billed. The next click uses a fresh id, after a cooldown.
    const message = error instanceof Error ? error.message : String(error);
    await closeTransaction(txId, "provider_error", message.slice(0, 1000));
    await auditAppointmentLetter(letter.id, "ESIGN_PROVIDER_FAILED", null, { error: message });
    return outcome("PROVIDER_ERROR", letter.esignStatus, {
      message: "We could not start electronic signing just now. Please try again in a minute, or contact HR.",
    });
  }

  if (!providerUrl) {
    await closeTransaction(txId, "provider_error", "Provider accepted the request but returned no signing URL");
    await auditAppointmentLetter(letter.id, "ESIGN_PROVIDER_FAILED", null, { error: "no signing url returned" });
    return outcome("PROVIDER_ERROR", letter.esignStatus, {
      message: "We could not start electronic signing just now. Please try again in a minute, or contact HR.",
    });
  }

  await db.execute(
    `UPDATE appointment_letter_esign_transaction
        SET provider_reference_id = ?, provider_url = ?, status = ?
      WHERE id = ?`,
    [providerReferenceId, providerUrl, txStatus, txId],
  );
  await db.execute(
    `UPDATE appointment_letter_issue
        SET employee_esign_status = 'sent', esign_transaction_id = ?
      WHERE id = ? AND employee_esign_status NOT IN ('signed', 'completed')`,
    [txId, letter.id],
  );
  await auditAppointmentLetter(letter.id, "ESIGN_STARTED", null, {
    transactionId: txId, ipAddress: ctx.ipAddress ?? null, userAgent: ctx.userAgent ?? null,
  });
  return outcome("OK", "sent", { providerUrl });
}

type SyncRow = RowDataPacket & {
  id: string;
  employee_id: string;
  client_transaction_id: string;
  provider_reference_id: string | null;
  status: string;
  signed_file_path: string | null;
  poll_attempts: number;
  since_poll_s: number | null;
  letter_number: string;
  employee_name: string | null;
  candidate_id: string | null;
};

/**
 * Ask the provider whether the employee has signed, and record the answer.
 *
 * `minIntervalSeconds` makes it safe to call from a page view: checkESignStatus
 * may be billed per call, so a screen that is refreshed repeatedly must not turn
 * into a polling loop. Also the place a signed-but-not-yet-downloaded artefact is
 * retried, because the provider confirming a signature and us holding the file
 * are two separate events.
 */
export async function syncAppointmentEsignForIssue(issueId: string, opts: {
  minIntervalSeconds?: number; timeoutMs?: number;
} = {}): Promise<AppointmentSyncOutcome> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT t.id, t.employee_id, t.client_transaction_id, t.provider_reference_id, t.status,
            t.signed_file_path, t.poll_attempts,
            TIMESTAMPDIFF(SECOND, t.last_polled_at, NOW()) AS since_poll_s,
            i.letter_number, i.employee_name, i.candidate_id
       FROM appointment_letter_esign_transaction t
       JOIN appointment_letter_issue i ON i.id = t.issue_id
      WHERE t.issue_id = ?
        AND (t.open_marker = 'Y' OR (t.status = 'signed' AND t.signed_file_path IS NULL))
      ORDER BY t.initiated_at DESC
      LIMIT 1`,
    [issueId],
  );
  const tx = (rows as SyncRow[])[0];
  if (!tx) return { synced: false, state: "not_started", message: "No live eSign session for this letter." };
  if (!tx.provider_reference_id) {
    return { synced: false, state: "not_started", message: "The signing session is still being created." };
  }
  const ref = {
    clientTransactionId: String(tx.client_transaction_id),
    transactionId: String(tx.provider_reference_id),
  };
  if (opts.minIntervalSeconds && tx.since_poll_s !== null && Number(tx.since_poll_s) < opts.minIntervalSeconds) {
    return { synced: false, state: "pending", message: "Checked moments ago.", ...ref };
  }

  const attempts = Number(tx.poll_attempts ?? 0) + 1;
  // Recorded BEFORE the provider call so a concurrent caller sees it and backs
  // off, and so a call that throws still counts against the schedule.
  await db.execute(
    `UPDATE appointment_letter_esign_transaction
        SET poll_attempts = ?, last_polled_at = NOW(), next_poll_at = (NOW() + INTERVAL ? MINUTE),
            updated_at = updated_at
      WHERE id = ?`,
    [attempts, nextPollMinutes(attempts), tx.id],
  );

  const { luckpayClient } = await import("../integrations/luckpay/luckpay.client.js");
  if (String(tx.status) === "signed") {
    // Provider already confirmed; only the artefact is missing.
    await completeSigned(tx, null);
    return { synced: true, state: "completed", changed: false, ...ref };
  }

  let status;
  try {
    status = await withTimeout(luckpayClient.checkESignStatus(ref), opts.timeoutMs ?? 20_000, "eSign status check");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.execute(
      `UPDATE appointment_letter_esign_transaction SET error_message = ?, updated_at = updated_at WHERE id = ?`,
      [message.slice(0, 1000), tx.id],
    );
    return { synced: false, state: "pending", message, ...ref };
  }

  if (status.state === "completed") {
    await completeSigned(tx, status.sanitized);
    return { synced: true, state: "completed", providerStatus: status.providerStatus, changed: true, ...ref };
  }

  if (status.state === "expired") {
    await db.execute(
      `UPDATE appointment_letter_esign_transaction
          SET status = 'expired', open_marker = NULL, next_poll_at = NULL,
              response_payload = CAST(? AS JSON), error_message = ?
        WHERE id = ?`,
      [JSON.stringify(status.sanitized ?? {}), status.message ?? null, tx.id],
    );
    await db.execute(
      `UPDATE appointment_letter_issue SET employee_esign_status = 'expired'
        WHERE id = ? AND employee_esign_status NOT IN ('signed', 'completed')`,
      [issueId],
    );
    await auditAppointmentLetter(issueId, "ESIGN_EXPIRED", null, { transactionId: tx.id });
    return { synced: true, state: "expired", providerStatus: status.providerStatus, changed: true, ...ref };
  }

  // pending or failed: recorded, session kept alive (a provider FAILED can still be completed).
  await db.execute(
    `UPDATE appointment_letter_esign_transaction
        SET status = ?, response_payload = CAST(? AS JSON), error_message = ?
      WHERE id = ?`,
    [status.state, JSON.stringify(status.sanitized ?? {}), status.state === "failed" ? status.message ?? null : null, tx.id],
  );
  return { synced: true, state: status.state, providerStatus: status.providerStatus, changed: true, ...ref };
}

/** Record the signature, and keep the employee-signed file next to the letter. */
async function completeSigned(tx: SyncRow, providerPayload: Record<string, unknown> | null): Promise<void> {
  let bytes: Buffer | null = null;
  try {
    const { luckpayClient } = await import("../integrations/luckpay/luckpay.client.js");
    const doc = await luckpayClient.downloadESignDocument({
      clientTransactionId: String(tx.client_transaction_id),
      transactionId: String(tx.provider_reference_id ?? ""),
    });
    if (doc.buffer?.length) bytes = doc.buffer;
  } catch (error) {
    // The signature happened; only the download failed. Say so and retry later
    // rather than claiming a file we do not hold.
    console.warn("[appointment-letter] signed artefact not retrieved:", error instanceof Error ? error.message : error);
  }

  let storedPath: string | null = null;
  let sha: string | null = null;
  if (bytes) {
    const dir = path.join(appointmentLetterStorageRoot(), String(tx.employee_id));
    await fs.promises.mkdir(dir, { recursive: true });
    storedPath = path.join(dir, `${tx.letter_number}-accepted.pdf`);
    await fs.promises.writeFile(storedPath, bytes);
    sha = createHash("sha256").update(bytes).digest("hex");
  }

  const firstCompletion = String(tx.status) !== "signed";
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `UPDATE appointment_letter_esign_transaction
          SET status = 'signed', open_marker = NULL, next_poll_at = NULL,
              signed_file_path = COALESCE(?, signed_file_path),
              signed_file_sha256 = COALESCE(?, signed_file_sha256),
              response_payload = COALESCE(CAST(? AS JSON), response_payload),
              error_message = NULL, completed_at = COALESCE(completed_at, NOW())
        WHERE id = ?`,
      [storedPath, sha, providerPayload ? JSON.stringify(providerPayload) : null, tx.id],
    );
    await conn.execute(
      `UPDATE appointment_letter_issue
          SET employee_esign_status = 'signed', employee_esign_at = COALESCE(employee_esign_at, NOW()),
              esign_transaction_id = ?
        WHERE id = (SELECT issue_id FROM appointment_letter_esign_transaction WHERE id = ?)`,
      [tx.id, tx.id],
    );
    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => undefined);
    throw error;
  } finally {
    conn.release();
  }

  const issueId = await issueIdOfTransaction(String(tx.id));
  if (firstCompletion) {
    await auditAppointmentLetter(issueId, "EMPLOYEE_SIGNED", null, {
      transactionId: tx.id, artefactRetrieved: Boolean(bytes),
    });
  }
  if (bytes && !tx.signed_file_path) {
    await recordSignerIdentity(tx, issueId, bytes);
  }
}

async function issueIdOfTransaction(transactionId: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT issue_id FROM appointment_letter_esign_transaction WHERE id = ? LIMIT 1`,
    [transactionId],
  );
  const id = (rows as RowDataPacket[])[0]?.issue_id;
  return id ? String(id) : null;
}

/** Subject CN of the company's own signing certificate (see dscConfig.service generateSelfSignedP12). */
const COMPANY_SIGNER_COMMON_NAME = "Mas Callnet India Pvt. Ltd.";

/**
 * Alert-only fraud signal, same as the joining kit: compare the CA-verified
 * signer named in the eSign certificate with the person the letter was issued
 * to. Never blocks or reverses a signature.
 */
export async function recordSignerIdentity(tx: SyncRow, issueId: string | null, signedBytes: Buffer): Promise<void> {
  try {
    const { extractLatestEsignCertificateIdentity } = await import("../../shared/esignCertificateIdentity.js");
    const { classifyNameMatch } = await import("../ats/indian-name-match.js");
    // The letter is company-signed BEFORE the employee signs, so the returned PDF
    // carries two signatures. The employee's is the last one; the company's own
    // certificate must never be read as the signer (it would always mismatch).
    const identity = extractLatestEsignCertificateIdentity(signedBytes, { excludeCommonNames: [COMPANY_SIGNER_COMMON_NAME] });
    const ownerName = String(tx.employee_name ?? "");
    const match = identity?.commonName ? classifyNameMatch(ownerName, identity.commonName) : null;
    const matchTier = match?.tier ?? "unverifiable";
    const suspicious = match?.suspicious ?? false;
    await db.execute(
      `INSERT INTO esign_signer_identity_check
         (id, employee_id, candidate_id, scope, reference_id, transaction_id,
          document_owner_name, certificate_common_name, certificate_issuer_cn,
          certificate_valid_from, certificate_valid_to, match_tier, is_suspicious, match_reason)
       VALUES (?, ?, ?, 'appointment_letter', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(), String(tx.employee_id), tx.candidate_id ?? null, issueId, String(tx.id),
        ownerName, identity?.commonName ?? null, identity?.issuerCommonName ?? null,
        identity?.validFrom ?? null, identity?.validTo ?? null,
        matchTier, suspicious ? 1 : 0, match?.reason ?? (identity ? null : "No embedded eSign certificate found"),
      ],
    );
    if (suspicious) {
      await auditAppointmentLetter(issueId, "ESIGN_SIGNER_IDENTITY_MISMATCH", null, {
        documentOwnerName: ownerName, certificateCommonName: identity?.commonName ?? null, matchTier,
      });
    }
  } catch (error) {
    console.warn("[appointment-letter] signer-identity check failed:", error instanceof Error ? error.message : error);
  }
}

/** Provider identifiers -> letter, for the webhook and the shared status sync. */
export async function findIssueIdByClientTransaction(clientTransactionId: string): Promise<string | null> {
  const id = String(clientTransactionId ?? "").trim();
  if (!id) return null;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT issue_id FROM appointment_letter_esign_transaction
      WHERE provider = ? AND client_transaction_id = ? LIMIT 1`,
    [PROVIDER, id],
  );
  const issueId = (rows as RowDataPacket[])[0]?.issue_id;
  return issueId ? String(issueId) : null;
}

/**
 * Entry used by luckpay-status.service (syncEsignStatus) when a client
 * transaction id is not a joining-document one: returns null when it is not an
 * appointment-letter transaction either, so the caller keeps its own answer.
 */
export async function syncAppointmentEsignByClientTransaction(
  clientTransactionId: string,
): Promise<AppointmentSyncOutcome | null> {
  const issueId = await findIssueIdByClientTransaction(clientTransactionId);
  if (!issueId) return null;
  return syncAppointmentEsignForIssue(issueId);
}

/**
 * Scheduled pull for letters whose employee has not come back to the page.
 * Called from the esign reconciliation worker's tick (which is itself off unless
 * ESIGN_RECONCILIATION_ENABLED). Own, small budget: at most RECONCILE_BATCH
 * letters per tick on a 5 -> 240 minute ladder, and it gives up after
 * RECONCILE_GIVE_UP_DAYS. Deliberately independent of the joining-document
 * budget, which is pinned by its own contract test.
 */
export async function reconcileAppointmentEsigns(): Promise<{ examined: number; completed: number; errors: number }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT issue_id FROM appointment_letter_esign_transaction
      WHERE provider = ?
        AND ((open_marker = 'Y' AND provider_reference_id IS NOT NULL
              AND initiated_at > (NOW() - INTERVAL ${RECONCILE_GIVE_UP_DAYS} DAY))
          OR (status = 'signed' AND signed_file_path IS NULL AND poll_attempts < ${MAX_ARTEFACT_HEAL_ATTEMPTS}))
        AND (next_poll_at IS NULL OR next_poll_at <= NOW())
      ORDER BY next_poll_at IS NOT NULL, next_poll_at
      LIMIT ${RECONCILE_BATCH}`,
    [PROVIDER],
  );
  let completed = 0;
  let errors = 0;
  for (const row of rows as RowDataPacket[]) {
    try {
      const result = await syncAppointmentEsignForIssue(String(row.issue_id));
      if (result.state === "completed") completed += 1;
    } catch (error) {
      errors += 1;
      console.warn("[appointment-esign] reconcile failed:", error instanceof Error ? error.message : error);
    }
  }
  return { examined: (rows as RowDataPacket[]).length, completed, errors };
}
