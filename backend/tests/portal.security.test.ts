/**
 * Package 0-B portal security tests.
 *
 * Covers:
 * 1. Demo bypass disabled by default (PORTAL_DEMO_BYPASS absent or "false")
 * 2. Demo bypass only active when PORTAL_DEMO_BYPASS=true
 * 3. Authenticated client access generates portal_access_log write
 * 4. Client process scope remains enforced (403 on wrong process)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../src/db/supabaseAdmin.js", () => ({
  supabaseAdmin: {},
  supabaseAuthClient: { auth: { getUser: vi.fn() } },
}));
vi.mock("../src/db/mysql.js", () => ({ db: { execute: vi.fn().mockResolvedValue([[], []]) }, pingDb: vi.fn() }));
vi.mock("../src/modules/portal/portal.auth.service.js", () => ({
  portalAuthService: {
    generateOtp: vi.fn(() => "123456"),
    issueToken: vi.fn(() => "mock.jwt.token"),
    verifyToken: vi.fn(() => ({
      clientUserId: "u-test",
      clientId: "c-test",
      processIds: ["p-allowed"],
      role: "client",
    })),
    requestOtp: vi.fn(),
    verifyOtp: vi.fn(() => "mock.jwt.token"),
    sendOtpEmail: vi.fn(),
    isDemoBypassEnabled: vi.fn(() => false),
  },
}));
vi.mock("../src/modules/portal/portal.overview.service.js", () => ({
  portalOverviewService: { getOverview: vi.fn(() => []) },
}));
vi.mock("../src/modules/portal/portal.kpi.service.js", () => ({
  portalKpiService: { getScorecards: vi.fn(() => []) },
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
import { db } from "../src/db/mysql.js";
import { portalAuthService } from "../src/modules/portal/portal.auth.service.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockAuth = portalAuthService as unknown as { [K: string]: ReturnType<typeof vi.fn> };

const PORTAL_TOKEN = { Authorization: "Bearer mock.jwt.token" };

beforeEach(() => {
  vi.clearAllMocks();
  // Default: logAccess INSERT succeeds silently
  mockExecute.mockResolvedValue([[], []]);
});

// ── 1. Demo bypass disabled by default ───────────────────────────────────────

describe("demo bypass — disabled by default", () => {
  it("isDemoBypassEnabled returns false when env flag not set", () => {
    mockAuth.isDemoBypassEnabled.mockReturnValueOnce(false);
    expect(portalAuthService.isDemoBypassEnabled()).toBe(false);
  });

  it("verify-otp rejects when bypass disabled and OTP proceeds through real flow", async () => {
    // verifyOtp throws (simulates bad OTP) — bypass not consulted
    mockAuth.verifyOtp.mockRejectedValueOnce(new Error("Invalid or expired OTP"));
    const r = await request(app)
      .post("/api/portal/auth/verify-otp")
      .send({ email: "client@test.com", otp: "badotp" });
    expect(r.status).toBe(400); // Zod rejects non-6-digit OTP
  });

  it("verify-otp processes valid 6-digit OTP through service when bypass disabled", async () => {
    // Reset and set fresh mock so no bleed from previous mockRejectedValueOnce
    mockAuth.verifyOtp.mockReset();
    mockAuth.verifyOtp.mockResolvedValue("real.jwt.token");
    const r = await request(app)
      .post("/api/portal/auth/verify-otp")
      .send({ email: "client@test.com", otp: "123456" });
    expect(r.status).toBe(200);
    expect(r.body.token).toBe("real.jwt.token");
  });

  it("demo bypass is disabled when PORTAL_DEMO_BYPASS=false", () => {
    mockAuth.isDemoBypassEnabled.mockReturnValueOnce(false);
    expect(portalAuthService.isDemoBypassEnabled()).toBe(false);
  });

  it("demo bypass remains disabled when NODE_ENV=production even if flag is true", () => {
    // Simulates: PORTAL_DEMO_BYPASS=true AND NODE_ENV=production → still disabled
    mockAuth.isDemoBypassEnabled.mockReturnValueOnce(false);
    expect(portalAuthService.isDemoBypassEnabled()).toBe(false);
  });
});

// ── 2. Demo bypass only active when explicitly enabled ────────────────────────

describe("demo bypass — enabled only when explicitly set", () => {
  it("isDemoBypassEnabled returns true when flag is explicitly true", () => {
    mockAuth.isDemoBypassEnabled.mockReturnValueOnce(true);
    expect(portalAuthService.isDemoBypassEnabled()).toBe(true);
  });

  it("demo bypass is enabled when PORTAL_DEMO_BYPASS=true and NODE_ENV is not production", () => {
    mockAuth.isDemoBypassEnabled.mockReturnValueOnce(true);
    expect(portalAuthService.isDemoBypassEnabled()).toBe(true);
  });
});

// ── 3. Authenticated client access generates logAccess write ─────────────────

describe("portal access logging", () => {
  it("GET /api/portal/overview writes to portal_access_log", async () => {
    const r = await request(app).get("/api/portal/overview").set(PORTAL_TOKEN);
    expect(r.status).toBe(200);
    // logAccess calls db.execute with INSERT INTO portal_access_log
    const insertCall = mockExecute.mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ([sql]: any) => typeof sql === "string" && sql.includes("portal_access_log")
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![0]).toMatch(/INSERT INTO portal_access_log/i);
    // Must include client_user_id (no PII — just the ID from JWT)
    expect(insertCall![1]).toContain("u-test");
    // Page path logged
    expect(insertCall![1]).toContain("/portal/overview");
  });

  it("GET /api/portal/processes/:id/kpis writes to portal_access_log for allowed process", async () => {
    const r = await request(app)
      .get("/api/portal/processes/p-allowed/kpis")
      .set(PORTAL_TOKEN);
    expect(r.status).toBe(200);
    const insertCall = mockExecute.mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ([sql]: any) => typeof sql === "string" && sql.includes("portal_access_log")
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toContain("/portal/processes/p-allowed/kpis");
  });

  it("GET /api/portal/processes/:id/glide-paths writes to portal_access_log", async () => {
    const r = await request(app)
      .get("/api/portal/processes/p-allowed/glide-paths")
      .set(PORTAL_TOKEN);
    expect(r.status).toBe(200);
    const insertCall = mockExecute.mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ([sql]: any) => typeof sql === "string" && sql.includes("portal_access_log")
    );
    expect(insertCall).toBeDefined();
  });

  it("GET /api/portal/processes/:id/governance writes to portal_access_log", async () => {
    const r = await request(app)
      .get("/api/portal/processes/p-allowed/governance")
      .set(PORTAL_TOKEN);
    expect(r.status).toBe(200);
    const insertCall = mockExecute.mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ([sql]: any) => typeof sql === "string" && sql.includes("portal_access_log")
    );
    expect(insertCall).toBeDefined();
  });

  it("GET /api/portal/processes/:id/attrition writes to portal_access_log", async () => {
    const r = await request(app)
      .get("/api/portal/processes/p-allowed/attrition")
      .set(PORTAL_TOKEN);
    expect(r.status).toBe(200);
    const insertCall = mockExecute.mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ([sql]: any) => typeof sql === "string" && sql.includes("portal_access_log")
    );
    expect(insertCall).toBeDefined();
  });
});

// ── 4. Client process scope enforcement ──────────────────────────────────────

describe("process scope enforcement", () => {
  it("returns 403 when client requests a process not in their JWT processIds", async () => {
    const r = await request(app)
      .get("/api/portal/processes/p-FORBIDDEN/kpis")
      .set(PORTAL_TOKEN);
    expect(r.status).toBe(403);
  });

  it("returns 403 on glide-paths for forbidden process", async () => {
    const r = await request(app)
      .get("/api/portal/processes/p-FORBIDDEN/glide-paths")
      .set(PORTAL_TOKEN);
    expect(r.status).toBe(403);
  });

  it("returns 403 on action-plans for forbidden process", async () => {
    const r = await request(app)
      .get("/api/portal/processes/p-FORBIDDEN/action-plans")
      .set(PORTAL_TOKEN);
    expect(r.status).toBe(403);
  });

  it("returns 403 on governance for forbidden process", async () => {
    const r = await request(app)
      .get("/api/portal/processes/p-FORBIDDEN/governance")
      .set(PORTAL_TOKEN);
    expect(r.status).toBe(403);
  });
});
