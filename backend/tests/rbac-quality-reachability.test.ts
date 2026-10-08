import { describe, it, expect } from "vitest";
import {
  ROLE_SPECIFIC_PAGE_CODES,
  COMMON_USER_PAGE_CODES,
} from "../src/shared/rbacPageMatrix.js";

/**
 * Every Quality, Operations and Call Master page was granted to no role at all.
 * `super_admin` is special-cased to receive every active page_catalog row, so
 * the pages opened fine for whoever built them and for nobody else.
 *
 * That alone was survivable. What made it dangerous is
 * backend/scripts/apply-rbac-page-matrix.mjs --apply, which sets
 * active_status = 0 on every grant NOT present in this matrix. Any grant added
 * directly in SQL is therefore temporary, and running the applier would have
 * revoked Quality and Call Master access outright.
 *
 * So this file asserts reachability in the matrix itself, which is the only
 * place the applier treats as authoritative.
 */

const rolesGranting = (code: string): string[] =>
  Object.entries(ROLE_SPECIFIC_PAGE_CODES)
    .filter(([, codes]) => (codes as readonly string[]).includes(code))
    .map(([role]) => role);

/** Mounted routes whose Gate pageCode had zero grants before this was fixed. */
const QUALITY_AND_OPS_PAGES = [
  "QUALITY_DASHBOARD",
  "QUALITY_EXECUTIVE",
  "QUALITY_TEAM",
  "OPERATIONS_DASHBOARD",
  "OPERATIONS_KPI",
  "CALL_MASTER",
  "CALL_MASTER_INBOUND",
  "SALES_BRAND_ANALYTICS",
  "PERFORMANCE_HUB",
  "AGENT_PERFORMANCE",
] as const;

describe("Quality and Operations pages are reachable without super_admin", () => {
  it.each(QUALITY_AND_OPS_PAGES)("%s is granted to at least one role", (code) => {
    const roles = rolesGranting(code);
    expect(
      roles.length,
      `${code} is on a mounted route but no role grants it, so only super_admin can open it`,
    ).toBeGreaterThan(0);
  });

  it("gives the quality roles a quality page", () => {
    // A QA analyst who cannot open a quality page is not a configured role.
    for (const role of ["qa", "quality_analyst", "tq_head"]) {
      const codes = ROLE_SPECIFIC_PAGE_CODES[role as keyof typeof ROLE_SPECIFIC_PAGE_CODES] as readonly string[];
      expect(codes.some((c) => c.startsWith("QUALITY_")), `${role} has no QUALITY_* page`).toBe(true);
    }
  });

  it("gives the operations roles an operations page", () => {
    for (const role of ["operations_manager", "process_manager", "branch_head"]) {
      const codes = ROLE_SPECIFIC_PAGE_CODES[role as keyof typeof ROLE_SPECIFIC_PAGE_CODES] as readonly string[];
      expect(codes.includes("OPERATIONS_DASHBOARD"), `${role} cannot open the operations dashboard`).toBe(true);
    }
  });
});

describe("roles with real users have a matrix entry", () => {
  // Live counts from user_roles on 2026-08-01. A role missing from the matrix
  // silently collapses to COMMON_USER_PAGE_CODES no matter what the routers say.
  const ROLES_WITH_USERS = [
    "employee", "process_manager", "hr", "recruiter", "wfm", "admin",
    "interviewer", "it", "team_leader", "manager", "branch_head", "ceo",
    "branch_admin", "payroll_hr", "trainer", "qa", "payroll", "finance",
  ] as const;

  it.each(ROLES_WITH_USERS)("%s is defined in the matrix", (role) => {
    expect(
      Object.prototype.hasOwnProperty.call(ROLE_SPECIFIC_PAGE_CODES, role),
      `${role} has active users but no matrix entry, so it receives only the ${COMMON_USER_PAGE_CODES.length} common pages`,
    ).toBe(true);
  });

  it("keeps coo defined, since routes and dashboards already reference it", () => {
    // coo appears in ~15 route role lists and three dashboard registries while
    // being absent from every role definition source.
    expect(ROLE_SPECIFIC_PAGE_CODES).toHaveProperty("coo");
    expect((ROLE_SPECIFIC_PAGE_CODES.coo as readonly string[]).length).toBeGreaterThan(0);
  });
});
