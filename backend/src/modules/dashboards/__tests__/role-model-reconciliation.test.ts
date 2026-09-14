import { describe, expect, it } from "vitest";

import {
  DASHBOARD_ACCESS_REGISTRY,
  DASHBOARD_ROLE_ALIASES,
  canAccessDashboard,
  normalizeDashboardRole,
  type DashboardCode,
} from "../../../shared/dashboardAccessRegistry.js";
import {
  SELF_DASHBOARD_ONLY_ROLES,
  WORKFORCE_ROLE_CATALOG,
  isAssignableRole,
} from "../../../shared/workforceRoleCatalog.js";

/**
 * Keeps the dashboard registry aligned to the roles that can actually be assigned.
 *
 * The registry drifted onto role names the database has never held, while roles the
 * business does use were absent — so 20 real users across six roles could not open any
 * dashboard, and nothing in the app reported it. These assertions make that a build
 * failure instead of a support ticket.
 */
const ALL_CODES = Object.keys(DASHBOARD_ACCESS_REGISTRY) as DashboardCode[];

describe("role model reconciliation", () => {
  it("every assignable role reaches at least one dashboard", () => {
    const orphans = WORKFORCE_ROLE_CATALOG.filter(
      (role) => !ALL_CODES.some((code) => canAccessDashboard(code, [role])),
    );

    expect(
      orphans,
      `These roles exist in workforce_role_catalog and can be assigned to users, but ` +
        `reach no dashboard at all:\n  ${orphans.join("\n  ")}`,
    ).toEqual([]);
  });

  it("roles with no dedicated surface still reach the self dashboard", () => {
    for (const role of SELF_DASHBOARD_ONLY_ROLES) {
      expect(
        canAccessDashboard("EMPLOYEE_SELF_DASHBOARD", [role]),
        `${role} is declared self-dashboard-only but cannot open it`,
      ).toBe(true);
    }
  });

  it("any alias a real user can trigger resolves to a real role", () => {
    // Aliases whose SOURCE is not assignable are dormant: no user can hold that key, so
    // the mapping never fires. Only aliases reachable from a real role must resolve to
    // a real role — rewriting a dormant one risks changing scope for no benefit
    // (e.g. branch_hr is BRANCH_ALL while hr is ORG_ALL).
    const bad = Object.entries(DASHBOARD_ROLE_ALIASES)
      .filter(([from]) => isAssignableRole(from))
      .filter(([, target]) => !isAssignableRole(target))
      .map(([from, to]) => `${from} -> ${to}`);

    expect(
      bad,
      `These aliases are reachable from a real role but point at a key that does not ` +
        `exist in workforce_role_catalog:\n  ${bad.join("\n  ")}`,
    ).toEqual([]);
  });

  it("normalisation never maps an assignable role onto a non-existent one", () => {
    const broken = WORKFORCE_ROLE_CATALOG
      .map((role) => [role, normalizeDashboardRole(role)] as const)
      .filter(([, normalized]) => !isAssignableRole(normalized))
      .map(([role, normalized]) => `${role} -> ${normalized}`);

    expect(
      broken,
      `Normalisation rewrites these assignable roles into keys that do not exist:\n  ` +
        broken.join("\n  "),
    ).toEqual([]);
  });

  it("the four head roles added 2026-07-30 reach their function's dashboard", () => {
    // These were created in the catalog with users attached but were unknown to the
    // code, so both holders were locked out entirely.
    expect(canAccessDashboard("IT_MANAGER_DASHBOARD", ["it_head"])).toBe(true);
    expect(canAccessDashboard("QUALITY_DASHBOARD", ["tq_head"])).toBe(true);
    expect(canAccessDashboard("PAYROLL_HR_DASHBOARD", ["finance_head"])).toBe(true);
    expect(canAccessDashboard("PAYROLL_HR_DASHBOARD", ["accounts_head"])).toBe(true);
  });

  it("branch_head reaches the dashboards its scope supports", () => {
    // branch_head holds 7 users and previously resolved to an empty intersection
    // between the code registry and the database page grants.
    expect(canAccessDashboard("MANAGEMENT_DASHBOARD", ["branch_head"])).toBe(true);
    expect(canAccessDashboard("OPERATIONS_DASHBOARD", ["branch_head"])).toBe(true);
    expect(canAccessDashboard("EMPLOYEE_SELF_DASHBOARD", ["branch_head"])).toBe(true);
  });

  it("keeps super_admin able to open every dashboard", () => {
    for (const code of ALL_CODES) {
      expect(canAccessDashboard(code, ["super_admin"]), `super_admin blocked from ${code}`).toBe(true);
    }
  });

  it("does not grant a dashboard to every role indiscriminately", () => {
    // Guards against "fix the orphans by allowing everyone". A plain employee must not
    // reach payroll, quality or the super admin dashboard.
    expect(canAccessDashboard("PAYROLL_HR_DASHBOARD", ["employee"])).toBe(false);
    expect(canAccessDashboard("QUALITY_DASHBOARD", ["employee"])).toBe(false);
    expect(canAccessDashboard("SUPER_ADMIN_DASHBOARD", ["employee"])).toBe(false);
    expect(canAccessDashboard("SUPER_ADMIN_DASHBOARD", ["admin"])).toBe(false);
    expect(canAccessDashboard("PAYROLL_HR_DASHBOARD", ["trainer"])).toBe(false);
  });
});
