/** Dedupe key for the unified lead pool: last 10 digits of the mobile (matches ATS + Meta behaviour). */
export function normalizeMobile10(raw: unknown): string | null {
  if (raw == null) return null;
  const digits = String(raw).replace(/\D+/g, "");
  if (digits.length < 10) return null;
  const last10 = digits.slice(-10);
  // Indian mobiles start 6-9; anything else is a landline/typo we must not pool.
  return /^[6-9]\d{9}$/.test(last10) ? last10 : null;
}
