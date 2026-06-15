/**
 * S9 Fix Tests
 *
 * 1. Upload ownership: POST /api/ats/candidates/:id/upload requires `mobile` matching the candidate
 * 2. send-token scope: POST /api/ats/onboarding/send-token/:id checks hasScopedAccess
 * 3. validateToken expiry: handles both Date object and string from mysql2
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockExecute = vi.fn();

vi.mock("../src/db/mysql.js", () => ({
  db: { execute: mockExecute },
}));

const mockHasScopedAccess = vi.fn().mockResolvedValue(true);
const mockBuildScopeWhereClause = vi.fn().mockResolvedValue({ sql: "1=1", params: [] });

vi.mock("../src/shared/scopeAccess.js", () => ({
  hasScopedAccess: mockHasScopedAccess,
  buildScopeWhereClause: mockBuildScopeWhereClause,
}));

vi.mock("../src/modules/ats/ats.onboarding.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/modules/ats/ats.onboarding.service.js")>();
  return {
    ...actual,
    sendOnboardingToken: vi.fn().mockResolvedValue({ token: "tok-abc", expiresAt: new Date() }),
    listOnboardingRequests: vi.fn().mockResolvedValue([]),
    listPendingApprovals: vi.fn().mockResolvedValue([]),
    saveOffer: vi.fn().mockResolvedValue({ ok: true }),
    approveOffer: vi.fn().mockResolvedValue({ ok: true }),
    rejectOffer: vi.fn().mockResolvedValue({}),
  };
});

vi.mock("../src/modules/ats/ats.service.js", () => ({
  atsService: {
    getCandidate: vi.fn().mockImplementation(async (id: string) => {
      const [rows] = await mockExecute("SELECT * FROM ats_candidate WHERE id = ? LIMIT 1", [id]);
      const candidate = rows?.[0];
      if (!candidate) throw Object.assign(new Error("Candidate not found"), { statusCode: 404 });
      return candidate;
    }),
    createCandidate: vi.fn(),
    updateCandidate: vi.fn(),
    moveStage: vi.fn(),
    listStageLogs: vi.fn(),
    listCandidates: vi.fn(),
    listOnboardingBridges: vi.fn(),
    createOnboardingBridge: vi.fn(),
    updateOnboardingBridge: vi.fn(),
    listSourcingChannels: vi.fn().mockResolvedValue([]),
    getDashboardStats: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("../src/modules/ats/ats.queue.service.js", () => ({
  createToken: vi.fn(),
  walkOut: vi.fn(),
  reEntry: vi.fn(),
  listActiveQueue: vi.fn().mockResolvedValue([]),
  getActiveTokenForCandidate: vi.fn(),
  assignRecruiter: vi.fn(),
  assignInterviewer: vi.fn(),
  updateTokenStage: vi.fn(),
}));

vi.mock("../src/modules/ats/ats.convert.service.js", () => ({
  convertCandidateToEmployee: vi.fn(),
}));

vi.mock("../src/modules/ats/salary.calculator.js", () => ({
  calculateSalary: vi.fn().mockReturnValue({}),
}));

vi.mock("../src/middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.authUser = { id: "user-hr-1", role: "hr" };
    next();
  },
}));

vi.mock("../src/middleware/requireRole.js", () => ({
  requireRole: (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

const ONE_HOUR_AGO = new Date(Date.now() - 61 * 60 * 1000); // 61 min ago
const JUST_NOW = new Date(Date.now() - 5 * 60 * 1000);       // 5 min ago

// ── Upload ownership tests ─────────────────────────────────────────────────────

describe("POST /api/ats/candidates/:id/upload — ownership via mobile", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    const { atsRouter } = await import("../src/modules/ats/ats.routes.js");
    app.use("/api/ats", atsRouter);
  });

  it("TC-S9-01: missing mobile → 400", async () => {
    const res = await request(app)
      .post("/api/ats/candidates/cand-1/upload")
      .field("type", "resume");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/mobile/i);
  });

  it("TC-S9-02: wrong mobile → 403 even within time window", async () => {
    mockExecute.mockResolvedValueOnce([[{ id: "cand-1", mobile: "9999999999", created_at: JUST_NOW }]]);
    const res = await request(app)
      .post("/api/ats/candidates/cand-1/upload")
      .field("type", "resume")
      .field("mobile", "8888888888"); // wrong mobile
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/mobile.*match|match.*mobile/i);
  });

  it("TC-S9-03: correct mobile but expired window → 403", async () => {
    mockExecute.mockResolvedValueOnce([[{ id: "cand-1", mobile: "9999999999", created_at: ONE_HOUR_AGO }]]);
    const res = await request(app)
      .post("/api/ats/candidates/cand-1/upload")
      .field("type", "resume")
      .field("mobile", "9999999999");
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/expired/i);
  });

  it("TC-S9-04: candidate not found → 404", async () => {
    mockExecute.mockResolvedValueOnce([[]]);
    const res = await request(app)
      .post("/api/ats/candidates/unknown-cand/upload")
      .field("type", "resume")
      .field("mobile", "9999999999");
    expect(res.status).toBe(404);
  });

  it("TC-S9-05: invalid type → 400 before DB hit", async () => {
    const res = await request(app)
      .post("/api/ats/candidates/cand-1/upload")
      .field("type", "document")
      .field("mobile", "9999999999");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/resume.*selfie|selfie.*resume/i);
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

// ── send-token scope tests ─────────────────────────────────────────────────────

describe("POST /api/ats/onboarding/send-token/:id — row-scope via hasScopedAccess", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    const onboardingRouter = (await import("../src/modules/ats/ats.onboarding.routes.js")).default;
    app.use("/api/ats/onboarding", onboardingRouter);
  });

  it("TC-S9-06: candidate not found → 404", async () => {
    mockExecute.mockResolvedValueOnce([[]]); // no candidate rows
    const res = await request(app)
      .post("/api/ats/onboarding/send-token/bad-id")
      .send({});
    expect(res.status).toBe(404);
  });

  it("TC-S9-07: scope denied → 403", async () => {
    mockExecute.mockResolvedValueOnce([[{ applied_for_branch: "branch-1", applied_for_process: "proc-1" }]]);
    mockHasScopedAccess.mockResolvedValueOnce(false);
    const res = await request(app)
      .post("/api/ats/onboarding/send-token/cand-1")
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/access denied/i);
  });

  it("TC-S9-08: scope allowed → token returned", async () => {
    mockExecute.mockResolvedValueOnce([[{ applied_for_branch: "branch-1", applied_for_process: "proc-1" }]]);
    mockHasScopedAccess.mockResolvedValueOnce(true);
    const res = await request(app)
      .post("/api/ats/onboarding/send-token/cand-1")
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.token).toBe("tok-abc");
  });

  it("TC-S9-09: hasScopedAccess called with candidate branch/process", async () => {
    mockExecute.mockResolvedValueOnce([[{ applied_for_branch: "b99", applied_for_process: "p77" }]]);
    mockHasScopedAccess.mockResolvedValueOnce(true);
    await request(app).post("/api/ats/onboarding/send-token/cand-1").send({});
    expect(mockHasScopedAccess).toHaveBeenCalledWith(
      "user-hr-1",
      ["hr", "recruiter"],
      { branchId: "b99", processId: "p77" },
      { allowAdminBypass: true },
    );
  });
});

// ── validateToken timezone safety ──────────────────────────────────────────────

describe("validateToken expiry — Date object vs string from mysql2", () => {
  it("TC-S9-10: expires_at as JS Date in the future → does not throw", async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
    mockExecute.mockResolvedValueOnce([[{
      candidate_id: "cand-1",
      onboarding_token_expires_at: futureDate,
      full_name: "Test User",
      mobile: "9999999999",
      email: null,
      applied_for_branch: "b1",
      applied_for_process: "p1",
      profile_status: "pending",
      branch_name: "Branch A",
    }]]);
    const { validateToken } = await import("../src/modules/ats/ats.onboarding.service.js");
    await expect(validateToken("valid-token")).resolves.toBeDefined();
  });

  it("TC-S9-11: expires_at as ISO string in the future → does not throw", async () => {
    const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    mockExecute.mockResolvedValueOnce([[{
      candidate_id: "cand-1",
      onboarding_token_expires_at: futureIso,
      full_name: "Test User",
      mobile: "9999999999",
      email: null,
      applied_for_branch: "b1",
      applied_for_process: "p1",
      profile_status: "pending",
      branch_name: "Branch A",
    }]]);
    const { validateToken } = await import("../src/modules/ats/ats.onboarding.service.js");
    await expect(validateToken("valid-token")).resolves.toBeDefined();
  });

  it("TC-S9-12: expires_at as JS Date in the past → throws 410", async () => {
    const pastDate = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    mockExecute.mockResolvedValueOnce([[{
      candidate_id: "cand-1",
      onboarding_token_expires_at: pastDate,
      full_name: "Test User",
      mobile: "9999999999",
      email: null,
      applied_for_branch: "b1",
      applied_for_process: "p1",
      profile_status: "pending",
      branch_name: "Branch A",
    }]]);
    const { validateToken } = await import("../src/modules/ats/ats.onboarding.service.js");
    await expect(validateToken("expired-token")).rejects.toMatchObject({ statusCode: 410 });
  });

  it("TC-S9-13: expires_at as ISO string in the past → throws 410", async () => {
    const pastIso = new Date(Date.now() - 1000).toISOString();
    mockExecute.mockResolvedValueOnce([[{
      candidate_id: "cand-1",
      onboarding_token_expires_at: pastIso,
      full_name: "Test User",
      mobile: "9999999999",
      email: null,
      applied_for_branch: "b1",
      applied_for_process: "p1",
      profile_status: "pending",
      branch_name: "Branch A",
    }]]);
    const { validateToken } = await import("../src/modules/ats/ats.onboarding.service.js");
    await expect(validateToken("expired-token")).rejects.toMatchObject({ statusCode: 410 });
  });
});
