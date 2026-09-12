import { describe, expect, it, vi } from "vitest";

/**
 * Absconding: the last date actually worked is the last working day — not that date + 7.
 *
 * THE DEFECT (two halves, both money)
 *
 * 1. The date was collected and discarded. The New Exit Request form has demanded
 *    "Absconding Since" as a MANDATORY field since it was written. submitRequest() never sent
 *    it, createExitRequestSchema had no field to accept it, and exit_request had no column to
 *    hold it. HR was forced to enter a date that reached nothing.
 *
 * 2. Its only effect was to overpay. The form set
 *        lastWorkingDayProposed = abscondingSince + 7 days
 *    labelled "Grace period ends". last_working_day_proposed is the FIRST term in payroll's
 *    employment-end-date resolver (payroll/employment-end-date.ts), and payableThrough() caps a
 *    leaver's payable days at it. So every absconding exit paid the employee for seven days
 *    after they stopped turning up, and on the exit transition would stamp
 *    employees.date_of_exit a week late too.
 *
 * Owner ruling 2026-09-12: the 7 days is how long the company WAITS before deciding somebody
 * has absconded. It is not paid employment. Their last working day is the last day they
 * actually worked.
 *
 * Enforced in the service rather than only in the form, so the API and the UI cannot disagree
 * about when an absconder stopped being employed.
 */

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: dbExecute,
    query: dbExecute,
    getConnection: vi.fn(async () => ({
      execute: dbExecute,
      query: dbExecute,
      beginTransaction: vi.fn(async () => undefined),
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined),
      release: vi.fn(() => undefined),
    })),
  },
}));
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
vi.mock("../../../shared/sessionRevocation.js", () => ({ revokeSessionsForEmployee: vi.fn() }));
vi.mock("../../../shared/employeeDeprovisioning.js", () => ({ deprovisionEmployeeAccess: vi.fn() }));
vi.mock("../../management/manager-attribution.service.js", () => ({ recordManagerChange: vi.fn() }));
vi.mock("../exit-followup-recovery.js", () => ({ recordExitFollowUpFailure: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: vi.fn() }) } }));

type Call = { sql: string; params: unknown[] };
let calls: Call[];

function mockDb() {
  calls = [];
  dbExecute.mockReset();
  dbExecute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql: String(sql), params });
    if (/SELECT id FROM exit_request/.test(sql)) return [[], []];       // no open exit
    if (/FROM exit_request er/.test(sql)) return [[{ id: "e1", employee_id: "emp-1" }], []];
    if (/INSERT INTO exit_request/.test(sql)) return [{ affectedRows: 1 }, []];
    if (/FROM business_policy_config/.test(sql)) return [[], []];       // unseeded -> fallback
    return [[], []];
  });
}

const insert = () => calls.find((c) => /INSERT INTO exit_request/.test(c.sql))!;

/**
 * Value bound to a named column, resolved from the INSERT's own column list.
 *
 * Not a hardcoded parameter index: adding absconding_since to this statement shifted every
 * column after it by one and quietly broke the positional assertions in the sibling
 * notice-terms suite, which carried on looking like a passing notice-period test while
 * comparing the wrong value. NOW() is inlined rather than bound, so placeholders and columns
 * are not 1:1 — count the `?` entries before the target column.
 */
function insertedValueFor(column: string): unknown {
  const { sql, params } = insert();
  const columnList = /INSERT INTO exit_request\s*\(([\s\S]*?)\)\s*VALUES/i.exec(sql)?.[1] ?? "";
  const valuesList = /VALUES\s*\(([\s\S]*?)\)/i.exec(sql)?.[1] ?? "";
  const columns = columnList.split(",").map((c) => c.trim());
  const values = valuesList.split(",").map((v) => v.trim());
  const idx = columns.indexOf(column);
  expect(idx, `INSERT does not name column "${column}"`).toBeGreaterThan(-1);
  expect(values[idx], `column "${column}" is not a bound parameter`).toBe("?");
  return params[values.slice(0, idx).filter((v) => v === "?").length];
}

const insertedAbscondingSince = () => insertedValueFor("absconding_since");
const insertedProposedLwd = () => insertedValueFor("last_working_day_proposed");
const insertedNoticeDays = () => insertedValueFor("notice_period_days");

const LAST_WORKED = "2026-10-01";

describe("createExitRequest — absconding date is stored", () => {
  it("persists the last-worked date instead of discarding it", async () => {
    mockDb();
    const { exitService } = await import("../exit.service.js");
    await exitService.createExitRequest(
      {
        employeeId: "emp-1", exitDate: LAST_WORKED, exitType: "involuntary",
        exitSubType: "absconding", abscondingSince: LAST_WORKED,
      },
      "actor-hr"
    );

    expect(insert().sql).toMatch(/absconding_since/);
    expect(insertedAbscondingSince()).toBe(LAST_WORKED);
  });

  it("leaves it null for an ordinary resignation", async () => {
    mockDb();
    const { exitService } = await import("../exit.service.js");
    await exitService.createExitRequest(
      { employeeId: "emp-1", exitDate: "2026-10-31", exitType: "voluntary" },
      "actor-1"
    );

    expect(insertedAbscondingSince()).toBeNull();
  });
});

describe("createExitRequest — absconding is not paid through a grace period", () => {
  it("sets the proposed last working day to the last worked date, not +7 days", async () => {
    mockDb();
    const { exitService } = await import("../exit.service.js");
    // The caller passes a +7 exitDate, exactly as the old form did. The service must override it.
    await exitService.createExitRequest(
      {
        employeeId: "emp-1", exitDate: "2026-10-08", exitType: "involuntary",
        exitSubType: "absconding", abscondingSince: LAST_WORKED,
      },
      "actor-hr"
    );

    expect(insertedProposedLwd()).toBe(LAST_WORKED);
    // 7 days of pay for days nobody worked, on every absconding exit, is the bug.
    expect(insertedProposedLwd()).not.toBe("2026-10-08");
  });

  it("applies the same rule to abandonment", async () => {
    mockDb();
    const { exitService } = await import("../exit.service.js");
    await exitService.createExitRequest(
      {
        employeeId: "emp-1", exitDate: "2026-10-20", exitType: "involuntary",
        exitSubType: "abandonment", abscondingSince: LAST_WORKED,
      },
      "actor-hr"
    );

    expect(insertedProposedLwd()).toBe(LAST_WORKED);
  });

  it("does not touch the proposed last working day for a resignation", async () => {
    mockDb();
    const { exitService } = await import("../exit.service.js");
    // A resigning employee proposes a future LWD and serves notice; nothing may rewrite it.
    await exitService.createExitRequest(
      { employeeId: "emp-1", exitDate: "2026-11-30", exitType: "voluntary" },
      "actor-1"
    );

    expect(insertedProposedLwd()).toBe("2026-11-30");
  });

  it("falls back to the supplied exit date when no absconding date is given", async () => {
    mockDb();
    const { exitService } = await import("../exit.service.js");
    // Defensive: the schema refuses this combination, but the service must not produce
    // undefined for a NOT-NULL-ish date column if reached another way.
    await exitService.createExitRequest(
      {
        employeeId: "emp-1", exitDate: "2026-10-09", exitType: "involuntary",
        exitSubType: "absconding",
      },
      "actor-hr"
    );

    expect(insertedProposedLwd()).toBe("2026-10-09");
    expect(insertedAbscondingSince()).toBeNull();
  });

  it("gives an absconding exit no notice period", async () => {
    mockDb();
    const { exitService } = await import("../exit.service.js");
    await exitService.createExitRequest(
      {
        employeeId: "emp-1", exitDate: LAST_WORKED, exitType: "involuntary",
        exitSubType: "absconding", abscondingSince: LAST_WORKED,
      },
      "actor-hr"
    );

    // A 30-day default here would make ff-compute derive a 30-day shortfall and recover it
    // from the settlement, for notice nobody ever asked this person to serve.
    expect(insertedNoticeDays()).toBe(0);
  });
});

describe("createExitRequestSchema — the absconding date is mandatory server-side", () => {
  it("refuses an absconding exit with no last-worked date", async () => {
    const { createExitRequestSchema } = await import("../exit.validation.js");
    const result = createExitRequestSchema.safeParse({
      employeeId: "11111111-1111-1111-1111-111111111111",
      exitType: "involuntary",
      exitSubType: "absconding",
      lastWorkingDayProposed: "2026-10-08",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toMatch(/abscondingSince/);
    }
  });

  it("accepts it when the date is supplied, in either spelling", async () => {
    const { createExitRequestSchema } = await import("../exit.validation.js");
    const base = {
      employeeId: "11111111-1111-1111-1111-111111111111",
      exitType: "involuntary" as const,
      exitSubType: "absconding" as const,
      lastWorkingDayProposed: LAST_WORKED,
    };

    const camel = createExitRequestSchema.safeParse({ ...base, abscondingSince: LAST_WORKED });
    expect(camel.success).toBe(true);
    if (camel.success) expect(camel.data.abscondingSince).toBe(LAST_WORKED);

    const snake = createExitRequestSchema.safeParse({ ...base, absconding_since: LAST_WORKED });
    expect(snake.success).toBe(true);
    if (snake.success) expect(snake.data.abscondingSince).toBe(LAST_WORKED);
  });

  it("does not demand it for a resignation", async () => {
    const { createExitRequestSchema } = await import("../exit.validation.js");
    const result = createExitRequestSchema.safeParse({
      employeeId: "11111111-1111-1111-1111-111111111111",
      exitType: "voluntary",
      lastWorkingDayProposed: "2026-11-30",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a malformed date", async () => {
    const { createExitRequestSchema } = await import("../exit.validation.js");
    const result = createExitRequestSchema.safeParse({
      employeeId: "11111111-1111-1111-1111-111111111111",
      exitType: "involuntary",
      exitSubType: "absconding",
      abscondingSince: "01/10/2026",
      lastWorkingDayProposed: LAST_WORKED,
    });

    expect(result.success).toBe(false);
  });
});
