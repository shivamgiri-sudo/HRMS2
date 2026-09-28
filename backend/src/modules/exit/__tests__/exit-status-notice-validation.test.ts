import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PATCH /api/exit/:id/status — the notice terms it now accepts, and what it refuses.
 *
 * This route is the single consolidated status handler (three other routers once defined the
 * same path and were entirely shadowed by it — see handleExitStatusUpdate's own header). It
 * was already RECEIVING lastWorkingDayConfirmed and noticePeriodDays from
 * NativeExitManagement's "Confirm & Advance" modal and reading neither, so the values were
 * silently dropped on every call.
 *
 * Validation is not ceremony here. last_working_day_confirmed is the first term in payroll's
 * employment-end-date resolver (payroll/employment-end-date.ts), which decides who is in a
 * salary run and through what date a leaver is prorated. A malformed or impossible date
 * accepted here propagates into pay.
 */

const ACTOR = "user-hr";
const EXIT_ID = "exit-1";

const { updateExitStatus, dbExecute } = vi.hoisted(() => ({
  updateExitStatus: vi.fn(async () => ({ id: "exit-1", status: "accepted" })),
  dbExecute: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute, query: dbExecute } }));
vi.mock("../exit.service.js", () => ({ exitService: { updateExitStatus } }));
vi.mock("../../../shared/accessGuard.js", () => ({
  getEmployeeForUser: vi.fn(async () => ({ id: "emp-actor" })),
  hasRole: vi.fn(async () => true),
}));
vi.mock("../../../shared/scopeAccess.js", () => ({
  hasAnyRole: vi.fn(async () => true),
  hasScopedAccess: vi.fn(async () => true),
  buildScopeWhereClause: vi.fn(async () => ({ sql: "1=1", params: [] })),
}));
vi.mock("../../payroll/noc.service.js", () => ({
  nocRequired: vi.fn(async () => ({ required: false, reason: null })),
  nocValidated: vi.fn(async () => true),
}));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: ACTOR }; next(); },
}));

const { exitSecureRouter } = await import("../exit.secure.routes.js");

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/exit", exitSecureRouter);
  return a;
}

beforeEach(() => {
  updateExitStatus.mockClear();
  dbExecute.mockReset();
  // The route reads the current status for its FSM check before doing anything else.
  dbExecute.mockImplementation(async (sql: string) => {
    if (/SELECT status FROM exit_request/.test(sql)) return [[{ status: "manager_review" }], []];
    return [[], []];
  });
}); 

const patch = (body: Record<string, unknown>) =>
  request(app()).patch(`/api/exit/${EXIT_ID}/status`).send(body);

describe("PATCH /:id/status — notice terms reach the service", () => {
  it("forwards a confirmed LWD and notice period instead of discarding them", async () => {
    const res = await patch({
      status: "accepted",
      remarks: "agreed with employee",
      lastWorkingDayConfirmed: "2026-10-15",
      noticePeriodDays: 30,
    });

    expect(res.status).toBe(200);
    // 6th argument — the notice terms. Before the fix this call had five arguments and the
    // two values the modal collected went nowhere.
    expect(updateExitStatus).toHaveBeenCalledWith(
      EXIT_ID, "accepted", "agreed with employee", ACTOR, "manager_review",
      { lastWorkingDayConfirmed: "2026-10-15", noticePeriodDays: 30 }
    );
  });

  it("accepts the snake_case spellings too", async () => {
    const res = await patch({
      status: "accepted",
      remarks: "ok",
      last_working_day_confirmed: "2026-10-15",
      notice_period_days: 45,
    });

    expect(res.status).toBe(200);
    expect(updateExitStatus.mock.calls[0][5]).toEqual({
      lastWorkingDayConfirmed: "2026-10-15",
      noticePeriodDays: 45,
    });
  });

  it("passes nulls through when the caller sends no terms", async () => {
    const res = await patch({ status: "accepted", remarks: "ok" });

    expect(res.status).toBe(200);
    expect(updateExitStatus.mock.calls[0][5]).toEqual({
      lastWorkingDayConfirmed: null,
      noticePeriodDays: null,
    });
  });
});

describe("PATCH /:id/status — refuses a date payroll could not use", () => {
  const rejects = async (body: Record<string, unknown>, match: RegExp) => {
    const res = await patch({ status: "accepted", remarks: "ok", ...body });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(match);
    // A rejected request must not have reached the state machine at all.
    expect(updateExitStatus).not.toHaveBeenCalled();
  };

  it("rejects a non-date string", () => rejects({ lastWorkingDayConfirmed: "next friday" }, /YYYY-MM-DD/));

  it("rejects a wrong-format date", () => rejects({ lastWorkingDayConfirmed: "15/10/2026" }, /YYYY-MM-DD/));

  it("rejects a date that does not exist on the calendar", () =>
    // The reason the check is not a bare regex: /^\d{4}-\d{2}-\d{2}$/ happily accepts this,
    // and what MySQL then does with it depends on sql_mode.
    rejects({ lastWorkingDayConfirmed: "2026-02-31" }, /real calendar date/));

  it("rejects month 13", () => rejects({ lastWorkingDayConfirmed: "2026-13-01" }, /real calendar date/));

  it("rejects a negative notice period", () => rejects({ noticePeriodDays: -5 }, /between 0 and 365/));

  it("rejects a fractional notice period", () => rejects({ noticePeriodDays: 30.5 }, /whole number/));

  it("rejects an absurd notice period", () => rejects({ noticePeriodDays: 10000 }, /between 0 and 365/));

  it("rejects a non-numeric notice period", () => rejects({ noticePeriodDays: "thirty" }, /whole number/));
});

describe("PATCH /:id/status — leap-year dates are real dates", () => {
  it("accepts 29 Feb in a leap year", async () => {
    const res = await patch({ status: "accepted", remarks: "ok", lastWorkingDayConfirmed: "2028-02-29" });
    expect(res.status).toBe(200);
  });

  it("rejects 29 Feb in a non-leap year", async () => {
    const res = await patch({ status: "accepted", remarks: "ok", lastWorkingDayConfirmed: "2027-02-29" });
    expect(res.status).toBe(400);
  });
});
