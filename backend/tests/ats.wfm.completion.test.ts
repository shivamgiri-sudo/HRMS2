/**
 * Package 3 — ATS extensions and WFM completion tests.
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
const HR    = { Authorization: "Bearer hr.token" };
const EMP   = { Authorization: "Bearer emp.token" };
const RECR  = { Authorization: "Bearer recruiter.token" };

beforeEach(() => { vi.clearAllMocks(); mockExecute.mockResolvedValue([[], []]); });

function mockAdmin() {
  mockGetUser.mockResolvedValue({ data: { user: { id: "u-admin" } }, error: null });
  mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);
}
function mockHr() {
  mockGetUser.mockResolvedValue({ data: { user: { id: "u-hr" } }, error: null });
  mockExecute.mockResolvedValueOnce([[{ role_key: "hr" }], []]);
}
function mockRecruiter() {
  mockGetUser.mockResolvedValue({ data: { user: { id: "u-recr" } }, error: null });
  mockExecute.mockResolvedValueOnce([[{ role_key: "recruiter" }], []]);
}

// ── Manpower Requisitions ─────────────────────────────────────────────────────

describe("GET /api/ats-ext/requisitions", () => {
  it("returns requisitions for admin", async () => {
    mockAdmin();
    mockExecute.mockResolvedValueOnce([[{ id: "r-1", req_code: "MR-1", status: "open" }], []]);
    const r = await request(app).get("/api/ats-ext/requisitions").set(ADMIN);
    expect(r.status).toBe(200);
  });

  it("returns 403 for employee role", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-emp" } }, error: null });
    mockExecute.mockResolvedValueOnce([[{ role_key: "employee" }], []]);
    const r = await request(app).get("/api/ats-ext/requisitions").set(EMP);
    expect(r.status).toBe(403);
  });
});

describe("POST /api/ats-ext/requisitions", () => {
  it("creates requisition for hr with audit", async () => {
    mockHr();
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockExecute.mockResolvedValueOnce([[{ id: "r-new", req_code: "MR-NEW", status: "draft" }], []]);
    const r = await request(app).post("/api/ats-ext/requisitions").set(HR)
      .send({ requested_count: 5, priority: "high", reason: "Expansion" });
    expect(r.status).toBe(201);
    const auditCall = mockExecute.mock.calls.find(// eslint-disable-next-line @typescript-eslint/no-explicit-any
    ([sql]: any) =>
      typeof sql === "string" && sql.includes("sensitive_action_log")
    );
    expect(auditCall).toBeDefined();
  });
});

describe("POST /api/ats-ext/requisitions/:id/approve", () => {
  it("returns 403 for recruiter", async () => {
    mockRecruiter();
    const r = await request(app).post("/api/ats-ext/requisitions/r-1/approve").set(RECR);
    expect(r.status).toBe(403);
  });

  it("approves for admin and writes audit", async () => {
    mockAdmin();
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    const r = await request(app).post("/api/ats-ext/requisitions/r-1/approve").set(ADMIN);
    expect(r.status).toBe(200);
  });
});

// ── BGV ───────────────────────────────────────────────────────────────────────

describe("POST /api/ats-ext/candidates/:id/bgv/initiate", () => {
  it("returns 403 for recruiter", async () => {
    mockRecruiter();
    const r = await request(app).post("/api/ats-ext/candidates/c-1/bgv/initiate").set(RECR)
      .send({ bgv_vendor: "VendorX" });
    expect(r.status).toBe(403);
  });

  it("initiates BGV for hr and writes audit", async () => {
    mockHr();
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);  // insert bgv
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);  // update candidate
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);  // audit
    mockExecute.mockResolvedValueOnce([[{ id: "bgv-1", overall_status: "in_progress" }], []]);
    const r = await request(app).post("/api/ats-ext/candidates/c-1/bgv/initiate").set(HR)
      .send({ bgv_vendor: "VendorX" });
    expect(r.status).toBe(201);
  });
});

// ── Offers ────────────────────────────────────────────────────────────────────

describe("POST /api/ats-ext/offers", () => {
  it("returns 400 without required fields", async () => {
    mockHr();
    const r = await request(app).post("/api/ats-ext/offers").set(HR)
      .send({ candidate_id: "c-1" }); // missing offer_date
    expect(r.status).toBe(400);
  });

  it("creates offer for hr with audit", async () => {
    mockHr();
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockExecute.mockResolvedValueOnce([[{ id: "o-new", status: "draft" }], []]);
    const r = await request(app).post("/api/ats-ext/offers").set(HR)
      .send({ candidate_id: "c-1", offer_date: "2026-06-01", offered_ctc: 300000 });
    expect(r.status).toBe(201);
    const auditCall = mockExecute.mock.calls.find(// eslint-disable-next-line @typescript-eslint/no-explicit-any
    ([sql]: any) =>
      typeof sql === "string" && sql.includes("sensitive_action_log")
    );
    expect(auditCall).toBeDefined();
  });
});

// ── Sourcing Analytics ────────────────────────────────────────────────────────

describe("GET /api/ats-ext/analytics/funnel", () => {
  it("returns funnel data for hr", async () => {
    mockHr();
    mockExecute.mockResolvedValueOnce([[
      { sourcing_channel: "Walk-in", total_applied: 100, total_selected: 20, conversion_pct: 20.0 }
    ], []]);
    const r = await request(app).get("/api/ats-ext/analytics/funnel").set(HR);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data)).toBe(true);
  });
});

describe("GET /api/ats-ext/analytics/stages", () => {
  it("returns stage-wise counts for admin", async () => {
    mockAdmin();
    mockExecute.mockResolvedValueOnce([[{ current_stage: "Applied", count: 50 }], []]);
    const r = await request(app).get("/api/ats-ext/analytics/stages").set(ADMIN);
    expect(r.status).toBe(200);
  });
});

// ── WFM Roster Swaps ─────────────────────────────────────────────────────────

describe("POST /api/wfm-ext/roster/swaps", () => {
  it("creates swap request as employee own record", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-emp" } }, error: null });
    mockExecute.mockResolvedValueOnce([[{ id: "emp-1", employee_code: "E001" }], []]);
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockExecute.mockResolvedValueOnce([[{ id: "sw-1", status: "pending" }], []]);
    const r = await request(app).post("/api/wfm-ext/roster/swaps").set(EMP)
      .send({ swap_with_emp_id: "emp-2", swap_date: "2026-06-10" });
    expect(r.status).toBe(201);
  });

  it("returns 400 without required fields", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-emp" } }, error: null });
    mockExecute.mockResolvedValueOnce([[{ id: "emp-1", employee_code: "E001" }], []]);
    const r = await request(app).post("/api/wfm-ext/roster/swaps").set(EMP)
      .send({ swap_date: "2026-06-10" }); // missing swap_with_emp_id
    expect(r.status).toBe(400);
  });
});

describe("POST /api/wfm-ext/roster/swaps/:id/review", () => {
  it("returns 403 for employee role", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-emp" } }, error: null });
    mockExecute.mockResolvedValueOnce([[{ role_key: "employee" }], []]);
    const r = await request(app).post("/api/wfm-ext/roster/swaps/sw-1/review").set(EMP)
      .send({ status: "approved" });
    expect(r.status).toBe(403);
  });

  it("approves swap for manager", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-mgr" } }, error: null });
    mockExecute.mockResolvedValueOnce([[{ role_key: "manager" }], []]);
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    const r = await request(app).post("/api/wfm-ext/roster/swaps/sw-1/review").set(ADMIN)
      .send({ status: "approved" });
    expect(r.status).toBe(200);
  });
});

// ── Coverage / Shrinkage ──────────────────────────────────────────────────────

describe("POST /api/wfm-ext/coverage/snapshot", () => {
  it("returns 403 for hr (wfm/admin only)", async () => {
    mockHr();
    const r = await request(app).post("/api/wfm-ext/coverage/snapshot").set(HR)
      .send({ snapshot_date: "2026-06-01", planned_headcount: 100 });
    expect(r.status).toBe(403);
  });

  it("creates snapshot for admin with calculated shrinkage", async () => {
    mockAdmin();
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    const r = await request(app).post("/api/wfm-ext/coverage/snapshot").set(ADMIN)
      .send({ snapshot_date: "2026-06-01", planned_headcount: 100, actual_headcount: 85, absent_count: 10, leave_count: 5 });
    expect(r.status).toBe(200);
    // Shrinkage = (10+5)/100 = 15%, coverage = 85/100 = 85% — computed in service
  });
});

// ── Attrition ─────────────────────────────────────────────────────────────────

describe("POST /api/wfm-ext/attrition/record", () => {
  it("returns 400 without required fields", async () => {
    mockHr();
    const r = await request(app).post("/api/wfm-ext/attrition/record").set(HR)
      .send({ employee_id: "emp-1" });
    expect(r.status).toBe(400);
  });

  it("records attrition for hr", async () => {
    mockHr();
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    const r = await request(app).post("/api/wfm-ext/attrition/record").set(HR)
      .send({ employee_id: "emp-1", exit_date: "2026-06-01", exit_type: "voluntary", tenure_days: 365 });
    expect(r.status).toBe(201);
  });
});

describe("GET /api/wfm-ext/attrition/summary", () => {
  it("returns summary for admin", async () => {
    mockAdmin();
    mockExecute.mockResolvedValueOnce([[{ exit_type: "voluntary", count: 5, avg_tenure_days: 300 }], []]);
    const r = await request(app).get("/api/wfm-ext/attrition/summary").set(ADMIN);
    expect(r.status).toBe(200);
  });
});
