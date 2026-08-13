// Format checks for statutory/bank identifiers, shared by whichever write path
// needs them. Deliberately separate from employee.profile.validation.ts's Zod
// schemas: those use different field names and semantics (e.g. aadhaar_last4
// instead of a full aadhaar_id) than what the live routes actually accept, and
// back only the dead employeeProfileService write path — reusing them as-is
// here would be wrong, not just redundant. Widths/patterns here instead match
// what's already live and running: the CSV bulk-upload validator in
// employee.compliance.routes.ts (ESIC 17 digits, UAN 12 digits, PF <= 40 chars)
// and the ATS conversion regexes in modules/ats/bgv-config.ts (PAN, Aadhaar).

export const PAN_FORMAT = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const AADHAAR_FORMAT = /^\d{12}$/;
export const UAN_FORMAT = /^\d{12}$/;
export const ESI_FORMAT = /^\d{17}$/;
export const IFSC_FORMAT = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const BANK_ACCOUNT_FORMAT = /^\d{6,20}$/;

const PF_MAX_LENGTH = 40;

export interface FormatCheck {
  field: string;
  message: string;
}

/**
 * Validate a set of statutory-identifier fields, skipping any key not present
 * in `values` (partial updates are expected — HR entry and the approval apply
 * path both only touch fields that were actually submitted). Returns the list
 * of failures; empty means valid. Values are checked as given — callers that
 * uppercase/trim before storage (e.g. PAN) should do so before calling this,
 * so the error message reflects what will actually be stored.
 */
export function validateStatutoryFields(values: Record<string, unknown>): FormatCheck[] {
  const errors: FormatCheck[] = [];

  if (values.pan_number !== undefined && values.pan_number !== null && values.pan_number !== "") {
    if (!PAN_FORMAT.test(String(values.pan_number))) {
      errors.push({ field: "pan_number", message: "PAN must be 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F)" });
    }
  }
  if (values.aadhaar_id !== undefined && values.aadhaar_id !== null && values.aadhaar_id !== "") {
    if (!AADHAAR_FORMAT.test(String(values.aadhaar_id))) {
      errors.push({ field: "aadhaar_id", message: "Aadhaar must be exactly 12 digits" });
    }
  }
  if (values.uan_number !== undefined && values.uan_number !== null && values.uan_number !== "") {
    if (!UAN_FORMAT.test(String(values.uan_number))) {
      errors.push({ field: "uan_number", message: "UAN must be exactly 12 digits" });
    }
  }
  if (values.esi_number !== undefined && values.esi_number !== null && values.esi_number !== "") {
    if (!ESI_FORMAT.test(String(values.esi_number))) {
      errors.push({ field: "esi_number", message: "ESI number must be exactly 17 digits" });
    }
  }
  if (values.epf_number !== undefined && values.epf_number !== null && values.epf_number !== "") {
    if (String(values.epf_number).length > PF_MAX_LENGTH) {
      errors.push({ field: "epf_number", message: `PF member number must be ${PF_MAX_LENGTH} characters or fewer` });
    }
  }

  return errors;
}

export function validateBankFields(values: Record<string, unknown>): FormatCheck[] {
  const errors: FormatCheck[] = [];

  if (values.ifsc_code !== undefined && values.ifsc_code !== null && values.ifsc_code !== "") {
    if (!IFSC_FORMAT.test(String(values.ifsc_code))) {
      errors.push({ field: "ifsc_code", message: "IFSC must be 11 characters: 4 letters, a 0, then 6 letters/digits (e.g. HDFC0001234)" });
    }
  }
  if (values.account_number !== undefined && values.account_number !== null && values.account_number !== "") {
    if (!BANK_ACCOUNT_FORMAT.test(String(values.account_number))) {
      errors.push({ field: "account_number", message: "Account number must be 6 to 20 digits" });
    }
  }

  return errors;
}
