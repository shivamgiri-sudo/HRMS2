/**
 * One normalization for every hash-based PII match (Aadhaar, PAN, bank account
 * number, UAN, etc.) across onboarding, BGV verification and OCR cross-checks.
 *
 * Four call sites independently reimplemented this before: ats.onboarding.service.ts's
 * hashPii() hashed the raw string with no normalization at all; bgv-verification.service.ts
 * and onboarding-full.service.ts each trimmed and uppercased but left internal separators
 * alone; ocr.service.ts trimmed and uppercased the OCR-extracted number, which is itself
 * already separator-free (the Aadhaar regex strips internal whitespace on capture, the
 * account-number regex only ever matches a bare digit run).
 *
 * That split is why a genuinely correct OCR read could still raise a fraud alert: a
 * candidate who types their Aadhaar as "1234 5678 9012" or an account number as
 * "1234-5678-9012" hashes to a different value than the same digits OCR extracted with no
 * separators, even though trim+uppercase alone leaves the space/dash in the entered value
 * untouched. Stripping every non-alphanumeric character before hashing makes the two sides
 * agree regardless of how the candidate formatted their input.
 */
import { createHash } from "crypto";

/** Trim, uppercase, then drop every character that is not a letter or digit. */
export function normalizePiiForHash(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** SHA-256 of the normalized value, or null for an empty/absent input. */
export function hashPiiForMatch(value: unknown): string | null {
  const normalized = normalizePiiForHash(value);
  return normalized ? createHash("sha256").update(normalized).digest("hex") : null;
}
