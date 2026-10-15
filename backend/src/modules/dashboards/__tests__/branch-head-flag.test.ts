import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1" }; next(); },
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(async () => [[], []]) } }));
vi.mock("../../../shared/roleResolver.js", () => ({
  getUserRoleContext: vi.fn(async () => ({ roleKeys: ["branch_head"], primaryRole: "branch_head", isSuperAdmin: false, isHO: false })),
}));
vi.mock("../../../shared/dashboardScope.js", () => ({
  buildScopeWhere: vi.fn(), resolveSelfOnlyDashboardScope: vi.fn(),
  resolveDashboardScope: vi.fn(async () => ({ level: "BRANCH_ALL", branchIds: ["b1"], processIds: [], employeeIds: [], userId: "u1", role: "branch_head" })),
  narrowDashboardScope: vi.fn(async (b: unknown) => b),
}));
vi.mock("../../../shared/dashboardAccessRegistry.js", () => ({
  getDashboardDefinition: (code: string) => ({ code }), canAccessDashboard: () => true,
  DASHBOARD_ACCESS_REGISTRY: { BRANCH_HEAD_DASHBOARD: { code: "BRANCH_HEAD_DASHBOARD" }, HR_DASHBOARD: { code: "HR_DASHBOARD" } },
}));
vi.mock("../dashboard-definition.service.js", () => ({
  executeDashboardMetrics: vi.fn(async () => ({})), isMetricConfiguredForDashboard: () => true,
}));
vi.mock("../dashboard-drilldown.service.js", () => ({ getDrilldown: vi.fn(async () => ({})) }));
vi.mock("../../work-inbox/work-inbox.service.js", () => ({ getUnifiedInboxSummary: vi.fn() }));
vi.mock("../metrics-in-flight.js", () => ({ sharedInFlight: (_k: string, fn: () => unknown) => fn() }));

import { dashboardRouter } from "../dashboard.routes.js";
const app = () => { const a = express(); a.use("/api/dashboards", dashboardRouter); return a; };

beforeEach(() => { delete process.env.BRANCH_HEAD_HEALTH_ENABLED; });
afterEach(() => { delete process.env.BRANCH_HEAD_HEALTH_ENABLED; });

describe("BRANCH_HEAD_DASHBOARD feature flag", () => {
  it("is 404 while flag off", async () => {
    const r = await request(app()).get("/api/dashboards/BRANCH_HEAD_DASHBOARD/summary");
    expect(r.status).toBe(404);
  });
  it("is not listed in access-registry while flag off, listed when on", async () => {
    let r = await request(app()).get("/api/dashboards/access-registry");
    expect(r.body.data.dashboards.map((d: any) => d.code)).toEqual(["HR_DASHBOARD"]);
    process.env.BRANCH_HEAD_HEALTH_ENABLED = "true";
    r = await request(app()).get("/api/dashboards/access-registry");
    expect(r.body.data.dashboards.map((d: any) => d.code)).toContain("BRANCH_HEAD_DASHBOARD");
  });
  it("is reachable when flag on", async () => {
    process.env.BRANCH_HEAD_HEALTH_ENABLED = "true";
    const r = await request(app()).get("/api/dashboards/BRANCH_HEAD_DASHBOARD/summary");
    expect(r.status).not.toBe(404);
  });
});
