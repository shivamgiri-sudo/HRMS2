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
  ORG_WIDE_EXEMPT_ROLES: ["super_admin", "ceo", "coo", "cfo", "payroll_head", "finance_head", "accounts_head", "finance"],
  getUserRoleKeys: vi.fn(async (id: string) => [ACTOR_ROLES.get(id) ?? "employee"]),
  getUserAssignmentScopes: vi.fn().mockResolvedValue([]),
  buildScopeWhereClause: mockBuildScopeWhereClause,
  hasScopedAccess: vi.fn().mockResolvedValue(true),
}));

// The ATS candidate scope now comes from ats-branch-scope (owner policy 2026-10-01): org-wide roles see
// everything, every other role - hr and admin included - is limited to its own branch. The resolver is mocked
// (role -> scope) so the db.execute queue below stays reserved for the report queries; the SQL builders are real.
const ORG_WIDE = ["super_admin", "ceo", "coo", "cfo", "payroll_head", "finance_head", "accounts_head", "finance"];
const BRANCH_SCOPE = { orgWide: false, branchIds: ["b1"], branchSpellings: ["Branch One", "b1"], branchNames: ["Branch One"], processNames: [] };
const mockResolveAtsBranchScope = vi.fn();
vi.mock("../src/modules/ats/ats-branch-scope.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/modules/ats/ats-branch-scope.js")>();
  return { ...actual, resolveAtsBranchScope: mockResolveAtsBranchScope };
});
function useRoleDrivenScope() {
  mockResolveAtsBranchScope.mockImplementation(async (id: string) =>
    ORG_WIDE.includes(ACTOR_ROLES.get(id) ?? "") ? { ...actual_ORG } : { ...BRANCH_SCOPE });
}
const actual_ORG = { orgWide: true, branchIds: [], branchSpellings: [], branchNames: [], processNames: [] };
const scopedCandidateQuery = () =>
  mockDbExecute.mock.calls.find((c) => /applied_for_branch IN/.test(String(c[0])));

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

// Only fills in an identity when the test has not already provided one, and
// spreads the real module so exports it does not override still exist.
//
// Assigning req.authUser unconditionally overwrote whatever makeApp had just set:
// requireAuth is mounted on the router, so it runs after the factory middleware
// and won. Every request then ran as demo-user-id regardless of the actor the case
// was about, which is why the scope clause was built for "demo-user-id" instead of
// "user-bh-1".
vi.mock("../src/middleware/authMiddleware.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/middleware/authMiddleware.js")>();
  return {
    ...actual,
    requireAuth: (req: any, _res: any, next: any) => {
      if (!req.authUser) {
        req.authUser = { id: "demo-user-id", role: "employee" };
        req.user = { id: "demo-user-id", email: "demo@mascallnet.com", role: "employee" };
      }
      next();
    },
  };
});

/**
 * The role each test actor was created with, keyed by user id.
 *
 * These routes decide bypassScope from getUserRoleContext(userId), which queries
 * user_roles. Against the mocked db that returns nothing, so admin and hr both
 * collapsed to "employee", bypassScope stayed false, and the scope clause was
 * built for actors who are supposed to skip it.
 */
const ACTOR_ROLES = new Map<string, string>();

vi.mock("../src/shared/roleResolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/roleResolver.js")>();
  return {
    ...actual,
    getUserRoleContext: vi.fn(async (userId: string) => {
      const role = ACTOR_ROLES.get(userId) ?? "employee";
      // Mirrors roleResolver.ts:151-158 — isSuperAdmin covers "admin" too.
      return {
        roleKeys: [role],
        primaryRole: role,
        isSuperAdmin: role === "super_admin" || role === "admin",
        isHO: false,
      };
    }),
  };
});

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
  ACTOR_ROLES.set(userId, role);
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
    useRoleDrivenScope();
    mockDbExecute.mockResolvedValue([[]]);
  });

  it("TC-S11-01: actorId without bypassScope → buildScopeWhereClause called", async () => {
    seedCandidateAndConfig();
    const { atsFullParityService } = await import("../src/modules/ats-full-parity/atsFullParity.service.js");
    ACTOR_ROLES.set("user-bh-1", "branch_head");
    await atsFullParityService.webData({ actorId: "user-bh-1" });
    // Owner policy 2026-10-01: the ATS branch resolver (not buildScopeWhereClause) scopes the rows.
    expect(mockResolveAtsBranchScope).toHaveBeenCalledWith("user-bh-1");
    expect(mockBuildScopeWhereClause).not.toHaveBeenCalled();
    const q = scopedCandidateQuery();
    expect(q).toBeTruthy();
    expect(q![1]).toEqual(expect.arrayContaining(["Branch One", "b1"]));
  });

  it("TC-S11-02: bypassScope=true → buildScopeWhereClause NOT called", async () => {
    seedCandidateAndConfig();
    const { atsFullParityService } = await import("../src/modules/ats-full-parity/atsFullParity.service.js");
    await atsFullParityService.webData({ actorId: "user-admin-1", bypassScope: true });
    expect(mockBuildScopeWhereClause).not.toHaveBeenCalled();
    expect(mockResolveAtsBranchScope).not.toHaveBeenCalled();
    expect(scopedCandidateQuery()).toBeUndefined();
  });

  it("TC-S11-03: no actorId at all → buildScopeWhereClause NOT called (backward-compat)", async () => {
    seedCandidateAndConfig();
    const { atsFullParityService } = await import("../src/modules/ats-full-parity/atsFullParity.service.js");
    await atsFullParityService.webData({});
    expect(mockBuildScopeWhereClause).not.toHaveBeenCalled();
  });

  it("TC-S11-04: scope returns 1=0 → candidateRows empty", async () => {
    // A user whose scope cannot be resolved sees nothing (fails closed).
    mockResolveAtsBranchScope.mockResolvedValueOnce({ orgWide: false, branchIds: [], branchSpellings: [], branchNames: [], processNames: [] });
    // webData issues the (independent) config lookup first and the candidate query right behind it.
    mockDbExecute.mockResolvedValueOnce([configRows]); // getConfigMap
    // candidateSelect with 1=0 returns no rows
    mockDbExecute.mockResolvedValueOnce([[]]); // candidateSelect
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
    useRoleDrivenScope();
    mockDbExecute.mockResolvedValue([[]]);
  });

  it("TC-S11-05: branch_head role → buildScopeWhereClause called with actor id", async () => {
    mockDbExecute.mockResolvedValueOnce([[]]); // candidateSelect
    mockDbExecute.mockResolvedValueOnce([configRows]); // getConfigMap
    const app = await makeApp("user-bh-1", "branch_head");
    await request(app).get("/api/ats-full-parity/web-data");
    expect(mockResolveAtsBranchScope).toHaveBeenCalledWith("user-bh-1");
    expect(scopedCandidateQuery()).toBeTruthy();
  });

  it("TC-S11-06: admin is branch-scoped; super_admin (org-wide) is not", async () => {
    mockDbExecute.mockResolvedValueOnce([[]]); // candidateSelect
    mockDbExecute.mockResolvedValueOnce([configRows]); // getConfigMap
    const app = await makeApp("user-admin-1", "admin");
    await request(app).get("/api/ats-full-parity/web-data");
    expect(scopedCandidateQuery()).toBeTruthy();

    mockDbExecute.mockClear();
    mockDbExecute.mockResolvedValue([[]]);
    const appSuper = await makeApp("user-super-1", "super_admin");
    await request(appSuper).get("/api/ats-full-parity/web-data");
    expect(scopedCandidateQuery()).toBeUndefined();
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
    useRoleDrivenScope();
    mockDbExecute.mockResolvedValue([[]]);
  });

  it("TC-S11-07: process_manager role → buildScopeWhereClause called", async () => {
    mockDbExecute.mockResolvedValueOnce([[]]); // candidateSelect
    mockDbExecute.mockResolvedValueOnce([configRows]); // getConfigMap
    const app = await makeApp("user-pm-1", "process_manager");
    await request(app).get("/api/ats-full-parity/queue");
    expect(mockResolveAtsBranchScope).toHaveBeenCalledWith("user-pm-1");
    expect(scopedCandidateQuery()).toBeTruthy();
  });

  it("TC-S11-08: hr is limited to its own branch (no longer bypasses scope); coo bypasses", async () => {
    mockDbExecute.mockResolvedValueOnce([[]]); // candidateSelect
    mockDbExecute.mockResolvedValueOnce([configRows]); // getConfigMap
    const app = await makeApp("user-hr-1", "hr");
    await request(app).get("/api/ats-full-parity/queue");
    expect(scopedCandidateQuery()).toBeTruthy();

    mockDbExecute.mockClear();
    mockDbExecute.mockResolvedValue([[]]);
    const appCoo = await makeApp("user-coo-1", "coo");
    await request(appCoo).get("/api/ats-full-parity/queue");
    expect(scopedCandidateQuery()).toBeUndefined();
    expect(mockBuildScopeWhereClause).not.toHaveBeenCalled();
  });
});
