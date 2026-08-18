// Keep in sync with backend/src/modules/ats/onboarding-full.service.ts's
// MANDATORY_DOCUMENTS + findMissingMandatoryDocuments. If one changes, change
// both — there is no shared runtime between frontend and backend to enforce
// this automatically, so this file exists specifically so there is only ONE
// frontend copy to keep in sync, instead of the two that existed before
// (Step 4's checklist, computed from an exact-match REQUIRED_DOCS subset, and
// — previously absent entirely — Step 10's submit gate, which only checked
// "at least one document exists"). Both now derive from this single module.
//
// Deliberately uses the same SUBSTRING matching as the backend, not an exact
// doc_type match — a document uploaded as "Diploma Certificate" satisfies the
// 12th/Diploma rule on the backend, but an exact-match frontend check would
// have disagreed and shown it as still missing.
import type { DocRecord } from "./useOnboardingFull";

export type MandatoryDocRule = { label: string; matches: string[] };

export const MANDATORY_DOCUMENT_RULES: MandatoryDocRule[] = [
  { label: "Aadhaar Card", matches: ["aadhaar", "aadhar"] },
  { label: "PAN Card", matches: ["pan"] },
  { label: "Address Proof", matches: ["address proof"] },
  { label: "Cancelled Cheque / Bank Passbook", matches: ["cancelled cheque", "cheque", "passbook"] },
  { label: "Passport Size Photo", matches: ["passport photo", "passport size", "photo"] },
  { label: "10th Marksheet", matches: ["10th"] },
  { label: "12th Marksheet / Diploma", matches: ["12th", "diploma"] },
];

/**
 * Mandatory document rules this candidate has not satisfied yet.
 * `digilockerDone` should be `status?.digilocker?.status === "documents_received"`
 * — the exact condition the backend checks — so a completed DigiLocker
 * session satisfies Aadhaar/PAN here exactly the way it does server-side.
 */
export function findMissingMandatoryDocs(
  documents: Pick<DocRecord, "doc_type" | "doc_name">[] | undefined,
  digilockerDone = false,
): MandatoryDocRule[] {
  const held = (documents ?? [])
    .map((d) => `${d.doc_type ?? ""} ${d.doc_name ?? ""}`.toLowerCase())
    .filter(Boolean);
  return MANDATORY_DOCUMENT_RULES.filter((rule) => {
    if (digilockerDone && (rule.matches.includes("aadhaar") || rule.matches.includes("pan"))) return false;
    return !held.some((text) => rule.matches.some((m) => text.includes(m)));
  });
}
