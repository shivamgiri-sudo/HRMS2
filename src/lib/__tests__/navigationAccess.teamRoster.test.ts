import { describe, expect, it } from "vitest";
import { canAccessNavItem } from "@/lib/navigationAccess";
import { navGroups } from "@/components/layout/navConfig";
import type { NavItem } from "@/components/layout/SidebarNav";

/**
 * The Team Roster page code is granted to the `employee` role (64 of the 78 real managers hold only
 * that role), so the page grant alone must NOT put the entry in every employee's sidebar. The item is
 * `managerGated`: the grant is the door, and the entry additionally needs a reporting line or a WFM role.
 */
const findItem = (): NavItem => {
  for (const g of navGroups) {
    for (const item of g.items) {
      for (const child of item.children ?? []) if (child.href === "/wfm/team-roster") return child;
      if (item.href === "/wfm/team-roster") return item;
    }
  }
  throw new Error("Team Roster nav item not found");
};

const access = (over: Partial<Parameters<typeof canAccessNavItem>[1]> = {}) => ({
  canViewPage: (code: string) => code === "WFM_TEAM_ROSTER",
  hasAnyRole: (...roles: string[]) => roles.includes("employee"),
  isAdminOrHR: false,
  roleKeys: ["employee"],
  visiblePageCodes: ["WFM_TEAM_ROSTER"],
  isManager: false,
  ...over,
});

describe("Team Roster nav entry", () => {
  const item = findItem();

  it("is registered against the WFM_TEAM_ROSTER page code and marked managerGated", () => {
    expect(item.pageCode).toBe("WFM_TEAM_ROSTER");
    expect(item.managerGated).toBe(true);
    expect(item.roles).toEqual(expect.arrayContaining(["wfm", "branch_wfm", "ho_wfm", "admin", "super_admin"]));
  });

  it("is hidden from an employee with the grant but nobody reporting to them", () => {
    expect(canAccessNavItem(item, access())).toBe(false);
  });

  it("is shown to an employee-role user who has direct reports (is_manager)", () => {
    expect(canAccessNavItem(item, access({ isManager: true }))).toBe(true);
  });

  it("is shown to WFM approvers without reports, and to super_admin", () => {
    expect(canAccessNavItem(item, access({ hasAnyRole: (...roles: string[]) => roles.includes("wfm"), roleKeys: ["wfm"] }))).toBe(true);
    expect(canAccessNavItem(item, access({ hasAnyRole: (...roles: string[]) => roles.includes("super_admin"), roleKeys: ["super_admin"], visiblePageCodes: [], canViewPage: () => false }))).toBe(true);
  });

  it("is never shown without the page grant, even to a manager", () => {
    expect(canAccessNavItem(item, access({ isManager: true, canViewPage: () => false, visiblePageCodes: [] }))).toBe(false);
  });

  it("other page-coded items are unaffected by managerGated (the flag is opt-in)", () => {
    const plain = { href: "/wfm/roster-view", pageCode: "WFM_ROSTER", label: "Roster", icon: null } as unknown as NavItem;
    expect(canAccessNavItem(plain, access({ canViewPage: (c) => c === "WFM_ROSTER", visiblePageCodes: ["WFM_ROSTER"] }))).toBe(true);
  });
});
