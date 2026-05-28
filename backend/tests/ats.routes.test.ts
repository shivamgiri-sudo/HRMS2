import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../src/db/supabaseAdmin.js", () => ({
  supabaseAdmin: {},
  supabaseAuthClient: { auth: { getUser: vi.fn() } },
}));
vi.mock("../src/db/mysql.js", () => ({
  db: { execute: vi.fn() },
  pingDb: vi.fn(),
}));
vi.mock("../src/modules/ats/ats.service.js", () => ({
  atsService: {
    listCandidates: vi.fn(),
    getCandidate: vi.fn(),
    createCandidate: vi.fn(),
    updateCandidate: vi.fn(),
    moveStage: vi.fn(),
    listStageLogs: vi.fn(),
    createOnboardingBridge: vi.fn(),
    updateOnboardingBridge: vi.fn(),
    listSourcingChannels: vi.fn(),
    getDashboardStats: vi.fn(),
  },
}));

import { supabaseAuthClient } from "../src/db/supabaseAdmin.js";
import { atsService } from "../src/modules/ats/ats.service.js";
import { app } from "../src/app.js";

const mockGetUser = supabaseAuthClient.auth.getUser as ReturnType<typeof vi.fn>;
const svc = atsService as { [K in keyof typeof atsService]: ReturnType<typeof vi.fn> };
const AUTH = { Authorization: "Bearer valid.token" };

const fakeCandidate = {
  id: "cand-1", candidate_code: "ATS-20260001", full_name: "Rahul Sharma",
  mobile: "9876543210", current_stage: "Applied",
  applied_for_branch: "Mumbai", applied_for_process: "Inbound",
  active_status: 1, created_at: "2026-05-20T10:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1", email: "hr@mcn.com" } }, error: null });
});

describe("GET /api/ats/candidates", () => {
  it("returns paginated candidates", async () => {
    svc.listCandidates.mockResolvedValueOnce({ data: [fakeCandidate], total: 1, page: 1, limit: 50 });
    const res = await request(app).get("/api/ats/candidates").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });

  it("returns 401 without auth", async () => {
    const res = await request(app).get("/api/ats/candidates");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/ats/candidates", () => {
  it("creates candidate and returns 201", async () => {
    svc.createCandidate.mockResolvedValueOnce(fakeCandidate);
    const res = await request(app)
      .post("/api/ats/candidates")
      .set(AUTH)
      .send({ fullName: "Rahul Sharma", mobile: "9876543210", walkInDate: "2026-05-20" });
    expect(res.status).toBe(201);
    expect(res.body.data.candidate_code).toBe("ATS-20260001");
  });

  it("returns 400 when fullName missing", async () => {
    const res = await request(app)
      .post("/api/ats/candidates")
      .set(AUTH)
      .send({ mobile: "9876543210" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when mobile too short", async () => {
    const res = await request(app)
      .post("/api/ats/candidates")
      .set(AUTH)
      .send({ fullName: "Test", mobile: "123" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/ats/candidates/:id/move-stage", () => {
  it("moves stage and returns updated candidate", async () => {
    svc.moveStage.mockResolvedValueOnce({ ...fakeCandidate, current_stage: "Screened" });
    const res = await request(app)
      .post("/api/ats/candidates/cand-1/move-stage")
      .set(AUTH)
      .send({ toStage: "Screened", remarks: "Passed HR screen" });
    expect(res.status).toBe(200);
    expect(res.body.data.current_stage).toBe("Screened");
  });

  it("returns 400 when toStage missing", async () => {
    const res = await request(app)
      .post("/api/ats/candidates/cand-1/move-stage")
      .set(AUTH)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe("GET /api/ats/candidates/:id/stage-logs", () => {
  it("returns stage logs", async () => {
    svc.listStageLogs.mockResolvedValueOnce([
      { id: "log-1", candidate_id: "cand-1", from_stage: "Applied", to_stage: "Screened" },
    ]);
    const res = await request(app).get("/api/ats/candidates/cand-1/stage-logs").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe("POST /api/ats/onboarding-bridge", () => {
  it("creates bridge and returns 201", async () => {
    svc.createOnboardingBridge.mockResolvedValueOnce({
      id: "ob-1", candidate_id: "cand-1", bridge_date: "2026-05-21", status: "pending",
    });
    const res = await request(app)
      .post("/api/ats/onboarding-bridge")
      .set(AUTH)
      .send({ candidateId: "550e8400-e29b-41d4-a716-446655440001", bridgeDate: "2026-05-21" });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("pending");
  });

  it("returns 400 when bridgeDate missing", async () => {
    const res = await request(app)
      .post("/api/ats/onboarding-bridge")
      .set(AUTH)
      .send({ candidateId: "550e8400-e29b-41d4-a716-446655440001" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/ats/sourcing-channels", () => {
  it("returns channels", async () => {
    svc.listSourcingChannels.mockResolvedValueOnce([
      { id: "sc-1", channel_code: "WALK_IN", channel_name: "Walk-in", active_status: 1 },
    ]);
    const res = await request(app).get("/api/ats/sourcing-channels").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe("GET /api/ats/stats", () => {
  it("returns dashboard stats", async () => {
    svc.getDashboardStats.mockResolvedValueOnce({
      total: 42,
      by_stage: [{ current_stage: "Applied", count: 20, today_count: 5 }],
    });
    const res = await request(app).get("/api/ats/stats").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(42);
  });
});
