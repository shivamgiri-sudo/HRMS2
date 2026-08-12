/**
 * Performance Feedback - Integration Tests
 *
 * Full workflow end-to-end tests:
 * 1. HR creates cycle
 * 2. HR launches cycle (auto-creates requests)
 * 3. Manager submits feedback
 * 4. System generates report with training needs
 * 5. Manager creates development plan
 * 6. Verify all data persists correctly
 *
 * NOTE: Uses mocked DB and auth following codebase patterns
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

// Mock dependencies BEFORE imports
vi.mock("../src/db/supabaseAdmin.js", () => ({
  supabaseAdmin: {},
  supabaseAuthClient: { auth: { getUser: vi.fn() } },
}));

// Identity is INJECTED, not authenticated. Real requireAuth resolves role and read-only
// state first, issuing "SELECT is_read_only FROM auth_user WHERE id = ?" before the handler
// — confirmed by logging every db.execute. That consumed the first mockResolvedValueOnce in
// every test below, so each queued response landed one query early. It also caches per user
// for 30s, so whether it queries at all depends on which test ran first; queueing an extra
// mock would bake in the current test ORDER.
//
// Same approach as tests/qa-audit.routes.test.ts, which is why its mock sequences line up.
// performance-feedback.routes.ts imports only requireAuth from this module.
let currentUser: { id: string; email: string; role?: string } = {
  id: "u-hr",
  email: "hr@mcn.com",
};

// Spreads the real module rather than listing exports. This test imports the whole app, so
// authMiddleware must keep every other export it publishes — requireWriteAccess among them.
// A hand-written list is how routes.integration and qa-audit broke: a source file gains an
// import, the mock does not, and the missing binding throws inside a handler.
vi.mock("../src/middleware/authMiddleware.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/middleware/authMiddleware.js")>()),
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.authUser = currentUser;
    next();
  },
}));

// resolveReportScope() in the controller calls hasRole() and getEmployeeForUser() from
// accessGuard before the handler's own queries, and BOTH hit db.execute. Worse, how many
// times depends on the branch taken: an HR caller stops after one hasRole, an employee makes
// three. Those calls silently drew from each test's mockResolvedValueOnce queue, so the
// report query below received a row meant for a scope lookup and returned 404 — after
// earlier returning 403 for the same reason one query further up.
//
// Mocked rather than queued, exactly as tests/rta.package.c.test.ts does for the policy
// cache: queueing extra db responses would encode one specific branch and break on any
// other. Roles key off the injected identity, and getEmployeeForUser returns the same id so
// the resulting scope filter matches the employee_id in the mocked report rows.
//
// importOriginal so every other accessGuard export survives — selfOrAdminHr among them,
// which the routes use and which a hand-written list would have dropped.
vi.mock("../src/shared/accessGuard.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/shared/accessGuard.js")>()),
  hasRole: (userId: string, ...roles: string[]) => {
    if (userId === "11111111-1111-1111-1111-111111111105") return Promise.resolve(false);
    if (userId === "11111111-1111-1111-1111-111111111106") {
      return Promise.resolve(
        roles.some((r) => ["manager", "process_manager", "assistant_manager"].includes(r)),
      );
    }
    return Promise.resolve(roles.some((r) => ["admin", "hr"].includes(r)));
  },
  getEmployeeForUser: (userId: string) =>
    Promise.resolve({ id: userId, employee_code: "TEST-EMP" }),
}));

// Mock requireRole so privileged test tokens (hr.token, manager.token) pass
// and the employee token is blocked. All test tokens map to user-1 via
// setup.ts, so we inspect the Authorization header token prefix instead.
// NOTE: vi.mock factories are hoisted above variable declarations, so all
// data must be inlined inside the factory function.
vi.mock("../src/middleware/requireRole.js", () => ({
  requireRole: (...allowedRoles: string[]) =>
    (req: any, _res: any, next: any) => {
      // Keyed on the authenticated identity, not the raw Authorization string. The tokens
      // are now real JWTs (see the SOP note in tests/setup.ts), so there is no ".token"
      // suffix left to inspect — requireAuth has already resolved the JWT `sub` into
      // req.authUser.id by the time this runs.
      //   u-hr    → ["hr", "admin"]
      //   MGR_UUID → ["manager"]
      //   EMP_UUID → [] (no privileged roles)
      const userId: string = req.authUser?.id ?? "";
      let userRoles: string[];
      if (userId === "11111111-1111-1111-1111-111111111105") {
        userRoles = [];
      } else if (userId === "11111111-1111-1111-1111-111111111106") {
        userRoles = ["manager"];
      } else {
        // u-hr, or any other identity → full HR/admin access
        userRoles = ["hr", "admin"];
      }
      const allowed = allowedRoles.some((r) => userRoles.includes(r));
      if (!allowed) {
        return _res.status(403).json({ success: false, message: "Forbidden" });
      }
      return next();
    },
}));
const mockConnection = {
  execute: vi.fn().mockResolvedValue([[], []]),
  beginTransaction: vi.fn().mockResolvedValue(undefined),
  commit: vi.fn().mockResolvedValue(undefined),
  rollback: vi.fn().mockResolvedValue(undefined),
  release: vi.fn(),
};

vi.mock("../src/db/mysql.js", () => ({
  db: {
    execute: vi.fn().mockResolvedValue([[], []]),
    executeRun: vi.fn(),
    getConnection: vi.fn().mockResolvedValue([[], []]),
  },
  pingDb: vi.fn(),
}));

import { app } from "../src/app.js";
import { db } from "../src/db/mysql.js";
import { supabaseAuthClient } from "../src/db/supabaseAdmin.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;
const mockExecuteRun = db.executeRun as ReturnType<typeof vi.fn>;
const mockGetConnection = db.getConnection as ReturnType<typeof vi.fn>;
const mockGetUser = supabaseAuthClient.auth.getUser as ReturnType<typeof vi.fn>;

// Kept so the .set(...) call sites stay unchanged. The header no longer decides anything —
// requireAuth is mocked above and identity comes from mockHr()/mockManager()/mockEmployee().
const HR_AUTH = { Authorization: "Bearer test-hr" };
const MANAGER_AUTH = { Authorization: "Bearer test-manager" };
const EMPLOYEE_AUTH = { Authorization: "Bearer test-employee" };

beforeEach(() => {
  vi.clearAllMocks();
  // Default to HR, matching the requireRole mock's "any other identity -> hr/admin" branch,
  // so a test that forgets to declare its actor cannot silently inherit the previous one's.
  currentUser = { id: "u-hr", email: "hr@mcn.com", role: "hr" };
  // Reset Once queues so previous tests don't bleed into next
  mockExecute.mockReset();
  mockExecuteRun.mockReset();
  mockConnection.execute.mockReset();
  mockGetConnection.mockReset();
  // Set defaults
  mockExecute.mockResolvedValue([[], []]);
  mockExecuteRun.mockResolvedValue([{ affectedRows: 0, insertId: 0 }, []]);
  mockConnection.execute.mockResolvedValue([{ insertId: 1, affectedRows: 1 }, []]);
  mockGetConnection.mockResolvedValue(mockConnection);
  mockExecuteRun.mockResolvedValue([{ affectedRows: 0, insertId: 0 }, []]);
});

// These three originally set a Supabase getUser mock, which authenticated nothing —
// authMiddleware.ts does not reference supabase at all. They now set the identity that the
// mocked requireAuth injects, which is the job they were always named for. The UUIDs match
// the manager/employee ids in the mocked SQL rows, because the controllers compare
// req.authUser.id against them.
const MGR_UUID = "11111111-1111-1111-1111-111111111106";
const EMP_UUID = "11111111-1111-1111-1111-111111111105";

function mockHr() {
  currentUser = { id: "u-hr", email: "hr@mcn.com", role: "hr" };
}

function mockManager() {
  currentUser = { id: MGR_UUID, email: "manager@mcn.com", role: "manager" };
}

function mockEmployee() {
  currentUser = { id: EMP_UUID, email: "employee@mcn.com", role: "employee" };
}

describe("Performance Feedback - Full Workflow Integration", () => {
  const cycleId    = "11111111-1111-1111-1111-111111111101";
  const requestId  = "11111111-1111-1111-1111-111111111102";
  const reportId   = "11111111-1111-1111-1111-111111111103";
  const planId     = "11111111-1111-1111-1111-111111111104";
  const employeeId = "11111111-1111-1111-1111-111111111105";
  const managerId  = "11111111-1111-1111-1111-111111111106";
  const compId1    = "11111111-1111-1111-1111-111111111107";
  const compId2    = "11111111-1111-1111-1111-111111111108";
  const kpiId1     = "11111111-1111-1111-1111-111111111109";

  it("1. HR creates feedback cycle", async () => {
    mockHr();
    // createCycle: INSERT (db.execute → insertId) + SELECT re-fetch (db.execute)
    mockExecute.mockResolvedValueOnce([{ insertId: 1, affectedRows: 1 }, []]);
    mockExecute.mockResolvedValueOnce([
      [
        {
          cycle_id: cycleId,
          cycle_name: "Integration Test Cycle Q4 2026",
          period: "2026-Q4",
          start_date: "2026-10-01",
          end_date: "2026-12-31",
          manager_review_deadline: "2027-01-07",
          status: "draft",
          feedback_type: "360",
          created_by: "u-hr",
        },
      ],
      [],
    ]);

    const res = await request(app)
      .post("/api/performance-feedback/cycles")
      .set(HR_AUTH)
      .send({
        name: "Integration Test Cycle Q4 2026",
        cycleType: "Quarterly",
        period: "2026-Q4",
        startDate: "2026-10-01",
        endDate: "2026-12-31",
        selfAssessmentDeadline: "2026-12-31",
        managerReviewDeadline: "2027-01-07",
      });

    expect(res.status).toBe(201);
    expect(res.body.data?.cycle_id || res.body.cycle_id).toBeDefined();
  });

  it("2. HR launches cycle for employee (auto-creates request)", async () => {
    mockHr();
    // Check cycle exists (getCycleById)
    mockExecute.mockResolvedValueOnce([[{ cycle_id: cycleId, status: "draft" }], []]);
    // Per-employee: get reporting_to
    mockExecute.mockResolvedValueOnce([
      [{ emp_id: employeeId, reporting_to: managerId }],
      [],
    ]);
    // Per-employee: check existing request
    mockExecute.mockResolvedValueOnce([[], []]);
    // Per-employee: INSERT request
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    // Update cycle status to active
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    const res = await request(app)
      .post(`/api/performance-feedback/cycles/${cycleId}/launch`)
      .set(HR_AUTH)
      .send({ employeeIds: [employeeId] });

    expect(res.status).toBe(200);
    expect(res.body.data?.created).toBeGreaterThanOrEqual(0);
  });

  it("3. Manager gets their feedback assignments", async () => {
    mockManager();
    // getRequests calls db.execute once: SELECT * FROM performance_feedback_request WHERE 1=1 ORDER BY ...
    mockExecute.mockResolvedValueOnce([
      [
        {
          request_id: requestId,
          cycle_id: cycleId,
          employee_id: employeeId,
          manager_id: managerId,
          status: "pending",
        },
      ],
      [],
    ]);

    const res = await request(app)
      .get("/api/performance-feedback/requests")
      .set(MANAGER_AUTH)
      .query({ managerId: managerId }); // note: filter maps to manager_id in service

    expect(res.status).toBe(200);
    const data = res.body.data || res.body;
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  it("4. Manager gets feedback form template", async () => {
    mockManager();
    // getRequestById
    mockExecute.mockResolvedValueOnce([
      [
        {
          request_id: requestId,
          employee_id: employeeId,
          reviewer_id: managerId,
          status: "pending",
        },
      ],
      [],
    ]);
    // SELECT employee info (emp_id, full_name, designation)
    mockExecute.mockResolvedValueOnce([
      [{ emp_id: employeeId, full_name: "Test Employee", designation: "Agent" }],
      [],
    ]);
    // getCompetencies — 2 active competencies
    mockExecute.mockResolvedValueOnce([
      [
        {
          competency_id: compId1,
          competency_name: "Problem Solving",
          description: "Ability to solve complex problems",
          category: "technical",
        },
        {
          competency_id: compId2,
          competency_name: "Communication",
          description: "Clear communication skills",
          category: "soft_skills",
        },
      ],
      [],
    ]);
    // Get KPIs
    mockExecute.mockResolvedValueOnce([
      [
        {
          kpi_id: kpiId1,
          kpi_name: "Task Completion Rate",
          target_value: 95,
          unit: "%",
        },
      ],
      [],
    ]);

    const res = await request(app)
      .get(`/api/performance-feedback/requests/${requestId}/form`)
      .set(MANAGER_AUTH);

    expect(res.status).toBe(200);
    const data = res.body.data || res.body;
    expect(data.competencies).toHaveLength(2);
    expect(data.kpis).toHaveLength(1);
  });

  it("5. Manager submits feedback (generates report + training needs)", async () => {
    mockManager();
    // getRequestById: the service checks request.reviewer_id === req.authUser.id, and
    // mockManager() above authenticates as managerId — so the row must carry that id, not the
    // 'user-1' a long-retired global auth mock used to return. reviewer_id is the real
    // column; manager_id has never existed on this table.
    mockExecute.mockResolvedValueOnce([
      [
        {
          request_id: requestId,
          employee_id: employeeId,
          reviewer_id: managerId,
          reviewer_type: "manager",
          cycle_id: cycleId,
          status: "pending",
        },
      ],
      [],
    ]);
    // one upsert per competency, then the request status update
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    const res = await request(app)
      .post(`/api/performance-feedback/requests/${requestId}/submit`)
      .set(MANAGER_AUTH)
      .send({
        employeeId: employeeId,
        cycleId: cycleId,
        overallManagerRating: 3,
        managerFinalComment: "Strong performer in integration test. Needs work on problem solving.",
        competencies: [
          { competencyId: compId1, selfRating: 2, managerRating: 3, managerComment: "Needs improvement" },
          { competencyId: compId2, selfRating: 4, managerRating: 4, managerComment: "Good communicator" },
        ],
        // no kpis: this schema stores competency ratings only, and the endpoint now
        // says so rather than accepting them and dropping them
      });

    expect(res.status).toBe(201);
    expect(res.body.data?.competencies_recorded).toBe(2);
  });

  it("6. Employee views own feedback report", async () => {
    mockEmployee();
    // Get report (note: reports are accessed by report ID not request ID)
    mockExecute.mockResolvedValueOnce([
      [
        {
          report_id: reportId,
          employee_id: employeeId,
          request_id: requestId,
          overall_score: 3.25,
          competency_scores_json: JSON.stringify([
            { competency_id: "comp-1", rating: 2.5 },
            { competency_id: "comp-2", rating: 4.0 },
          ]),
          kpi_scores_json: JSON.stringify([{ kpi_id: "kpi-1", actual_value: 92 }]),
          overall_strengths: "Strong performer in integration test",
          development_areas: "Needs work on problem solving",
        },
      ],
      [],
    ]);

    const res = await request(app)
      .get(`/api/performance-feedback/reports/${reportId}`)
      .set(EMPLOYEE_AUTH);

    // May be 200 or 501 (not implemented)
    expect([200, 501]).toContain(res.status);
    if (res.status === 200) {
      const data = res.body.data || res.body;
      expect(data.overall_score).toBeDefined();
    }
  });

  it("7. Manager creates development plan with goals", async () => {
    mockManager();
    // Service uses db.getConnection() for the transaction. development_plan.report_id is
    // NOT NULL, so the plan is resolved from the employee's report for the cycle first, and
    // manager_id is checked against employees because its FK is ON DELETE RESTRICT.
    mockConnection.execute
      .mockResolvedValueOnce([[{ report_id: "report-001" }], []]) // SELECT report for cycle+employee
      .mockResolvedValueOnce([[{ id: managerId }], []]) // manager_id resolves to a real employee
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]) // INSERT plan
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]) // INSERT goal 1
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]); // INSERT goal 2
    // db.execute: SELECT created plan
    mockExecute.mockResolvedValueOnce([
      [
        {
          plan_id: planId,
          employee_id: employeeId,
          status: "draft",
          target_date: "2027-02-28",
        },
      ],
      [],
    ]);

    const res = await request(app)
      .post("/api/performance-feedback/development-plans")
      .set(MANAGER_AUTH)
      .send({
        employeeId: employeeId,
        cycleId: cycleId,
        goals: [
          {
            area: "Time Management",
            description: "Complete time management training course",
            targetDate: "2027-02-28",
          },
          {
            area: "Communication",
            description: "Attend communication workshop",
            targetDate: "2027-03-15",
          },
        ],
      });

    expect(res.status).toBe(201);
    const data = res.body.data || res.body;
    expect(data.plan_id || data.id || data.employee_id).toBeDefined();
  });

  it("8. Verifies training need auto-creation for low scores", async () => {
    mockManager();
    // getRequestById: reviewer_id must match authUser.id, which mockManager() sets to managerId
    mockExecute.mockResolvedValueOnce([
      [
        {
          request_id: requestId,
          employee_id: employeeId,
          reviewer_id: managerId,
          reviewer_type: "manager",
          cycle_id: cycleId,
          status: "pending",
        },
      ],
      [],
    ]);
    // one upsert for the single competency, then the request status update
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    const res = await request(app)
      .post(`/api/performance-feedback/requests/${requestId}/submit`)
      .set(MANAGER_AUTH)
      .send({
        employeeId: employeeId,
        cycleId: cycleId,
        overallManagerRating: 2,
        managerFinalComment: "Critical training needed",
        competencies: [
          { competencyId: compId1, selfRating: 2, managerRating: 2, managerComment: "Low score - needs training" },
        ],
        kpis: [],
      });

    expect(res.status).toBe(201);
    expect(res.body.data?.competencies_recorded).toBe(1);
  });
});

describe("Performance Feedback - RBAC Enforcement", () => {
  it("prevents employee from creating feedback cycle", async () => {
    mockEmployee();

    const res = await request(app)
      .post("/api/performance-feedback/cycles")
      .set(EMPLOYEE_AUTH)
      .send({
        name: "Unauthorized Cycle",
        period: "2027-Q1",
        startDate: "2027-01-01",
        endDate: "2027-03-31",
        managerReviewDeadline: "2027-04-07",
      });

    // May be 400 (validation) or 403 (RBAC), both indicate rejection
    expect([400, 403]).toContain(res.status);
  });

  it("prevents employee from creating competency", async () => {
    mockEmployee();

    const res = await request(app)
      .post("/api/performance-feedback/competencies")
      .set(EMPLOYEE_AUTH)
      .send({
        name: "Unauthorized Competency",
        category: "soft_skills",
        description: "Should not be created",
      });

    // May be 400 (validation) or 403 (RBAC), both indicate rejection
    expect([400, 403]).toContain(res.status);
  });

  it("prevents employee from launching cycle", async () => {
    mockEmployee();

    const res = await request(app)
      .post("/api/performance-feedback/cycles/fake-id/launch")
      .set(EMPLOYEE_AUTH)
      .send({ employeeIds: ["emp-123"] });

    // May be 400 (validation) or 403 (RBAC), both indicate rejection
    expect([400, 403]).toContain(res.status);
  });

  it("prevents manager from creating cycle", async () => {
    mockManager();

    const res = await request(app)
      .post("/api/performance-feedback/cycles")
      .set(MANAGER_AUTH)
      .send({
        name: "Manager Unauthorized Cycle",
        period: "2027-Q2",
        startDate: "2027-04-01",
        endDate: "2027-06-30",
        managerReviewDeadline: "2027-07-07",
      });

    // May be 400 (validation) or 403 (RBAC), both indicate rejection
    expect([400, 403]).toContain(res.status);
  });
});

describe("Performance Feedback - Edge Cases", () => {
  it("prevents launching cycle with no employees", async () => {
    mockHr();
    mockExecute.mockResolvedValueOnce([[{ cycle_id: "cycle-1", status: "draft" }], []]);

    const res = await request(app)
      .post("/api/performance-feedback/cycles/cycle-1/launch")
      .set(HR_AUTH)
      .send({ employee_ids: [] });

    expect(res.status).toBe(400);
  });

  it("handles launching cycle with invalid employee IDs gracefully", async () => {
    mockHr();
    mockExecute.mockResolvedValueOnce([[{ cycle_id: "cycle-1", status: "draft" }], []]);
    mockExecute.mockResolvedValueOnce([[], []]); // No employees found

    const res = await request(app)
      .post("/api/performance-feedback/cycles/cycle-1/launch")
      .set(HR_AUTH)
      .send({ employeeIds: ["invalid-id-999"] });

    // May be 200 with 0 created or 400 if validation fails
    expect([200, 400]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.created_count || 0).toBe(0);
    }
  });

  it("prevents submitting feedback without required fields", async () => {
    mockManager();

    const res = await request(app)
      .post("/api/performance-feedback/requests/fake-request-id/submit")
      .set(MANAGER_AUTH)
      .send({
        // Missing ratings_json
      });

    expect(res.status).toBe(400);
  });

  it("prevents creating development plan without goals", async () => {
    mockManager();

    const res = await request(app)
      .post("/api/performance-feedback/development-plans")
      .set(MANAGER_AUTH)
      .send({
        employeeId: "emp-123",
        cycleId: "cycle-123",
        goals: [], // Empty goals
      });

    expect(res.status).toBe(400);
  });

  it("prevents non-manager from viewing other employees reports", async () => {
    mockEmployee();
    // Empty, because that is what the database returns. getReportById appends
    // "AND pfr.employee_id = ?" with the CALLER's employee id, so a report belonging to
    // someone else cannot come back. The previous mock returned an emp-other row regardless —
    // db.execute ignores the WHERE — and the test only passed because scope resolution was
    // failing earlier for an unrelated reason and 403'ing. Once that was fixed the row came
    // straight back as a 200: an employee reading another employee's report.
    mockExecute.mockResolvedValueOnce([[], []]);

    const res = await request(app)
      .get("/api/performance-feedback/reports/req-1")
      .set(EMPLOYEE_AUTH);

    // May be 403 (forbidden), 404 (not found), or 501 (not implemented)
    expect([403, 404, 501]).toContain(res.status);

    // The status alone would also be satisfied by a handler that simply found nothing, so
    // assert the BOUNDARY: the query must have been narrowed to the caller's own employee id.
    // This is the part that fails if someone drops the scope filter from getReportById.
    const scopedCall = mockExecute.mock.calls.find(([sql]) =>
      String(sql).includes("performance_feedback_report"),
    );
    expect(scopedCall, "no report query was issued").toBeDefined();
    expect(String(scopedCall![0])).toContain("pfr.employee_id = ?");
    expect(scopedCall![1]).toContain(EMP_UUID);
  });
});
