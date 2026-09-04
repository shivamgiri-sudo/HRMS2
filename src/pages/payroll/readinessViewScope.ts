/**
 * Which readiness view a user gets, decided from their roles alone.
 *
 * WHY THIS IS ITS OWN MODULE. The Payroll Readiness Dashboard renders one of two entirely different
 * components — an org-wide HO view that calls GET /branch-readiness/summary, or an own-branch view
 * that calls GET /branch-readiness/:branchId. Picking the wrong one does not produce an error a user
 * can act on: the HO view's data request is simply refused, and the empty result renders as
 * "No branches found for 2026-08", which reads as a statement about the month rather than about
 * access. That is what every Branch Head saw on 2026-09-04.
 *
 * The rule was three lines inline in a 1,700-line component, so nothing tested it and nothing could.
 * It is a pure function of the caller's roles, so it belongs where the real role combinations can be
 * asserted against it.
 *
 * THE INVARIANT: `ho` must name exactly the roles that GET /branch-readiness/summary admits
 * (payroll-branch-readiness.routes.ts). Any role classified as HO but refused by that route gets a
 * view it cannot load. `hr` was listed here and is not admitted there — and every Branch Head in
 * production also holds `hr`, so the misclassification hit all of them at once.
 */

/** Roles GET /api/payroll/branch-readiness/summary admits. Keep in step with its requireRole. */
const HO_ROLES = ["payroll_head", "super_admin", "payroll", "admin"] as const;

/**
 * Branch-side roles.
 *
 * payroll_hr is here deliberately. It was missing, so a Branch Payroll HR holding no other branch
 * role matched neither arm and was told they had no access to the page their own job runs on —
 * the same omission the API carried on its scope lists.
 */
const BRANCH_ROLES = ["wfm", "branch_head", "payroll_branch", "payroll_hr", "process_manager"] as const;

export type ReadinessView = "ho" | "own-branch" | "none";

/**
 * HO wins when a user holds both, which is correct: a Payroll Head who also holds branch_head for
 * their own posting still needs the org-wide grid, and their scope rows carry scope_type 'all'.
 */
export function readinessViewFor(roleKeys: readonly string[]): ReadinessView {
  if (roleKeys.some((r) => (HO_ROLES as readonly string[]).includes(r))) return "ho";
  if (roleKeys.some((r) => (BRANCH_ROLES as readonly string[]).includes(r))) return "own-branch";
  return "none";
}
