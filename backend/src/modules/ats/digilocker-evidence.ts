/**
 * Which checks a completed DigiLocker session actually evidences.
 *
 * The previous behaviour marked both `aadhaar` and `pan` verified on any
 * completion. The assumption behind that does not hold:
 *
 *   - HRMS2 asks for ["AADHAAR", "PAN"], but the list never reaches the
 *     provider. Luckpay's verifyDigilockerWithURL accepts only
 *     clientTransactionId, customerName and mobileNumber, so the request is
 *     stored locally and has no effect on what comes back.
 *   - downloadKycDocument returns ONE document, not a set. What the candidate
 *     consents to share in the DigiLocker portal decides what that is.
 *
 * So a completion may carry Aadhaar and no PAN at all. Marking PAN verified in
 * that case is worse than paying for the PAN check: it records a verification
 * that never happened, and skips the check that would have caught it. Being
 * wrong here is expensive in the direction that matters.
 *
 * Aadhaar is treated differently on purpose. A DigiLocker session is
 * authenticated with the holder's Aadhaar, so completing one is itself evidence
 * of it. PAN has to show up in what was returned.
 */

export interface DigilockerEvidence {
  /** File name of the downloaded document, when one was retrieved. */
  fileName?: unknown;
  /** Document types, if the provider ever reports them explicitly. */
  documentTypes?: unknown;
  /** Present when the download failed; the session still completed. */
  downloadError?: unknown;
}

export type DigilockerVerifiedCheckType = "aadhaar" | "pan";

/** Whole-word match, so "company", "panel" and "japan" are not PAN documents. */
function mentions(haystack: string, word: string): boolean {
  return new RegExp(`(^|[^a-z])${word}([^a-z]|$)`, "i").test(haystack);
}

export function digilockerVerifiedCheckTypes(evidence: DigilockerEvidence): DigilockerVerifiedCheckType[] {
  const parts: string[] = [];
  if (typeof evidence.fileName === "string") parts.push(evidence.fileName);
  if (Array.isArray(evidence.documentTypes)) {
    parts.push(...evidence.documentTypes.filter((t): t is string => typeof t === "string"));
  }
  const haystack = parts.join(" ").replace(/[^A-Za-z]+/g, " ");

  // Completing the session authenticates the holder against Aadhaar, so it is
  // evidenced whether or not a file naming it came back.
  const types: DigilockerVerifiedCheckType[] = ["aadhaar"];

  if (mentions(haystack, "pan") || mentions(haystack, "pancard")) types.push("pan");

  return types;
}
