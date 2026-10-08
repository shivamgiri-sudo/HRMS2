import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
vi.mock("../src/db/supabaseAdmin.js", () => ({
    supabaseAdmin: {},
    supabaseAuthClient: { auth: { getUser: vi.fn() } },
}));
vi.mock("../src/db/mysql.js", () => ({ db: { execute: vi.fn().mockResolvedValue([[], []]) }, pingDb: vi.fn() }));
vi.mock("../src/modules/kpi/kpi.service.js", () => ({
    kpiService: {
        listMetrics: vi.fn(),
        createMetric: vi.fn(),
        listTemplates: vi.fn(),
        createTemplate: vi.fn(),
        listTemplateMetrics: vi.fn(),
        addTemplateMetric: vi.fn(),
        assignTemplate: vi.fn(),
        getEmployeeTemplate: vi.fn(),
        recordScore: vi.fn(),
        bulkRecordScores: vi.fn(),
        getEmployeeSummary: vi.fn(),
        getLeaderboard: vi.fn(),
    },
}));
import { supabaseAuthClient } from "../src/db/supabaseAdmin.js";
import { kpiService } from "../src/modules/kpi/kpi.service.js";
import { app } from "../src/app.js";
const mockGetUser = supabaseAuthClient.auth.getUser;
const svc = kpiService;
const AUTH = { Authorization: "Bearer valid.token" };
beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1", email: "admin@mcn.com" } }, error: null });
});
const fakeMetric = { id: "met-1", metric_code: "AHT", category: "operations" };
const fakeTemplate = { id: "tpl-1", template_name: "Ops Agent BPO" };
const fakeSummary = { weighted_score_pct: 99.5, rating: "A", metrics: [] };
// Metrics
describe("GET /api/kpi/metrics", () => {
    it("returns metrics", async () => {
        svc.listMetrics.mockResolvedValueOnce([fakeMetric]);
        const r = await request(app).get("/api/kpi/metrics").set(AUTH);
        expect(r.status).toBe(200);
        expect(r.body.data).toHaveLength(1);
    });
    it("returns 401 without auth", async () => {
        expect((await request(app).get("/api/kpi/metrics")).status).toBe(401);
    });
});
describe("POST /api/kpi/metrics", () => {
    it("creates metric", async () => {
        svc.createMetric.mockResolvedValueOnce(fakeMetric);
        const r = await request(app).post("/api/kpi/metrics").set(AUTH).send({
            metricCode: "AHT", metricName: "Avg Handle Time", category: "operations", unit: "seconds", direction: "lower_is_better",
        });
        expect(r.status).toBe(201);
    });
    it("returns 400 for invalid category", async () => {
        const r = await request(app).post("/api/kpi/metrics").set(AUTH).send({
            metricCode: "X", metricName: "X", category: "invalid", unit: "count", direction: "higher_is_better",
        });
        expect(r.status).toBe(400);
    });
});
// Templates
describe("GET /api/kpi/templates", () => {
    it("returns templates", async () => {
        svc.listTemplates.mockResolvedValueOnce([fakeTemplate]);
        const r = await request(app).get("/api/kpi/templates").set(AUTH);
        expect(r.status).toBe(200);
    });
});
describe("POST /api/kpi/templates", () => {
    it("creates template", async () => {
        svc.createTemplate.mockResolvedValueOnce(fakeTemplate);
        const r = await request(app).post("/api/kpi/templates").set(AUTH)
            .send({ templateName: "Ops Agent BPO" });
        expect(r.status).toBe(201);
    });
    it("returns 400 when templateName missing", async () => {
        const r = await request(app).post("/api/kpi/templates").set(AUTH).send({});
        expect(r.status).toBe(400);
    });
});
describe("GET /api/kpi/templates/:id/metrics", () => {
    it("returns template metrics", async () => {
        svc.listTemplateMetrics.mockResolvedValueOnce([{ metric_code: "AHT", weight_pct: 40 }]);
        const r = await request(app).get("/api/kpi/templates/tpl-1/metrics").set(AUTH);
        expect(r.status).toBe(200);
    });
});
describe("POST /api/kpi/templates/:id/metrics", () => {
    it("adds metric to template", async () => {
        svc.addTemplateMetric.mockResolvedValueOnce({ target_value: 300, weight_pct: 40 });
        const r = await request(app).post("/api/kpi/templates/tpl-1/metrics").set(AUTH).send({
            metricId: "550e8400-e29b-41d4-a716-446655440000", targetValue: 300, weightPct: 40,
        });
        expect(r.status).toBe(201);
    });
    it("returns 400 when weightPct > 100", async () => {
        const r = await request(app).post("/api/kpi/templates/tpl-1/metrics").set(AUTH).send({
            metricId: "550e8400-e29b-41d4-a716-446655440000", targetValue: 300, weightPct: 150,
        });
        expect(r.status).toBe(400);
    });
});
// Assignments
describe("POST /api/kpi/assignments", () => {
    it("assigns template to designation", async () => {
        svc.assignTemplate.mockResolvedValueOnce({ id: "asgn-1", designation_id: "des-1" });
        const r = await request(app).post("/api/kpi/assignments").set(AUTH).send({
            templateId: "550e8400-e29b-41d4-a716-446655440001",
            designationId: "550e8400-e29b-41d4-a716-446655440002",
        });
        expect(r.status).toBe(201);
    });
    it("returns 400 when no target specified", async () => {
        const r = await request(app).post("/api/kpi/assignments").set(AUTH).send({
            templateId: "550e8400-e29b-41d4-a716-446655440001",
        });
        expect(r.status).toBe(400);
    });
});
describe("GET /api/kpi/assignments/employee/:employeeId", () => {
    it("returns active template for employee", async () => {
        svc.getEmployeeTemplate.mockResolvedValueOnce({ template_id: "tpl-1" });
        const r = await request(app).get("/api/kpi/assignments/employee/emp-1").set(AUTH);
        expect(r.status).toBe(200);
    });
});
// Scores
describe("POST /api/kpi/scores", () => {
    it("records single score", async () => {
        svc.recordScore.mockResolvedValueOnce({ actual_value: 280 });
        const r = await request(app).post("/api/kpi/scores").set(AUTH).send({
            employeeId: "550e8400-e29b-41d4-a716-446655440000",
            metricId: "550e8400-e29b-41d4-a716-446655440001",
            period: "2026-05",
            actualValue: 280,
        });
        expect(r.status).toBe(201);
    });
    it("returns 400 for invalid period format", async () => {
        const r = await request(app).post("/api/kpi/scores").set(AUTH).send({
            employeeId: "550e8400-e29b-41d4-a716-446655440000",
            metricId: "550e8400-e29b-41d4-a716-446655440001",
            period: "May-2026",
            actualValue: 280,
        });
        expect(r.status).toBe(400);
    });
});
describe("POST /api/kpi/scores/bulk", () => {
    it("records multiple scores", async () => {
        svc.bulkRecordScores.mockResolvedValueOnce({ recorded: 3 });
        const r = await request(app).post("/api/kpi/scores/bulk").set(AUTH).send({
            period: "2026-05",
            scores: [
                { employeeId: "550e8400-e29b-41d4-a716-446655440000", metricId: "550e8400-e29b-41d4-a716-446655440001", actualValue: 280 },
            ],
        });
        expect(r.status).toBe(200);
        expect(r.body.data.recorded).toBe(3);
    });
});
// Summary
describe("GET /api/kpi/summary/:employeeId/:templateId/:period", () => {
    it("returns weighted score and rating", async () => {
        svc.getEmployeeSummary.mockResolvedValueOnce(fakeSummary);
        const r = await request(app).get("/api/kpi/summary/emp-1/tpl-1/2026-05").set(AUTH);
        expect(r.status).toBe(200);
        expect(r.body.data.rating).toBe("A");
    });
});
// Leaderboard
describe("GET /api/kpi/leaderboard", () => {
    it("returns ranked list", async () => {
        svc.getLeaderboard.mockResolvedValueOnce([
            { employee_id: "emp-1", weighted_score_pct: 102, rating: "S" },
        ]);
        const r = await request(app).get("/api/kpi/leaderboard?period=2026-05&templateId=550e8400-e29b-41d4-a716-446655440001").set(AUTH);
        expect(r.status).toBe(200);
        expect(r.body.data).toHaveLength(1);
    });
    it("returns 400 when period missing", async () => {
        const r = await request(app).get("/api/kpi/leaderboard").set(AUTH);
        expect(r.status).toBe(400);
    });
});
