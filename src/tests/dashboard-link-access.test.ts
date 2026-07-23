import { describe, expect, it } from "vitest";
import { canAccessDashboardLink } from "../pages/dashboards/dashboardLinkAccess";

describe("dashboard link access", () => {
  it("allows public links for every authenticated user", () => {
    expect(canAccessDashboardLink("/profile", {
      authenticated: true,
      roleKeys: ["employee"],
      pages: [],
      disabledPageCodes: [],
    })).toBe(true);
  });

  it("requires the configured page permission", () => {
    expect(canAccessDashboardLink("/work-inbox", {
      authenticated: true,
      roleKeys: ["employee"],
      pages: [{ page_code: "WORK_INBOX", can_view: false }],
      disabledPageCodes: [],
    })).toBe(false);

    expect(canAccessDashboardLink("/work-inbox", {
      authenticated: true,
      roleKeys: ["employee"],
      pages: [{ page_code: "WORK_INBOX", can_view: true }],
      disabledPageCodes: [],
    })).toBe(true);
  });

  it("honours an explicit disabled-page override", () => {
    expect(canAccessDashboardLink("/work-inbox", {
      authenticated: true,
      roleKeys: ["employee"],
      pages: [{ page_code: "WORK_INBOX", can_view: true }],
      disabledPageCodes: ["WORK_INBOX"],
    })).toBe(false);
  });

  it("allows super admin unless a link is absent from the route catalogue", () => {
    expect(canAccessDashboardLink("/employees", {
      authenticated: true,
      roleKeys: ["super_admin"],
      pages: [],
      disabledPageCodes: [],
    })).toBe(true);
    expect(canAccessDashboardLink("/not-a-real-route", {
      authenticated: true,
      roleKeys: ["super_admin"],
      pages: [],
      disabledPageCodes: [],
    })).toBe(false);
  });
});
