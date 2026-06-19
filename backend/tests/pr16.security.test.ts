/**
 * PR #16 security tests — scope enforcement, PII masking, audit logging,
 * and duplicate-detection idempotency.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../src/db/supabaseAdmin.js", () => ({
  supabaseAdmin: {},
  supabaseAuthClient: { auth: { getUser: vi.fn() } },
}));
vi.mock("../src/db/mysql.js", () => ({ db: { execute: vi.fn().mockResolvedValue([[], []]) }, pingDb: vi.fn() }));

import { app } from "../src/app.js";
import { db } from "../src/db/mysql.js";
import { supabaseAuthClient } from "../src/db/supabaseAdmin.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;
const mockGetUser = supabaseAuthClient.auth.getUser as ReturnType<typeof vi.fn>;

const ADMIN = { Authorization: "Bearer admin.token" };
const MGR   = { Authorization: "Bearer manager.token" };
const RECR  = { Authorization: "Bearer recruiter.token" };
const HR    = { Authorization: "Bearer hr.token" };

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockResolvedValue([[], []]);
});

function mockAdmin() {
  mockGetUser.mockResolvedValue({ data: { user: { id: "u-admin" } }, error: null });
  mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);
}
function mockHr() {
  mockGetUser.mockResolvedValue({ data: { user: { id: "u-hr" } }, error: null });
  mockExecute.mockResolvedValueOnce([[{ role_key: "hr" }], []]);
}
function mockManager() {
  mockGetUser.mockResolvedValue({ data: { user: { id: "u-mgr" } }, error: null });
  mockExecute.mockResolvedValueOnce([[{ role_key: "manager" }], []]);
}
function mockRecruiter() {
  mockGetUser.mockResolvedValue({ data: { user: { id: "u-recr" } }, error: null });
  mockExecute.mockResolvedValueOnce([[{ role_key: "recruiter" }], []]);
}

// ── a) GET /api/ats-ext/requisitions — 403 for manager ───────────────────────

describe("ATS scope: GET /api/ats-ext/requisitions", () => {
  it("returns 403 for manager role (scope not yet enforced — admin/hr only)", async () => {
    mockManager();
    const r = await request(app).get("/api/ats-ext/requisitions").set(MGR);
    expect(r.status).toBe(403);
  });

  it("returns 200 for admin (baseline)", async () => {
    mockAdmin();
    mockExecute.mockResolvedValueOnce([[{ id: "r-1", req_code: "MR-1", status: "open" }], []]);
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
    mockHr();
    mockExecute.mockResolvedValueOnce([[
      { sourcing_channel: "Walk-in", total_applied: 50, total_selected: 10, conversion_pct: 20.0 }
    ], []]);
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
    mockAdmin();
    mockExecute.mockResolvedValueOnce([[
      {
        id: "dup-1",
        candidate_name: "Ravi Kumar",
        matched_name: "Ravi K",
        candidate_mobile_masked: "987****23",
        matched_mobile_masked: "987****23",
        match_reason: "mobile",
        resolved: 0,
      },
    ], []]);

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
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // UPDATE resolved
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // audit insert

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
    mockAdmin();
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // UPDATE swap status
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // audit insert

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
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

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
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // UPDATE resolved
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // audit insert

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
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // INSERT/upsert
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // audit insert

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
    mockHr();
    mockExecute.mockResolvedValueOnce([[{ process_id: "proc-1", branch_id: "branch-1", date_of_joining: "2024-01-01" }], []]); // employee lookup
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // INSERT attrition
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // audit insert

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
    // The SELECT for existing duplicate returns one row
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-admin" } }, error: null });

    // Simulate calling duplicateService.logDuplicate via service layer:
    // First call: SELECT finds existing unresolved row → service returns early
    mockExecute.mockResolvedValueOnce([[{ id: "dup-existing" }], []]);

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
    // SELECT finds no existing row → service proceeds to INSERT
    mockExecute.mockResolvedValueOnce([[], []]); // SELECT → empty
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]); // INSERT

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
    mockAdmin();
    mockExecute.mockResolvedValueOnce([[
      { exit_type: "voluntary", count: 3, avg_tenure_days: 400 }
    ], []]);
    const r = await request(app).get("/api/wfm-ext/attrition/summary").set(ADMIN);
    expect(r.status).toBe(200);
  });
});
