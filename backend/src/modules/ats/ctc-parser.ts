// backend/src/modules/ats/ctc-parser.ts
/**
 * Safely parses a monthly-CTC value that may have come through as a formatted string
 * (comma-grouped, or period-grouped from an Excel/European-locale paste) instead of a
 * plain number.
 *
 * Root cause this closes: the offer-creation CTC field was a bare text input with no
 * comma/decimal handling, parsed with plain Number(). Two real, live cases:
 *   Number("16,500")  -> NaN  -> JSON.stringify(NaN) -> null -> Number(null) -> 0
 *   Number("16.500")  -> 16.5 -> silently annualized (x12=198) and stored as a broken
 *                                 ~Rs 16.50/month "CTC" (confirmed live, 2026-09-11:
 *                                 multiple recruiters, multiple candidates, identical
 *                                 corrupted gross/net figures -- a deterministic parsing
 *                                 bug, not individual typos).
 *
 * Same parser used client-side (NativeHROnboardingRequests.tsx) and here, so a direct
 * API call bypassing the UI gets the same protection.
 */
export function parseCtcInput(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/[₹\s]/g, "");

  // Commas in a CTC field are always a thousands grouping mark (Indian "1,98,000" or
  // Western "198,000" grouping), never a decimal separator -- strip them unconditionally.
  if (s.includes(",")) s = s.replace(/,/g, "");

  // A single period followed by exactly three digits and nothing else ("16.500",
  // "198.000") is a thousands-grouped whole number, not rupees-and-paise -- monthly CTC
  // entry never needs 3 decimal places. Treat the period as a grouping mark, not a
  // decimal point.
  if (/^\d{1,3}\.\d{3}$/.test(s)) s = s.replace(".", "");

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
