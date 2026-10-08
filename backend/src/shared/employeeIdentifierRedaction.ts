/**
 * Least-data redaction for the employee-detail response.
 *
 * ── THE EXPOSURE ─────────────────────────────────────────────────────────────
 * employeeService.getEmployee() is `SELECT * FROM employees`, so GET /api/employees/:id
 * returns every column on the row. Row scope is enforced correctly by the route — this is
 * purely a field-level failure. Among those columns are aadhaar_number, pan_number,
 * bank_account_number, ifsc_code and uan_number, and the route admits ten roles:
 * hr, manager, branch_head, process_manager, wfm, payroll_head, payroll_admin, payroll,
 * finance_head and it_head (plus admin bypass).
 *
 * Three masking layers already exist in this repo — privacyFieldProjection.service.ts,
 * piiMask.ts and portalMask.ts. Only portalMask has call sites, and only for the client
 * portal. Nothing masks an internal employee response.
 *
 * privacyFieldProjection is deliberately NOT used here. It is an allowlist that denies
 * every field it does not name, so applying it to this response would strip most of the
 * employee record the detail page renders; and getProjectionForRole() falls back to the
 * `hr` policy for any role it does not recognise, which is every role on this route except
 * `hr` itself. That default is fail-open. This module is a denylist over the sensitive
 * identifiers only, which changes nothing else about the payload.
 *
 * ── WHAT IT DOES ─────────────────────────────────────────────────────────────
 * 1. Drops at-rest crypto plumbing from every response, for every role. Ciphertext, blind
 *    indexes and key-version markers are storage internals; no client consumes them
 *    (verified: zero references to *_encrypted, *_blind_index or *_key_version anywhere in
 *    the frontend). Shipping a blind index is strictly worse than useless — it is an
 *    offline-guessable handle to the value it indexes.
 *
 * 2. Masks the raw statutory and bank identifiers for roles with no business need for
 *    them. The role split below is taken from the readiness audit's own role rules:
 *      WFM             "cannot view salary/bank/PII unnecessarily"
 *      Manager         team-only people actions
 *      Process Manager "salary/PII should not appear simply because the manager owns the process"
 *      Branch Head     branch scope must not become organisation-wide access
 *      IT              "zero unnecessary payroll/HR access"
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────────
 * hr, payroll*, finance_head, admin and super_admin keep exactly the access they have
 * today. Masking those is a live question — the audit argues HR access should be
 * exception-based rather than assumed — but it is a workflow decision with real operational
 * consequences, and it is not one a redaction helper should make silently. Narrowing them
 * is a follow-up that needs an explicit ruling, not a default.
 *
 * Unrecognised roles fail CLOSED (masked), the opposite of the projection service's default.
 */

import { maskPii } from "./piiMask.js";
import { isCryptoPlumbingColumn } from "./cryptoColumnHygiene.js";

/**
 * Storage internals. Never leave the API, for any role.
 *
 * Re-exported from cryptoColumnHygiene, which owns the rule — the same stripping is needed
 * on candidate rows in the BGV report, and one shared definition beats two that drift.
 */
export { CRYPTO_PLUMBING_PATTERN } from "./cryptoColumnHygiene.js";

/** Raw identifier columns on `employees`, with the mask shape each one needs. */
export const IDENTIFIER_FIELDS: Record<string, Parameters<typeof maskPii>[1]> = {
  aadhaar_number: "aadhaar",
  pan_number: "pan",
  bank_account_number: "bank_account",
  uan_number: "bank_account",
  ifsc_code: "bank_account",
};

/**
 * Roles that keep raw identifiers — today's behaviour, preserved deliberately.
 *
 * Payroll needs raw PAN/UAN/bank for statutory filing and bank advice; finance_head for
 * payment workflows; hr for statutory onboarding. super_admin is break-glass.
 */
export const RAW_IDENTIFIER_ROLES = new Set([
  "super_admin",
  "admin",
  "hr",
  "hr_head",
  "payroll",
  "payroll_head",
  "payroll_admin",
  "finance_head",
]);

/**
 * True when any of the caller's roles is entitled to raw identifiers.
 *
 * This is a union, and a union is the correct shape here only because these are grants
 * rather than restrictions: holding `payroll` legitimately confers payroll's access no
 * matter what else the user holds. Worth stating because the inverse — a restriction
 * written as a union — is how role checks in this codebase have failed open before, and
 * because branch-scoped users here are known to also carry global `admin`/`finance_head`
 * rows. If that grant inheritance is itself wrong, it is wrong upstream in role assignment;
 * this module must not try to second-guess it by intersecting instead.
 */
export function maySeeRawIdentifiers(roles: readonly string[] | null | undefined): boolean {
  if (!roles || roles.length === 0) return false; // no roles resolved -> fail closed
  return roles.some((r) => RAW_IDENTIFIER_ROLES.has(String(r).trim().toLowerCase()));
}

/**
 * Apply least-data rules to one employee record.
 *
 * Returns a new object; the input is not mutated. A masked field keeps its key so the
 * client still renders a field rather than a missing one — the value simply carries only
 * the last few characters, which is what identity confirmation actually needs.
 */
export function redactEmployeeIdentifiers<T extends Record<string, unknown>>(
  record: T,
  roles: readonly string[] | null | undefined,
): Record<string, unknown> {
  const raw = maySeeRawIdentifiers(roles);
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (isCryptoPlumbingColumn(key)) continue;

    const maskType = IDENTIFIER_FIELDS[key];
    if (maskType && !raw && value != null && String(value).trim() !== "") {
      out[key] = maskPii(String(value), maskType);
      continue;
    }
    out[key] = value;
  }

  return out;
}
