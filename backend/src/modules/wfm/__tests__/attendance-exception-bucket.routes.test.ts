import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-level contract for the exception-bucket and payable-days APIs.
 *
 * Worth testing at this level specifically because in this codebase a route that does not exist
 * also answers 401 — so "I got a 401" proves nothing about whether the endpoint was ever mounted.
 * These tests mount the routers and assert on behaviour only a live route can produce: a 403 from
 * the role guard, and 400s from the validators.
 */

const AUTH_USER_ID = "33333333-3333-3333-3333-333333333333";
const EMPLOYEE_ID = "11111111-1111-1111-1111-111111111111";

const { execute, hasAnyRole, logSensitiveAction } = vi.hoisted(() => ({
  execute: vi.fn(),
  hasAnyRole: vi.fn(),
  logSensitiveAction: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/scopeAccess.js", () => ({ hasAnyRole }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: { id: string } }).authUser = { id: AUTH_USER_ID };
    next();
  },
}));

import { attendanceExceptionBucketRouter } from "../attendance-exception-bucket.routes.js";
import { payableDaysOverrideRouter } from "../../payroll/payable-days-override.routes.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/wfm/attendance-exception-bucket", attendanceExceptionBucketRouter);
  app.use("/api/payroll/payable-days-overrides", payableDaysOverrideRouter);
  return app;
}

/** Grant payroll_head: the guard checks super_admin, admin, payroll_head, payroll_admin in order. */
function grantPayrollHead() {
  hasAnyRole.mockImplementation(async (_u: string, role: string) => role === "payroll_head");
}
function grantNothing() {
  hasAnyRole.mockResolvedValue(false);
}

describe("attendance exception bucket routes", () => {
  beforeEach(() => {
    execute.mockReset();
    hasAnyRole.mockReset();
    logSensitiveAction.mockReset();
  });

  it("is mounted and answers the list route for a Payroll Head", async () => {
    grantPayrollHead();
    execute.mockResolvedValueOnce([[], []]);

    const res = await request(buildApp()).get("/api/wfm/attendance-exception-bucket");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Proves the handler ran rather than a catch-all answering: it reports the engine default.
    expect(res.body.meta.default_full_day_minutes).toBe(540);
  });

  it("refuses a caller who holds none of the payroll roles", async () => {
    grantNothing();
    const res = await request(buildApp()).get("/api/wfm/attendance-exception-bucket");
    expect(res.status).toBe(403);
  });

  it("rejects an entry that relaxes nothing", async () => {
    grantPayrollHead();
    const res = await request(buildApp())
      .post("/api/wfm/attendance-exception-bucket")
      .send({
        employee_id: EMPLOYEE_ID,
        single_punch_counts_as_present: false,
        full_day_threshold_minutes: null,
        reason: "a perfectly long reason string",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one exception/i);
  });

  it("rejects a threshold outside the allowed band", async () => {
    grantPayrollHead();
    const res = await request(buildApp())
      .post("/api/wfm/attendance-exception-bucket")
      .send({
        employee_id: EMPLOYEE_ID,
        single_punch_counts_as_present: true,
        full_day_threshold_minutes: 5,
        reason: "a perfectly long reason string",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/between 60 and 1440/);
  });

  it("requires a reason of real substance", async () => {
    grantPayrollHead();
    const res = await request(buildApp())
      .post("/api/wfm/attendance-exception-bucket")
      .send({ employee_id: EMPLOYEE_ID, single_punch_counts_as_present: true, reason: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 10 characters/);
  });
});

describe("payable days override routes", () => {
  beforeEach(() => {
    execute.mockReset();
    hasAnyRole.mockReset();
    logSensitiveAction.mockReset();
  });

  it("is mounted and answers the list route for a Payroll Head", async () => {
    grantPayrollHead();
    execute.mockResolvedValueOnce([[], []]);
    const res = await request(buildApp())
      .get("/api/payroll/payable-days-overrides?runMonth=2026-09");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("refuses a caller who holds none of the payroll roles", async () => {
    grantNothing();
    const res = await request(buildApp()).get("/api/payroll/payable-days-overrides");
    expect(res.status).toBe(403);
  });

  it("rejects a run month that is not YYYY-MM", async () => {
    grantPayrollHead();
    const res = await request(buildApp())
      .post("/api/payroll/payable-days-overrides")
      .send({ employee_id: EMPLOYEE_ID, run_month: "September 2026", payable_days: 26, reason: "a long enough reason" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/YYYY-MM/);
  });

  it("rejects payable days beyond any possible month", async () => {
    grantPayrollHead();
    const res = await request(buildApp())
      .post("/api/payroll/payable-days-overrides")
      .send({ employee_id: EMPLOYEE_ID, run_month: "2026-09", payable_days: 45, reason: "a long enough reason" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot exceed 31/);
  });

  it("rejects a quarter day, which attendance cannot produce", async () => {
    grantPayrollHead();
    const res = await request(buildApp())
      .post("/api/payroll/payable-days-overrides")
      .send({ employee_id: EMPLOYEE_ID, run_month: "2026-09", payable_days: 25.25, reason: "a long enough reason" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/whole or half day/);
  });

  it("refuses to accept an override against a finalized run, which could never be recalculated", async () => {
    grantPayrollHead();
    execute
      // employee exists
      .mockResolvedValueOnce([[{ id: EMPLOYEE_ID }], []])
      // canonical run for the month is FINALIZED
      .mockResolvedValueOnce([[{ id: "run-1", status: "FINALIZED" }], []]);

    const res = await request(buildApp())
      .post("/api/payroll/payable-days-overrides")
      .send({ employee_id: EMPLOYEE_ID, run_month: "2026-09", payable_days: 26, reason: "a long enough reason" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/cannot be recalculated/);
  });
});
