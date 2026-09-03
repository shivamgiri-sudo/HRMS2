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

// Bank Passbook / Cancelled Cheque deliberately removed — bank account is no
// longer mandatory at onboarding. Keep this list identical to the backend's
// MANDATORY_DOCUMENTS in onboarding-full.service.ts.
export const MANDATORY_DOCUMENT_RULES: MandatoryDocRule[] = [
  { label: "Aadhaar Card", matches: ["aadhaar", "aadhar"] },
  { label: "PAN Card", matches: ["pan"] },
  { label: "Address Proof", matches: ["address proof"] },
  { label: "Passport Size Photo", matches: ["passport photo", "passport size", "photo"] },
  // Live Selfie is deliberately its own rule and NOT folded into the photo rule
  // above: a gallery-uploaded passport photo must not satisfy a *live* capture,
  // which exists to prove the candidate was physically present. Every live
  // capture writes doc_type "Live Selfie" (55/55 rows in production), so the
  // "selfie" substring is sufficient and no exact-match special case is needed.
  { label: "Live Selfie", matches: ["selfie"] },
  { label: "10th Marksheet", matches: ["10th"] },
  { label: "12th Marksheet / Diploma", matches: ["12th", "diploma"] },
];

// Categories that are still asked for and still shown as "Required" in the Step 4
// checklist, but which no longer BLOCK the Step 10 Submit button. Deliberately a
// separate list rather than a removal from MANDATORY_DOCUMENT_RULES above: the
// visible UI is unchanged (asterisks, red badges, "still missing" hints all stay),
// only the gate moves. Keep identical to NON_BLOCKING_DOCUMENT_LABELS in
// backend/src/modules/ats/onboarding-full.service.ts — if the two disagree, the
// button either stays disabled for no reason or enables against a backend that
// still refuses the submission with a 400.
export const NON_BLOCKING_DOCUMENT_LABELS = new Set<string>(["PAN Card"]);

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

/**
 * The subset of `findMissingMandatoryDocs` that actually blocks submission —
 * i.e. everything the backend's submit gate still refuses. Use this for the
 * Submit button's enabled/disabled state; use `findMissingMandatoryDocs` for
 * anything that merely *displays* what is outstanding.
 */
export function findMissingBlockingDocs(
  documents: Pick<DocRecord, "doc_type" | "doc_name">[] | undefined,
  digilockerDone = false,
): MandatoryDocRule[] {
  return findMissingMandatoryDocs(documents, digilockerDone)
    .filter((rule) => !NON_BLOCKING_DOCUMENT_LABELS.has(rule.label));
}
