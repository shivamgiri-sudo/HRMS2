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
  if (docCategoryFor(documentType) !== 'other') return true;
  // Tax submissions the employee makes themselves. Form 16 / tax certificates are issued by the
  // employer, so those stay HR uploads.
  const t = String(documentType ?? '').trim().toLowerCase();
  return t === 'investment_proof' || t === 'declaration_form';
}

/**
 * Tax paperwork the employee is entitled to keep: Form 16 / tax certificate issued to them and the
 * investment proofs / declarations they submitted. Unlike KYC and contracts (HR opens those), the
 * owner may view and download these.
 */
const OWNER_READABLE = new Set(['form_16', 'form16', 'form 16', 'form_130', 'tax_certificate', 'investment_proof', 'declaration_form']);

export function isOwnerReadableDocType(documentType: string): boolean {
  return OWNER_READABLE.has(String(documentType ?? '').trim().toLowerCase());
}
