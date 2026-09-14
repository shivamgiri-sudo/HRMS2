import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Notice terms agreed at a status transition are actually stored.
 *
 * THE DEFECT
 *
 * NativeExitManagement's "Confirm & Advance" modal is the only place in the product where an
 * exit's Last Working Day is confirmed and its notice period is set. It collects both, and
 * updateStatus() puts them on the PATCH body as lastWorkingDayConfirmed / noticePeriodDays.
 * handleExitStatusUpdate in exit.secure.routes.ts read `status` and `remarks` and nothing
 * else, and exitService.updateExitStatus had no parameter for either — so HR filled the form
 * in, got "Updated to Accepted", and every notice column stayed exactly as it was.
 *
 * Proven by exhaustion rather than by reading one function: across the whole of backend/src
 * there were exactly six statements that write exit_request (one INSERT in exit.service.ts and
 * five status-only UPDATEs), and not one of them named last_working_day_confirmed,
 * notice_start_date or notice_end_date. All three columns had no writer at all and were NULL
 * on every row in the table.
 *
 * WHAT THAT BROKE DOWNSTREAM — all of it presenting as data, not as an error
 *
 *   - manpower-risk.routes.ts computes days_remaining/days_served from notice_start_date, so
 *     the Notice Period tab showed "—" remaining and 0 served for everyone.
 *   - exit-lwd-scan.service.ts selects on `last_working_day_confirmed IS NOT NULL`, so the
 *     daily LWD-approaching alert — which carries the open-clearance count and is the
 *     alerting half of the clearance control — matched zero rows every night.
 *   - ai-account.service.ts reports the notice window to an employee only when both dates are
 *     present, so it never did.
 *   - payroll's employment-end-date resolver prefers last_working_day_confirmed over
 *     last_working_day_proposed. With confirmed permanently NULL, every leaver was paid
 *     against the date they *proposed*, never the one HR agreed.
 */

const { dbExecute, connCommit, connRollback, connRelease, connBegin } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  connCommit: vi.fn(async () => undefined),
  connRollback: vi.fn(async () => undefined),
  connRelease: vi.fn(() => undefined),
  connBegin: vi.fn(async () => undefined),
}));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: dbExecute,
    query: dbExecute,
    getConnection: vi.fn(async () => ({
      execute: dbExecute,
      query: dbExecute,
      beginTransaction: connBegin,
      commit: connCommit,
      rollback: connRollback,
      release: connRelease,
    })),
  },
}));

vi.mock("../../../shared/sessionRevocation.js", () => ({
  revokeSessionsForEmployee: vi.fn(async () => ({ refreshTokensRevoked: 0, deviceSessionsRevoked: 0 })),
}));
vi.mock("../../../shared/employeeDeprovisioning.js", () => ({
  deprovisionEmployeeAccess: vi.fn(async () => ({
    lmsMappingsRevoked: 0, leaveRequestsCancelled: 0, openAssetAssignments: 0, failures: [],
  })),
}));
vi.mock("../../management/manager-attribution.service.js", () => ({
  recordManagerChange: vi.fn(async () => undefined),
}));
vi.mock("../exit-followup-recovery.js", () => ({ recordExitFollowUpFailure: vi.fn(async () => undefined) }));
vi.mock("../exit-intelligence.service.js", () => ({
  createDefaultClearanceTasks: vi.fn(async () => undefined),
  createExitHealthSnapshot: vi.fn(async () => undefined),
}));
vi.mock("../exit.notifications.js", () => ({
  notifyResignationSubmitted: vi.fn(async () => true),
  notifyResignationDecision: vi.fn(async () => undefined),
}));
vi.mock("../../work-inbox/work-inbox.triggers.js", () => ({
  triggerResignationPendingReview: vi.fn(async () => undefined),
}));
vi.mock("../../communication/sms.helper.js", () => ({ sendSMS: vi.fn(async () => undefined) }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: vi.fn() }) } }));

/** An exit in manager_review with a proposed but not yet confirmed LWD — the real starting state. */
const EXIT_ROW = {
  id: "exit-1",
  employee_id: "emp-1",
  status: "manager_review",
  exit_type: "voluntary",
  exit_sub_type: "resignation",
  last_working_day_proposed: "2026-09-30",
  last_working_day_confirmed: null,
  notice_period_days: 0,
  notice_start_date: null,
  notice_end_date: null,
};

type Call = { sql: string; params: unknown[] };
let calls: Call[];

function mockDb(row: Record<string, unknown> = EXIT_ROW) {
  calls = [];
  dbExecute.mockReset();
  dbExecute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql: String(sql), params });
    if (/FROM exit_request er/.test(sql)) return [[row], []];
    if (/SELECT status FROM exit_request WHERE id = \? FOR UPDATE/.test(sql)) {
      return [[{ status: row.status }], []];
    }
    if (/UPDATE exit_request SET status/.test(sql)) return [{ affectedRows: 1 }, []];
    if (/INSERT INTO exit_approval_log/.test(sql)) return [{ affectedRows: 1 }, []];
    if (/UPDATE employees SET active_status = 0/.test(sql)) return [{ affectedRows: 1 }, []];
    return [[], []];
  });
}

/** The single UPDATE that carries the transition. */
const statusUpdate = () => calls.find((c) => /UPDATE exit_request SET status/.test(c.sql))!;
const employeeUpdate = () => calls.find((c) => /UPDATE employees SET active_status = 0/.test(c.sql));

beforeEach(() => {
  connCommit.mockClear();
  connRollback.mockClear();
  connRelease.mockClear();
  connBegin.mockClear();
});

describe("updateExitStatus — notice terms are persisted", () => {
  it("writes the confirmed last working day", async () => {
    mockDb();
    const { exitService } = await import("../exit.service.js");
    await exitService.updateExitStatus("exit-1", "accepted", "ok", "actor-1", "manager_review", {
      lastWorkingDayConfirmed: "2026-10-15",
      noticePeriodDays: 30,
    });

    const u = statusUpdate();
    expect(u.sql).toMatch(/last_working_day_confirmed = \?/);
    expect(u.params).toContain("2026-10-15");
  });

  it("writes the notice period", async () => {
    mockDb();
    const { exitService } = await import("../exit.service.js");
    await exitService.updateExitStatus("exit-1", "accepted", "ok", "actor-1", "manager_review", {
      lastWorkingDayConfirmed: "2026-10-15",
      noticePeriodDays: 45,
    });

    const u = statusUpdate();
    expect(u.sql).toMatch(/notice_period_days = \?/);
    expect(u.params).toContain(45);
  });

  it("derives the notice window in the same statement as the transition", async () => {
    mockDb();
    const { exitService } = await import("../exit.service.js");
    await exitService.updateExitStatus("exit-1", "accepted", "ok", "actor-1", "manager_review", {
      lastWorkingDayConfirmed: "2026-10-15",
      noticePeriodDays: 30,
    });

    const u = statusUpdate();
    // Atomicity: notice terms must land with the status they were agreed at, not in a second
    // statement that could commit alone.
    expect(u.sql).toMatch(/SET status = \?/);
    expect(u.sql).toMatch(/notice_start_date = /);
    expect(u.sql).toMatch(/notice_end_date = /);
  });

  it("anchors notice_start_date on the tender date, and never moves one already recorded", async () => {
    mockDb();
    const { exitService } = await import("../exit.service.js");
    await exitService.updateExitStatus("exit-1", "accepted", "ok", "actor-1", "manager_review", {
      lastWorkingDayConfirmed: "2026-10-15",
      noticePeriodDays: 30,
    });

    const u = statusUpdate();
    // COALESCE puts the existing value first, so re-running a transition cannot shift the
    // start date and silently change how much notice the employee is recorded as having served.
    expect(u.sql).toMatch(/notice_start_date = COALESCE\(notice_start_date, DATE\(submitted_at\), DATE\(created_at\)\)/);
  });

  it("computes the notice window in SQL, never in JS", async () => {
    mockDb();
    const { exitService } = await import("../exit.service.js");
    await exitService.updateExitStatus("exit-1", "accepted", "ok", "actor-1", "manager_review", {
      lastWorkingDayConfirmed: "2026-10-15",
      noticePeriodDays: 30,
    });

    // mysql2 hands a DATE back as a host-timezone JS Date and this codebase has a documented
    // history of that shifting a day. On a notice boundary a day is a day of pay, so the dates
    // must never round-trip through JS.
    expect(statusUpdate().sql).toMatch(/DATE_ADD\(/);
  });

  it("prefers the confirmed LWD as the notice end over start + days", async () => {
    mockDb();
    const { exitService } = await import("../exit.service.js");
    await exitService.updateExitStatus("exit-1", "accepted", "ok", "actor-1", "manager_review", {
      lastWorkingDayConfirmed: "2026-10-15",
      noticePeriodDays: 30,
    });

    const u = statusUpdate();
    expect(u.sql).toMatch(/notice_end_date = COALESCE\(\?, DATE_ADD\(/);
    // The confirmed date is bound as the first arm, so an agreed LWD wins over the arithmetic.
    expect(u.params.filter((p) => p === "2026-10-15").length).toBeGreaterThanOrEqual(2);
  });
});

describe("updateExitStatus — notice terms are optional and non-destructive", () => {
  it("touches no notice column when the caller supplies none", async () => {
    mockDb();
    const { exitService } = await import("../exit.service.js");
    // The plain transitions — Notice, Confirm Exit, Revoke, and every bulk action — send only
    // status and remarks. They must not blank out terms a previous step agreed.
    await exitService.updateExitStatus("exit-1", "accepted", "ok", "actor-1", "manager_review");

    const u = statusUpdate();
    expect(u.sql).not.toMatch(/last_working_day_confirmed/);
    expect(u.sql).not.toMatch(/notice_period_days/);
    expect(u.sql).not.toMatch(/notice_start_date/);
    expect(u.sql).not.toMatch(/notice_end_date/);
  });

  it("ignores an empty-string date rather than writing a blank", async () => {
    mockDb();
    const { exitService } = await import("../exit.service.js");
    await exitService.updateExitStatus("exit-1", "accepted", "ok", "actor-1", "manager_review", {
      lastWorkingDayConfirmed: "",
      noticePeriodDays: null,
    });

    expect(statusUpdate().sql).not.toMatch(/last_working_day_confirmed/);
  });

  it("does not invent a zero-day notice window", async () => {
    mockDb();
    const { exitService } = await import("../exit.service.js");
    // notice_period_days = 0 is the absence of a notice period, not a notice period of zero.
    // Writing notice_start = notice_end here would make "no notice recorded" indistinguishable
    // from "notice served and finished today" for every reader downstream.
    await exitService.updateExitStatus("exit-1", "accepted", "ok", "actor-1", "manager_review", {
      lastWorkingDayConfirmed: "2026-10-15",
      noticePeriodDays: 0,
    });

    const u = statusUpdate();
    expect(u.sql).toMatch(/last_working_day_confirmed = \?/); // the LWD is still a fact
    expect(u.sql).not.toMatch(/notice_start_date/);
    expect(u.sql).not.toMatch(/notice_end_date/);
  });
});

describe("updateExitStatus — the confirmed LWD reaches the employee record", () => {
  it("stamps date_of_exit from the LWD confirmed on this call, not the stale proposed one", async () => {
    // The subtle half of the fix. lastWorkingDay was computed from the row read BEFORE the
    // transaction, so confirming an LWD and marking the employee exited in one request would
    // write the new date into exit_request and the OLD one into employees.date_of_exit —
    // recreating the exact two-systems-disagree split the confirmed-before-proposed precedence
    // exists to prevent, on the one transition where it cannot be undone.
    mockDb({ ...EXIT_ROW, status: "notice_serving" });
    const { exitService } = await import("../exit.service.js");
    await exitService.updateExitStatus("exit-1", "exited", "confirming", "actor-1", "notice_serving", {
      lastWorkingDayConfirmed: "2026-10-15",
      noticePeriodDays: 30,
    });

    const e = employeeUpdate();
    expect(e).toBeDefined();
    expect(e!.params).toContain("2026-10-15");
    expect(e!.params).not.toContain("2026-09-30"); // the proposed date must not win
  });

  it("still falls back to the stored confirmed LWD, then proposed, when none is supplied", async () => {
    mockDb({ ...EXIT_ROW, status: "notice_serving", last_working_day_confirmed: "2026-09-25" });
    const { exitService } = await import("../exit.service.js");
    await exitService.updateExitStatus("exit-1", "exited", "confirming", "actor-1", "notice_serving");

    expect(employeeUpdate()!.params).toContain("2026-09-25");
  });

  it("uses the proposed LWD when nothing has ever been confirmed", async () => {
    mockDb({ ...EXIT_ROW, status: "notice_serving" });
    const { exitService } = await import("../exit.service.js");
    await exitService.updateExitStatus("exit-1", "exited", "confirming", "actor-1", "notice_serving");

    expect(employeeUpdate()!.params).toContain("2026-09-30");
  });
});

describe("createExitRequest — submitted_at, initiated_by and the default notice period", () => {
  function mockCreate() {
    calls = [];
    dbExecute.mockReset();
    dbExecute.mockImplementation(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql: String(sql), params });
      // no open exit for this employee
      if (/SELECT id FROM exit_request/.test(sql)) return [[], []];
      if (/FROM exit_request er/.test(sql)) return [[EXIT_ROW], []];
      if (/INSERT INTO exit_request/.test(sql)) return [{ affectedRows: 1 }, []];
      // business_policy_config lookup behind getPolicyValue — unseeded, so the caller's
      // fallback of "30" applies. That is the live state: no migration seeds this key.
      if (/FROM business_policy_config/.test(sql)) return [[], []];
      return [[], []];
    });
  }
  const insert = () => calls.find((c) => /INSERT INTO exit_request/.test(c.sql))!;

  /**
   * Value bound to a named column of the INSERT, resolved by parsing the column list rather
   * than by a hardcoded parameter index.
   *
   * A fixed index silently reads the wrong column the moment the INSERT gains one — which it
   * did: adding absconding_since ahead of last_working_day_proposed shifted notice_period_days
   * from position 10 to 11, and these assertions started comparing against the wrong value
   * while still looking like a notice-period test.
   *
   * NOW() is inlined in the VALUES list rather than bound, so placeholders and columns are not
   * 1:1 — only columns whose VALUES entry is a literal `?` have a parameter. Counting the
   * placeholders before the target column gives the right offset.
   */
  const insertedValueFor = (column: string) => {
    const { sql, params } = insert();
    const columnList = /INSERT INTO exit_request\s*\(([\s\S]*?)\)\s*VALUES/i.exec(sql)?.[1] ?? "";
    const valuesList = /VALUES\s*\(([\s\S]*?)\)/i.exec(sql)?.[1] ?? "";
    const columns = columnList.split(",").map((c) => c.trim());
    const values = valuesList.split(",").map((v) => v.trim());
    const idx = columns.indexOf(column);
    expect(idx, `INSERT does not name column "${column}"`).toBeGreaterThan(-1);
    const paramIndex = values.slice(0, idx).filter((v) => v === "?").length;
    expect(values[idx], `column "${column}" is not a bound parameter`).toBe("?");
    return params[paramIndex];
  };

  const insertedNoticeDays = () => insertedValueFor("notice_period_days");

  it("stamps submitted_at, which had no writer anywhere in the backend", async () => {
    mockCreate();
    const { exitService } = await import("../exit.service.js");
    await exitService.createExitRequest(
      { employeeId: "emp-1", exitDate: "2026-10-31", exitType: "voluntary" },
      "actor-1"
    );

    const i = insert();
    expect(i.sql).toMatch(/submitted_at/);
    // NOW() in SQL, not a JS timestamp bound as a param.
    expect(i.sql).toMatch(/NOW\(\)/);
  });

  it("records an HR-raised exit as hr-initiated instead of forging 'employee'", async () => {
    mockCreate();
    const { exitService } = await import("../exit.service.js");
    await exitService.createExitRequest(
      {
        employeeId: "emp-1", exitDate: "2026-10-31", exitType: "involuntary",
        exitSubType: "absconding", initiatedBy: "hr",
      },
      "actor-hr"
    );

    // Was the literal "employee" unconditionally, so an HR-raised absconding exit was
    // indistinguishable from a self-resignation on the record.
    expect(insert().params).toContain("hr");
  });

  it("defaults to 'employee' when the caller does not say, preserving prior behaviour", async () => {
    mockCreate();
    const { exitService } = await import("../exit.service.js");
    await exitService.createExitRequest(
      { employeeId: "emp-1", exitDate: "2026-10-31", exitType: "voluntary" },
      "actor-1"
    );

    expect(insert().params).toContain("employee");
  });

  it("stamps the 30-day company default on a resignation instead of 0", async () => {
    mockCreate();
    const { exitService } = await import("../exit.service.js");
    // notice_period_days was hardcoded 0 on every exit ever created — no UI collected it and the
    // schema defaulted it — so the notice window, the days-remaining figures and the F&F
    // notice-shortfall calculation all had nothing to work from.
    await exitService.createExitRequest(
      { employeeId: "emp-1", exitDate: "2026-10-31", exitType: "voluntary" },
      "actor-1"
    );

    expect(insertedNoticeDays()).toBe(30);
  });

  it("gives an absconding exit no notice period, not the 30-day default", async () => {
    mockCreate();
    const { exitService } = await import("../exit.service.js");
    // Someone who absconded was never asked to serve notice. Defaulting them to 30 would make
    // ff-compute derive a 30-day shortfall and therefore a recovery deducted from their
    // settlement, for notice nobody ever required.
    await exitService.createExitRequest(
      {
        employeeId: "emp-1", exitDate: "2026-10-31",
        exitType: "involuntary", exitSubType: "absconding",
      },
      "actor-hr"
    );

    expect(insertedNoticeDays()).toBe(0);
  });

  it("gives a termination no notice period either", async () => {
    mockCreate();
    const { exitService } = await import("../exit.service.js");
    await exitService.createExitRequest(
      {
        employeeId: "emp-1", exitDate: "2026-10-31",
        exitType: "involuntary", exitSubType: "termination",
      },
      "actor-hr"
    );

    expect(insertedNoticeDays()).toBe(0);
  });

  it("honours an explicit notice period, including a deliberate zero", async () => {
    mockCreate();
    const { exitService } = await import("../exit.service.js");
    await exitService.createExitRequest(
      { employeeId: "emp-1", exitDate: "2026-10-31", exitType: "voluntary", noticePeriodDays: 15 },
      "actor-1"
    );
    expect(insertedNoticeDays()).toBe(15);

    mockCreate();
    // 0 must survive. The validation schema used to .default(0), which made "said nothing" and
    // "said zero notice" the same value and left no way to apply a default without also
    // overriding a deliberate waiver.
    await exitService.createExitRequest(
      { employeeId: "emp-1", exitDate: "2026-10-31", exitType: "voluntary", noticePeriodDays: 0 },
      "actor-1"
    );
    expect(insertedNoticeDays()).toBe(0);
  });

  it("takes the company default from policy config, not a hardcoded literal", async () => {
    // getPolicyValue memoises for 60s (policy-engine.cache.ts TTL_MS), and the cases above have
    // already cached this key at the "30" fallback. Without an explicit invalidation this test
    // reads that cached 30 and passes for the wrong reason — it would pass identically against a
    // hardcoded literal, which is exactly what it exists to rule out.
    const { invalidatePolicyCacheKey } = await import("../../policy-engine/policy-engine.cache.js");
    invalidatePolicyCacheKey("exit", "notice", "default_notice_days");

    calls = [];
    dbExecute.mockReset();
    dbExecute.mockImplementation(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql: String(sql), params });
      if (/SELECT id FROM exit_request/.test(sql)) return [[], []];
      if (/FROM exit_request er/.test(sql)) return [[EXIT_ROW], []];
      if (/INSERT INTO exit_request/.test(sql)) return [{ affectedRows: 1 }, []];
      // The company changes its standard notice period to 45 days in business_policy_config.
      if (/FROM business_policy_config/.test(sql)) return [[{ config_value: "45" }], []];
      return [[], []];
    });

    const { exitService } = await import("../exit.service.js");
    await exitService.createExitRequest(
      { employeeId: "emp-1", exitDate: "2026-11-30", exitType: "voluntary" },
      "actor-1"
    );

    // Effective-dated and changeable without a deploy — the whole reason this is not a literal.
    expect(insertedNoticeDays()).toBe(45);
  });
});
