/**
 * Letter numbering and public verification.
 *
 * Every issued appointment letter carries a quotable number and a QR pointing at
 * a page that confirms it is genuine. The point is that a bank, landlord or next
 * employer can check a letter handed to them without an HRMS login.
 *
 * Minimal disclosure by design: name, employee code, designation, joining date,
 * issue date, letter number and revocation state. No salary, no address, no
 * Aadhaar or PAN. A verification page that leaks a salary would be worse than
 * having none.
 *
 * The token is stored only as a SHA-256 hash — the same rule the joining-document
 * public tokens follow — so a leaked table yields no working links. The letter
 * NUMBER is intentionally not the lookup key: it is sequential and guessable.
 */
import { randomBytes, createHash } from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { istDisplayDate } from "./letterFormat.js";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export type VerificationResult =
  | { found: false }
  | {
      found: true;
      valid: boolean;
      letterNumber: string;
      employeeName: string | null;
      employeeCode: string | null;
      designation: string | null;
      branchName: string | null;
      dateOfJoining: string | null;
      issuedOn: string | null;
      signedBy: string | null;
      signedByDesignation: string | null;
      /** False when signed with a self-signed certificate — stated, not hidden. */
      caIssuedSignature: boolean;
      employeeAccepted: boolean;
      revoked: boolean;
      revokedOn: string | null;
      statement: string;
    };

/**
 * Next letter number for the year, allocated under the caller's transaction.
 *
 * Uses MAX(letter_seq) + 1 inside the transaction with a locking read, so two
 * concurrent issuances cannot mint the same number; the UNIQUE on
 * (letter_year, letter_seq) is the backstop if they somehow do.
 */
export async function allocateLetterNumber(conn: PoolConnection, when: Date = new Date()): Promise<{
  letterNumber: string; letterSeq: number; letterYear: number;
}> {
  const letterYear = Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric" }).format(when),
  );
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT COALESCE(MAX(letter_seq), 0) AS max_seq
       FROM appointment_letter_issue
      WHERE letter_year = ? FOR UPDATE`,
    [letterYear],
  );
  const letterSeq = Number((rows as RowDataPacket[])[0]?.max_seq ?? 0) + 1;
  return {
    letterYear,
    letterSeq,
    letterNumber: `MCN-AL-${letterYear}-${String(letterSeq).padStart(6, "0")}`,
  };
}

/** A fresh verification token. The plaintext is returned once, for the QR only. */
export function mintVerificationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(24).toString("hex");
  return { token, tokenHash: sha256(token) };
}

export function verificationUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/verify/appointment/${token}`;
}

/**
 * Resolve a token to the facts a third party may see.
 *
 * Returns `found: false` for an unknown token rather than distinguishing
 * "never existed" from "deleted" — there is nothing useful in that difference
 * and it would let someone probe for valid numbers.
 */
export async function verifyAppointmentLetter(token: string): Promise<VerificationResult> {
  if (!token || token.length < 20) return { found: false };

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT letter_number, employee_name, employee_code, designation, branch_name,
            date_of_joining, issued_at, signed_by_name, signed_by_designation,
            is_ca_issued, employee_esign_status, status, revoked_at
       FROM appointment_letter_issue
      WHERE verify_token_hash = ?
      LIMIT 1`,
    [sha256(token)],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);

  const r = (rows as RowDataPacket[])[0];
  if (!r) return { found: false };

  const revoked = Boolean(r.revoked_at) || String(r.status) === "revoked";
  const caIssued = Number(r.is_ca_issued) === 1;
  const accepted = ["signed", "completed"].includes(String(r.employee_esign_status ?? ""));

  const statement = revoked
    ? "This appointment letter has been REVOKED by Mas Callnet India Pvt. Ltd. and should not be relied upon."
    : caIssued
      ? "This is a genuine appointment letter issued by Mas Callnet India Pvt. Ltd. and digitally signed with a certificate issued by a licensed Certifying Authority."
      : "This appointment letter was issued by Mas Callnet India Pvt. Ltd. Its digital signature is self-signed and is NOT from a licensed Certifying Authority — confirm with the company's HR before relying on it.";

  return {
    found: true,
    valid: !revoked,
    letterNumber: String(r.letter_number),
    employeeName: (r.employee_name as string) ?? null,
    employeeCode: (r.employee_code as string) ?? null,
    designation: (r.designation as string) ?? null,
    branchName: (r.branch_name as string) ?? null,
    dateOfJoining: r.date_of_joining ? istDisplayDate(r.date_of_joining) : null,
    issuedOn: r.issued_at ? istDisplayDate(r.issued_at) : null,
    signedBy: (r.signed_by_name as string) ?? null,
    signedByDesignation: (r.signed_by_designation as string) ?? null,
    caIssuedSignature: caIssued,
    employeeAccepted: accepted,
    revoked,
    revokedOn: r.revoked_at ? istDisplayDate(r.revoked_at) : null,
    statement,
  };
}
