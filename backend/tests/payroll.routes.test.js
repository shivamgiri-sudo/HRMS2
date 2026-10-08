import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
vi.mock("../src/db/supabaseAdmin.js", () => ({
    supabaseAdmin: {},
    supabaseAuthClient: { auth: { getUser: vi.fn() } },
}));
vi.mock("../src/db/mysql.js", () => ({ db: { execute: vi.fn().mockResolvedValue([[], []]) }, pingDb: vi.fn() }));
vi.mock("../src/modules/payroll/payroll.service.js", () => ({
    payrollService: {
        listStructures: vi.fn(),
        createStructure: vi.fn(),
        listComponents: vi.fn(),
        createComponent: vi.fn(),
        assignSalary: vi.fn(),
        getEmployeeSalary: vi.fn(),
        createRun: vi.fn(),
        getRun: vi.fn(),
        updateRunStatus: vi.fn(),
        listRuns: vi.fn(),
        listLines: vi.fn(),
        updateLine: vi.fn(),
        createAdvance: vi.fn(),
        listAdvances: vi.fn(),
        getStatutoryConfig: vi.fn(),
        calculateNetSalary: vi.fn(),
    },
}));
import { supabaseAuthClient } from "../src/db/supabaseAdmin.js";
import { payrollService } from "../src/modules/payroll/payroll.service.js";
import { db } from "../src/db/mysql.js";
import { app } from "../src/app.js";
const mockGetUser = supabaseAuthClient.auth.getUser;
const svc = payrollService;
const mockExecute = db.execute;
const AUTH = { Authorization: "Bearer valid.token" };
const fakeStructure = { id: "str-1", structure_code: "BPO_A", structure_name: "BPO Grade A" };
const fakeComponent = { id: "cmp-1", component_code: "BASIC", component_type: "earning" };
const fakeRun = { id: "run-1", run_month: "2026-05", status: "draft" };
const fakeLine = { id: "line-1", run_id: "run-1", employee_code: "MCN001", net_salary: 22000 };
const fakeAssignment = { id: "asgn-1", employee_id: "emp-1", ctc_annual: 300000 };
const fakeAdvance = { id: "adv-1", employee_id: "emp-1", amount: 5000 };
beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1", email: "admin@mcn.com" } }, error: null });
});
// Structures
describe("GET /api/payroll/structures", () => {
    it("returns structures", async () => {
        svc.listStructures.mockResolvedValueOnce([fakeStructure]);
        const r = await request(app).get("/api/payroll/structures").set(AUTH);
        expect(r.status).toBe(200);
        expect(r.body.data).toHaveLength(1);
    });
    it("returns 401 without auth", async () => {
        expect((await request(app).get("/api/payroll/structures")).status).toBe(401);
    });
});
describe("POST /api/payroll/structures", () => {
    it("creates structure", async () => {
        mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);
        svc.createStructure.mockResolvedValueOnce(fakeStructure);
        const r = await request(app).post("/api/payroll/structures").set(AUTH)
            .send({ structureCode: "BPO_A", structureName: "BPO Grade A" });
        expect(r.status).toBe(201);
    });
    it("returns 400 for empty code", async () => {
        mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);
        const r = await request(app).post("/api/payroll/structures").set(AUTH)
            .send({ structureCode: "", structureName: "X" });
        expect(r.status).toBe(400);
    });
});
// Components
describe("GET /api/payroll/components", () => {
    it("returns components", async () => {
        svc.listComponents.mockResolvedValueOnce([fakeComponent]);
        const r = await request(app).get("/api/payroll/components").set(AUTH);
        expect(r.status).toBe(200);
    });
});
describe("POST /api/payroll/components", () => {
    it("creates component", async () => {
        mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);
        svc.createComponent.mockResolvedValueOnce(fakeComponent);
        const r = await request(app).post("/api/payroll/components").set(AUTH)
            .send({ componentCode: "BASIC", componentName: "Basic Salary", componentType: "earning" });
        expect(r.status).toBe(201);
    });
    it("returns 400 for invalid componentType", async () => {
        mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);
        const r = await request(app).post("/api/payroll/components").set(AUTH)
            .send({ componentCode: "X", componentName: "X", componentType: "bonus" });
        expect(r.status).toBe(400);
    });
});
// Salary assignment
describe("POST /api/payroll/salary-assignments", () => {
    it("assigns salary", async () => {
        mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);
        svc.assignSalary.mockResolvedValueOnce(fakeAssignment);
        const r = await request(app).post("/api/payroll/salary-assignments").set(AUTH).send({
            employeeId: "550e8400-e29b-41d4-a716-446655440000",
            structureId: "550e8400-e29b-41d4-a716-446655440001",
            ctcAnnual: 300000,
            effectiveFrom: "2026-01-01",
        });
        expect(r.status).toBe(201);
    });
    it("returns 400 for negative CTC", async () => {
        mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);
        const r = await request(app).post("/api/payroll/salary-assignments").set(AUTH).send({
            employeeId: "550e8400-e29b-41d4-a716-446655440000",
            structureId: "550e8400-e29b-41d4-a716-446655440001",
            ctcAnnual: -1,
            effectiveFrom: "2026-01-01",
        });
        expect(r.status).toBe(400);
    });
});
describe("GET /api/payroll/salary-assignments/:employeeId", () => {
    it("returns assignment", async () => {
        mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);
        svc.getEmployeeSalary.mockResolvedValueOnce(fakeAssignment);
        const r = await request(app).get("/api/payroll/salary-assignments/emp-1").set(AUTH);
        expect(r.status).toBe(200);
        expect(r.body.data.ctc_annual).toBe(300000);
    });
    it("returns null when no assignment", async () => {
        mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);
        svc.getEmployeeSalary.mockResolvedValueOnce(null);
        const r = await request(app).get("/api/payroll/salary-assignments/emp-nope").set(AUTH);
        expect(r.status).toBe(200);
        expect(r.body.data).toBeNull();
    });
});
// Prep Runs
describe("POST /api/payroll/runs", () => {
    it("creates run", async () => {
        mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);
        svc.createRun.mockResolvedValueOnce(fakeRun);
        const r = await request(app).post("/api/payroll/runs").set(AUTH)
            .send({ runMonth: "2026-05" });
        expect(r.status).toBe(201);
        expect(r.body.data.run_month).toBe("2026-05");
    });
    it("returns 400 for invalid runMonth format", async () => {
        mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);
        const r = await request(app).post("/api/payroll/runs").set(AUTH)
            .send({ runMonth: "May-2026" });
        expect(r.status).toBe(400);
    });
});
describe("GET /api/payroll/runs", () => {
    it("returns paginated runs", async () => {
        svc.listRuns.mockResolvedValueOnce({ data: [fakeRun], total: 1, page: 1, limit: 50 });
        const r = await request(app).get("/api/payroll/runs").set(AUTH);
        expect(r.status).toBe(200);
        expect(r.body.data).toHaveLength(1);
    });
});
describe("GET /api/payroll/runs/:id", () => {
    it("returns run", async () => {
        svc.getRun.mockResolvedValueOnce(fakeRun);
        const r = await request(app).get("/api/payroll/runs/run-1").set(AUTH);
        expect(r.status).toBe(200);
    });
});
describe("PATCH /api/payroll/runs/:id/status", () => {
    it("advances run status", async () => {
        mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);
        svc.updateRunStatus.mockResolvedValueOnce({ ...fakeRun, status: "approved" });
        const r = await request(app).patch("/api/payroll/runs/run-1/status").set(AUTH)
            .send({ status: "approved" });
        expect(r.status).toBe(200);
        expect(r.body.data.status).toBe("approved");
    });
    it("returns 400 for invalid status", async () => {
        mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);
        const r = await request(app).patch("/api/payroll/runs/run-1/status").set(AUTH)
            .send({ status: "cancelled" });
        expect(r.status).toBe(400);
    });
});
// Prep Lines
describe("GET /api/payroll/runs/:id/lines", () => {
    it("returns prep lines", async () => {
        svc.listLines.mockResolvedValueOnce([fakeLine]);
        const r = await request(app).get("/api/payroll/runs/run-1/lines").set(AUTH);
        expect(r.status).toBe(200);
        expect(r.body.data).toHaveLength(1);
    });
});
describe("PATCH /api/payroll/lines/:id", () => {
    it("updates prep line", async () => {
        mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);
        svc.updateLine.mockResolvedValueOnce({ ...fakeLine, lwp_days: 2 });
        const r = await request(app).patch("/api/payroll/lines/line-1").set(AUTH)
            .send({ lwpDays: 2 });
        expect(r.status).toBe(200);
    });
    it("returns 400 for negative lwpDays", async () => {
        mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);
        const r = await request(app).patch("/api/payroll/lines/line-1").set(AUTH)
            .send({ lwpDays: -1 });
        expect(r.status).toBe(400);
    });
});
// Advances
describe("POST /api/payroll/advances", () => {
    it("creates advance", async () => {
        mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);
        svc.createAdvance.mockResolvedValueOnce(fakeAdvance);
        const r = await request(app).post("/api/payroll/advances").set(AUTH).send({
            employeeId: "550e8400-e29b-41d4-a716-446655440000",
            amount: 5000,
            advanceDate: "2026-05-01",
        });
        expect(r.status).toBe(201);
    });
});
describe("GET /api/payroll/advances/:employeeId", () => {
    it("returns advances", async () => {
        mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);
        svc.listAdvances.mockResolvedValueOnce([fakeAdvance]);
        const r = await request(app).get("/api/payroll/advances/emp-1").set(AUTH);
        expect(r.status).toBe(200);
        expect(r.body.data).toHaveLength(1);
    });
});
// Statutory config
describe("GET /api/payroll/statutory-config", () => {
    it("returns config map", async () => {
        mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);
        svc.getStatutoryConfig.mockResolvedValueOnce({ PF_EMPLOYEE_PCT: 12 });
        const r = await request(app).get("/api/payroll/statutory-config").set(AUTH);
        expect(r.status).toBe(200);
        expect(r.body.data.PF_EMPLOYEE_PCT).toBe(12);
    });
});
