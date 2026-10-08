/**
 * Carry a real identity-verification result onto the employee record.
 *
 * WHY THIS EXISTS
 *   employees.pan_verified_on and aadhaar_verified_on are read in four places to decide
 *   whether an identity document is "verified" or "pending" — the self-service profile, the
 *   HR employee detail, and two clauses in identity.executor.ts, one of which filters
 *   `pan_verified_on IS NOT NULL` and another that emits 'VERIFIED'. Measured live 2026-08-11:
 *   both columns are NULL on all 58,814 employees and NO writer existed anywhere in the
 *   codebase. So every employee reads "pending" for ever, and the identity/KYC report is a
 *   permanent 0% verified that returns zero rows — the data, not the SQL.
 *
 *   Meanwhile the BGV pipeline genuinely verifies these documents: candidate_bgv_check holds
 *   20 PAN and 21 bank checks at status='verified', each with a provider-supplied verified_at.
 *   Those are real compliance events that were being discarded.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *   It never invents a verification date. The timestamp written is the one the provider
 *   returned on the check that actually passed. Backfilling a plausible date to make the
 *   report look healthier would fabricate compliance evidence, which is worse than a truthful
 *   0%.
 *
 *   It never overwrites an existing date (`AND <col> IS NULL`), so a re-run or a later
 *   re-verification cannot rewrite when the document was first verified.
 *
 *   digilocker checks are NOT mapped to Aadhaar. DigiLocker is a document SOURCE that may
 *   carry several documents; treating it as proof that Aadhaar specifically was verified
 *   would overstate what the provider actually asserted.
 */
import { db } from "../db/mysql.js";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

/** BGV check types that constitute verification of a specific identity document. */
const CHECK_TYPE_TO_COLUMN: Readonly<Record<string, "pan_verified_on" | "aadhaar_verified_on">> = {
  pan: "pan_verified_on",
  aadhaar: "aadhaar_verified_on",
  aadhaar_offline: "aadhaar_verified_on",
};

export function verificationColumnFor(checkType: string): string | null {
  return CHECK_TYPE_TO_COLUMN[String(checkType ?? "").trim().toLowerCase()] ?? null;
}

export interface PropagationResult {
  /** null when the check type is not an identity document, or no employee is linked. */
  column: string | null;
  employeeId: string | null;
  updated: boolean;
}

/**
 * Stamp the employee's verification date from a BGV check that reached `verified`.
 *
 * Resolves the employee through ats_onboarding_bridge, which is the deterministic
 * candidate→employee link. No name or email matching: attaching a verification to the wrong
 * person is worse than leaving it unattached.
 *
 * Returns rather than throws on "nothing to do", so callers can log an outcome. A genuine
 * database error still propagates — the caller decides whether it should fail the BGV write.
 */
export async function propagateIdentityVerification(
  candidateId: string,
  checkType: string,
  verifiedAt: Date | string | null | undefined,
): Promise<PropagationResult> {
  const column = verificationColumnFor(checkType);
  if (!column || !candidateId || !verifiedAt) {
    return { column, employeeId: null, updated: false };
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_id FROM ats_onboarding_bridge
      WHERE candidate_id = ? AND employee_id IS NOT NULL LIMIT 1`,
    [candidateId],
  );
  const employeeId = String((rows as Array<{ employee_id?: string }>)[0]?.employee_id ?? "").trim();
  if (!employeeId) return { column, employeeId: null, updated: false };

  // `AND ${column} IS NULL` makes this idempotent and preserves the FIRST verification date.
  // updated_at is intentionally left to its ON UPDATE default here, unlike the bulk backfills:
  // a document being verified is a real change to the employee record, not a derived mirror
  // of data that already existed.
  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE employees SET ${column} = ? WHERE id = ? AND ${column} IS NULL`,
    [verifiedAt instanceof Date ? verifiedAt : new Date(verifiedAt), employeeId],
  );

  return { column, employeeId, updated: res.affectedRows > 0 };
}
