import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  hasRole: vi.fn(), hasDirectReports: vi.fn(), scopedPopulation: vi.fn(), getModel: vi.fn(), loadExits: vi.fn(),
}));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1" }; next(); },
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));
vi.mock("../../../shared/enterpriseScope.js", () => ({ resolveUserBusinessScope: vi.fn(), buildEmployeeScopeCondition: vi.fn() }));
vi.mock("../../../shared/accessGuard.js", () => ({ hasRole: m.hasRole, getEmployeeForUser: vi.fn() }));
vi.mock("../../../shared/reportingSpan.js", () => ({ hasDirectReports: m.hasDirectReports, spanClauseFor: vi.fn() }));
// Real service helpers (bucketOf, probabilityFor, ...) with only the I/O entry points replaced.
vi.mock("../attrition-hub.service.js", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getModel: m.getModel, loadExits: m.loadExits, scopedPopulation: m.scopedPopulation,
}));

const { attritionHubRouter } = await import("../attrition-hub.routes.js");
const app = () => { const a = express(); a.use("/api/analytics/attrition-hub", attritionHubRouter); return a; };

const person = (id: string, tier = "LOW") => ({
  id, code: id, name: id, designation: null, process: null, branch: null, manager: null, designationId: null, processId: null, branchId: null, managerId: null,
  source: null, joinDate: "2025-01-01", aonDays: 400, exitDate: null, features: { aonDays: 400 }, score: tier === "LOW" ? 3 : 70, tier,
  factors: { lifecycle: 0, attendance: 0, performance: 0, compensation: 0, conduct: 0, team: 0 }, reasons: [], inNotice: false,
});

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.hasRole.mockResolvedValue(false);
  m.hasDirectReports.mockResolvedValue(false);
  m.getModel.mockResolvedValue({ calibration: [], baseRatePct: 4 });
  m.loadExits.mockResolvedValue({ exits: [], headcountEvents: [] });
  m.scopedPopulation.mockResolvedValue({ asOf: "2026-10-01", people: [person("a", "CRITICAL"), person("b")], degraded: [], orgWide: true });
});

describe("attrition hub routes", () => {
  it("refuses someone who is neither HR/ops nor a people manager", async () => {
    const res = await request(app()).get("/api/analytics/attrition-hub/overview");
    expect(res.status).toBe(403);
    expect(m.scopedPopulation).not.toHaveBeenCalled();
  });

  it("lets a plain-employee team lead in because they have direct reports", async () => {
    m.hasDirectReports.mockResolvedValue(true);
    const res = await request(app()).get("/api/analytics/attrition-hub/risk");
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2);
  });

  it("risk: ignores an unknown tier instead of failing, applies a valid one", async () => {
    m.hasRole.mockResolvedValue(true);
    const bad = await request(app()).get("/api/analytics/attrition-hub/risk?tier=bogus");
    expect(bad.status).toBe(200);
    expect(bad.body.data.total).toBe(2);
    const ok = await request(app()).get("/api/analytics/attrition-hub/risk?tier=critical");
    expect(ok.body.data.total).toBe(1);
  });

  it("overview, insights and alerts answer in the documented envelope", async () => {
    m.hasRole.mockResolvedValue(true);
    for (const path of ["overview", "insights", "alerts"]) {
      const res = await request(app()).get(`/api/analytics/attrition-hub/${path}`);
      expect(res.status, path).toBe(200);
      expect(res.body.success).toBe(true);
    }
  });

  it("employee detail: 404 for someone outside the caller's scope, 200 inside", async () => {
    m.hasRole.mockResolvedValue(true);
    expect((await request(app()).get("/api/analytics/attrition-hub/employee/zzz")).status).toBe(404);
    const ok = await request(app()).get("/api/analytics/attrition-hub/employee/a");
    expect(ok.status).toBe(200);
    expect(ok.body.data.row.employeeId).toBe("a");
    expect(Array.isArray(ok.body.data.signals)).toBe(true);
  });

  it("a model failure does not break the page - probabilities just go missing", async () => {
    m.hasRole.mockResolvedValue(true);
    m.getModel.mockRejectedValue(new Error("db down"));
    const res = await request(app()).get("/api/analytics/attrition-hub/overview");
    expect(res.status).toBe(200);
    expect(res.body.data.degraded).toContain("model-calibration");
  });
});
