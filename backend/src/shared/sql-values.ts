/**
 * Binding helpers for `COALESCE(?, existing_column)` updates.
 *
 * In a COALESCE-guarded UPDATE the sentinel for "leave this column alone" is
 * NULL. Most call sites build that sentinel with `value ?? null`, which is wrong
 * for anything arriving from a form or a JSON body: `??` only falls back on
 * null/undefined, so an untouched field arrives as "" and is passed straight
 * through. COALESCE('', col) evaluates to '' — verified against the live
 * database — so the column is written, not preserved.
 *
 * For a DATE, DATETIME or DECIMAL column that is not merely wrong, it is fatal:
 * MySQL rejects '' with ER_TRUNCATED_WRONG_VALUE and the whole statement aborts.
 * That is what broke candidate onboarding on 2026-08-08 — a blank date of birth
 * threw *after* candidate_onboarding_profile had been written, so the row saved
 * and its ats_candidate mirror silently did not (fixed in cdaa0c47).
 *
 * `|| null` happens to be correct here and several call sites already use it;
 * `?? null` is the broken twin. This helper exists so the intent is explicit
 * rather than resting on which operator someone happened to type.
 */

/**
 * "" and whitespace-only become NULL; everything else passes through untouched.
 *
 * Deliberately the most conservative transform available. It cannot reject a
 * value that currently works — unlike a format-validating helper such as
 * grn-smart's `dateOrNull`, which requires exactly YYYY-MM-DD and would silently
 * drop a valid DATETIME like "2026-08-08 10:30:00". Use this on the binding for
 * any COALESCE-guarded column; use a stricter parser only where the column
 * really is a bare DATE and the input is known to be one.
 */
export function blankToNull<T>(value: T): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() === "" ? null : value;
  return value;
}
