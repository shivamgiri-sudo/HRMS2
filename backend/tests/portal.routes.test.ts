import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../src/db/supabaseAdmin.js", () => ({
  supabaseAdmin: {},
  supabaseAuthClient: { auth: { getUser: vi.fn() } },
}));
vi.mock("../src/db/mysql.js", () => ({ db: { execute: vi.fn() }, pingDb: vi.fn() }));
vi.mock("../src/modules/portal/portal.auth.service.js", () => ({
  portalAuthService: {
    generateOtp: vi.fn(() => "123456"),
    issueToken: vi.fn(() => "mock.jwt.token"),
    verifyToken: vi.fn(() => ({
      clientUserId: "u-1",
      clientId: "c-1",
      processIds: ["p-1"],
      role: "client",
    })),
    requestOtp: vi.fn(),
    verifyOtp: vi.fn(() => "mock.jwt.token"),
    sendOtpEmail: vi.fn(),
  },
}));
vi.mock("../src/modules/portal/portal.overview.service.js", () => ({
  portalOverviewService: { getOverview: vi.fn(() => []) },
}));
vi.mock("../src/modules/portal/portal.kpi.service.js", () => ({
  portalKpiService: {
    computeAchievement: vi.fn(),
    ragFromAchievement: vi.fn(),
    getScorecards: vi.fn(() => []),
  },
}));
vi.mock("../src/modules/portal/portal.glide.service.js", () => ({
  portalGlideService: { getGlidePaths: vi.fn(() => []), setCommitment: vi.fn() },
}));
vi.mock("../src/modules/portal/portal.actions.service.js", () => ({
  portalActionsService: { list: vi.fn(() => []), create: vi.fn(), update: vi.fn() },
}));
vi.mock("../src/modules/portal/portal.governance.service.js", () => ({
  portalGovernanceService: { getChecklist: vi.fn(() => []), updateLog: vi.fn() },
}));
vi.mock("../src/modules/portal/portal.attrition.service.js", () => ({
  portalAttritionService: { getAttrition: vi.fn(() => ({ period: "2026-05", attrition_pct: 0 })) },
}));
vi.mock("../src/modules/portal/portal.commentary.service.js", () => ({
  portalCommentaryService: {
    get: vi.fn(() => null),
    create: vi.fn(),
    acknowledge: vi.fn(),
    addReply: vi.fn(),
  },
}));

import { app } from "../src/app.js";
import { portalAuthService } from "../src/modules/portal/portal.auth.service.js";

const svcAuth = portalAuthService as { [K: string]: ReturnType<typeof vi.fn> };
const PORTAL_AUTH = { Authorization: "Bearer mock.jwt.token" };

beforeEach(() => vi.clearAllMocks());

describe("POST /api/portal/auth/request-otp", () => {
  it("returns 200 for valid email", async () => {
    svcAuth.requestOtp.mockResolvedValueOnce(undefined);
    const r = await request(app).post("/api/portal/auth/request-otp").send({ email: "client@airtel.com" });
    expect(r.status).toBe(200);
  });
  it("returns 400 for invalid email", async () => {
    const r = await request(app).post("/api/portal/auth/request-otp").send({ email: "notanemail" });
    expect(r.status).toBe(400);
  });
});

describe("POST /api/portal/auth/verify-otp", () => {
  it("returns token on valid OTP", async () => {
    svcAuth.verifyOtp.mockResolvedValueOnce("a.b.c");
    const r = await request(app).post("/api/portal/auth/verify-otp").send({ email: "client@airtel.com", otp: "123456" });
    expect(r.status).toBe(200);
    expect(r.body.token).toBeTruthy();
  });
  it("returns 400 for non-6-digit OTP", async () => {
    const r = await request(app).post("/api/portal/auth/verify-otp").send({ email: "client@airtel.com", otp: "abc" });
    expect(r.status).toBe(400);
  });
});

describe("GET /api/portal/overview", () => {
  it("returns 200 with portal token", async () => {
    const r = await request(app).get("/api/portal/overview").set(PORTAL_AUTH);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
  });
  it("returns 401 without token", async () => {
    const r = await request(app).get("/api/portal/overview");
    expect(r.status).toBe(401);
  });
});

describe("GET /api/portal/processes/:id/kpis", () => {
  it("returns 200 for process in JWT processIds", async () => {
    const r = await request(app).get("/api/portal/processes/p-1/kpis").set(PORTAL_AUTH);
    expect(r.status).toBe(200);
  });
  it("returns 403 for process NOT in JWT processIds", async () => {
    const r = await request(app).get("/api/portal/processes/other-process/kpis").set(PORTAL_AUTH);
    expect(r.status).toBe(403);
  });
});
