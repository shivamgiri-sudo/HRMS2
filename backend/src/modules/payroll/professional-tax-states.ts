/**
 * Which Indian states levy professional tax, and which genuinely do not.
 *
 * WHY THIS DISTINCTION HAS TO BE EXPLICIT
 * --------------------------------------
 * getPtFromSlab returns 0 when a state has no rows in pt_slab_master. That
 * single answer covers two completely different situations:
 *
 *   Uttar Pradesh — levies no professional tax at all. 0 is the correct
 *                   deduction, and 780 employees rely on it being correct.
 *   Punjab        — levies professional tax, but has never been configured
 *                   here. 0 is an UNDER-deduction, and the shortfall is the
 *                   employer's liability.
 *
 * Indistinguishable from the table alone: both are simply "no rows". So the
 * states that levy nothing are named here, and anything else with no slab is
 * treated as a configuration gap rather than as zero liability.
 *
 * PT is a state subject, so this list changes only when a state legislates.
 * Adding a state here is a statement that it has no professional tax law — not
 * a shortcut for "we have not got round to configuring it".
 */

/**
 * States and union territories that levy no professional tax.
 *
 * Sources are state legislation, not inference from our own data: a state
 * missing from pt_slab_master proves nothing except that nobody has entered it.
 */
const PT_EXEMPT_REGIONS = [
  "uttar pradesh", "up",
  "delhi", "new delhi", "dl",
  "haryana", "hr",
  "rajasthan", "rj",
  "uttarakhand", "uk", "ua",
  "himachal pradesh", "hp",
  "jammu and kashmir", "jammu & kashmir", "jk",
  "ladakh", "la",
  "chandigarh", "ch",
  "goa", "ga",
  "arunachal pradesh", "ar",
  "andaman and nicobar islands", "andaman & nicobar islands", "an",
  "dadra and nagar haveli and daman and diu", "dn", "dd",
  "lakshadweep", "ld",
] as const;

const EXEMPT = new Set<string>(PT_EXEMPT_REGIONS);

/**
 * Whether a state is known to levy no professional tax.
 *
 * Matching is case- and whitespace-insensitive because branch_master holds the
 * same state written several ways — "GUJARAT", "Gujarat", "TELANGANA" all
 * appear — and a case-sensitive check would silently misclassify.
 */
export function isProfessionalTaxExempt(state: string): boolean {
  return EXEMPT.has(state.trim().toLowerCase());
}
