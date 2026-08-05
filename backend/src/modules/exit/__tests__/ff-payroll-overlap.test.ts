import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F&F settlement had no visibility into payroll already paid for the same period.
 * Nothing in modules/exit referenced salary_prep_line or salary_prep_run at all,
 * so whoever prepared a settlement could key pending salary into salary_hold by
 * hand for a month payroll had already paid.
 *
 * This is surfaced rather than blocked, on purpose. A mid-month leaver belongs in
 * both: that month's run pays their pro-rated salary to the last working day, and
 * F&F settles the separate final dues (leave encashment, gratuity, notice
 * recovery). Refusing F&F whenever a payroll line overlaps would reject the normal
 * case — the original audit recommendation was wrong on that point and is
 * corrected here.
 *
 * Verified against production before shipping: the query returns two prior months
 * of real payments for an employee with paid lines, and an empty list where there
 * are none — i.e. it is not a no-op.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));
vi.mock("../../payroll/payrollCalculate.service.js", () => ({ calculateGratuity: vi.fn() }));
vi.mock("../exit.notifications.js", () => ({ notifyFullFinalReady: vi.fn() }));

import { ffService } from "../ff.service.js";

const EMPLOYEE_ID = "11111111-1111-1111-1111-111111111111";
const EXIT_REQUEST_ID = "22222222-2222-2222-2222-222222222222";

const FF_ROW = {
  id: "ff-1",
  exit_request_id: EXIT_REQUEST_ID,
  employee_id: EMPLOYEE_ID,
  calculation_date: "2026-07-28",
  salary_hold: 0,
  status: "draft",
  is_ff_provisional: 1,
};

const PAID_LINES = [
  { run_month: "2026-07", run_status: "processing", gross_salary: 62009.81, net_salary: 58786.07, paid_working_days: 15 },
  { run_month: "2026-06", run_status: "processing", gross_salary: 80096.0, net_salary: 75932.0, paid_working_days: 30 },
];

describe("getFF surfaces payroll already paid over the settlement window", () => {
  beforeEach(() => execute.mockReset());

  it("attaches the payroll lines already raised for the employee", async () => {
    execute.mockResolvedValueOnce([[FF_ROW]]).mockResolvedValueOnce([PAID_LINES]);

    const ff = await ffService.getFF(EXIT_REQUEST_ID);

    expect(ff.payroll_already_paid).toHaveLength(2);
    expect(ff.payroll_already_paid?.[0].run_month).toBe("2026-07");
    expect(ff.payroll_already_paid?.[0].net_salary).toBe(58786.07);
  });

  it("does not block or alter the settlement — overlap is informational", async () => {
    execute.mockResolvedValueOnce([[FF_ROW]]).mockResolvedValueOnce([PAID_LINES]);

    // A mid-month leaver legitimately appears in both. getFF must still return the
    // record rather than throwing, and must not silently adjust any figure.
    const ff = await ffService.getFF(EXIT_REQUEST_ID);

    expect(ff.status).toBe("draft");
    expect(ff.salary_hold).toBe(0);
  });

  it("returns an empty list, not an error, when no payroll overlaps", async () => {
    execute.mockResolvedValueOnce([[FF_ROW]]).mockResolvedValueOnce([[]]);

    const ff = await ffService.getFF(EXIT_REQUEST_ID);

    expect(ff.payroll_already_paid).toEqual([]);
  });
});

describe("the overlap query only counts money actually paid", () => {
  beforeEach(() => execute.mockReset());

  it("excludes draft/cancelled runs and excluded/blocked lines, and bounds the window to three months", async () => {
    execute.mockResolvedValueOnce([[]]);

    await ffService.getPayrollAlreadyPaid(EMPLOYEE_ID, "2026-07-28");

    const [sql, params] = execute.mock.calls[0];
    // Nothing has been paid out of a draft or cancelled run, and an excluded or
    // blocked line is not a payment either — counting them would produce false
    // warnings on every settlement.
    expect(sql).toMatch(/LOWER\(spl\.status\) NOT IN \('excluded', 'blocked'\)/);
    expect(sql).toMatch(/LOWER\(spr\.status\) NOT IN \('draft', 'cancelled'\)/);
    expect(sql).toMatch(/DATE_SUB\(\?, INTERVAL 2 MONTH\)/);
    expect(params).toEqual([EMPLOYEE_ID, "2026-07-28", "2026-07-28"]);
  });
});
