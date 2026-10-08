import { describe, it, expect } from "vitest";
import {
  getRolePageCodes,
  ROLE_SPECIFIC_PAGE_CODES,
  LIVE_IMPORTED_PAGE_CODES,
  COMMON_USER_PAGE_CODES,
} from "../src/shared/rbacPageMatrix.js";

/**
 * scripts/apply-rbac-page-matrix.mjs sets active_status = 0 on every grant
 * absent from this matrix. The matrix held 148 page codes while production
 * granted 181, so running it would have revoked 158 role/page grants across 20
 * roles — PAYROLL_REIMBURSEMENTS, PAYROLL_RUNNING_BREAKDOWN and HELPDESK_KB for
 * all 1,357 employees, and 24 pages for hr covering onboarding, salary
 * certificates and the payroll control tower.
 *
 * These pin the specific losses that were measured against production, so the
 * applier cannot quietly become destructive again.
 */

const resolves = (role: string, code: string) => getRolePageCodes(role).includes(code);

describe("access that exists in production survives the matrix", () => {
  // Measured from role_page_access on 2026-08-01.
  const MUST_RESOLVE: Array<[string, string]> = [
    ["employee", "PAYROLL_REIMBURSEMENTS"],
    ["employee", "PAYROLL_RUNNING_BREAKDOWN"],
    ["employee", "HELPDESK_KB"],
    ["employee", "ENGAGEMENT_COMMAND_CENTER"],
    ["employee", "PEOPLE_EXPERIENCE_COMMAND_CENTER"],
    ["hr", "SALARY_CERTIFICATE"],
    ["hr", "ONBOARDING_REQUESTS"],
    ["hr", "PAYROLL_ATTENDANCE_CONTROL_TOWER"],
    ["hr", "RESIGNATION_COMMAND_CENTER"],
    ["admin", "CONFIGURATION_CENTER"],
    ["payroll_head", "PAYROLL_HO_QUEUES"],
    ["wfm", "ATTENDANCE_LOOKUP"],
  ];

  it.each(MUST_RESOLVE)("%s keeps %s", (role, code) => {
    expect(
      resolves(role, code),
      `${role} holds ${code} in production; dropping it here makes the applier revoke it`,
    ).toBe(true);
  });

  it("covers every role that had production-only grants", () => {
    // 20 roles were affected. If this shrinks, someone deleted an import.
    expect(Object.keys(LIVE_IMPORTED_PAGE_CODES).length).toBeGreaterThanOrEqual(20);
  });
});

describe("imported grants stay distinguishable from chosen ones", () => {
  it("keeps the two sets separate", () => {
    // Merging them would make a grant nobody chose look like one somebody did.
    expect(LIVE_IMPORTED_PAGE_CODES).not.toBe(ROLE_SPECIFIC_PAGE_CODES);
  });

  it("does not silently duplicate a code the curated matrix already grants", () => {
    // Not an error if it happens — getRolePageCodes de-duplicates — but a large
    // overlap would mean the import was computed against the wrong baseline.
    let overlap = 0;
    for (const [role, codes] of Object.entries(LIVE_IMPORTED_PAGE_CODES)) {
      const curated = new Set(
        (ROLE_SPECIFIC_PAGE_CODES[role as keyof typeof ROLE_SPECIFIC_PAGE_CODES] ?? []) as readonly string[],
      );
      overlap += (codes as readonly string[]).filter((c) => curated.has(c)).length;
    }
    expect(overlap).toBe(0);
  });

  it("still de-duplicates against the common pages", () => {
    for (const role of Object.keys(LIVE_IMPORTED_PAGE_CODES)) {
      const resolved = getRolePageCodes(role);
      expect(new Set(resolved).size).toBe(resolved.length);
    }
  });
});

describe("the Quality work is unaffected", () => {
  it("still grants the Quality pages the earlier commit added", () => {
    // The import must not have displaced the curated Quality grants.
    expect(resolves("qa", "CALL_MASTER")).toBe(true);
    expect(resolves("tq_head", "QUALITY_EXECUTIVE")).toBe(true);
    expect(resolves("coo", "QUALITY_DASHBOARD")).toBe(true);
  });

  it("leaves super_admin resolution alone", () => {
    // super_admin takes exactly the caller's active page list, with no union.
    expect(getRolePageCodes("super_admin", ["ONLY_THIS"])).toEqual(["ONLY_THIS"]);
  });

  it("keeps the CEO exclusion working through the import", () => {
    expect(getRolePageCodes("ceo")).not.toContain("MY_KPI");
    expect(COMMON_USER_PAGE_CODES).toContain("MY_KPI");
  });
});
