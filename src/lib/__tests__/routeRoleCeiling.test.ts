import { describe, expect, it } from "vitest";
import { getRouteRoleCeiling } from "@/lib/routeRoleCeiling";
import { canAccessNavItem } from "@/lib/navigationAccess";

const access = (role: string, grants: string[]) => ({
  canViewPage: (c: string) => grants.includes(c),
  hasAnyRole: (...rs: string[]) => rs.includes(role),
  isAdminOrHR: false,
  roleKeys: [role],
  visiblePageCodes: grants,
  isManager: false,
});

describe("route role ceiling", () => {
  it("reads roles from the mounted route guards", () => {
    expect(getRouteRoleCeiling("/security-center")).toEqual(["super_admin"]);
    expect(getRouteRoleCeiling("/settings?tab=x")).toContain("admin");
    expect(getRouteRoleCeiling("/profile")).toBeUndefined();
  });

  it("hides entries the route guard would 403, even with a page grant", () => {
    const item = { href: "/security-center", pageCode: "SECURITY_CENTER" };
    expect(canAccessNavItem(item, access("wfm", ["SECURITY_CENTER"]))).toBe(false);
    expect(canAccessNavItem(item, access("super_admin", []))).toBe(true);
  });

  it("keeps finance away from HR/admin areas but not its own pages", () => {
    expect(canAccessNavItem({ href: "/settings" }, access("finance", ["SETTINGS"]))).toBe(false);
    expect(canAccessNavItem({ href: "/assets" }, access("accounts_head", []))).toBe(false);
    expect(canAccessNavItem({ href: "/finance/grn", pageCode: "FINANCE_GRN" }, access("finance", ["FINANCE_GRN"]))).toBe(true);
  });
});
