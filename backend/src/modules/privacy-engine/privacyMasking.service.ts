/**
 * Centralizes PII masking — delegates to existing shared/piiMask utilities
 * and adds new masking helpers for the privacy engine.
 */

export function maskPan(value: string | null | undefined): string {
  if (!value) return "";
  const s = value.trim().toUpperCase();
  if (s.length < 4) return "XXXXX";
  return `XXXXX${s.slice(-4)}`;
}

export function maskAadhaar(value: string | null | undefined): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "XXXX-XXXX-XXXX";
  return `XXXX-XXXX-${digits.slice(-4)}`;
}

export function maskBankAccount(value: string | null | undefined): string {
  if (!value) return "";
  const s = value.trim();
  if (s.length < 4) return "XXXXXX";
  return `XXXXXX${s.slice(-4)}`;
}

export function maskEmail(value: string | null | undefined): string {
  if (!value) return "";
  const [local, domain] = value.split("@");
  if (!domain) return value.slice(0, 2) + "***";
  return `${local.slice(0, 2)}***@${domain}`;
}

export function maskMobile(value: string | null | undefined): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "XXXXXX";
  return `XXXXXX${digits.slice(-4)}`;
}

export function maskUan(value: string | null | undefined): string {
  if (!value) return "";
  const s = value.trim();
  return s.length > 4 ? `XXXXXXXX${s.slice(-4)}` : "XXXXXXXX";
}

/**
 * Apply masking to a record object for specific fields.
 * Returns a new object with sensitive fields replaced by masked values.
 */
export function applyFieldMasking(
  record: Record<string, unknown>,
  fields: string[]
): Record<string, unknown> {
  const result = { ...record };
  for (const field of fields) {
    if (!(field in result)) continue;
    const val = result[field] as string | null | undefined;
    if (field.includes("pan")) result[field] = maskPan(val);
    else if (field.includes("aadhaar") || field.includes("aadhar")) result[field] = maskAadhaar(val);
    else if (field.includes("bank_account") || field.includes("account_no")) result[field] = maskBankAccount(val);
    else if (field.includes("email")) result[field] = maskEmail(val);
    else if (field.includes("mobile") || field.includes("phone")) result[field] = maskMobile(val);
    else if (field.includes("uan")) result[field] = maskUan(val);
    else result[field] = "***";
  }
  return result;
}
