import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A FINALIZED run must be closed to edits.
 *
 * These guards were written `['locked','disbursed'].includes(run.status)`.
 * Production holds no run in either status — runs settle as FINALIZED, stored
 * uppercase — so every one of them matched nothing and a settled run stayed
 * editable. 51 of 67 production runs are FINALIZED.
 *
 * run-status.test.ts already proves isRunClosed('FINALIZED') is true, and
 * statusGuardRecurrence.test.ts proves the call appears at each site. Neither
 * shows the routes actually reject: a guard can be present, correct, and still
 * wired somewhere it never runs. This mounts the router and asserts the refusal.
 *
 * Case matters and is asserted separately. MySQL's collation is case-insensitive,
 * so `status IN ('locked','disbursed')` in SQL would have matched 'LOCKED' and the
 * mismatch reads like a non-issue — but Set.has() in JavaScript is case sensitive,
 * which is why the JS guards failed where the SQL ones appeared to work.
 */

const RUN_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const AUTH_USER = "33333333-3333-3333-3333-333333333333";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: { id: string } }).authUser = { id: AUTH_USER };
    next();
  },
}));
// Role is not under test — these callers legitimately hold payroll rights. Whether a
// settled run may be edited is the question.
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_q: express.Request, _s: express.Response, n: express.NextFunction) => n(),
}));

import { payrollWindowCronRouter } from "../payroll-window.routes.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/payroll", payrollWindowCronRouter);
  return app;
}

const runRow = (status: string) => [[{ id: RUN_ID, run_month: "2026-07", status, window_close_date: null, auto_closed_at: null, tds_mode: "manual" }], []];

beforeEach(() => execute.mockReset());

/** The statuses production actually settles runs in, in the casing it stores. */
const CLOSED = ["FINALIZED", "finalized", "LOCKED", "locked", "disbursed"];
/** Runs still legitimately in flight — these must stay editable. */
const OPEN = ["draft", "processing", "approved"];

describe("PATCH /runs/:id/tds-mode refuses a settled run", () => {
  for (const status of CLOSED) {
    it(`409s when the run is ${status}`, async () => {
      execute.mockResolvedValueOnce(runRow(status));

      const res = await request(buildApp())
        .patch(`/api/payroll/runs/${RUN_ID}/tds-mode`)
        .send({ tds_mode: "auto" });

      expect(res.status).toBe(409);
      // Only the status lookup should have run — no UPDATE against a settled run.
      expect(execute).toHaveBeenCalledTimes(1);
    });
  }

  for (const status of OPEN) {
    it(`allows the change when the run is ${status}`, async () => {
      execute.mockResolvedValueOnce(runRow(status)).mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      const res = await request(buildApp())
        .patch(`/api/payroll/runs/${RUN_ID}/tds-mode`)
        .send({ tds_mode: "auto" });

      // Guards against the opposite defect: closing everything would satisfy every
      // assertion above while stopping payroll from working at all.
      expect(res.status).toBe(200);
      expect(execute).toHaveBeenCalledTimes(2);
    });
  }
});

describe("POST /runs/:id/manual-tds refuses a settled run", () => {
  it("409s on a FINALIZED run and writes no TDS row", async () => {
    execute.mockResolvedValueOnce(runRow("FINALIZED"));

    const res = await request(buildApp())
      .post(`/api/payroll/runs/${RUN_ID}/manual-tds`)
      .send([{ employee_id: "emp-1", tds_amount: 5000 }]);

    expect(res.status).toBe(409);
    // Manual TDS on a settled run would alter tax already reported.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("accepts entries on a draft run", async () => {
    execute.mockResolvedValueOnce(runRow("draft")).mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    const res = await request(buildApp())
      .post(`/api/payroll/runs/${RUN_ID}/manual-tds`)
      .send([{ employee_id: "emp-1", tds_amount: 5000 }]);

    expect(res.status).toBe(200);
  });
});

describe("GET /runs/:id/window-status reports a settled run as closed", () => {
  it("reports is_window_open false for FINALIZED", async () => {
    execute.mockResolvedValueOnce(runRow("FINALIZED"));

    const res = await request(buildApp()).get(`/api/payroll/runs/${RUN_ID}/window-status`);

    expect(res.status).toBe(200);
    // The original defect in one assertion: a FINALIZED run reported as open.
    expect(res.body.data.is_window_open).toBe(false);
  });

  it("reports is_window_open true for a draft run with no close date", async () => {
    execute.mockResolvedValueOnce(runRow("draft"));

    const res = await request(buildApp()).get(`/api/payroll/runs/${RUN_ID}/window-status`);

    expect(res.body.data.is_window_open).toBe(true);
  });
});
