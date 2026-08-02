/**
 * Page codes that a role is granted while no route is mounted for them.
 *
 * This replaces the bare `KNOWN_UNMAPPED_PAGE_CODES` array that lived inside
 * page-catalog-route-drift.contract.test.ts. That array listed twenty-six codes and nothing
 * else — no reason, no evidence, no decision about what should happen to any of them. Adding
 * a line made the contract pass and asserted nothing, which is the same failure mode the
 * hidden route registry was created to fix.
 *
 * WHY THESE CANNOT SIMPLY BE DELETED FROM THE MATRIX
 *
 * A first attempt at this removed sixteen of these codes from rbacPageMatrix.ts on the
 * reasoning that a grant to a page that does not exist is dead surface. That was wrong, and
 * tests/rbac-applier-safety.test.ts caught it.
 *
 * `LIVE_IMPORTED_PAGE_CODES` is not a wishlist. It is a record of what production's
 * role_page_access table actually granted when it was imported on 2026-08-01, and it exists
 * precisely so that scripts/apply-rbac-page-matrix.mjs does not revoke real access: the
 * applier sets active_status = 0 on every grant absent from the matrix. Deleting an entry
 * there is not a cleanup, it is a revocation — for HELPDESK_KB and ENGAGEMENT_COMMAND_CENTER
 * that meant all 1,357 employees.
 *
 * So the observation stands and the action changes. The codes stay in the matrix, mirroring
 * production. Revoking them in the database is proposed separately and deliberately in
 * backend/sql/1061_revoke_grants_for_unrouted_pages.sql, which is not executed. Once that is
 * applied, the next import drops them from LIVE_IMPORTED_PAGE_CODES on its own — the record
 * follows reality rather than leading it.
 *
 * EVERY ENTRY MUST CARRY A DISPOSITION. If you cannot say what should happen to a code, that
 * is the finding, and `unclassified` is how you say so — not by leaving the field vague.
 */

export type UnroutedDisposition =
  /** No page was ever built. The grant anticipates a feature. */
  | "not-built"
  /** The page existed and was removed; the grant outlived it. */
  | "retired"
  /** Another page does this now; the grant should point there or go. */
  | "superseded"
  /** Inherited from the previous bare allowlist and not yet investigated. */
  | "unclassified";

export interface UnroutedGrantedPageCode {
  code: string;
  disposition: UnroutedDisposition;
  /** What was actually checked to reach that disposition. */
  evidence: string;
  /** What should happen next, and who decides. Empty only for `unclassified`. */
  proposedAction: string;
}

/**
 * The sixteen investigated on 2026-08-03.
 *
 * Each was confirmed to have no mounted route anywhere in src/config/routes, and each was
 * confirmed present in LIVE_IMPORTED_PAGE_CODES — that is, production grants it today. Both
 * halves matter: the first says the grant leads nowhere, the second says removing it from
 * the matrix would revoke live access rather than tidy a list.
 */
const INVESTIGATED: readonly UnroutedGrantedPageCode[] = [
  {
    code: "EMPLOYEE_JOINING_DOCUMENTS",
    disposition: "not-built",
    evidence:
      "The page component exists in src/pages but was never added to any route file. This is " +
      "the clearest case of the sixteen: the work is done and unreachable.",
    proposedAction:
      "Mount the route. This one should probably be built rather than revoked — the component " +
      "is already written and roles already hold the grant.",
  },
  ...(
    [
      ["ATS_INTERVIEW_APPROVALS", "interview approval queue"],
      ["ATS_INTERVIEW_QUEUE", "interviewer's own queue"],
      ["ATS_INTERVIEW_SUBMIT", "interview feedback submission"],
      ["ATS_STATUTORY_ONBOARDING", "statutory onboarding step"],
      ["EMPLOYEE_DASHBOARD", "employee self-service landing"],
      ["ENGAGEMENT_COMMAND_CENTER", "engagement command centre"],
      ["HELPDESK_KB", "helpdesk knowledge base"],
      ["ONBOARDING_REVIEW", "onboarding review screen"],
      ["ONBOARDING_SECTION_STATUS", "per-section onboarding status"],
      ["PAYROLL_ATTENDANCE_OVERRIDES", "payroll attendance override screen"],
      ["PAYROLL_DASHBOARD", "payroll landing dashboard"],
      ["PAYROLL_DEDUCTION_TYPES", "deduction type master"],
      ["PAYROLL_DEDUCTION_UPLOAD", "deduction bulk upload"],
      ["PROVISIONING_APPOINTMENT", "appointment provisioning screen"],
      ["TEAM_ROSTER", "team roster view"],
    ] as const
  ).map(([code, what]): UnroutedGrantedPageCode => ({
    code,
    disposition: "not-built",
    evidence:
      `No route and no page component for the ${what}. Confirmed granted in production via ` +
      `LIVE_IMPORTED_PAGE_CODES, imported from role_page_access on 2026-08-01.`,
    proposedAction:
      "Revoke via backend/sql/1061_revoke_grants_for_unrouted_pages.sql, which archives before " +
      "deleting and keeps the page_catalog row so restoring it later is one INSERT. NOT executed " +
      "— an owner decides whether the feature is coming or the grant goes.",
  })),
];

/**
 * Inherited from the bare allowlist this file replaces.
 *
 * These are recorded honestly as unclassified rather than given invented reasons. The
 * contract asserts this list does not grow, so the debt is fixed in size and visible, and a
 * new unrouted grant cannot be quietly added to it.
 */
const INHERITED_UNCLASSIFIED: readonly string[] = [
  "APPOINTMENT_ESIGN",
  "ATS_OFFER",
  "BENEFITS",
  "CLIENT_MASTER",
  "COACHING",
  "COMPLIANCE_DASHBOARD",
  "CUSTOMIZATION_MANAGER",
  "DIALER_INTEGRATION",
  "EMPLOYEES",
  "EMPLOYEE_EPF_COMPLIANCE",
  "FINANCE_HEAD_DASHBOARD",
  "HELPDESK",
  "IT_MANAGER_DASHBOARD",
  "KPI_DASHBOARD",
  "LEAVE_MANAGEMENT",
  "ORG_CHART",
  "ORG_MASTERS",
  "PERFORMANCE_DASHBOARD",
  "PROCESS_CONFIG",
  "PROCESS_MANAGER_DASHBOARD",
  "PROVISIONING_DASHBOARD",
  "SALARY_PREP",
  "SALARY_PROPOSAL_APPROVALS",
  "SALARY_REGISTER",
  "TEAM_ATTENDANCE",
  "WFM_ROSTER_MANAGER_QUEUE",
];

export const UNROUTED_GRANTED_PAGE_CODES: readonly UnroutedGrantedPageCode[] = [
  ...INVESTIGATED,
  ...INHERITED_UNCLASSIFIED.map((code): UnroutedGrantedPageCode => ({
    code,
    disposition: "unclassified",
    evidence:
      "Inherited from the KNOWN_UNMAPPED_PAGE_CODES array with no recorded reason. Not yet " +
      "investigated; listed so the debt is countable rather than invisible.",
    proposedAction: "",
  })),
];

export const UNROUTED_GRANTED_CODES: readonly string[] = UNROUTED_GRANTED_PAGE_CODES.map(
  (e) => e.code,
).sort();

/** Fixed at the size inherited on 2026-08-03. The contract fails if it grows. */
export const INHERITED_UNCLASSIFIED_COUNT = INHERITED_UNCLASSIFIED.length;
