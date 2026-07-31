/**
 * payroll.security.test.ts
 * Phase 4 payroll security hardening tests.
 *
 * Covers:
 * a) Employee cannot access payroll structures (403)
 * b) Employee cannot create payroll run (403)
 * c) Employee cannot view payroll statutory config (403)
 * d) Employee A cannot view Employee B payslip (403) — server-side mapping
 * e) Employee can view own payslip (200) — server-side mapping resolves correctly
 * f) Employee cannot acknowledge Employee B payslip (403)
 * g) Employee A cannot view Employee B tax declaration (403)
 * h) User with no employee record cannot access tax self-service (403)
 * i) Employee cannot create F&F for exit request (403)
 * j) Employee cannot approve F&F (403)
 * k) Employee cannot view any F&F (403)
 * l) F&F cannot be approved when is_ff_provisional=1 (error thrown)
 * m) computeBasicTds returns pending_configuration when no tds_slab config exists
 * n) calculateLwpDeduction returns pending_configuration when basis is undefined
 * o) calculateGratuity returns pending_configuration when gratuityWageBase is undefined
 * p) Employee cannot list all exit requests (403)
 * q) Employee cannot update exit request status (403)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

vi.mock("../src/db/supabaseAdmin.js", () => ({
  supabaseAdmin: {},
  supabaseAuthClient: { auth: { getUser: vi.fn() } },
}));
vi.mock("../src/db/mysql.js", () => ({ db: { execute: vi.fn().mockResolvedValue([[], []]) }, pingDb: vi.fn() }));
vi.mock("../src/shared/auditLog.js", () => ({
  logSensitiveAction: vi.fn().mockResolvedValue(undefined),
}));

import { app } from "../src/app.js";
import { db } from "../src/db/mysql.js";
import { supabaseAuthClient } from "../src/db/supabaseAdmin.js";
import { payrollGapsService } from "../src/modules/payroll/payrollGaps.service.js";
import { ffService } from "../src/modules/exit/ff.service.js";
import { logSensitiveAction } from "../src/shared/auditLog.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;
const mockGetUser = supabaseAuthClient.auth.getUser as ReturnType<typeof vi.fn>;
const mockLogSensitiveAction = logSensitiveAction as ReturnType<typeof vi.fn>;

/**
 * A real JWT, not a "mock-token-*" demo token, and not the retired
 * "<role>.token" placeholder this file used to send.
 *
 * The placeholder stopped working when auth moved to MySQL JWTs: the middleware
 * hands anything not starting with "mock-token" to verifyAccessToken, jwt.verify
 * throws on "employee.token", and every request 401s. That is why all 18
 * failures here read "expected 401 to be 403" — the suite was asserting nothing
 * about payroll authorization, only that unauthenticated requests are rejected.
 *
 * A demo token would authenticate but would NOT fix the suite: requireRole
 * resolves demo users from req.authUser.role and never queries user_roles, so
 * the per-test role mocks below would go unconsumed and mockEmployeeNoRoles —
 * the "user holds no roles at all" case — could not be expressed at all. These
 * tests exist to prove DB-driven role checks, so the token has to go down the
 * real JWT path. Signed with the same secret tests/setup.ts verifies against.
 */
const JWT_SECRET = process.env.JWT_SECRET || "change-me-jwt-secret-32characters!!";
const empJwt = jwt.sign(
  { sub: "user-emp", email: "employee@mcn.com", iat: Math.floor(Date.now() / 1000) },
  JWT_SECRET,
  { expiresIn: "1h" },
);
const EMP_TOKEN = { Authorization: `Bearer ${empJwt}` };

/**
 * Same employee, but authenticated as "user-1".
 *
 * The audit assertion in e2 expects actor_user_id "user-1" — the identity the
 * suite was written against. Signing the subject the assertion already names
 * keeps that check testing what it was written to test (the audit trail records
 * the authenticated actor), rather than relaxing the expectation to whatever the
 * token happens to carry. A distinct user id also means a distinct auth-cache
 * entry, so this test cannot inherit cached roles from the ones before it.
 */
const AUDIT_TOKEN = {
  Authorization: `Bearer ${jwt.sign(
    { sub: "user-1", email: "employee@mcn.com", iat: Math.floor(Date.now() / 1000) },
    JWT_SECRET,
    { expiresIn: "1h" },
  )}`,
};

// Helper — authenticate as employee (user-emp) with no privileged roles
function mockEmployee(userId = "user-emp") {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId, email: "employee@mcn.com" } },
    error: null,
  });
  // requireRole: user_roles query returns only "employee" role
  mockExecute.mockResolvedValueOnce([[{ role_key: "employee" }], []]);
}

// Helper — authenticate as employee but return EMPTY roles (no role_key at all)
function mockEmployeeNoRoles(userId = "user-emp") {
  mockGetUser.mockResolvedValue({
    data: { user: { id: userId, email: "employee@mcn.com" } },
    error: null,
  });
  mockExecute.mockResolvedValueOnce([[], []]);
}

/**
 * Route db.execute by the SQL it receives instead of by call order.
 *
 * The positional mockResolvedValueOnce chains these tests used cannot survive
 * the auth layer. authMiddleware keeps a 30-second in-process context cache
 * keyed by user id, so the FIRST request for a user costs three to four queries
 * (user_roles, user_assignment_scope, sometimes auth_user role, then auth_user
 * is_read_only) and every later one costs none — and on a cache hit requireRole
 * reads req.authUser.roles and skips its own lookup too. Which test pays that
 * cost depends on execution order, so a positional queue silently shifts under
 * the tests that run later. vi.clearAllMocks() does not drain a once-queue
 * either, so leftovers carry between tests as well.
 *
 * Keyed by SQL, call count and ordering stop mattering. Patterns are tried in
 * order, so list the more specific table first (salary_prep_line_component
 * before salary_prep_line). Anything unmatched returns an empty result set,
 * which is also what an unmocked query should look like.
 */
function mockQueries(routes: Array<[RegExp, unknown[]]>) {
  mockExecute.mockImplementation(async (sql: unknown) => {
    const text = String(sql);
    for (const [pattern, rows] of routes) {
      if (pattern.test(text)) return [rows, []];
    }
    return [[], []];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockReset();
  mockExecute.mockResolvedValue([[], []]);
});

// ── a) Employee cannot access payroll structures (403) ───────────────────────

describe("a) Employee cannot POST /api/payroll/structures", () => {
  it("returns 403 when user has employee role only", async () => {
    mockEmployee();
    const r = await request(app)
      .post("/api/payroll/structures")
      .set(EMP_TOKEN)
      .send({ structureCode: "BPO_A", structureName: "BPO Grade A" });
    expect(r.status).toBe(403);
  });
});

// ── b) Employee cannot create payroll run (403) ──────────────────────────────

describe("b) Employee cannot POST /api/payroll/runs", () => {
  it("returns 403 when user has employee role only", async () => {
    mockEmployee();
    const r = await request(app)
      .post("/api/payroll/runs")
      .set(EMP_TOKEN)
      .send({ runMonth: "2026-05" });
    expect(r.status).toBe(403);
  });
});

// ── c) Employee cannot view statutory config (403) ───────────────────────────

describe("c) Employee cannot GET /api/payroll/statutory-config", () => {
  it("returns 403 when user has employee role only", async () => {
    mockEmployee();
    const r = await request(app)
      .get("/api/payroll/statutory-config")
      .set(EMP_TOKEN);
    expect(r.status).toBe(403);
  });
});

// ── d) Employee A cannot view Employee B payslip (403) ───────────────────────
// The route uses getEmployeeForUser to map user_id → employee_id server-side.
// employee A (user-emp-a) maps to employee emp-A; trying to view emp-B's payslip → 403.

describe("d) Employee A cannot view Employee B payslip", () => {
  it("returns 403 when server-side mapping resolves to a different employee", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-emp-a", email: "empA@mcn.com" } },
      error: null,
    });
    // hasRole check — no privileged role
    mockExecute.mockResolvedValueOnce([[], []]);
    // getEmployeeForUser — resolves to emp-A
    mockExecute.mockResolvedValueOnce([[{ id: "emp-A", employee_code: "MCN001" }], []]);

    const r = await request(app)
      .get("/api/payroll/payslip/run-1/emp-B")
      .set(EMP_TOKEN);
    expect(r.status).toBe(403);
  });
});

// ── e) Employee can view own payslip (200) ───────────────────────────────────

describe("e) Employee can view own payslip", () => {
  it("returns 200 when server-side mapping resolves to the same employee", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-emp-a", email: "empA@mcn.com" } },
      error: null,
    });
    mockQueries([
      // getEmployeeForUser — resolves the caller to emp-A, same as the URL param
      [/FROM employees/i, [{ id: "emp-A", employee_code: "MCN001" }]],
      // payslipService.getPayslip
      [/FROM salary_prep_line/i, [{
        id: "ps-1", run_id: "run-1", employee_id: "emp-A",
        payslip_ref: "PS-2026-05-MCN001",
        gross_salary: 25000, net_salary: 22600,
      }]],
      // Role lookups fall through to [] — the point of this test is that an
      // employee with no privileged role can still read their OWN payslip.
    ]);

    const r = await request(app)
      .get("/api/payroll/payslip/run-1/emp-A")
      .set(EMP_TOKEN);
    expect(r.status).toBe(200);
    expect(r.body.data).toBeDefined();
  });
});

describe("e2) Employee payslip history", () => {
  it("rejects an invalid year before querying payroll data", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-emp-a", email: "empA@mcn.com" } },
      error: null,
    });
    mockExecute.mockResolvedValueOnce([[{ id: "emp-A", employee_code: "MCN001" }], []]);

    const r = await request(app)
      .get("/api/payroll/payslip/my?year=%25")
      .set(EMP_TOKEN);

    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/invalid payslip year/i);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("returns only the authenticated employee history and audits metadata", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-emp-a", email: "empA@mcn.com" } },
      error: null,
    });
    mockQueries([
      [/FROM employees/i, [{ id: "emp-A", employee_code: "MCN001" }]],
      // More specific table first — salary_prep_line is a prefix of this one.
      [/salary_prep_line_component/i, [{
        component_code: "BASIC",
        component_name: "Basic Salary",
        component_type: "earning",
        amount: 15000,
        taxable: 1,
      }]],
      [/salary_prep_line/i, [{
        id: "line-1",
        employee_id: "emp-A",
        run_month: "2026-05",
        gross_salary: 25000,
        total_deductions: 2400,
        net_salary: 22600,
      }]],
    ]);

    const r = await request(app)
      .get("/api/payroll/payslip/my?year=2026")
      .set(AUDIT_TOKEN);

    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0].earnings).toHaveLength(1);
    expect(mockLogSensitiveAction).toHaveBeenCalledWith(expect.objectContaining({
      actor_user_id: "user-1",
      action_type: "PAYSLIP_HISTORY_VIEWED",
      entity_id: "emp-A",
      change_summary: { year: "2026", statement_count: 1 },
    }));
  });
});

// ── f) Employee cannot acknowledge Employee B payslip (403) ─────────────────
// Route: POST /api/payroll/payslip/:payslipId/acknowledge
// Server maps user → employee; payslipService.acknowledgePayslip checks employee_id ownership.

describe("f) Employee cannot acknowledge Employee B payslip", () => {
  it("returns 403 when acknowledging another employee payslip", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-emp-a", email: "empA@mcn.com" } },
      error: null,
    });
    mockQueries([
      // getEmployeeForUser — resolves the caller to emp-A
      [/FROM employees/i, [{ id: "emp-A", employee_code: "MCN001" }]],
      // acknowledgePayslip SELECT — the payslip belongs to emp-B, not the caller
      [/FROM salary_payslip/i, [{ id: "ps-2", employee_id: "emp-B" }]],
    ]);

    const r = await request(app)
      .post("/api/payroll/payslip/ps-2/acknowledge")
      .set(EMP_TOKEN);
    expect(r.status).toBe(403);
  });
});

// ── g) Employee A cannot view Employee B tax declaration (403) ───────────────

describe("g) Employee A cannot view Employee B tax declaration", () => {
  it("returns 403 when server-side mapping resolves to a different employee", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-emp-a", email: "empA@mcn.com" } },
      error: null,
    });
    // hasRole check — no privileged role
    mockExecute.mockResolvedValueOnce([[], []]);
    // getEmployeeForUser — resolves to emp-A, but URL param is emp-B
    mockExecute.mockResolvedValueOnce([[{ id: "emp-A", employee_code: "MCN001" }], []]);

    const r = await request(app)
      .get("/api/payroll/tax-declaration/emp-B/2026-2027")
      .set(EMP_TOKEN);
    expect(r.status).toBe(403);
  });
});

// ── h) User with no employee record cannot access tax self-service (403) ─────
// POST tax-declaration: non-privileged user with no employee record → 403

describe("h) User with no employee record cannot access tax self-service", () => {
  it("returns 403 when getEmployeeForUser returns null", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-no-emp", email: "ghost@mcn.com" } },
      error: null,
    });
    // hasRole check — no privileged role
    mockExecute.mockResolvedValueOnce([[], []]);
    // getEmployeeForUser — no employee mapped
    mockExecute.mockResolvedValueOnce([[], []]);

    const r = await request(app)
      .post("/api/payroll/tax-declaration/emp-X/2026-2027")
      .set(EMP_TOKEN)
      .send({ regime: "new" });
    expect(r.status).toBe(403);
  });
});

// ── i) Employee cannot create F&F for exit request (403) ────────────────────

describe("i) Employee cannot POST /api/exit/ff/:exitRequestId", () => {
  it("returns 403 when user has employee role only", async () => {
    mockEmployee();
    const r = await request(app)
      .post("/api/exit/ff/exit-1")
      .set(EMP_TOKEN)
      .send({ calculationDate: "2026-05-29" });
    expect(r.status).toBe(403);
  });
});

// ── j) Employee cannot approve F&F (403) ────────────────────────────────────

describe("j) Employee cannot POST /api/exit/ff/:id/approve", () => {
  it("returns 403 when user has employee role only", async () => {
    mockEmployee();
    const r = await request(app)
      .post("/api/exit/ff/ff-1/approve")
      .set(EMP_TOKEN);
    expect(r.status).toBe(403);
  });
});

// ── k) Employee cannot view any F&F (403) ────────────────────────────────────

describe("k) Employee cannot GET /api/exit/ff/:exitRequestId", () => {
  it("returns 403 when user has employee role only", async () => {
    mockEmployee();
    const r = await request(app)
      .get("/api/exit/ff/exit-1")
      .set(EMP_TOKEN);
    expect(r.status).toBe(403);
  });
});

// ── l) F&F cannot be approved when is_ff_provisional=1 ──────────────────────

describe("l) ffService.approveFF blocked when is_ff_provisional=1", () => {
  it("throws error when is_ff_provisional is 1", async () => {
    mockQueries([
      [/FROM full_final_calculation/i, [{
        id: "ff-1",
        exit_request_id: "exit-1",
        employee_id: "emp-1",
        status: "draft",
        is_ff_provisional: 1,
      }]],
    ]);

    await expect(ffService.approveFF("ff-1", "admin-1")).rejects.toThrow(
      /provisional/i
    );
  });
});

// ── m) computeBasicTds returns pending_configuration when no tds_slab config ─

describe("m) payrollGapsService.computeBasicTds — pending_configuration with no config", () => {
  it("returns pending_configuration status when no tds_slab_* rows exist", async () => {
    // checkTdsConfigExists → COUNT returns 0
    mockExecute.mockResolvedValueOnce([[{ cnt: 0 }], []]);

    const result = await payrollGapsService.computeBasicTds(500000);
    expect(result.status).toBe("pending_configuration");
    expect(result.tds).toBe(0);
  });

  it("returns pending_configuration when tds_slab query returns empty rows", async () => {
    // COUNT returns 0 (no rows)
    mockExecute.mockResolvedValueOnce([[{ cnt: 0 }], []]);

    const result = await payrollGapsService.computeBasicTds(800000);
    expect(result.status).toBe("pending_configuration");
    expect(result.tds).toBe(0);
    expect(result.note).toMatch(/no hardcoded defaults/i);
  });
});

// ── n) calculateLwpDeduction returns pending_configuration when basis undefined

describe("n) payrollGapsService.calculateLwpDeduction — pending_configuration", () => {
  it("returns pending_configuration when lwpBasis is undefined", () => {
    const result = payrollGapsService.calculateLwpDeduction(2, 300000, 26, undefined);
    expect(result.status).toBe("pending_configuration");
    expect(result.amount).toBe(0);
  });

  it("returns pending_configuration note mentioning lwp_deduction_basis", () => {
    const result = payrollGapsService.calculateLwpDeduction(3, 400000, 26, undefined);
    expect(result.note).toMatch(/lwp_deduction_basis/i);
  });

  it("returns configured status when basis is ctc_annual", () => {
    const result = payrollGapsService.calculateLwpDeduction(2, 300000, 26, "ctc_annual");
    expect(result.status).toBe("configured");
    expect(result.amount).toBeGreaterThan(0);
  });
});

// ── o) calculateGratuity returns pending_configuration when wage base undefined

describe("o) ffService.calculateGratuity — pending_configuration", () => {
  it("returns pending_configuration when gratuityWageBase is undefined", () => {
    const result = ffService.calculateGratuity("2020-01-01", "2026-01-01", undefined);
    expect(result.status).toBe("pending_configuration");
    expect(result.amount).toBe(0);
  });

  it("returns pending_configuration note mentioning wage base configuration", () => {
    const result = ffService.calculateGratuity("2018-01-01", "2026-01-01", undefined);
    expect(result.note).toMatch(/wage base/i);
  });

  it("returns draft status when wage base is provided and tenure >= 5 years", () => {
    const result = ffService.calculateGratuity("2020-01-01", "2026-01-01", 25000);
    expect(result.status).toBe("draft");
    expect(result.amount).toBeGreaterThan(0);
  });

  it("returns not_eligible when tenure < minYears", () => {
    const result = ffService.calculateGratuity("2023-01-01", "2026-01-01", 25000);
    expect(result.status).toBe("not_eligible");
    expect(result.amount).toBe(0);
  });
});

// ── p) Employee cannot list all exit requests (403) ──────────────────────────

describe("p) Employee cannot GET /api/exit/ (list all)", () => {
  it("returns 403 when user has employee role only", async () => {
    mockEmployee();
    const r = await request(app)
      .get("/api/exit/")
      .set(EMP_TOKEN);
    expect(r.status).toBe(403);
  });
});

// ── q) Employee cannot update exit request status (403) ──────────────────────

describe("q) Employee cannot PATCH /api/exit/:id/status", () => {
  it("returns 403 when user has employee role only", async () => {
    mockEmployee();
    const r = await request(app)
      .patch("/api/exit/exit-1/status")
      .set(EMP_TOKEN)
      .send({ status: "closed" });
    expect(r.status).toBe(403);
  });
});
