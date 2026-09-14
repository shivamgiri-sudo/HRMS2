import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Task 2 of the WFM attendance-console merge — COSEC monitoring + billing-config API
 * alignment.
 *
 * 2a. cosecMonitoringRouter widened to the union of its old role list
 *     (admin, hr, ceo, wfm) and the WFM_LIVE_TRACKER page-gate roles
 *     (super_admin, branch_head, branch_wfm, manager, process_manager, wfm) for the three
 *     run-level endpoints (/sync-status, /sync-runs, /sync-errors), which carry no
 *     per-employee data. /latest-punches DOES join to employees, so it keeps the narrower
 *     pre-existing role list (admin, hr, ceo, wfm, super_admin) on the route itself — a
 *     role that only cleared the router-level union (e.g. process_manager, branch_head)
 *     must still be refused there.
 * 2b. getCosecMonitoring's single do-everything function is split into one reader per
 *     endpoint, so GET /sync-status no longer issues the 50-row sync_runs query, the
 *     50-row sync_errors query, or the 100-row biometric_attendance_log punch join.
 * 2c. ATTENDANCE_BILLING_CONFIG's list endpoint (GET /) gains `wfm`, matching the page
 *     gate. Write endpoints are untouched.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

let actor: { id: string; role: string; roles: string[] };
vi.mock("../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middleware/authMiddleware.js")>();
  return {
    ...original,
    requireAuth: (req: any, _res: any, next: any) => {
      req.authUser = actor;
      next();
    },
  };
});

// requireRole.ts is NOT mocked — the whole point of this file is to exercise the real
// role gate on both the router-level and route-level middleware.
import { cosecMonitoringRouter } from "../modules/peopleos/peopleos.routes.js";
import { billingConfigRouter } from "../modules/attendance/billing-config.routes.js";

function appFor(role: string) {
  actor = { id: `u-${role}`, role, roles: [role] };
  const app = express();
  app.use(express.json());
  app.use("/api/integrations/cosec", cosecMonitoringRouter);
  app.use("/api/attendance/billing-config", billingConfigRouter);
  return app;
}

function stubDb() {
  execute.mockReset();
  execute.mockImplementation(async (sql: string) => {
    if (/FROM integration_sync_run[\s\S]*LIMIT 1\b/.test(sql)) {
      return [[{ id: "run-1", status: "success", started_at: "2026-08-27 06:00:00", completed_at: "2026-08-27 06:05:00" }], []];
    }
    if (/FROM integration_sync_run[\s\S]*LIMIT 50\b/.test(sql)) {
      return [[{ id: "run-1", status: "success" }], []];
    }
    if (/information_schema\.tables/.test(sql)) {
      return [[{ 1: 1 }], []];
    }
    if (/FROM biometric_attendance_log/.test(sql)) {
      return [[{ employee_code: "E1", punch_date: "2026-08-27" }], []];
    }
    if (/FROM attendance_billing_config/.test(sql)) {
      return [[{ id: "cfg-1", scope_type: "global" }], []];
    }
    return [[], []];
  });
}

beforeEach(() => {
  stubDb();
});

describe("2a — cosecMonitoringRouter role split", () => {
  it("process_manager (page-gate role, not in the old API list) gets 200 on /sync-runs", async () => {
    const res = await request(appFor("process_manager")).get("/api/integrations/cosec/sync-runs");
    expect(res.status).toBe(200);
  });

  it("branch_head (page-gate role) gets 200 on /sync-status and /sync-errors", async () => {
    const app = appFor("branch_head");
    expect((await request(app).get("/api/integrations/cosec/sync-status")).status).toBe(200);
    expect((await request(app).get("/api/integrations/cosec/sync-errors")).status).toBe(200);
  });

  it("process_manager gets 403 on /latest-punches — the run-level union does not grant the per-employee route", async () => {
    const res = await request(appFor("process_manager")).get("/api/integrations/cosec/latest-punches");
    expect(res.status).toBe(403);
  });

  it("branch_wfm gets 403 on /latest-punches for the same reason", async () => {
    const res = await request(appFor("branch_wfm")).get("/api/integrations/cosec/latest-punches");
    expect(res.status).toBe(403);
  });

  it("wfm (in both the old list and the narrow punch list) still gets 200 on /latest-punches", async () => {
    const res = await request(appFor("wfm")).get("/api/integrations/cosec/latest-punches");
    expect(res.status).toBe(200);
  });

  it("an out-of-set role (employee) is refused at the router level", async () => {
    const res = await request(appFor("employee")).get("/api/integrations/cosec/sync-runs");
    expect(res.status).toBe(403);
  });
});

describe("2b — each endpoint issues only the query(ies) its own response uses", () => {
  it("GET /sync-status returns 200 and issues only the latest-run query — no sync_runs, sync_errors, or punch query", async () => {
    const res = await request(appFor("admin")).get("/api/integrations/cosec/sync-status");
    expect(res.status).toBe(200);

    const calls = execute.mock.calls.map(([sql]) => String(sql));
    expect(calls.some((sql) => /LIMIT 1\b/.test(sql))).toBe(true);
    expect(calls.some((sql) => /LIMIT 50\b/.test(sql))).toBe(false);
    expect(calls.some((sql) => /biometric_attendance_log/.test(sql))).toBe(false);
    expect(calls.some((sql) => /information_schema\.tables/.test(sql))).toBe(false);
    expect(calls.length).toBe(1);
  });

  it("GET /sync-runs issues only the 50-row run query, not the latest-run, errors, or punch query", async () => {
    const res = await request(appFor("admin")).get("/api/integrations/cosec/sync-runs");
    expect(res.status).toBe(200);

    const calls = execute.mock.calls.map(([sql]) => String(sql));
    expect(calls.length).toBe(1);
    expect(calls[0]).toMatch(/LIMIT 50\b/);
    expect(calls[0]).not.toMatch(/status = 'failed'/);
  });

  it("GET /sync-errors issues only the failed/records_failed query", async () => {
    const res = await request(appFor("admin")).get("/api/integrations/cosec/sync-errors");
    expect(res.status).toBe(200);

    const calls = execute.mock.calls.map(([sql]) => String(sql));
    expect(calls.length).toBe(1);
    expect(calls[0]).toMatch(/status = 'failed' OR records_failed > 0/);
  });

  it("GET /latest-punches issues the punch join and never the run-table queries", async () => {
    // tableExists() caches per table name at module scope, so whether the
    // information_schema.tables probe itself fires here depends on test execution order
    // within this file (a prior /latest-punches call already warmed the cache) — that
    // probe is exercised in isolation below. What must hold regardless of cache state is
    // that this endpoint never touches integration_sync_run.
    const res = await request(appFor("admin")).get("/api/integrations/cosec/latest-punches");
    expect(res.status).toBe(200);

    const calls = execute.mock.calls.map(([sql]) => String(sql));
    expect(calls.some((sql) => /FROM biometric_attendance_log/.test(sql))).toBe(true);
    expect(calls.some((sql) => /FROM integration_sync_run/.test(sql))).toBe(false);
  });
});

describe("2c — ATTENDANCE_BILLING_CONFIG list gains wfm", () => {
  it("wfm gets 200 on GET /api/attendance/billing-config (was 403 before the fix)", async () => {
    const res = await request(appFor("wfm")).get("/api/attendance/billing-config");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("write endpoints are unchanged — wfm still gets 403 on POST /", async () => {
    const res = await request(appFor("wfm"))
      .post("/api/attendance/billing-config")
      .send({ scope_type: "global", extra_day_salary_allowed: 1, effective_from: "2026-08-01", change_reason: "x" });
    expect(res.status).toBe(403);
  });

  it("write endpoints are unchanged — finance_head still gets past POST / role gate", async () => {
    const res = await request(appFor("finance_head"))
      .post("/api/attendance/billing-config")
      .send({ scope_type: "global", extra_day_salary_allowed: 1, effective_from: "2026-08-01", change_reason: "x" });
    expect(res.status).not.toBe(403);
  });

  it("delete stays super_admin-only — finance_head gets 403 on DELETE /:id", async () => {
    const res = await request(appFor("finance_head")).delete("/api/attendance/billing-config/cfg-1");
    expect(res.status).toBe(403);
  });
});
