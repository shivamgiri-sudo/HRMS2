import { describe, expect, it } from "vitest";

import { getDemoCred, resolveActiveDemoCredential } from "@/lib/demoCreds";
import { COMMON_USER_PAGE_CODES, ROLE_DASHBOARD_PAGE_CODES } from "@/lib/rbacPageMatrix";

const NON_COMMON_ROLE_DASHBOARD_CODES = ROLE_DASHBOARD_PAGE_CODES.filter(
  (pageCode) => !COMMON_USER_PAGE_CODES.includes(pageCode as any),
);

describe("demo access contract", () => {
  it("resolves the matching CEO demo identity for frontend role and employee gates", () => {
    const credential = resolveActiveDemoCredential(
      { id: "demo-ceo-id", email: "ceo@mascallnet.com" },
      true,
    );

    expect(credential).toMatchObject({
      role: "ceo",
      employeeId: "demo-emp-ceo",
      employeeCode: "EMP-CEO-001",
    });
  });

  it("does not activate demo access when demo mode is disabled or identity does not match", () => {
    expect(resolveActiveDemoCredential(
      { id: "demo-ceo-id", email: "ceo@mascallnet.com" },
      false,
    )).toBeUndefined();

    expect(resolveActiveDemoCredential(
      { id: "another-user", email: "ceo@mascallnet.com" },
      true,
    )).toBeUndefined();
  });

  it.each([
    ["ceo@mascallnet.com", "CEO_DASHBOARD"],
    ["hr@mascallnet.com", "HR_DASHBOARD"],
    ["manager@mascallnet.com", "MANAGEMENT_DASHBOARD"],
    ["finance@mascallnet.com", "PAYROLL_HR_DASHBOARD"],
    ["employee@mascallnet.com", "EMPLOYEE_SELF_DASHBOARD"],
  ])("allows %s to open its role dashboard in demo mode", (email, pageCode) => {
    expect(getDemoCred(email)?.pages).toContain(pageCode);
  });

  it.each(["admin@mascallnet.com", "demo@mascallnet.com"])(
    "does not grant department role-dashboard page codes to admin demo identity %s",
    (email) => {
      const pages = getDemoCred(email)?.pages ?? [];
      expect(pages).toContain("EMPLOYEE_SELF_DASHBOARD");
      expect(pages.filter((pageCode) => NON_COMMON_ROLE_DASHBOARD_CODES.includes(pageCode as any))).toEqual([]);
    },
  );

  it("keeps super-admin demo as the only all-dashboard demo identity", () => {
    const pages = getDemoCred("superadmin@mascallnet.com")?.pages ?? [];
    expect(ROLE_DASHBOARD_PAGE_CODES.every((pageCode) => pages.includes(pageCode))).toBe(true);
  });

  it.each([
    "superadmin@mascallnet.com",
    "admin@mascallnet.com",
    "hr@mascallnet.com",
    "recruiter@mascallnet.com",
    "manager@mascallnet.com",
    "tl@mascallnet.com",
    "qa@mascallnet.com",
    "wfm@mascallnet.com",
    "finance@mascallnet.com",
    "employee@mascallnet.com",
    "ceo@mascallnet.com",
    "trainer@mascallnet.com",
    "demo@mascallnet.com",
  ])("grants common employee pages to %s", (email) => {
    const pages = getDemoCred(email)?.pages ?? [];
    expect(COMMON_USER_PAGE_CODES.every((pageCode) => pages.includes(pageCode))).toBe(true);
  });
});
