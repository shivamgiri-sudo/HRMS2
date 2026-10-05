import { describe, it, expect, vi } from "vitest";

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(), getConnection: vi.fn() } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));
vi.mock("../salaryIncrement.notifications.js", () => ({ notifySalaryIncrementLetter: vi.fn() }));

import { INCREMENT_TRANSITIONS, INCREMENT_ROLE_GATES } from "../salaryIncrement.service.js";

describe("increment workflow: no Finance step, the Payroll Head is the last approval", () => {
  it("has no finance validation action", () => {
    expect(Object.keys(INCREMENT_TRANSITIONS)).not.toContain("finance_validate");
    expect(Object.keys(INCREMENT_ROLE_GATES)).not.toContain("finance_validate");
    for (const roles of Object.values(INCREMENT_ROLE_GATES)) expect(roles).not.toContain("finance");
  });

  it("only the Payroll Head or super admin approves and applies", () => {
    expect(INCREMENT_ROLE_GATES.approve).toEqual(["payroll_head", "super_admin"]);
    expect(INCREMENT_ROLE_GATES.implement).toEqual(["payroll_head", "super_admin"]);
    expect(INCREMENT_ROLE_GATES.approve).not.toContain("hr");
  });

  it("HR can still raise-side steps: validate, reject, cancel, withdraw", () => {
    for (const a of ["hr_validate", "reject", "cancel", "withdraw"] as const) expect(INCREMENT_ROLE_GATES[a]).toContain("hr");
  });

  it("approval is possible straight from submitted (HR validation is optional) and from the legacy finance_validated status", () => {
    expect(INCREMENT_TRANSITIONS.approve.from).toEqual(expect.arrayContaining(["submitted", "hr_validated", "finance_validated"]));
    expect(INCREMENT_TRANSITIONS.approve.to).toBe("approved");
    expect(INCREMENT_TRANSITIONS.implement.from).toEqual(["approved"]);
  });
});
