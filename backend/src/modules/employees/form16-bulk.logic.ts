/**
 * Pure rules for the Form 16 bulk upload (TRACES-issued certificates matched to employees by PAN).
 * No database, no filesystem: everything here is unit-tested directly.
 */

/** A PAN is 5 letters, 4 digits, 1 letter. */
const PAN_IN_TEXT = /[A-Za-z]{5}[0-9]{4}[A-Za-z]/g;

/**
 * The PAN named in a file name, upper-cased. A name that holds no PAN, or two different PANs, yields
 * null: guessing which one was meant would attach a certificate to the wrong person's record.
 */
export function extractPanFromFilename(filename: string): string | null {
  const base = String(filename ?? "").replace(/^.*[\\/]/, "");
  const found = new Set((base.match(PAN_IN_TEXT) ?? []).map((p) => p.toUpperCase()));
  return found.size === 1 ? [...found][0] : null;
}

/** "2025-26" style, and the second half must really be the year after the first. */
export function isValidFinancialYear(value: unknown): value is string {
  const m = /^(20\d{2})-(\d{2})$/.exec(String(value ?? ""));
  return !!m && (Number(m[1]) + 1) % 100 === Number(m[2]);
}

/** A real PDF starts with the %PDF- header; the extension alone proves nothing. */
export function looksLikePdf(buf: Buffer | Uint8Array): boolean {
  return buf.length > 5 && Buffer.from(buf.subarray(0, 5)).toString("latin1") === "%PDF-";
}

export function form16DocName(financialYear: string): string {
  return `Form 16 FY ${financialYear}`;
}

export type Form16Outcome =
  | "ready"          // matched, in scope, not uploaded yet
  | "uploaded"       // commit mode: saved
  | "duplicate"      // this employee already has Form 16 for that year
  | "no_pan"         // file name holds no (or more than one) PAN
  | "not_pdf"
  | "too_large"
  | "no_employee"    // no employee has that PAN
  | "ambiguous"      // more than one employee has that PAN
  | "out_of_scope"   // employee exists but is outside the caller's branch / assignments
  | "failed";        // commit mode: could not be saved

export const OUTCOME_LABEL: Record<Form16Outcome, string> = {
  ready: "Ready to upload",
  uploaded: "Uploaded",
  duplicate: "Already uploaded for this year",
  no_pan: "No single PAN in the file name",
  not_pdf: "Not a PDF",
  too_large: "File too large",
  no_employee: "No employee with this PAN",
  ambiguous: "More than one employee has this PAN",
  out_of_scope: "Employee is outside your branch / assignments",
  failed: "Could not be saved",
};

export function summarise(results: Array<{ outcome: Form16Outcome }>): Record<string, number> {
  const out: Record<string, number> = { total: results.length };
  for (const r of results) out[r.outcome] = (out[r.outcome] ?? 0) + 1;
  return out;
}

export const MAX_FORM16_FILES = 50;
export const MAX_FORM16_BYTES = 5 * 1024 * 1024;
