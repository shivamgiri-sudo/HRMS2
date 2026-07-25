import { describe, expect, it } from "vitest";

import { getDemoCred, resolveActiveDemoCredential } from "@/lib/demoCreds";

const ROLE_DASHBOARD_CODES = [
  "CEO_DASHBOARD",
  "PAYROLL_HR_DASHBOARD",
  "WFM_DASHBOARD",
  "WFM_ATTENDANCE_DASHBOARD",
  "HR_DASHBOARD",
  "QUALITY_DASHBOARD",
  "OPERATIONS_DASHBOARD",
  "RECRUITER_DASHBOARD",
  "IT_MANAGER_DASHBOARD",
  "MANAGEMENT_DASHBOARD",
  "EMPLOYEE_SELF_DASHBOARD",
  "SUPER_ADMIN_DASHBOARD",
];

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
    "does not grant role-dashboard page codes to admin demo identity %s",
    (email) => {
      const pages = getDemoCred(email)?.pages ?? [];
      expect(pages.filter((pageCode) => ROLE_DASHBOARD_CODES.includes(pageCode))).toEqual([]);
    },
  );

  it("keeps super-admin demo as the only all-dashboard demo identity", () => {
    const pages = getDemoCred("superadmin@mascallnet.com")?.pages ?? [];
    expect(ROLE_DASHBOARD_CODES.every((pageCode) => pages.includes(pageCode))).toBe(true);
  });
});
