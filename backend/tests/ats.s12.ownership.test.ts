/**
 * S12 Ownership / Impersonation Tests
 *
 * 1. GET /recruiter/my-candidates — must be tied to JWT, not untrusted query param
 * 2. GET /recruiter/submission-history — must be tied to JWT
 * 3. POST /recruiter-submission — recruiterCode from body must match JWT-linked profile
 * 4. GET /journey — scope check for non-admin roles
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── Mock DB ───────────────────────────────────────────────────────────────────

const mockExecute = vi.fn();
vi.mock("../src/db/mysql.js", () => ({
  db: {
    execute: mockExecute,
    getConnection: vi.fn(),
  },
}));

// ── scopeAccess mocks ─────────────────────────────────────────────────────────

const mockHasScopedAccess = vi.fn().mockResolvedValue(true);
const mockBuildScopeWhereClause = vi.fn().mockResolvedValue({ sql: "1=1", params: [] });

vi.mock("../src/shared/scopeAccess.js", () => ({
  hasScopedAccess: mockHasScopedAccess,
  buildScopeWhereClause: mockBuildScopeWhereClause,
}));

// ── Env mock ──────────────────────────────────────────────────────────────────

vi.mock("../src/config/env.js", () => ({
  env: {
    NODE_ENV: "test",
    SMTP_HOST: "",
    SMTP_PORT: "587",
    SMTP_USER: "",
    SMTP_PASS: "",
    SMTP_FROM: "",
    ATS_FORM_API_KEY: undefined,
  },
}));

// ── Auth shims ────────────────────────────────────────────────────────────────

vi.mock("../src/middleware/authMiddleware.js", () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../src/middleware/requireRole.js", () => ({
  requireRole: (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
}));

// Mocked recruiterInterview dependencies used by atsFullParity.routes
vi.mock("../src/modules/ats-full-parity/recruiterInterview.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/modules/ats-full-parity/recruiterInterview.service.js")>();
  return {
    ...actual,
    submitInterviewUpdate: vi.fn().mockResolvedValue({ submission: { id: "sub-1" }, action: "created" }),
    verifyRecruiter: vi.fn().mockResolvedValue({ id: "r1", name: "Alice", recruiterCode: "RC001", branch: "B1", email: null, employeeId: "e1" }),
    getMyPendingCandidates: vi.fn().mockResolvedValue([]),
    getSubmissionHistory: vi.fn().mockResolvedValue([]),
    resolveRecruiterForActor: vi.fn().mockResolvedValue({ id: "r1", name: "Alice", recruiterCode: "RC001", branch: "B1", email: null, employeeId: "e1" }),
  };
});

// Mocked ATS full-parity service for journey tests
vi.mock("../src/modules/ats-full-parity/atsFullParity.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/modules/ats-full-parity/atsFullParity.service.js")>();
  return {
    atsFullParityService: {
      ...actual.atsFullParityService,
      webData: vi.fn().mockResolvedValue({ ok: true, candidateRows: [], queueRows: [], dashboardRows: [], summary: {}, trends: {}, options: {}, branchTable: [], processTable: [], roleTable: [], sourceTable: [], recruiterTable: [], slotTable: [], reusablePool: [] }),
      candidateJourney: vi.fn().mockResolvedValue({
        candidate: { id: "cand-1", applied_for_branch: "branch-1", applied_for_process: "proc-1", full_name: "Test" },
        stageLogs: [],
        confirmations: [],
        emails: [],
        notifications: [],
      }),
      dailyReportSnapshot: vi.fn().mockResolvedValue([]),
      healthCheck: vi.fn().mockResolvedValue({ ok: true, checks: [] }),
    },
  };
});

// ── App factory ───────────────────────────────────────────────────────────────

async function makeApp(userId: string, role: string) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next) => {
    req.authUser = { id: userId, role };
    next();
  });
  const { atsRouter } = await import("../src/modules/ats/ats.routes.js");
  app.use("/api/ats", atsRouter);
  return app;
}

async function makeFpApp(userId: string, role: string) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next) => {
    req.authUser = { id: userId, role };
    next();
  });
  const { atsFullParityRouter } = await import("../src/modules/ats-full-parity/atsFullParity.routes.js");
  app.use("/api/ats-full-parity", atsFullParityRouter);
  return app;
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. GET /recruiter/my-candidates — ownership
// ═════════════════════════════════════════════════════════════════════════════

describe("GET /api/ats/recruiter/my-candidates — JWT ownership", () => {
  let resolveRecruiterForActor: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockExecute.mockResolvedValue([[]]);
    mockBuildScopeWhereClause.mockResolvedValue({ sql: "1=1", params: [] });
    const svc = await import("../src/modules/ats-full-parity/recruiterInterview.service.js");
    resolveRecruiterForActor = vi.mocked(svc.resolveRecruiterForActor);
    resolveRecruiterForActor.mockResolvedValue({ id: "r1", name: "Alice", recruiterCode: "RC001", branch: "B1", email: null, employeeId: "e1" });
    vi.mocked(svc.getMyPendingCandidates).mockResolvedValue([]);
  });

  it("TC-S12-01: recruiter actor — uses JWT-linked name, ignores query param", async () => {
    const app = await makeApp("user-rec-1", "recruiter");
    const res = await request(app)
      .get("/api/ats/recruiter/my-candidates?recruiterName=EVIL_OTHER_RECRUITER");
    expect(res.status).toBe(200);
    const svc = await import("../src/modules/ats-full-parity/recruiterInterview.service.js");
    expect(vi.mocked(svc.getMyPendingCandidates)).toHaveBeenCalledWith("Alice");
    expect(vi.mocked(svc.getMyPendingCandidates)).not.toHaveBeenCalledWith("EVIL_OTHER_RECRUITER");
  });

  it("TC-S12-02: recruiter with no linked profile → 403", async () => {
    const svc = await import("../src/modules/ats-full-parity/recruiterInterview.service.js");
    vi.mocked(svc.resolveRecruiterForActor).mockResolvedValueOnce(null);
    const app = await makeApp("user-rec-nolink", "recruiter");
    const res = await request(app).get("/api/ats/recruiter/my-candidates");
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/recruiter profile/i);
  });

  it("TC-S12-03: admin with ?recruiterName= → overrides to named recruiter", async () => {
    const app = await makeApp("user-admin-1", "admin");
    const res = await request(app).get("/api/ats/recruiter/my-candidates?recruiterName=Bob");
    expect(res.status).toBe(200);
    const svc = await import("../src/modules/ats-full-parity/recruiterInterview.service.js");
    expect(vi.mocked(svc.getMyPendingCandidates)).toHaveBeenCalledWith("Bob");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. GET /recruiter/submission-history — ownership
// ═════════════════════════════════════════════════════════════════════════════

describe("GET /api/ats/recruiter/submission-history — JWT ownership", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockExecute.mockResolvedValue([[]]);
    mockBuildScopeWhereClause.mockResolvedValue({ sql: "1=1", params: [] });
    const svc = await import("../src/modules/ats-full-parity/recruiterInterview.service.js");
    vi.mocked(svc.resolveRecruiterForActor).mockResolvedValue({ id: "r1", name: "Alice", recruiterCode: "RC001", branch: "B1", email: null, employeeId: "e1" });
    vi.mocked(svc.getSubmissionHistory).mockResolvedValue([]);
  });

  it("TC-S12-04: recruiter actor — uses JWT-linked code, ignores ?recruiterCode=", async () => {
    const app = await makeApp("user-rec-1", "recruiter");
    const res = await request(app)
      .get("/api/ats/recruiter/submission-history?recruiterCode=EVIL_RC999");
    expect(res.status).toBe(200);
    const svc = await import("../src/modules/ats-full-parity/recruiterInterview.service.js");
    expect(vi.mocked(svc.getSubmissionHistory)).toHaveBeenCalledWith("RC001");
    expect(vi.mocked(svc.getSubmissionHistory)).not.toHaveBeenCalledWith("EVIL_RC999");
  });

  it("TC-S12-05: recruiter with no profile → 403", async () => {
    const svc = await import("../src/modules/ats-full-parity/recruiterInterview.service.js");
    vi.mocked(svc.resolveRecruiterForActor).mockResolvedValueOnce(null);
    const app = await makeApp("user-rec-nolink", "recruiter");
    const res = await request(app).get("/api/ats/recruiter/submission-history");
    expect(res.status).toBe(403);
  });

  it("TC-S12-06: hr with ?recruiterCode= → overrides to named code", async () => {
    const app = await makeApp("user-hr-1", "hr");
    const res = await request(app).get("/api/ats/recruiter/submission-history?recruiterCode=RC_OTHER");
    expect(res.status).toBe(200);
    const svc = await import("../src/modules/ats-full-parity/recruiterInterview.service.js");
    expect(vi.mocked(svc.getSubmissionHistory)).toHaveBeenCalledWith("RC_OTHER");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. POST /recruiter-submission — impersonation prevention
// ═════════════════════════════════════════════════════════════════════════════

describe("POST /api/ats-full-parity/recruiter-submission — impersonation prevention", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockExecute.mockResolvedValue([[]]);
    mockBuildScopeWhereClause.mockResolvedValue({ sql: "1=1", params: [] });
    const svc = await import("../src/modules/ats-full-parity/recruiterInterview.service.js");
    vi.mocked(svc.resolveRecruiterForActor).mockResolvedValue({ id: "r1", name: "Alice", recruiterCode: "RC001", branch: "B1", email: null, employeeId: "e1" });
  });

  it("TC-S12-07: body recruiterCode matches JWT profile → allowed", async () => {
    const app = await makeFpApp("user-rec-1", "recruiter");
    const body = { recruiterCode: "RC001", candidateId: "cand-1", interviewedForProcess: "Onfido", walkinEndStage: "Arrival", finalDecision: "Hold" };
    const res = await request(app).post("/api/ats-full-parity/recruiter-submission").send(body);
    expect(res.status).toBe(200);
  });

  it("TC-S12-08: body recruiterCode differs from JWT profile → 403 impersonation blocked", async () => {
    const app = await makeFpApp("user-rec-1", "recruiter");
    const body = { recruiterCode: "EVIL_RC999", candidateId: "cand-1", interviewedForProcess: "Onfido", walkinEndStage: "Arrival", finalDecision: "Hold" };
    const res = await request(app).post("/api/ats-full-parity/recruiter-submission").send(body);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/recruiterCode.*match|match.*recruiterCode/i);
  });

  it("TC-S12-09: recruiter with no linked profile → 403", async () => {
    const svc = await import("../src/modules/ats-full-parity/recruiterInterview.service.js");
    vi.mocked(svc.resolveRecruiterForActor).mockResolvedValueOnce(null);
    const app = await makeFpApp("user-rec-nolink", "recruiter");
    const res = await request(app).post("/api/ats-full-parity/recruiter-submission").send({ candidateId: "cand-1" });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/recruiter profile/i);
  });

  it("TC-S12-10: admin with different recruiterCode → allowed (privilege bypass)", async () => {
    const app = await makeFpApp("user-admin-1", "admin");
    // admin provides a different recruiterCode in body — should be resolved via lookup, not JWT chain
    const body = { recruiterCode: "RC_OTHER", candidateId: "cand-1", interviewedForProcess: "Onfido", walkinEndStage: "Arrival", finalDecision: "Hold" };
    // mock the DB lookup for admin path
    mockExecute.mockResolvedValueOnce([[{ id: "r2", name: "Bob", recruiter_code: "RC_OTHER", email: null, branch: "B2", employee_id: "e2" }]]);
    const res = await request(app).post("/api/ats-full-parity/recruiter-submission").send(body);
    expect(res.status).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. GET /journey — scope enforcement
// ═════════════════════════════════════════════════════════════════════════════

describe("GET /api/ats-full-parity/journey — scope enforcement", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockExecute.mockResolvedValue([[]]);
    mockBuildScopeWhereClause.mockResolvedValue({ sql: "1=1", params: [] });
    mockHasScopedAccess.mockResolvedValue(true);
  });

  it("TC-S12-11: admin gets candidate journey without scope check", async () => {
    const app = await makeFpApp("user-admin-1", "admin");
    const res = await request(app).get("/api/ats-full-parity/journey?query=cand-1");
    expect(res.status).toBe(200);
    expect(mockHasScopedAccess).not.toHaveBeenCalled();
  });

  it("TC-S12-12: branch_head denied when scope check fails → 403", async () => {
    mockHasScopedAccess.mockResolvedValueOnce(false);
    const app = await makeFpApp("user-bh-1", "branch_head");
    const res = await request(app).get("/api/ats-full-parity/journey?query=cand-1");
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/access denied/i);
  });

  it("TC-S12-13: recruiter allowed when scope check passes → 200", async () => {
    mockHasScopedAccess.mockResolvedValueOnce(true);
    const app = await makeFpApp("user-rec-1", "recruiter");
    const res = await request(app).get("/api/ats-full-parity/journey?query=cand-1");
    expect(res.status).toBe(200);
    expect(mockHasScopedAccess).toHaveBeenCalledWith(
      "user-rec-1",
      expect.arrayContaining(["recruiter"]),
      expect.objectContaining({ branchId: "branch-1", processId: "proc-1" }),
      expect.any(Object),
    );
  });
});
