/**
 * The employee-signed ("accepted") copy of an appointment letter.
 *
 * After the employee signs with Aadhaar eSign, appointmentLetterEsign.service.ts
 * downloads the provider's signed PDF and records it on
 * appointment_letter_esign_transaction. appointment_letter_issue.signed_file_path
 * keeps pointing at the company-signed ORIGINAL on purpose, so every reader that
 * wants the signed copy has to go through here.
 *
 * Three surfaces read it (HR download route, the employee's own documents page,
 * the public accept page). They share one resolver so the same three checks apply
 * everywhere: the file is inside this module's storage tree, it exists, and its
 * bytes still hash to what was recorded when it was stored.
 *
 * Read-only: nothing in this file writes to the database or the disk.
 */
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { appointmentLetterStorageRoot } from "./appointmentLetterEsign.service.js";

export const ACCEPTED_COPY_MISSING = "ACCEPTED_COPY_MISSING";
export const ACCEPTED_COPY_INTEGRITY = "ACCEPTED_COPY_INTEGRITY";

export class AcceptedCopyError extends Error {
  constructor(message: string, readonly statusCode: number, readonly code: string) {
    super(message);
    this.name = "AcceptedCopyError";
  }
}

export type AcceptedCopyRecord = {
  transactionId: string;
  filePath: string;
  sha256: string | null;
  completedAt: string | null;
};

export type AcceptedCopyFile = AcceptedCopyRecord & { bytes: Buffer; fileName: string };

const isoOrNull = (value: unknown): string | null => {
  if (!value) return null;
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** Newest signed transaction of this letter that actually holds a file, or null. */
export async function findAcceptedCopy(issueId: string): Promise<AcceptedCopyRecord | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, signed_file_path, signed_file_sha256, completed_at
       FROM appointment_letter_esign_transaction
      WHERE issue_id = ? AND status = 'signed' AND signed_file_path IS NOT NULL
      ORDER BY completed_at DESC, initiated_at DESC
      LIMIT 1`,
    [issueId],
  );
  const row = (rows as RowDataPacket[])[0];
  if (!row?.signed_file_path) return null;
  return {
    transactionId: String(row.id),
    filePath: String(row.signed_file_path),
    sha256: row.signed_file_sha256 ? String(row.signed_file_sha256).toLowerCase() : null,
    completedAt: isoOrNull(row.completed_at),
  };
}

/** Only ever a file this module's own storage tree holds (no ../ escapes, no other drive). */
export function resolveInsideStorage(filePath: string): string | null {
  const root = path.resolve(appointmentLetterStorageRoot());
  const resolved = path.resolve(filePath);
  return resolved !== root && resolved.startsWith(root + path.sep) ? resolved : null;
}

const notAvailable = (letterNumber: string) =>
  new AcceptedCopyError(
    `The employee-signed copy of ${letterNumber} is not available on the server. Please contact HR.`,
    404,
    ACCEPTED_COPY_MISSING,
  );

/**
 * Load and verify the accepted copy. Throws AcceptedCopyError:
 *  404 ACCEPTED_COPY_MISSING    no signed transaction, path outside storage, or file gone
 *  409 ACCEPTED_COPY_INTEGRITY  the bytes no longer match the recorded sha256
 */
export async function loadAcceptedCopy(issueId: string, letterNumber: string): Promise<AcceptedCopyFile> {
  const record = await findAcceptedCopy(issueId);
  if (!record) {
    throw new AcceptedCopyError(
      `${letterNumber} has no employee-signed copy yet: the employee has not completed signing, or the signed file was not retrieved.`,
      404,
      ACCEPTED_COPY_MISSING,
    );
  }

  const inside = resolveInsideStorage(record.filePath);
  if (!inside) {
    console.warn(`[appointment-letter] refusing signed copy of ${letterNumber}: recorded path is outside the storage root`);
    throw notAvailable(letterNumber);
  }

  let bytes: Buffer;
  try {
    bytes = await fs.promises.readFile(inside);
  } catch {
    throw notAvailable(letterNumber);
  }

  if (record.sha256) {
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== record.sha256) {
      console.warn(
        `[appointment-letter] signed copy of ${letterNumber} failed its integrity check ` +
        `(transaction ${record.transactionId}): recorded ${record.sha256}, on disk ${actual}`,
      );
      throw new AcceptedCopyError(
        `The stored signed copy of ${letterNumber} failed its integrity check and was not served. Please contact IT.`,
        409,
        ACCEPTED_COPY_INTEGRITY,
      );
    }
  }

  return { ...record, bytes, fileName: `${letterNumber}-accepted.pdf` };
}
