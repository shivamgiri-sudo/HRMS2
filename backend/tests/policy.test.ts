import { describe, it, expect } from "vitest";
import { Role, expandRoles, PAYROLL_ROLES, PII_READ_ROLES } from "../src/platform/policy/roles.js";
import { Permission, can, assertPermission } from "../src/platform/policy/permissions.js";

describe("Role enum", () => {
  it("all Role values are non-empty strings", () => {
    for (const [key, value] of Object.entries(Role)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it("no two Role enum entries have the same value", () => {
    const values = Object.values(Role);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});

describe("expandRoles", () => {
  it("expands manager to include process_manager", () => {
    const result = expandRoles([Role.MANAGER]);
    expect(result).toContain(Role.PROCESS_MANAGER);
  });

  it("expands process_manager to include manager", () => {
    const result = expandRoles([Role.PROCESS_MANAGER]);
    expect(result).toContain(Role.MANAGER);
  });

  it("expands tl to include team_leader", () => {
    const result = expandRoles([Role.TL]);
    expect(result).toContain(Role.TEAM_LEADER);
  });

  it("expands wfm to include wfm_analyst", () => {
    const result = expandRoles([Role.WFM]);
    expect(result).toContain(Role.WFM_ANALYST);
  });

  it("preserves original roles in expansion", () => {
    const result = expandRoles([Role.ADMIN, Role.HR_ADMIN]);
    expect(result).toContain(Role.ADMIN);
    expect(result).toContain(Role.HR_ADMIN);
  });

  it("does not produce duplicates", () => {
    const result = expandRoles([Role.MANAGER, Role.PROCESS_MANAGER]);
    const unique = new Set(result);
    expect(unique.size).toBe(result.length);
  });
});

describe("can() — permission checks", () => {
  it("super_admin satisfies every permission", () => {
    for (const perm of Object.values(Permission)) {
      expect(can([Role.SUPER_ADMIN], perm)).toBe(true);
    }
  });

  it("employee cannot run payroll", () => {
    expect(can([Role.EMPLOYEE], Permission.PAYROLL_RUN)).toBe(false);
  });

  it("payroll_head can run payroll", () => {
    expect(can([Role.PAYROLL_HEAD], Permission.PAYROLL_RUN)).toBe(true);
  });

  it("employee can view own payslip", () => {
    expect(can([Role.EMPLOYEE], Permission.PAYROLL_VIEW_SELF)).toBe(true);
  });

  it("employee cannot view all payroll", () => {
    expect(can([Role.EMPLOYEE], Permission.PAYROLL_VIEW_ALL)).toBe(false);
  });

  it("client cannot read employee PII", () => {
    expect(can([Role.CLIENT], Permission.EMPLOYEE_PII_READ)).toBe(false);
  });

  it("client can read portal process data", () => {
    expect(can([Role.CLIENT], Permission.PORTAL_PROCESS_READ)).toBe(true);
  });

  it("hr_admin can read employee PII", () => {
    expect(can([Role.HR_ADMIN], Permission.EMPLOYEE_PII_READ)).toBe(true);
  });

  it("returns false for empty role array", () => {
    expect(can([], Permission.EMPLOYEE_READ)).toBe(false);
  });

  it("returns false for unknown role", () => {
    expect(can(["nonexistent_role" as any], Permission.EMPLOYEE_READ)).toBe(false);
  });
});

describe("assertPermission()", () => {
  it("does not throw when permission is satisfied", () => {
    expect(() => assertPermission([Role.ADMIN], Permission.MIGRATION_CONSOLE)).not.toThrow();
  });

  it("throws with status 403 when denied", () => {
    expect(() => assertPermission([Role.EMPLOYEE], Permission.MIGRATION_CONSOLE)).toThrow();
    try {
      assertPermission([Role.EMPLOYEE], Permission.MIGRATION_CONSOLE);
    } catch (err: any) {
      expect(err.status).toBe(403);
      expect(err.payload.success).toBe(false);
    }
  });
});

describe("PAYROLL_ROLES invariants", () => {
  it("client is not in PAYROLL_ROLES", () => {
    expect(PAYROLL_ROLES).not.toContain(Role.CLIENT);
  });

  it("employee is not in PAYROLL_ROLES", () => {
    expect(PAYROLL_ROLES).not.toContain(Role.EMPLOYEE);
  });

  it("payroll_head is in PAYROLL_ROLES", () => {
    expect(PAYROLL_ROLES).toContain(Role.PAYROLL_HEAD);
  });
});

describe("PII_READ_ROLES invariants", () => {
  it("client is not in PII_READ_ROLES", () => {
    expect(PII_READ_ROLES).not.toContain(Role.CLIENT);
  });

  it("employee is not in PII_READ_ROLES", () => {
    expect(PII_READ_ROLES).not.toContain(Role.EMPLOYEE);
  });
});
