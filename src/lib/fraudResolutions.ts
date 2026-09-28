/**
 * The decisions a reviewer can record against a fraud alert, keyed by what the
 * alert actually checked. Moved out of FraudComparisonPanel unchanged so the panel
 * and the new decision UI share one list; the stored status values and the
 * `[code] reason` audit-note format are exactly what they were.
 */

export type ResolutionStatus = "resolved_false_positive" | "resolved_fraud" | "dismissed" | "under_review";

export type ResolutionOption = {
  value: ResolutionStatus;
  code: string;
  label: string;
  hint: string;
};

// DUPLICATE_AADHAAR / DUPLICATE_PAN / DUPLICATE_BANK_ACCOUNT / REPEAT_APPLICANT:
// the question is whether this is the same person re-applying under a name
// variant, or a genuinely different person sharing someone else's identifier.
const IDENTITY_DUPLICATE_RESOLUTIONS: ResolutionOption[] = [
  { value: "resolved_false_positive", code: "name_variance", label: "Same person, name written differently", hint: "Initials, added/dropped middle name, regional ordering" },
  { value: "resolved_false_positive", code: "married_name", label: "Name changed after marriage", hint: "Supporting document seen" },
  { value: "resolved_false_positive", code: "data_entry", label: "Our data was wrong", hint: "OCR misread or a typo in the record" },
  { value: "resolved_fraud", code: "confirmed_fraud", label: "Confirmed: different person", hint: "Candidate rejected" },
  { value: "dismissed", code: "not_applicable", label: "Not applicable", hint: "Raised in error or duplicate alert" },
];

// FACE_MISMATCH: a photo comparison, not a name or number.
const FACE_MISMATCH_RESOLUTIONS: ResolutionOption[] = [
  { value: "resolved_false_positive", code: "image_quality", label: "Same person, image quality issue", hint: "Lighting, angle, blur, or a low-resolution scan" },
  { value: "resolved_false_positive", code: "wrong_photo", label: "Wrong photo was compared", hint: "Document or selfie was mismatched; corrected" },
  { value: "resolved_fraud", code: "confirmed_fraud", label: "Confirmed: different person", hint: "Candidate rejected" },
  { value: "dismissed", code: "not_applicable", label: "Not applicable", hint: "Raised in error or duplicate alert" },
];

// DOCUMENT_NUMBER_MISMATCH / CHEQUE_ACCOUNT_MISMATCH: a bare digit-string
// comparison — there is no name and no photo involved.
const NUMBER_MISMATCH_RESOLUTIONS: ResolutionOption[] = [
  { value: "resolved_false_positive", code: "ocr_misread", label: "OCR misread the document", hint: "Number confirmed correct on manual review" },
  { value: "resolved_false_positive", code: "data_entry", label: "Candidate's entered number was wrong", hint: "Corrected the record to match the document" },
  { value: "resolved_fraud", code: "confirmed_fraud", label: "Confirmed: number does not match", hint: "Candidate could not produce a matching document" },
  { value: "dismissed", code: "not_applicable", label: "Not applicable", hint: "Raised in error or duplicate alert" },
];

const RESOLUTIONS_BY_ALERT_TYPE: Record<string, ResolutionOption[]> = {
  DUPLICATE_AADHAAR: IDENTITY_DUPLICATE_RESOLUTIONS,
  DUPLICATE_PAN: IDENTITY_DUPLICATE_RESOLUTIONS,
  DUPLICATE_BANK_ACCOUNT: IDENTITY_DUPLICATE_RESOLUTIONS,
  REPEAT_APPLICANT: IDENTITY_DUPLICATE_RESOLUTIONS,
  FACE_MISMATCH: FACE_MISMATCH_RESOLUTIONS,
  DOCUMENT_NUMBER_MISMATCH: NUMBER_MISMATCH_RESOLUTIONS,
  CHEQUE_ACCOUNT_MISMATCH: NUMBER_MISMATCH_RESOLUTIONS,
};

export function resolutionsForAlertType(alertType: string): ResolutionOption[] {
  return RESOLUTIONS_BY_ALERT_TYPE[alertType] ?? IDENTITY_DUPLICATE_RESOLUTIONS;
}

export type DecisionChoice = "ok" | "bad" | "info";

export const NEED_INFO_OPTION: ResolutionOption = {
  value: "under_review",
  code: "need_info",
  label: "Asked for more information",
  hint: "Keeps the alert open in your queue",
};

export interface DecisionGroups {
  ok: ResolutionOption[];
  bad: ResolutionOption[];
  info: ResolutionOption[];
  dismiss: ResolutionOption | null;
}

/** The same options as before, regrouped under the three plain choices. */
export function decisionGroups(alertType: string): DecisionGroups {
  const all = resolutionsForAlertType(alertType);
  return {
    ok: all.filter((o) => o.value === "resolved_false_positive"),
    bad: all.filter((o) => o.value === "resolved_fraud"),
    info: [NEED_INFO_OPTION],
    dismiss: all.find((o) => o.value === "dismissed") ?? null,
  };
}

/** The audit note the backend stores: "[code] what the reviewer wrote". */
export function formatDecisionNote(option: ResolutionOption, note: string): string {
  const text = note.trim();
  return text ? `[${option.code}] ${text}` : `[${option.code}]`;
}
