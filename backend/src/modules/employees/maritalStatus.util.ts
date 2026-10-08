/**
 * Marital status normalisation.
 *
 * `employees.marital_status` is a strict-mode ENUM('single','married','divorced','widowed').
 * `candidate_onboarding_profile.marital_status`, the source this gets copied from at
 * conversion, is free text: live data on 2026-09-10 held 'Single', 'Married', 'WIDOW',
 * 'DIVORCE' and 'Separated' — none of the last three is a member of the employees enum
 * (MySQL enum matching is case-insensitive but still exact-word, so 'WIDOW' does not match
 * 'widowed' and 'DIVORCE' does not match 'divorced'). Passing any of them straight through
 * threw ER_TRUNCATED_WRONG_VALUE_FOR_FIELD with no statusCode, which errorHandler.ts masks
 * as "An unexpected server error occurred" -- crashing the whole offer approval and giving
 * neither the branch head nor HR any indication what was actually wrong (ref 0ca287e1,
 * candidate POONAM SHARMA / CND-MT9HYQDU, 2026-09-10).
 *
 * Every write path should funnel through here, the same pattern as normalizeBloodGroup:
 * an unrecognisable value becomes NULL (an honest blank) rather than crashing the insert.
 * 'Separated' has no corresponding member in the employees enum, so it is not guessable and
 * is dropped to NULL like any other unrecognised value -- silently forcing it to 'single' or
 * 'divorced' would misrecord someone's marital status.
 */

export const MARITAL_STATUSES = ["single", "married", "divorced", "widowed"] as const;

export type MaritalStatus = (typeof MARITAL_STATUSES)[number];

export function normalizeMaritalStatus(raw: unknown): MaritalStatus | null {
  if (raw === null || raw === undefined) return null;

  const s = String(raw).trim().toUpperCase();
  if (!s) return null;

  switch (s) {
    case "SINGLE":
    case "UNMARRIED":
      return "single";
    case "MARRIED":
      return "married";
    case "DIVORCED":
    case "DIVORCE":
      return "divorced";
    case "WIDOWED":
    case "WIDOW":
      return "widowed";
    default:
      // 'Separated' and anything else unrecognised -- no matching enum member to map to.
      return null;
  }
}
