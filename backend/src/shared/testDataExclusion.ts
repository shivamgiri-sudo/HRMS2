/**
 * The exclusion half of test-data classification.
 *
 * Migration 1063 adds `is_test_data` to ats_candidate, employees and process_master. That
 * column on its own achieves nothing — worse than nothing, because a flag that no query
 * filters on looks like a solution while the test rows keep appearing. This module is the
 * half that does the work, and `test-data-exclusion.contract.test.ts` is what stops it
 * quietly falling out of a query later.
 *
 * WHY NOT A VIEW, OR A GLOBAL DEFAULT
 *
 * Both were considered. A view (`employees_real`) would be enforced by construction, which
 * is attractive, but there are 158 foreign keys into `employees` and several hundred
 * queries against it; swapping the table for a view under all of them during a release
 * freeze is a larger change than the problem justifies, and a view that some queries use
 * and others do not is the same inconsistency in a new place.
 *
 * A global filter in the query layer was rejected for a sharper reason: some surfaces MUST
 * see test rows. An admin looking at why a test candidate reached the leaderboard needs to
 * find it. Data-quality tooling needs to count them. Silently hiding rows from every query
 * makes those jobs impossible and makes debugging surreal — the row exists, the ID is
 * valid, and every query says it does not.
 *
 * So exclusion is explicit and per-surface, and the contract test enumerates which surfaces
 * are required to apply it.
 */

/** Tables that carry the classification columns, as of migration 1063. */
export const TEST_DATA_CLASSIFIED_TABLES = ["ats_candidate", "employees", "process_master"] as const;

export type TestDataClassifiedTable = (typeof TEST_DATA_CLASSIFIED_TABLES)[number];

/**
 * SQL predicate excluding test rows for a given table alias.
 *
 * Written as `<alias>.is_test_data = 0` rather than `!= 1` or `IS NOT TRUE` because the
 * column is NOT NULL DEFAULT 0 — there is no third state, and an equality test uses the
 * index. Callers that LEFT JOIN the table must put this in the ON clause, not the WHERE
 * clause, or they turn the outer join into an inner one.
 */
export function excludeTestData(alias: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    // The alias is interpolated into SQL. It is always a literal in our call sites, but
    // rejecting anything else here means it can never become an injection point if a future
    // caller passes something dynamic.
    throw new Error(`Invalid SQL alias for test-data exclusion: ${JSON.stringify(alias)}`);
  }
  return `${alias}.is_test_data = 0`;
}

/**
 * The inverse, for the surfaces that exist specifically to find test data — the admin
 * data-quality view, and the classification script's own verification queries.
 */
export function onlyTestData(alias: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    throw new Error(`Invalid SQL alias for test-data exclusion: ${JSON.stringify(alias)}`);
  }
  return `${alias}.is_test_data = 1`;
}

/**
 * Surfaces that must exclude test data, and why each one matters.
 *
 * This list is the specification the contract test enforces. Adding a surface here without
 * applying the predicate in the file makes the test fail, which is the intended direction:
 * the list is the decision, the code follows it.
 *
 * The Quality leaderboard is first because it is the one that actually failed — a seeded
 * candidate reached rank 2 at 96.67% "Excellent" in front of the CEO during UAT.
 */
export interface ExclusionSite {
  /** Repo-relative file that must apply the predicate. */
  file: string;
  /** What the user sees if the predicate is missing. */
  consequence: string;
}

export const REQUIRED_EXCLUSION_SITES: readonly ExclusionSite[] = [
  {
    file: "src/modules/quality-dashboard/quality-dashboard.routes.ts",
    consequence: "A seeded candidate ranks on the live Quality leaderboard, as it did in UAT Round 2.",
  },
  {
    file: "src/modules/dashboards/dashboard.routes.ts",
    consequence: "Headcount tiles count synthetic employees, so every derived percentage is wrong.",
  },
  {
    file: "src/modules/process-pnl/process-pnl.routes.ts",
    consequence: "Test processes appear in P&L with null cost attribution, distorting per-process margin.",
  },
] as const;
