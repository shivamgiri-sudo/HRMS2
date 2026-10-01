import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Demo-bypass sessions: only the demo super_admin is handed the org-wide (ORG_ALL) dashboard scope. A demo `admin`
 * is branch-scoped like hr (owner ruling 2026-10-01) and goes through the normal scope resolver.
 */
const h = vi.hoisted(() => ({
  user: { id: "demo-1", isDemo: true, role: "admin" } as Record<string, unknown>,
  getDrilldown: vi.fn(async (_m: string, scope: unknown) => ({ scope })),
  resolveDashboardScope: vi.fn(async () => ({ level: "BRANCH_ALL", branchIds: ["b1"], processIds: [], employeeIds: [], userId: "demo-1", role: "admin" })),
}));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = h.user; next(); },
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(async () => [[], []]) } }));
vi.mock("../../../shared/roleResolver.js", () => ({
  getUserRoleContext: vi.fn(async () => ({ roleKeys: ["admin"], primaryRole: "admin", isSuperAdmin: false, isHO: false })),
}));
vi.mock("../../../shared/dashboardScope.js", () => ({
  buildScopeWhere: vi.fn(), resolveSelfOnlyDashboardScope: vi.fn(),
  resolveDashboardScope: h.resolveDashboardScope,
  narrowDashboardScope: vi.fn(async (base: unknown) => base),
}));
vi.mock("../../../shared/dashboardAccessRegistry.js", () => ({
  getDashboardDefinition: (code: string) => ({ code }), canAccessDashboard: () => true,
}));
vi.mock("../dashboard-definition.service.js", () => ({
  executeDashboardMetrics: vi.fn(), isMetricConfiguredForDashboard: () => true,
}));
vi.mock("../dashboard-drilldown.service.js", () => ({ getDrilldown: h.getDrilldown }));
vi.mock("../../work-inbox/work-inbox.service.js", () => ({ getUnifiedInboxSummary: vi.fn() }));
vi.mock("../metrics-in-flight.js", () => ({ sharedInFlight: (_k: string, fn: () => unknown) => fn() }));

import { dashboardRouter } from "../dashboard.routes.js";

const app = () => { const a = express(); a.use("/api/dashboards", dashboardRouter); return a; };
const drill = () => request(app()).get("/api/dashboards/HR_DASHBOARD/metric/ANY/drilldown");

beforeEach(() => { h.getDrilldown.mockClear(); h.resolveDashboardScope.mockClear(); });

describe("demo dashboard scope", () => {
  it("demo super_admin keeps the org-wide scope", async () => {
    h.user = { id: "demo-1", isDemo: true, role: "super_admin" };
    const res = await drill();
    expect(res.status).toBe(200);
    expect(h.getDrilldown.mock.calls[0][1]).toMatchObject({ level: "ORG_ALL" });
    expect(h.resolveDashboardScope).not.toHaveBeenCalled();
  });
  it("demo admin is NOT org-wide: it goes through resolveDashboardScope", async () => {
    h.user = { id: "demo-1", isDemo: true, role: "admin" };
    await drill();
    expect(h.resolveDashboardScope).toHaveBeenCalled();
    expect(h.getDrilldown.mock.calls[0]?.[1]).not.toMatchObject({ level: "ORG_ALL" });
  });
});
