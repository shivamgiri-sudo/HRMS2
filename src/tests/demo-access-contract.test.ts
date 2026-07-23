import { describe, expect, it } from "vitest";

import { getDemoCred, resolveActiveDemoCredential } from "@/lib/demoCreds";

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
    ["wfm@mascallnet.com", "WFM_DASHBOARD"],
    ["wfm@mascallnet.com", "WFM_ATTENDANCE_DASHBOARD"],
    ["recruiter@mascallnet.com", "RECRUITER_DASHBOARD"],
    ["manager@mascallnet.com", "MANAGEMENT_DASHBOARD"],
    ["finance@mascallnet.com", "PAYROLL_HR_DASHBOARD"],
    ["operations@mascallnet.com", "OPERATIONS_DASHBOARD"],
    ["it@mascallnet.com", "IT_MANAGER_DASHBOARD"],
    ["employee@mascallnet.com", "EMPLOYEE_SELF_DASHBOARD"],
  ])("allows %s to open its role dashboard in demo mode", (email, pageCode) => {
    expect(getDemoCred(email)?.pages).toContain(pageCode);
  });
});
