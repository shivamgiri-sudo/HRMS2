/**
 * runPayrollWindowClosure auto-locks any run past its window_close_date with
 * no check of approved_by/finance_approved_by/ceo_acknowledged_by/
 * validated_by — by design, per the module's own stated purpose (a
 * window-closing warning fires WINDOW_CLOSING_LEAD_DAYS earlier, so the
 * deadline itself is not a surprise). Root-caused during the Payroll Run
 * audit; the auto-close behaviour is unchanged by this fix.
 *
 * What was missing: a way to tell, after the fact, whether a given
 * auto-closure happened to a run someone had actually signed off on, or to
 * one nobody ever approved at all — both were audited identically. Fixed by
 * recording a distinct action_type (payroll_window_auto_closed_without_approval)
 * and a had_no_approval flag when none of the four approval columns are set.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDb = { execute: vi.fn() };
vi.mock("../../../db/mysql.js", () => ({ db: mockDb }));

const mockLogSensitiveAction = vi.fn(async () => {});
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: mockLogSensitiveAction }));

vi.mock("../../leave/leave.service.js", () => ({
  leaveService: { lapseUnresolvedLeaves: vi.fn(async () => {}) },
}));
vi.mock("../payroll.notifications.js", () => ({
  notifyPayrollWindowClosing: vi.fn(async () => {}),
}));

const { runPayrollWindowClosure } = await import("../payroll-window.cron.js");

function run(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "run-1",
    run_month: "2026-06",
    status: "draft",
    approved_by: null,
    finance_approved_by: null,
    ceo_acknowledged_by: null,
    validated_by: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.execute.mockImplementation(async (sql: string) => {
    if (/FROM salary_prep_run/.test(sql) && /window_close_date IS NOT NULL/.test(sql)) return [[], []];
    if (/FROM salary_prep_line WHERE run_id/.test(sql)) return [[], []];
    return [[{ affectedRows: 1 }], []];
  });
});

describe("runPayrollWindowClosure records whether an auto-closed run had any approval", () => {
  it("flags had_no_approval and uses the distinct action_type when nothing was ever approved", async () => {
    mockDb.execute.mockImplementation(async (sql: string) => {
      if (/FROM salary_prep_run/.test(sql) && /window_close_date IS NOT NULL/.test(sql)) return [[run()], []];
      if (/FROM salary_prep_line WHERE run_id/.test(sql)) return [[], []];
      return [[{ affectedRows: 1 }], []];
    });

    await runPayrollWindowClosure();

    expect(mockLogSensitiveAction).toHaveBeenCalledTimes(1);
    const entry = mockLogSensitiveAction.mock.calls[0][0];
    expect(entry.action_type).toBe("payroll_window_auto_closed_without_approval");
    expect(entry.change_summary.had_no_approval).toBe(true);
  });

  it("still locks the run the same way regardless of approval state — this fix changes visibility, not behaviour", async () => {
    mockDb.execute.mockImplementation(async (sql: string) => {
      if (/FROM salary_prep_run/.test(sql) && /window_close_date IS NOT NULL/.test(sql)) return [[run()], []];
      if (/FROM salary_prep_line WHERE run_id/.test(sql)) return [[], []];
      return [[{ affectedRows: 1 }], []];
    });

    await runPayrollWindowClosure();

    const updateCall = mockDb.execute.mock.calls.find(([sql]) => /UPDATE salary_prep_run/.test(sql));
    expect(updateCall).toBeDefined();
    expect(updateCall![0]).toMatch(/SET status = 'locked', auto_closed_at = NOW\(\), closed_by = 'system'/);
  });

  it("uses the ordinary action_type and had_no_approval=false when the run was properly approved", async () => {
    mockDb.execute.mockImplementation(async (sql: string) => {
      if (/FROM salary_prep_run/.test(sql) && /window_close_date IS NOT NULL/.test(sql))
        return [[run({ finance_approved_by: "finance-user" })], []];
      if (/FROM salary_prep_line WHERE run_id/.test(sql)) return [[], []];
      return [[{ affectedRows: 1 }], []];
    });

    await runPayrollWindowClosure();

    const entry = mockLogSensitiveAction.mock.calls[0][0];
    expect(entry.action_type).toBe("payroll_window_auto_closed");
    expect(entry.change_summary.had_no_approval).toBe(false);
  });

  it("a single approval marker (any one of the four) is enough to count as approved", async () => {
    mockDb.execute.mockImplementation(async (sql: string) => {
      if (/FROM salary_prep_run/.test(sql) && /window_close_date IS NOT NULL/.test(sql))
        return [[run({ validated_by: "head-payroll-user" })], []];
      if (/FROM salary_prep_line WHERE run_id/.test(sql)) return [[], []];
      return [[{ affectedRows: 1 }], []];
    });

    await runPayrollWindowClosure();

    expect(mockLogSensitiveAction.mock.calls[0][0].change_summary.had_no_approval).toBe(false);
  });
});
