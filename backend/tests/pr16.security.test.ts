/**
 * PR #16 security tests — scope enforcement, PII masking, audit logging,
 * and duplicate-detection idempotency.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

vi.mock("../src/db/supabaseAdmin.js", () => ({
  supabaseAdmin: {},
  supabaseAuthClient: { auth: { getUser: vi.fn() } },
}));
// wfm-ext''s roster-swap review runs inside withEmployeeRosterLock, which takes a MySQL named
// advisory lock on a dedicated connection — so db.getConnection() must exist here, and the
// lock statements go through .query() rather than .execute(). GET_LOCK has to report
// acquired = 1, or the service throws ROSTER_LOCK_TIMEOUT before reaching the behaviour under
// test. The connection shares the pool''s execute stub, so existing SQL expectations are
// unaffected.
vi.mock("../src/db/mysql.js", () => {
  const execute = vi.fn().mockResolvedValue([[], []]);
  const query = vi.fn().mockResolvedValue([[{ acquired: 1 }], []]);
  return {
    db: {
      execute,
      query,
      getConnection: vi.fn().mockResolvedValue({
        execute,
        query,
        beginTransaction: vi.fn().mockResolvedValue(undefined),
        commit: vi.fn().mockResolvedValue(undefined),
        rollback: vi.fn().mockResolvedValue(undefined),
        release: vi.fn(),
      }),
    },
    pingDb: vi.fn(),
  };
});

import { app } from "../src/app.js";
import { db } from "../src/db/mysql.js";
// The supabaseAdmin module stays mocked above because app.ts pulls it in, but
// authMiddleware no longer calls it — auth is MySQL JWT now, so mocking
// getUser here would prove nothing.

const mockExecute = db.execute as ReturnType<typeof vi.fn>;

/**
 * Real JWTs, not the retired "<role>.token" placeholders this file used to send.
 *
 * Auth moved to MySQL JWTs: the middleware hands anything not starting with
 * "mock-token" to verifyAccessToken, jwt.verify throws on "admin.token", and
 * every request 401s — which is why all 15 failures here read "expected 401 to
 * be <something>". The suite was asserting only that unauthenticated requests
 * are rejected, not any of the scope, masking or audit rules it is named for.
 *
 * A mock-token-* demo token would authenticate but defeat the point: requireRole
 * resolves demo users from req.authUser.role and never consults the database, so
 * these role-scope tests would stop exercising the DB-driven path they exist to
 * cover. Each role gets its own subject, matching the ids the helpers used.
 */
const JWT_SECRET = process.env.JWT_SECRET || "change-me-jwt-secret-32characters!!";
const bearer = (sub: string) => ({
  Authorization: `Bearer ${jwt.sign(
    { sub, email: `${sub}@mcn.com`, iat: Math.floor(Date.now() / 1000) },
    JWT_SECRET,
    { expiresIn: "1h" },
  )}`,
});

const ADMIN = bearer("u-admin");
const MGR   = bearer("u-mgr");
const RECR  = bearer("u-recr");
const HR    = bearer("u-hr");

/**
 * Route db.execute by the SQL it receives rather than by call order.
 *
 * Positional mockResolvedValueOnce chains cannot survive this auth path.
 * authMiddleware caches resolved role context for 30 seconds per user id, so
 * the first request for a subject costs several queries (user_roles,
 * user_assignment_scope, auth_user) and every later one costs none — and on a
 * cache hit requireRole reads req.authUser.roles and skips its own lookup too.
 * Which test pays that cost depends on execution order, so a positional queue
 * silently shifts underneath whichever tests run later.
 *
 * Writes answer with affectedRows so audit-log assertions still see a result;
 * reads answer with `rows`, defaulting to empty.
 */
function mockDb(rows: unknown[] = [], roleKey?: string) {
  mockExecute.mockImplementation(async (sql: unknown) => {
    const text = String(sql);
    if (/FROM user_roles/i.test(text)) {
      return [roleKey ? [{ role_key: roleKey }] : [], []];
    }
    if (/user_assignment_scope|FROM auth_user/i.test(text)) return [[], []];
    if (/^\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(text)) return [{ affectedRows: 1 }, []];
    return [rows, []];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockReset();
  mockExecute.mockResolvedValue([[], []]);
});

function mockAdmin(rows: unknown[] = [])     { mockDb(rows, "admin"); }
function mockHr(rows: unknown[] = [])        { mockDb(rows, "hr"); }
function mockManager(rows: unknown[] = [])   { mockDb(rows, "manager"); }
function mockRecruiter(rows: unknown[] = []) { mockDb(rows, "recruiter"); }

// ── a) GET /api/ats-ext/requisitions — 403 for manager ───────────────────────

describe("ATS scope: GET /api/ats-ext/requisitions", () => {
  it("returns 403 for manager role (scope not yet enforced — admin/hr only)", async () => {
    mockManager();
    const r = await request(app).get("/api/ats-ext/requisitions").set(MGR);
    expect(r.status).toBe(403);
  });

  it("returns 200 for admin (baseline)", async () => {
    mockAdmin([{ id: "r-1", req_code: "MR-1", status: "open" }]);
    const r = await request(app).get("/api/ats-ext/requisitions").set(ADMIN);
    expect(r.status).toBe(200);
  });
});

// ── b) GET /api/ats-ext/analytics/funnel — 403 for recruiter ─────────────────

describe("ATS scope: GET /api/ats-ext/analytics/funnel", () => {
  it("returns 403 for recruiter role (scope not yet enforced — admin/hr only)", async () => {
    mockRecruiter();
    const r = await request(app).get("/api/ats-ext/analytics/funnel").set(RECR);
    expect(r.status).toBe(403);
  });

  it("returns 200 for hr (baseline)", async () => {
    mockHr([{ sourcing_channel: "Walk-in", total_applied: 50, total_selected: 10, conversion_pct: 20.0 }]);
    const r = await request(app).get("/api/ats-ext/analytics/funnel").set(HR);
    expect(r.status).toBe(200);
  });
});

// ── c) GET /api/ats-ext/duplicates — 403 for recruiter ───────────────────────

describe("ATS scope: GET /api/ats-ext/duplicates", () => {
  it("returns 403 for recruiter role (scope not yet enforced — admin/hr only)", async () => {
    mockRecruiter();
    const r = await request(app).get("/api/ats-ext/duplicates").set(RECR);
    expect(r.status).toBe(403);
  });
});

// ── d) GET /api/ats-ext/duplicates — admin sees masked mobiles ────────────────

describe("ATS PII masking: GET /api/ats-ext/duplicates", () => {
  it("returns masked mobile fields and no raw mobile for admin", async () => {
    mockAdmin([{
      id: "dup-1",
      candidate_name: "Ravi Kumar",
      matched_name: "Ravi K",
      candidate_mobile_masked: "987****23",
      matched_mobile_masked: "987****23",
      match_reason: "mobile",
      resolved: 0,
    }]);

    const r = await request(app).get("/api/ats-ext/duplicates").set(ADMIN);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data)).toBe(true);

    const row = r.body.data[0];
    // Masked fields must be present
    expect(row).toHaveProperty("candidate_mobile_masked");
    expect(row).toHaveProperty("matched_mobile_masked");
    // Raw mobile columns must NOT be present
    expect(row).not.toHaveProperty("mobile");
    expect(row).not.toHaveProperty("candidate_mobile");
    expect(row).not.toHaveProperty("matched_mobile");
  });
});

// ── e) POST /api/ats-ext/duplicates/:id/resolve — writes audit log ────────────

describe("ATS audit: POST /api/ats-ext/duplicates/:id/resolve", () => {
  it("writes a sensitive_action_log entry when resolving a duplicate", async () => {
    mockAdmin();

    const r = await request(app)
      .post("/api/ats-ext/duplicates/dup-1/resolve")
      .set(ADMIN)
      .send({ note: "Same person, earlier application" });

    expect(r.status).toBe(200);
    const auditCall = mockExecute.mock.calls.find(// eslint-disable-next-line @typescript-eslint/no-explicit-any
    ([sql]: any) =>
      typeof sql === "string" && sql.includes("sensitive_action_log")
    );
    expect(auditCall).toBeDefined();
  });
});

// ── f) POST /api/wfm-ext/roster/swaps/:id/review — writes audit log ──────────

describe("WFM audit: POST /api/wfm-ext/roster/swaps/:id/review", () => {
  it("writes a sensitive_action_log entry when reviewing a swap", async () => {
    // The review path locks the swap row with SELECT ... FOR UPDATE and refuses one it cannot
    // find, one that is not pending, or one whose counterpart has not accepted. With no rows
    // seeded the lookup returned nothing and the route answered 404, so no audit was ever
    // reached — which is the thing this test exists to assert.
    mockAdmin([{
      id: "sw-1",
      status: "pending",
      counterpart_status: "accepted",
      requester_emp_id: "emp-1",
      swap_with_emp_id: "emp-2",
      process_id: "proc-1",
    }]);

    const r = await request(app)
      .post("/api/wfm-ext/roster/swaps/sw-1/review")
      .set(ADMIN)
      .send({ status: "approved" });

    expect(r.status).toBe(200);
    const auditCall = mockExecute.mock.calls.find(// eslint-disable-next-line @typescript-eslint/no-explicit-any
    ([sql]: any) =>
      typeof sql === "string" && sql.includes("sensitive_action_log")
    );
    expect(auditCall).toBeDefined();
  });

  it("writes audit log for rejected swap too", async () => {
    mockAdmin();

    const r = await request(app)
      .post("/api/wfm-ext/roster/swaps/sw-2/review")
      .set(ADMIN)
      .send({ status: "rejected" });

    expect(r.status).toBe(200);
    const auditCall = mockExecute.mock.calls.find(// eslint-disable-next-line @typescript-eslint/no-explicit-any
    ([sql]: any) =>
      typeof sql === "string" && sql.includes("sensitive_action_log")
    );
    expect(auditCall).toBeDefined();
  });
});

// ── g) POST /api/wfm-ext/roster/conflicts/:id/resolve — writes audit log ─────

describe("WFM audit: POST /api/wfm-ext/roster/conflicts/:id/resolve", () => {
  it("writes a sensitive_action_log entry when resolving a conflict", async () => {
    mockAdmin();

    const r = await request(app)
      .post("/api/wfm-ext/roster/conflicts/cf-1/resolve")
      .set(ADMIN);

    expect(r.status).toBe(200);
    const auditCall = mockExecute.mock.calls.find(// eslint-disable-next-line @typescript-eslint/no-explicit-any
    ([sql]: any) =>
      typeof sql === "string" && sql.includes("sensitive_action_log")
    );
    expect(auditCall).toBeDefined();
  });
});

// ── h) POST /api/wfm-ext/coverage/snapshot — writes audit log ────────────────

describe("WFM audit: POST /api/wfm-ext/coverage/snapshot", () => {
  it("writes a sensitive_action_log entry when upserting a coverage snapshot", async () => {
    mockAdmin();

    const r = await request(app)
      .post("/api/wfm-ext/coverage/snapshot")
      .set(ADMIN)
      .send({
        snapshot_date: "2026-06-01",
        planned_headcount: 100,
        actual_headcount: 90,
        absent_count: 5,
        leave_count: 5,
      });

    expect(r.status).toBe(200);
    const auditCall = mockExecute.mock.calls.find(// eslint-disable-next-line @typescript-eslint/no-explicit-any
    ([sql]: any) =>
      typeof sql === "string" && sql.includes("sensitive_action_log")
    );
    expect(auditCall).toBeDefined();
  });
});

// ── i) POST /api/wfm-ext/attrition/record — writes audit log ─────────────────

describe("WFM audit: POST /api/wfm-ext/attrition/record", () => {
  it("writes a sensitive_action_log entry when recording attrition", async () => {
    mockHr([{ process_id: "proc-1", branch_id: "branch-1", date_of_joining: "2024-01-01" }]);

    const r = await request(app)
      .post("/api/wfm-ext/attrition/record")
      .set(HR)
      .send({
        employee_id: "emp-42",
        exit_date: "2026-05-31",
        exit_type: "voluntary",
        tenure_days: 730,
      });

    expect(r.status).toBe(201);
    const auditCall = mockExecute.mock.calls.find(// eslint-disable-next-line @typescript-eslint/no-explicit-any
    ([sql]: any) =>
      typeof sql === "string" && sql.includes("sensitive_action_log")
    );
    expect(auditCall).toBeDefined();
  });
});

// ── j) Duplicate detection idempotency ───────────────────────────────────────

describe("ATS duplicate idempotency: logDuplicate skips existing unresolved pairs", () => {
  it("does not INSERT when an unresolved record already exists for the same pair", async () => {
    // SELECT for an existing duplicate returns one row → service returns early.
    mockDb([{ id: "dup-existing" }]);

    // Import service at module scope to call it directly
    const { duplicateService } = await import("../src/modules/ats-extensions/ats-ext.service.js");
    await duplicateService.logDuplicate("cand-A", "cand-B", "mobile", 100);

    const selectCall = mockExecute.mock.calls[0][0] as string;
    expect(selectCall).toContain("SELECT");

    // Verify no INSERT was executed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insertCall = mockExecute.mock.calls.find(([sql]: any) =>
      typeof sql === "string" && sql.toUpperCase().includes("INSERT")
    );
    expect(insertCall).toBeUndefined();
  });

  it("does INSERT when no existing unresolved record for the pair", async () => {
    // SELECT finds no existing row → service proceeds to INSERT.
    mockDb([]);

    const { duplicateService } = await import("../src/modules/ats-extensions/ats-ext.service.js");
    await duplicateService.logDuplicate("cand-C", "cand-D", "email", 90);

    // Two DB calls: SELECT then INSERT
    expect(mockExecute).toHaveBeenCalledTimes(2);
    // Second call must be an INSERT (not another SELECT)
    const secondCallSql = (mockExecute.mock.calls[1] as [string])[0];
    expect(typeof secondCallSql).toBe("string");
    expect(secondCallSql.trim().toUpperCase().startsWith("INSERT")).toBe(true);
  });
});

// ── k) GET /api/wfm-ext/attrition/summary — scoped manager access ───────────

describe("WFM scope: GET /api/wfm-ext/attrition/summary", () => {
  it("returns scoped data for manager role instead of wide-open data", async () => {
    mockManager();
    const r = await request(app).get("/api/wfm-ext/attrition/summary").set(MGR);
    expect(r.status).toBe(200);
    expect(r.body.total_exits).toBe(0);
  });

  it("returns 200 for admin (baseline)", async () => {
    mockAdmin([{ exit_type: "voluntary", count: 3, avg_tenure_days: 400 }]);
    const r = await request(app).get("/api/wfm-ext/attrition/summary").set(ADMIN);
    expect(r.status).toBe(200);
  });
});
