/**
 * The employee-facing half of appointment-letter acceptance.
 *
 * The issuance email links to /employee/appointment-letter/<token>. Until this
 * existed that link resolved to nothing. Everything here is reached with a
 * bearer-less token from an email, so it is deliberately narrow — it follows
 * joiningKitPublic.service.ts: the token is the only identifier accepted from the
 * caller, and what comes back is only what the signer needs to know what they are
 * accepting. It never returns the salary snapshot, contact details, internal ids,
 * file paths or provider identifiers.
 *
 * Which token is accepted:
 *  - accept_token_hash — the token minted for the accept link (all letters issued
 *    from migration 1858 on, and any letter HR has re-sent the link for).
 *  - verify_token_hash — ONLY while the letter has no accept token. Letters issued
 *    before the accept flow existed carry the verification token in the link that
 *    is already in the employee's inbox; that is the only way those links start
 *    working. Once a letter has its own accept token the verification token (which
 *    is printed as a QR and shown to third parties) stops opening this flow.
 */
import fs from "fs";
import path from "path";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import { istDisplayDate } from "./letterFormat.js";
import { looksLikeToken, sha256Hex } from "./appointmentLetterAcceptToken.js";
import {
  appointmentLetterStorageRoot,
  startAppointmentEsign,
  syncAppointmentEsignForIssue,
  type EsignLetter,
  type StartOutcome,
} from "./appointmentLetterEsign.service.js";
import { AcceptedCopyError, loadAcceptedCopy, type AcceptedCopyFile } from "./appointmentLetterSignedCopy.service.js";

export const LETTER_LINK_INVALID = "LETTER_LINK_INVALID";
export const LETTER_REVOKED = "LETTER_REVOKED";
const INVALID_MESSAGE =
  "This link is no longer active. It may have been replaced by a newer email from MAS Callnet — please use the link in your latest email, or ask HR to resend it.";
const REVOKED_MESSAGE =
  "This appointment letter is no longer valid. Please contact HR for details.";
/** Refresh a pending signature from the provider at most this often per letter. */
const SESSION_SYNC_MIN_INTERVAL_SECONDS = 120;
const SESSION_SYNC_TIMEOUT_MS = 8_000;

export type LetterSession = {
  letterNumber: string;
  employeeName: string | null;
  employeeCode: string | null;
  designation: string | null;
  branchName: string | null;
  dateOfJoining: string | null;
  companySignedAt: string | null;
  companySignedBy: string | null;
  /** not_sent | sent | opened | signed | expired */
  esignStatus: string;
  signed: boolean;
  signedAt: string | null;
  /** False when the provider is switched off, so the page can say so up front. */
  esignAvailable: boolean;
};

type LetterRow = RowDataPacket & {
  id: string;
  letter_number: string;
  employee_id: string;
  employee_name: string | null;
  employee_code: string | null;
  designation: string | null;
  branch_name: string | null;
  date_of_joining: unknown;
  company_signed_at: unknown;
  signed_by_name: string | null;
  employee_esign_status: string | null;
  employee_esign_at: unknown;
  signed_file_path: string | null;
  file_sha256: string | null;
  status: string;
  revoked_at: unknown;
};

function publicError(message: string, statusCode: number, code: string): never {
  throw Object.assign(new Error(message), { statusCode, code });
}

const isoOrNull = (value: unknown): string | null => {
  if (!value) return null;
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/**
 * Token -> letter. Unknown, malformed and unusable tokens all get the same flat
 * 404 so a caller cannot tell "never existed" from anything else; a revoked
 * letter answers 410, which only a real token holder can reach.
 */
export async function resolveLetterByToken(token: string): Promise<LetterRow> {
  if (!looksLikeToken(token)) publicError(INVALID_MESSAGE, 404, LETTER_LINK_INVALID);
  const hash = sha256Hex(token);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, letter_number, employee_id, employee_name, employee_code, designation,
            branch_name, date_of_joining, company_signed_at, signed_by_name,
            employee_esign_status, employee_esign_at, signed_file_path, file_sha256,
            status, revoked_at
       FROM appointment_letter_issue
      WHERE accept_token_hash = ?
         OR (accept_token_hash IS NULL AND verify_token_hash = ?)
      LIMIT 1`,
    [hash, hash],
  );
  const row = (rows as LetterRow[])[0];
  if (!row) publicError(INVALID_MESSAGE, 404, LETTER_LINK_INVALID);
  if (row.revoked_at || String(row.status) === "revoked") publicError(REVOKED_MESSAGE, 410, LETTER_REVOKED);
  return row;
}

const toEsignLetter = (row: LetterRow): EsignLetter => ({
  id: String(row.id),
  letterNumber: String(row.letter_number),
  employeeId: String(row.employee_id),
  employeeName: row.employee_name ?? null,
  branchName: row.branch_name ?? null,
  signedFilePath: row.signed_file_path ?? null,
  fileSha256: row.file_sha256 ?? null,
  esignStatus: String(row.employee_esign_status ?? "not_sent"),
});

export async function getPublicLetterSession(token: string): Promise<LetterSession> {
  let row = await resolveLetterByToken(token);

  // A returning employee should see "signed" without waiting for the scheduled
  // pull. Throttled and time-boxed: it must never slow or fail the page.
  const pending = ["sent", "opened"].includes(String(row.employee_esign_status ?? ""));
  if (pending) {
    const result = await syncAppointmentEsignForIssue(String(row.id), {
      minIntervalSeconds: SESSION_SYNC_MIN_INTERVAL_SECONDS,
      timeoutMs: SESSION_SYNC_TIMEOUT_MS,
    }).catch(() => null);
    if (result?.changed) row = await resolveLetterByToken(token);
  }

  const esignStatus = String(row.employee_esign_status ?? "not_sent");
  const signed = ["signed", "completed"].includes(esignStatus);
  return {
    letterNumber: String(row.letter_number),
    employeeName: row.employee_name ?? null,
    employeeCode: row.employee_code ?? null,
    designation: row.designation ?? null,
    branchName: row.branch_name ?? null,
    dateOfJoining: row.date_of_joining ? istDisplayDate(row.date_of_joining) || null : null,
    companySignedAt: isoOrNull(row.company_signed_at),
    companySignedBy: row.signed_by_name ?? null,
    esignStatus,
    signed,
    signedAt: signed ? isoOrNull(row.employee_esign_at) : null,
    esignAvailable: Boolean(env.LUCKPAY_PROVIDER_ENABLED),
  };
}

/** Only ever a file this module's own storage tree holds. */
function assertInsideStorage(filePath: string): string {
  const root = appointmentLetterStorageRoot();
  const resolved = path.resolve(filePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    publicError("The letter document is not available. Please contact HR.", 404, "LETTER_FILE_MISSING");
  }
  return resolved;
}

async function acceptedCopyPath(issueId: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT signed_file_path FROM appointment_letter_esign_transaction
      WHERE issue_id = ? AND status = 'signed' AND signed_file_path IS NOT NULL
      ORDER BY completed_at DESC LIMIT 1`,
    [issueId],
  );
  const p = (rows as RowDataPacket[])[0]?.signed_file_path;
  return p ? String(p) : null;
}

/**
 * The PDF the employee is reading. Once they have signed, their own signed copy
 * is served from the same link; before that, the company-signed letter.
 */
export async function getPublicLetterFile(token: string): Promise<{ storagePath: string; fileName: string }> {
  const row = await resolveLetterByToken(token);
  const accepted = ["signed", "completed"].includes(String(row.employee_esign_status ?? ""))
    ? await acceptedCopyPath(String(row.id))
    : null;

  for (const candidate of [accepted, row.signed_file_path]) {
    if (!candidate) continue;
    const resolved = assertInsideStorage(String(candidate));
    if (fs.existsSync(resolved)) {
      return { storagePath: resolved, fileName: `${row.letter_number}${candidate === accepted ? "-accepted" : ""}.pdf` };
    }
  }
  publicError("The letter document is not available. Please contact HR.", 404, "LETTER_FILE_MISSING");
}

/**
 * The copy the employee signed, for the "Download your signed letter" button.
 *
 * Same token resolution as everything else on this page (so a revoked letter is a
 * 410 before anything is read), and only once the employee has actually signed.
 * Unlike getPublicLetterFile there is no fallback to the company-signed original:
 * this button promises the signed copy, so absence is a 404, not a different file.
 */
export async function getPublicSignedLetter(token: string): Promise<AcceptedCopyFile> {
  const row = await resolveLetterByToken(token);
  if (!["signed", "completed"].includes(String(row.employee_esign_status ?? ""))) {
    publicError("You have not signed this letter yet.", 404, "LETTER_NOT_SIGNED");
  }
  try {
    return await loadAcceptedCopy(String(row.id), String(row.letter_number));
  } catch (error) {
    if (error instanceof AcceptedCopyError) {
      // Wording written for the employee; nothing about paths or hashes.
      const message = error.statusCode === 409
        ? "Your signed letter cannot be downloaded right now. Please contact HR."
        : "Your signed letter is not available to download yet. Please contact HR.";
      publicError(message, error.statusCode, error.code);
    }
    throw error;
  }
}

export type StartResult = StartOutcome;

/** Hand back the provider URL, creating the session if there is not a live one. */
export async function startPublicLetterEsign(params: {
  token: string; ipAddress?: string | null; userAgent?: string | null;
}): Promise<StartResult> {
  const row = await resolveLetterByToken(params.token);
  return startAppointmentEsign(toEsignLetter(row), {
    ipAddress: params.ipAddress ?? null, userAgent: params.userAgent ?? null,
  });
}
