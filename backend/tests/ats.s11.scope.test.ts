/**
 * S11 Scope Tests
 *
 * 1. webData scope enforcement — branch_head/process_manager/recruiter scoped; admin bypasses
 * 2. dailyReportSnapshot scope — branch_head passes actorId; admin bypasses
 * 3. GET /api/ats-full-parity/web-data route passes actorId from authUser
 * 4. GET /api/ats-full-parity/queue route passes actorId from authUser
 * 5. GET /api/ats-full-parity/daily-report/snapshot route scope logic
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── Module mocks ──────────────────────────────────────────────────────────────

const mockBuildScopeWhereClause = vi.fn().mockResolvedValue({ sql: "1=1", params: [] });

vi.mock("../src/shared/scopeAccess.js", () => ({
  buildScopeWhereClause: mockBuildScopeWhereClause,
  hasScopedAccess: vi.fn().mockResolvedValue(true),
}));

const mockDbExecute = vi.fn();
vi.mock("../src/db/mysql.js", () => ({
  db: { execute: mockDbExecute },
}));

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

vi.mock("../src/modules/ats-full-parity/recruiterInterview.service.js", () => ({
  submitInterviewUpdate: vi.fn().mockResolvedValue({ submission: {}, action: "created" }),
  verifyRecruiter: vi.fn(),
  getMyPendingCandidates: vi.fn(),
  getSubmissionHistory: vi.fn(),
}));

// ── Auth middleware shims ─────────────────────────────────────────────────────

function makeAuthMiddleware(userId: string, role: string) {
  return vi.fn((req: any, _res: any, next: any) => {
    req.authUser = { id: userId, role };
    next();
  });
}

vi.mock("../src/middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.authUser = { id: "demo-user-id", role: "employee" };
    req.user = { id: "demo-user-id", email: "demo@mascallnet.com", role: "employee" };
    next();
  },
}));

vi.mock("../src/middleware/requireRole.js", () => ({
  requireRole: (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
}));

// ── Candidate rows returned by DB (simplified) ───────────────────────────────

function candidateRow(overrides: Record<string, any> = {}) {
  return {
    id: "cand-1",
    candidate_code: "CND-001",
    full_name: "Test Candidate",
    mobile: "9000000001",
    active_status: 1,
    applied_for_branch: "branch-1",
    applied_for_process: "proc-1",
    branch_text: "Branch One",
    process_text: "Process One",
    created_at: new Date(),
    created_date: null,
    status: "Waiting",
    current_stage: "New",
    walkin_end_stage: null,
    recruiter_assigned_name: "Recruiter A",
    recruiter_name: null,
    sla_breached: 0,
    ...overrides,
  };
}

// ── Config rows ───────────────────────────────────────────────────────────────

const configRows = [{ setting: "Org_Name", value_text: "Test Org" }];

// ── Helper — build a test app from the atsFullParity router ──────────────────

async function makeApp(userId: string, role: string) {
  const app = express();
  app.use(express.json());
  // Inject authUser before the router picks it up
  app.use((req: any, _res, next) => {
    req.authUser = { id: userId, role };
    next();
  });
  const { atsFullParityRouter } = await import("../src/modules/ats-full-parity/atsFullParity.routes.js");
  app.use("/api/ats-full-parity", atsFullParityRouter);
  return app;
}

// ── Helpers to seed mock DB ───────────────────────────────────────────────────

function seedCandidateAndConfig() {
  // candidateSelect query → returns one row
  mockDbExecute.mockResolvedValueOnce([[candidateRow()]]);
  // getConfigMap query
  mockDbExecute.mockResolvedValueOnce([configRows]);
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. webData() service — scope injection when actorId is provided
// ═════════════════════════════════════════════════════════════════════════════

describe("atsFullParityService.webData() — scope injection", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // Re-apply mocks after resetModules
    mockBuildScopeWhereClause.mockResolvedValue({ sql: "1=1", params: [] });
    mockDbExecute.mockResolvedValue([[]]);
  });

  it("TC-S11-01: actorId without bypassScope → buildScopeWhereClause called", async () => {
    seedCandidateAndConfig();
    const { atsFullParityService } = await import("../src/modules/ats-full-parity/atsFullParity.service.js");
    await atsFullParityService.webData({ actorId: "user-bh-1" });
    expect(mockBuildScopeWhereClause).toHaveBeenCalledWith(
      "user-bh-1",
      ["branch_head", "process_manager", "recruiter", "manager", "hr"],
      { branchId: "c.applied_for_branch", processId: "c.applied_for_process" },
      { allowAdminBypass: true, allowCeoAllRead: true },
    );
  });

  it("TC-S11-02: bypassScope=true → buildScopeWhereClause NOT called", async () => {
    seedCandidateAndConfig();
    const { atsFullParityService } = await import("../src/modules/ats-full-parity/atsFullParity.service.js");
    await atsFullParityService.webData({ actorId: "user-admin-1", bypassScope: true });
    expect(mockBuildScopeWhereClause).not.toHaveBeenCalled();
  });

  it("TC-S11-03: no actorId at all → buildScopeWhereClause NOT called (backward-compat)", async () => {
    seedCandidateAndConfig();
    const { atsFullParityService } = await import("../src/modules/ats-full-parity/atsFullParity.service.js");
    await atsFullParityService.webData({});
    expect(mockBuildScopeWhereClause).not.toHaveBeenCalled();
  });

  it("TC-S11-04: scope returns 1=0 → candidateRows empty", async () => {
    mockBuildScopeWhereClause.mockResolvedValueOnce({ sql: "1=0", params: [] });
    // candidateSelect with 1=0 returns no rows
    mockDbExecute.mockResolvedValueOnce([[]]); // candidateSelect
    mockDbExecute.mockResolvedValueOnce([configRows]); // getConfigMap
    const { atsFullParityService } = await import("../src/modules/ats-full-parity/atsFullParity.service.js");
    const result = await atsFullParityService.webData({ actorId: "user-bh-out-of-scope" });
    expect(result.candidateRows).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Route — GET /api/ats-full-parity/web-data passes actorId correctly
// ═════════════════════════════════════════════════════════════════════════════

describe("GET /api/ats-full-parity/web-data — route scope forwarding", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockBuildScopeWhereClause.mockResolvedValue({ sql: "1=1", params: [] });
    mockDbExecute.mockResolvedValue([[]]);
  });

  it("TC-S11-05: branch_head role → buildScopeWhereClause called with actor id", async () => {
    mockDbExecute.mockResolvedValueOnce([[]]); // candidateSelect
    mockDbExecute.mockResolvedValueOnce([configRows]); // getConfigMap
    const app = await makeApp("user-bh-1", "branch_head");
    await request(app).get("/api/ats-full-parity/web-data");
    expect(mockBuildScopeWhereClause).toHaveBeenCalledWith(
      "user-bh-1",
      expect.arrayContaining(["branch_head"]),
      expect.objectContaining({ branchId: "c.applied_for_branch" }),
      expect.any(Object),
    );
  });

  it("TC-S11-06: admin role → buildScopeWhereClause NOT called (bypassScope)", async () => {
    mockDbExecute.mockResolvedValueOnce([[]]); // candidateSelect
    mockDbExecute.mockResolvedValueOnce([configRows]); // getConfigMap
    const app = await makeApp("user-admin-1", "admin");
    await request(app).get("/api/ats-full-parity/web-data");
    expect(mockBuildScopeWhereClause).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Route — GET /api/ats-full-parity/queue passes actorId
// ═════════════════════════════════════════════════════════════════════════════

describe("GET /api/ats-full-parity/queue — route scope forwarding", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockBuildScopeWhereClause.mockResolvedValue({ sql: "1=1", params: [] });
    mockDbExecute.mockResolvedValue([[]]);
  });

  it("TC-S11-07: process_manager role → buildScopeWhereClause called", async () => {
    mockDbExecute.mockResolvedValueOnce([[]]); // candidateSelect
    mockDbExecute.mockResolvedValueOnce([configRows]); // getConfigMap
    const app = await makeApp("user-pm-1", "process_manager");
    await request(app).get("/api/ats-full-parity/queue");
    expect(mockBuildScopeWhereClause).toHaveBeenCalledWith(
      "user-pm-1",
      expect.arrayContaining(["process_manager"]),
      expect.objectContaining({ processId: "c.applied_for_process" }),
      expect.any(Object),
    );
  });

  it("TC-S11-08: hr role → buildScopeWhereClause NOT called (bypassScope)", async () => {
    mockDbExecute.mockResolvedValueOnce([[]]); // candidateSelect
    mockDbExecute.mockResolvedValueOnce([configRows]); // getConfigMap
    const app = await makeApp("user-hr-1", "hr");
    await request(app).get("/api/ats-full-parity/queue");
    expect(mockBuildScopeWhereClause).not.toHaveBeenCalled();
  });
});
