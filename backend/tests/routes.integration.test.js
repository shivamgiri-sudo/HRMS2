import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
// Mock all external I/O before importing app
vi.mock("../src/db/supabaseAdmin.js", () => ({
    supabaseAdmin: {},
    supabaseAuthClient: {
        auth: {
            getUser: vi.fn(),
        },
    },
}));
vi.mock("../src/db/mysql.js", () => ({
    db: { execute: vi.fn().mockResolvedValue([[], []]) },
    pingDb: vi.fn(),
}));
vi.mock("../src/modules/process/process.repository.js", () => ({
    getProcessRepository: vi.fn(),
}));
import { supabaseAuthClient } from "../src/db/supabaseAdmin.js";
import { pingDb } from "../src/db/mysql.js";
import { getProcessRepository } from "../src/modules/process/process.repository.js";
import { app } from "../src/app.js";
const mockGetUser = supabaseAuthClient.auth.getUser;
const mockPingDb = pingDb;
const mockGetRepo = getProcessRepository;
const mockRepo = {
    list: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateStatus: vi.fn(),
};
const fakeProcess = {
    id: "proc-1",
    process_code: "IB",
    process_name: "Inbound",
    department_id: null,
    process_type: null,
    branch_name: null,
    location_name: null,
    process_owner_employee_id: null,
    process_manager_employee_id: null,
    active_status: true,
    description: null,
    metadata: {},
    created_by: "user-1",
    updated_by: "user-1",
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
};
function authHeader() {
    return { Authorization: "Bearer valid.token" };
}
beforeEach(() => {
    vi.clearAllMocks();
    mockGetRepo.mockReturnValue(mockRepo);
});
// ─── Health Route ──────────────────────────────────────────────────────────────
describe("GET /api/health", () => {
    it("returns healthy status with db ok when ping succeeds", async () => {
        mockPingDb.mockResolvedValueOnce(undefined);
        const res = await request(app).get("/api/health");
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.status).toBe("healthy");
        expect(res.body.db).toBe("ok");
        expect(res.body.timestamp).toBeDefined();
    });
    it("returns db error when ping fails", async () => {
        mockPingDb.mockRejectedValueOnce(new Error("connection refused"));
        const res = await request(app).get("/api/health");
        expect(res.status).toBe(200); // health endpoint stays up
        expect(res.body.db).toBe("error");
    });
});
// ─── Root Route ────────────────────────────────────────────────────────────────
describe("GET /", () => {
    it("returns service info", async () => {
        const res = await request(app).get("/");
        expect(res.status).toBe(200);
        expect(res.body.service).toBe("MCN HRMS Backend API");
    });
});
// ─── 404 Handler ───────────────────────────────────────────────────────────────
describe("Unknown route", () => {
    it("returns 404 for unregistered route", async () => {
        const res = await request(app).get("/api/nonexistent");
        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
    });
});
// ─── Process Routes — Auth Guard ───────────────────────────────────────────────
describe("GET /api/processes — auth guard", () => {
    it("returns 401 when no token provided", async () => {
        const res = await request(app).get("/api/processes");
        expect(res.status).toBe(401);
    });
    it("returns 401 when token is invalid", async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: { message: "expired" } });
        const res = await request(app).get("/api/processes").set(authHeader());
        expect(res.status).toBe(401);
    });
});
// ─── GET /api/processes ────────────────────────────────────────────────────────
describe("GET /api/processes", () => {
    beforeEach(() => {
        mockGetUser.mockResolvedValue({
            data: { user: { id: "user-1", email: "admin@mcn.com" } },
            error: null,
        });
    });
    it("returns list of processes", async () => {
        mockRepo.list.mockResolvedValueOnce([fakeProcess]);
        const res = await request(app).get("/api/processes").set(authHeader());
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].process_code).toBe("IB");
    });
    it("filters by activeStatus query param", async () => {
        mockRepo.list.mockResolvedValueOnce([]);
        await request(app).get("/api/processes?activeStatus=active").set(authHeader());
        expect(mockRepo.list).toHaveBeenCalledWith(expect.objectContaining({ activeStatus: "active" }));
    });
    it("returns 400 for invalid activeStatus value", async () => {
        const res = await request(app).get("/api/processes?activeStatus=bad").set(authHeader());
        expect(res.status).toBe(400);
    });
});
// ─── GET /api/processes/:id ────────────────────────────────────────────────────
describe("GET /api/processes/:id", () => {
    beforeEach(() => {
        mockGetUser.mockResolvedValue({
            data: { user: { id: "user-1", email: "admin@mcn.com" } },
            error: null,
        });
    });
    it("returns process by id", async () => {
        mockRepo.getById.mockResolvedValueOnce(fakeProcess);
        const res = await request(app).get("/api/processes/proc-1").set(authHeader());
        expect(res.status).toBe(200);
        expect(res.body.data.id).toBe("proc-1");
    });
    it("returns 500 when process not found", async () => {
        mockRepo.getById.mockResolvedValueOnce(null);
        const res = await request(app).get("/api/processes/missing").set(authHeader());
        expect(res.status).toBe(500);
        expect(res.body.message).toMatch(/Process not found/i);
    });
});
// ─── POST /api/processes ───────────────────────────────────────────────────────
describe("POST /api/processes", () => {
    beforeEach(() => {
        mockGetUser.mockResolvedValue({
            data: { user: { id: "user-1", email: "admin@mcn.com" } },
            error: null,
        });
    });
    it("creates process and returns 201", async () => {
        mockRepo.list.mockResolvedValueOnce([]);
        mockRepo.create.mockResolvedValueOnce(fakeProcess);
        const res = await request(app)
            .post("/api/processes")
            .set(authHeader())
            .send({ processCode: "IB", processName: "Inbound" });
        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toMatch(/created/i);
    });
    it("returns 400 when processCode is missing", async () => {
        const res = await request(app)
            .post("/api/processes")
            .set(authHeader())
            .send({ processName: "Inbound" });
        expect(res.status).toBe(400);
    });
    it("returns 500 when process code already exists", async () => {
        mockRepo.list.mockResolvedValueOnce([fakeProcess]); // duplicate
        const res = await request(app)
            .post("/api/processes")
            .set(authHeader())
            .send({ processCode: "IB", processName: "Inbound Duplicate" });
        expect(res.status).toBe(500);
        expect(res.body.message).toMatch(/already exists/i);
    });
});
// ─── PUT /api/processes/:id ────────────────────────────────────────────────────
describe("PUT /api/processes/:id", () => {
    beforeEach(() => {
        mockGetUser.mockResolvedValue({
            data: { user: { id: "user-1", email: "admin@mcn.com" } },
            error: null,
        });
    });
    it("updates and returns process", async () => {
        mockRepo.getById.mockResolvedValueOnce(fakeProcess);
        const updated = { ...fakeProcess, process_name: "Updated" };
        mockRepo.update.mockResolvedValueOnce(updated);
        const res = await request(app)
            .put("/api/processes/proc-1")
            .set(authHeader())
            .send({ processName: "Updated" });
        expect(res.status).toBe(200);
        expect(res.body.data.process_name).toBe("Updated");
    });
});
// ─── PATCH /api/processes/:id/status ──────────────────────────────────────────
describe("PATCH /api/processes/:id/status", () => {
    beforeEach(() => {
        mockGetUser.mockResolvedValue({
            data: { user: { id: "user-1", email: "admin@mcn.com" } },
            error: null,
        });
    });
    it("deactivates process", async () => {
        mockRepo.getById.mockResolvedValueOnce(fakeProcess);
        mockRepo.updateStatus.mockResolvedValueOnce({ ...fakeProcess, active_status: false });
        const res = await request(app)
            .patch("/api/processes/proc-1/status")
            .set(authHeader())
            .send({ activeStatus: false });
        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/deactivated/i);
    });
    it("returns 400 when activeStatus is missing", async () => {
        const res = await request(app)
            .patch("/api/processes/proc-1/status")
            .set(authHeader())
            .send({});
        expect(res.status).toBe(400);
    });
});
