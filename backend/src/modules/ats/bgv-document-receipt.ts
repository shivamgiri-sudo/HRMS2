/**
 * Which documents a candidate has actually uploaded, for the BGV report's
 * "Documents Received" checklist.
 *
 * `candidate_bgv_report` carries nine `*_received` flags. Nothing ever wrote
 * them — `syncBgvChecksToReport` syncs only the `*_status` columns — so across
 * all 42 reports in production every one of the nine was 0, and the checklist
 * page printed entirely unticked even for candidates who had uploaded eight
 * documents. An unticked box reads as "the candidate did not provide it", which
 * is the opposite of the truth.
 *
 * `doc_type` is free-ish text and has drifted: production holds both "Aadhaar"
 * and "aadhaar_card", both "Cancelled Cheque" and "cancelled_cheque", both "PAN
 * Card" and "pan_card". Matching is therefore done on a normalised form rather
 * than on exact strings, so the two spellings of the same document cannot
 * disagree about whether it arrived.
 *
 * The 21 values below are the complete vocabulary present in production as of
 * 2026-08-03, not a guess at what the form might send.
 */

/** The nine checklist columns on candidate_bgv_report. */
export type ReceiptFlag =
  | "photo_received"
  | "aadhaar_received"
  | "pan_received"
  | "passport_received"
  | "driving_license_received"
  | "edu_cert_received"
  | "prev_exp_received"
  | "bank_proof_received"
  | "offer_letter_received";

export const RECEIPT_FLAGS: ReceiptFlag[] = [
  "photo_received", "aadhaar_received", "pan_received", "passport_received",
  "driving_license_received", "edu_cert_received", "prev_exp_received",
  "bank_proof_received", "offer_letter_received",
];

/** "PAN Card" and "pan_card" both become "pancard". */
function normalise(docType: unknown): string {
  return String(docType ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Ordered rules: the first match wins.
 *
 * Order matters in one place. "Passport Photo" is a photograph, not a passport,
 * so the photo rule must be tested before the passport rule — otherwise every
 * candidate who uploaded a headshot would be recorded as having produced a
 * passport, and 36 of them did exactly that.
 */
const RULES: ReadonlyArray<{ flag: ReceiptFlag; matches: (n: string) => boolean }> = [
  // Must precede the passport rule. See above.
  { flag: "photo_received", matches: (n) => n.includes("passportphoto") || n.includes("photo") || n.includes("selfie") },
  { flag: "aadhaar_received", matches: (n) => n.includes("aadhaar") || n.includes("aadhar") },
  { flag: "pan_received", matches: (n) => n === "pan" || n.includes("pancard") },
  { flag: "driving_license_received", matches: (n) => n.includes("driving") || n.includes("dl") },
  { flag: "passport_received", matches: (n) => n.includes("passport") },
  {
    flag: "edu_cert_received",
    matches: (n) =>
      n.includes("marksheet") || n.includes("degree") || n.includes("diploma") ||
      n.includes("certificate") && !n.includes("experience"),
  },
  { flag: "prev_exp_received", matches: (n) => n.includes("experience") || n.includes("relieving") || n.includes("payslip") },
  { flag: "bank_proof_received", matches: (n) => n.includes("passbook") || n.includes("cheque") || n.includes("bank") },
  { flag: "offer_letter_received", matches: (n) => n.includes("appointment") || n.includes("offer") },
];

/**
 * Map one uploaded document to a checklist flag, or null if it feeds none.
 *
 * "Address Proof", "Voter ID" and "Other" deliberately return null — the report
 * has no column for them. Returning null is the honest answer; inventing a flag
 * would be worse than leaving the document uncounted.
 */
export function receiptFlagForDocType(docType: unknown): ReceiptFlag | null {
  const n = normalise(docType);
  if (!n) return null;
  for (const rule of RULES) {
    if (rule.matches(n)) return rule.flag;
  }
  return null;
}

/**
 * Reduce a candidate's uploaded documents to the nine checklist flags.
 *
 * Deliberately only ever sets a flag true. This says "we hold this document",
 * and a document that was uploaded and later deleted is a matter for the audit
 * trail, not something this checklist should quietly un-tick.
 */
export function receiptFlagsFromDocuments(
  docTypes: ReadonlyArray<unknown>,
): Record<ReceiptFlag, boolean> {
  const flags = Object.fromEntries(
    RECEIPT_FLAGS.map((f) => [f, false]),
  ) as Record<ReceiptFlag, boolean>;

  for (const docType of docTypes) {
    const flag = receiptFlagForDocType(docType);
    if (flag) flags[flag] = true;
  }
  return flags;
}
