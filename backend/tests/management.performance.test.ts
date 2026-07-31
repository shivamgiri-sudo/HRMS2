/**
 * Package 5: Management performance surfaces + Client Portal hardening tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
vi.mock("../src/db/supabaseAdmin.js", () => ({ supabaseAdmin: {}, supabaseAuthClient: { auth: { getUser: vi.fn() } } }));
vi.mock("../src/db/mysql.js", () => ({ db: { execute: vi.fn().mockResolvedValue([[], []]) }, pingDb: vi.fn() }));
import { app } from "../src/app.js";
import { db } from "../src/db/mysql.js";
// supabaseAdmin stays mocked above (app.ts imports it); authMiddleware no
// longer calls it — auth is MySQL JWT now.
const mockExecute = db.execute as ReturnType<typeof vi.fn>;

const JWT_SECRET = process.env.JWT_SECRET || "change-me-jwt-secret-32characters!!";

/**
 * Real JWTs replace the retired "<role>.token" placeholders — jwt.verify throws
 * on those, so every request 401'd and none of the management-performance or
 * client-portal rules this suite covers were ever exercised.
 *
 * Fresh subject per call: authMiddleware caches resolved roles for 30 seconds
 * per user id, so a fixed subject lets one test inherit another's roles.
 */
let subjectCounter = 0;
const bearer = (sub: string) => ({
  Authorization: `Bearer ${jwt.sign(
    { sub: `${sub}-${++subjectCounter}`, email: `${sub}@mcn.com`, iat: Math.floor(Date.now() / 1000) },
    JWT_SECRET,
    { expiresIn: "1h" },
  )}`,
});

/**
 * Ordered fixtures for SELECTs only.
 *
 * These tests were written as positional db.execute queues, which is a
 * reasonable way to express "this query, then that one" — but it broke once
 * auth started issuing its own queries, because the number of those varies with
 * whether the subject is already in authMiddleware's 30-second role cache. So
 * the ordering is kept where it carries meaning (SELECTs, in the order the route
 * makes them) and removed where it never did: role lookups and writes are
 * answered by shape, outside the queue.
 */
let selectQueue: unknown[][] = [];
function selectRows(rows: unknown[]) { selectQueue.push(rows); }

function authAs(sub: string, roles: string[]) {
  selectQueue = [];
  mockExecute.mockImplementation(async (sql: unknown) => {
    const text = String(sql);
    if (/FROM user_roles/i.test(text)) return [roles.map((r) => ({ role_key: r })), []];
    if (/user_assignment_scope|FROM auth_user/i.test(text)) return [[], []];
    if (/^\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(text)) return [{ affectedRows: 1 }, []];
    return [selectQueue.length ? selectQueue.shift()! : [], []];
  });
  return bearer(sub);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockReset();
  mockExecute.mockResolvedValue([[], []]);
  selectQueue = [];
});

const mockAdmin = () => authAs("u-admin", ["admin"]);
const mockEmployeeRole = () => authAs("u-emp", ["employee"]);
const mockManager = () => authAs("u-mgr", ["manager"]);
/** Employee whose user maps to a specific employee record (first SELECT). */
function mockEmployee(empId: string) {
  const auth = authAs("u-emp", ["employee"]);
  selectRows([{ id: empId }]);
  return auth;
}

// ── 1. GET /api/management/team-kpi ──────────────────────────────────────────

describe("GET /api/management/team-kpi", () => {
  it("returns 200 for admin with kpi rows", async () => {
    const auth = mockAdmin();
    // resolveTeamScope hasRole check — admin is a wide role
    // getTeamKpiSummary db.execute
    selectRows([
      { id: "k1", employee_id: "e1", employee_code: "MCN001", full_name: "Alice", period: "2026-05", overall_score: 92.5, rank_position: 1 },
    ]);
    const r = await request(app).get("/api/management/team-kpi").set(auth);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data)).toBe(true);
    expect(r.body.data.length).toBeGreaterThan(0);
  });

  it("returns 403 for employee role", async () => {
    // requireAuth getUser + requireRole user_roles (employee)
    const auth = mockEmployeeRole();
    const r = await request(app).get("/api/management/team-kpi").set(auth);
    expect(r.status).toBe(403);
  });
});

// ── 2. GET /api/management/coaching ──────────────────────────────────────────

describe("GET /api/management/coaching", () => {
  it("returns 200 for admin and sees all sessions", async () => {
    // admin sees all sessions
    const auth = mockAdmin();
    // hasRole call: SELECT role_key FROM user_roles
    // listCoachingSessions db.execute
    selectRows([
      { id: "cs-1", employee_id: "e1", employee_code: "MCN001", full_name: "Alice", session_type: "performance", status: "scheduled" },
      { id: "cs-2", employee_id: "e2", employee_code: "MCN002", full_name: "Bob",   session_type: "quality",     status: "completed" },
    ]);
    const r = await request(app).get("/api/management/coaching").set(auth);
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(2);
  });

  it("returns 200 for employee and sees own sessions only", async () => {
    // requireAuth getUser
    const auth = mockEmployeeRole();
    // hasRole call for coaching route (returns employee — not admin/hr/manager)
    // getEmployeeForUser call
    selectRows([{ id: "emp-1", employee_code: "MCN003" }]);
    // getDirectReportIds call — employee has no reports, so route falls back to own sessions
    selectRows([]);
    // listCoachingSessions filtered by employee_id=emp-1
    selectRows([
      { id: "cs-3", employee_id: "emp-1", employee_code: "MCN003", full_name: "Carol", session_type: "coaching", status: "scheduled" },
    ]);
    const r = await request(app).get("/api/management/coaching").set(auth);
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0].employee_id).toBe("emp-1");
  });
});

// ── 3. POST /api/management/coaching ─────────────────────────────────────────

describe("POST /api/management/coaching", () => {
  it("returns 201 for admin, creates session and calls audit", async () => {
    const auth = mockAdmin();
    // createCoachingSession: INSERT + logSensitiveAction INSERT + SELECT
    selectRows([{ id: "cs-new-1", employee_id: "emp-uuid-1", session_type: "performance", session_date: "2026-06-01", status: "scheduled" }]); // SELECT
    const r = await request(app)
      .post("/api/management/coaching")
      .set(auth)
      .send({ employee_id: "emp-uuid-1", session_date: "2026-06-01", session_type: "performance" });
    expect(r.status).toBe(201);
    expect(r.body.data).toBeDefined();
    // Audit INSERT was called (mockExecute called >=3 times beyond requireRole)
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO sensitive_action_log"),
      expect.any(Array)
    );
  });

  it("returns 403 for employee on POST /coaching", async () => {
    const auth = mockEmployeeRole();
    const r = await request(app)
      .post("/api/management/coaching")
      .set(auth)
      .send({ employee_id: "emp-uuid-1", session_date: "2026-06-01", session_type: "performance" });
    expect(r.status).toBe(403);
  });

  it("returns 400 when required fields are missing", async () => {
    const auth = mockAdmin();
    const r = await request(app)
      .post("/api/management/coaching")
      .set(auth)
      .send({ session_type: "quality" }); // missing employee_id and session_date
    expect(r.status).toBe(400);
  });
});

// ── 4. GET /api/management/alerts ────────────────────────────────────────────

describe("GET /api/management/alerts", () => {
  it("returns 200 for admin with alert rows", async () => {
    const auth = mockAdmin();
    // resolveTeamScope hasRole check — admin is a wide role
    // listAlerts db.execute
    selectRows([
      { id: "a1", employee_id: "e1", employee_code: "MCN001", full_name: "Alice", severity: "critical", acknowledged: 0 },
    ]);
    const r = await request(app).get("/api/management/alerts").set(auth);
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0].severity).toBe("critical");
  });

  it("returns 403 for employee", async () => {
    const auth = mockEmployeeRole();
    const r = await request(app).get("/api/management/alerts").set(auth);
    expect(r.status).toBe(403);
  });
});

// ── 5. POST /api/management/alerts/:id/acknowledge ───────────────────────────

describe("POST /api/management/alerts/:id/acknowledge", () => {
  it("returns 200 for admin and audit INSERT is present", async () => {
    const auth = mockAdmin();
    // acknowledgeAlert: UPDATE performance_alert + INSERT sensitive_action_log
    const r = await request(app)
      .post("/api/management/alerts/alert-uuid-1/acknowledge")
      .set(auth);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO sensitive_action_log"),
      expect.any(Array)
    );
  });

  it("returns 403 for employee", async () => {
    const auth = mockEmployeeRole();
    const r = await request(app)
      .post("/api/management/alerts/alert-uuid-1/acknowledge")
      .set(auth);
    expect(r.status).toBe(403);
  });
});

// ── 6. GET /api/management/dashboard ─────────────────────────────────────────

describe("GET /api/management/dashboard", () => {
  it("returns a live operational summary for admin", async () => {
    const auth = mockAdmin();
    // resolveTeamScope hasRole check — admin is a wide role
    selectRows([{ headcount: 100, exits_30d: 5 }]);
    selectRows([{ pending_leaves: 3 }]);
    selectRows([{ open_tickets: 2 }]);
    // getDashboard divides by attendance.expected_to_work, not `total` — the old
    // fixture named a column the service stopped reading, so expectedToWork was 0
    // and attendance_rate came out 0 instead of 92. The assertion was right; the
    // fixture had drifted.
    selectRows([{ expected_to_work: 100, present: 90, half_day: 4 }]);
    selectRows([
      { employee_id: "e1", overall_score: 85.2 },
      { employee_id: "e2", overall_score: 74.8 },
    ]);
    const r = await request(app).get("/api/management/dashboard").set(auth);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({
      headcount: 100,
      avg_kpi_score: 80,
      open_tickets: 2,
      pending_leaves: 3,
      attendance_rate: 92,
    });
    expect(r.body.data.attrition_rate).toBeGreaterThan(0);
    const flatKeys = Object.keys(r.body.data ?? {});
    const payrollFields = flatKeys.filter(k => /salary|payroll|gross|net_pay|tds|pf|esi|ctc|bank/i.test(k));
    expect(payrollFields).toHaveLength(0);
  });

  it("returns 403 for employee", async () => {
    const auth = mockEmployeeRole();
    const r = await request(app).get("/api/management/dashboard").set(auth);
    expect(r.status).toBe(403);
  });
});

// ── 7. Portal endpoint blocked without Supabase JWT ──────────────────────────

describe("Portal endpoint blocked without Supabase JWT", () => {
  it("GET /api/management/team-kpi without any token returns 401", async () => {
    const r = await request(app).get("/api/management/team-kpi");
    expect(r.status).toBe(401);
  });
});

describe("SECURITY — Manager scope", () => {
  it("manager team-kpi is restricted to direct reports plus self", async () => {
    const auth = mockManager();
    selectRows([{ id: "mgr-emp", employee_code: "MGR001" }]);
    selectRows([{ id: "rep-1" }]);
    selectRows([]);

    const r = await request(app).get("/api/management/team-kpi").set(auth);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("e.id IN (?,?)"),
      expect.arrayContaining(["rep-1", "mgr-emp"])
    );
  });

  it("manager alerts are restricted to direct reports plus self", async () => {
    const auth = mockManager();
    selectRows([{ id: "mgr-emp", employee_code: "MGR001" }]);
    selectRows([{ id: "rep-1" }]);
    selectRows([]);

    const r = await request(app).get("/api/management/alerts").set(auth);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("pa.employee_id IN (?,?)"),
      expect.arrayContaining(["rep-1", "mgr-emp"])
    );
  });

  it("manager dashboard is restricted to direct reports plus self", async () => {
    const auth = mockManager();
    selectRows([{ id: "mgr-emp", employee_code: "MGR001" }]);
    selectRows([{ id: "rep-1" }]);
    for (let i = 0; i < 6; i += 1) {
      selectRows([{ headcount: 0, exits_30d: 0, pending_leaves: 0, open_tickets: 0, total: 0, present: 0, half_day: 0 }]);
    }

    const r = await request(app).get("/api/management/dashboard").set(auth);
    expect(r.status).toBe(200);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("e.id IN (?,?)"),
      expect.arrayContaining(["rep-1", "mgr-emp"])
    );
  });
  it("employee sees own coaching (200) via server-side mapping", async () => {
    const auth = mockEmployeeRole();
    selectRows([{ id: "emp-self", employee_code: "E001" }]);
    selectRows([]);
    selectRows([{ id: "c-1", employee_id: "emp-self" }]);
    const r = await request(app).get("/api/management/coaching").set(auth);
    expect(r.status).toBe(200);
  });
  it("dashboard response contains no payroll fields", async () => {
    const auth = mockAdmin();
    selectRows([{ headcount: 5, exits_30d: 0 }]);
    selectRows([{ pending_leaves: 2 }]);
    selectRows([{ open_tickets: 1 }]);
    selectRows([{ total: 5, present: 4, half_day: 1 }]);
    selectRows([{ employee_id: "e1", overall_score: 80 }]);
    const r = await request(app).get("/api/management/dashboard").set(auth);
    expect(r.status).toBe(200);
    const keys = Object.keys(r.body.data ?? {});
    expect(keys).not.toContain("salary");
    expect(keys).not.toContain("ctc");
  });
});
