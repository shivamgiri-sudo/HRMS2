// src/lib/ctcParser.ts
/**
 * Safely parses a monthly-CTC value typed into a bare text input, where a recruiter's
 * natural formatting habits can silently corrupt a plain Number() parse.
 *
 * Confirmed live, 2026-09-11 -- multiple recruiters, multiple candidates, a deterministic
 * parsing bug (not individual typos):
 *   Number("16,500")  -> NaN  -> serialized as null -> backend reads it as 0
 *   Number("16.500")  -> 16.5 -> annualized (x12=198) and stored as a broken ~Rs 16.50/month
 *                                 "CTC" with a negative net-in-hand.
 *
 * Same parser used server-side (backend/src/modules/ats/ctc-parser.ts) as a second line of
 * defense for any caller that bypasses this form.
 */
export function parseCtcInput(raw: string): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/[₹\s]/g, "");

  // Commas are always a thousands grouping mark on a CTC field (Indian "1,98,000" or
  // Western "198,000" grouping), never a decimal separator.
  if (s.includes(",")) s = s.replace(/,/g, "");

  // A single period followed by exactly three digits ("16.500", "198.000") is a
  // thousands-grouped whole number pasted from an Excel/European-locale source, not
  // rupees-and-paise -- monthly CTC entry never needs 3 decimal places.
  if (/^\d{1,3}\.\d{3}$/.test(s)) s = s.replace(".", "");

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** ₹16,500-style grouped display, for the "you typed X, this means Y" live preview. */
export function formatCtcPreview(n: number): string {
  return `₹${n.toLocaleString("en-IN")}`;
}
