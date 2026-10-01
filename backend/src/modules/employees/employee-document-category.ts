/**
 * Maps an uploaded document type to the `employee_documents.doc_category` it belongs in.
 *
 * The upload route never set a category, so every row landed as 'other' (the column
 * default) — including PAN, Aadhaar and bank proof. The ESI registration screen and
 * the payroll bank checks key off doc_category / known doc_type spellings, so an
 * employee's PAN stored as 'other' was invisible to them.
 *
 * Anything not recognised stays 'other', exactly as before.
 */
export type EmployeeDocCategory = 'pan' | 'aadhaar' | 'bank' | 'other';

const PAN = new Set(['pan', 'pan_card', 'pan card']);
const AADHAAR = new Set(['aadhaar', 'aadhar', 'aadhaar_card', 'aadhaar card']);
const BANK = new Set(['bank_passbook', 'bank passbook', 'passbook', 'cancelled_cheque', 'cancelled cheque']);

export function docCategoryFor(documentType: string): EmployeeDocCategory {
  const t = String(documentType ?? '').trim().toLowerCase();
  if (PAN.has(t)) return 'pan';
  if (AADHAAR.has(t)) return 'aadhaar';
  if (BANK.has(t)) return 'bank';
  return 'other';
}

/**
 * An employee uploading to their own record (not HR/admin) may only add the documents
 * statutory registration needs. Everything else (contracts, offer letters, experience
 * letters…) stays an HR-controlled upload.
 */
export function isSelfServiceDocType(documentType: string): boolean {
  return docCategoryFor(documentType) !== 'other';
}
