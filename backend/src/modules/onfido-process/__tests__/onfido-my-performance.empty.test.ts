import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /my-kpi asks every user for their Onfido numbers; most users have none.
 * An empty range is a normal empty state (200, data: null), not a 404.
 */
const { getAnalystPerformance } = vi.hoisted(() => ({ getAnalystPerformance: vi.fn() }));

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1", email: "a@x.in" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, n: any) => n() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(async () => [[], []]) } }));
vi.mock("../onfido-process-dashboard.service.js", () => ({ getAnalystPerformance }));
vi.mock("../onfido-client-doc-series.service.js", () => ({}));
vi.mock("../onfido-doc-task-type-column.js", () => ({ ensureDocTaskTypeColumn: (_q: any, _s: any, n: any) => n() }));
vi.mock("../onfido-audit-sampling.service.js", () => ({ getAuditSamplingReport: vi.fn() }));
vi.mock("../onfido-response-cache.js", () => ({ onfidoResponseCache: (_q: any, _s: any, n: any) => n() }));
vi.mock("../onfido-export.service.js", () => ({ streamAttritionExitsCsv: vi.fn(), streamRecordsCsv: vi.fn() }));
vi.mock("../onfido-poa-pages.routes.js", () => ({ mountPoaPageRoutes: () => {} }));
vi.mock("../onfido-quality-pages.routes.js", () => ({ mountQualityPageRoutes: () => {} }));
vi.mock("../onfido-overview-report.routes.js", () => ({ mountOverviewReportRoutes: () => {} }));
vi.mock("../onfido-outlier.routes.js", () => ({ mountOutlierRoutes: () => {} }));
vi.mock("../../process-operations/process-operations.service.js", () => ({ readableProcessIds: vi.fn(async () => new Set()) }));

const { onfidoProcessDashboardRouter } = await import("../onfido-process-dashboard.routes.js");
const app = () => { const a = express(); a.use("/api/onfido-process", onfidoProcessDashboardRouter); return a; };

beforeEach(() => getAnalystPerformance.mockReset());

describe("GET /api/onfido-process/my-performance", () => {
  it("returns 200 with data:null when the caller has no Onfido records", async () => {
    getAnalystPerformance.mockResolvedValue(null);
    const res = await request(app()).get("/api/onfido-process/my-performance?from=2026-07-01&to=2026-10-01");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: null });
    expect(getAnalystPerformance).toHaveBeenCalledWith("a@x.in", { from: "2026-07-01", to: "2026-10-01" });
  });

  it("returns the analyst's data when present", async () => {
    getAnalystPerformance.mockResolvedValue({ email: "a@x.in", totalTasks: 5 });
    const res = await request(app()).get("/api/onfido-process/my-performance");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ email: "a@x.in", totalTasks: 5 });
  });
});
