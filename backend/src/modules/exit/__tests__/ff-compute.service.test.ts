/**
 * ff-compute.service.ts — Phase 1 F&F compute/preview engine.
 *
 * Every component must be tagged computed/not_applicable/pending_configuration and
 * never invent a rate that isn't actually configured (same discipline calculateTds/
 * calculateGratuity already apply). This is a read-only derivation layer — it writes
 * nothing; createFF's own validation (ffComponentSum/FF_NET_TOLERANCE) is untouched
 * and covered by ff-net-payable-reconciliation.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { getPolicyValue } = vi.hoisted(() => ({ getPolicyValue: vi.fn() }));
vi.mock("../../policy-engine/policy-engine.cache.js", () => ({ getPolicyValue }));

const { getBalance } = vi.hoisted(() => ({ getBalance: vi.fn() }));
vi.mock("../../leave/leave.service.js", () => ({ leaveService: { getBalance } }));

const { calculateGratuityFromEmployee, getPayrollAlreadyPaid } = vi.hoisted(() => ({
  calculateGratuityFromEmployee: vi.fn(),
  getPayrollAlreadyPaid: vi.fn(),
}));
vi.mock("../ff.service.js", () => ({
  ffService: { calculateGratuityFromEmployee, getPayrollAlreadyPaid },
}));

const { computeFfPreview } = await import("../ff-compute.service.js");

const EMPLOYEE_ID = "11111111-1111-1111-1111-111111111111";
const EXIT_REQUEST_ID = "22222222-2222-2222-2222-222222222222";

/** Routes db.execute by inspecting the SQL text — safe against Promise.all's call ordering. */
function mockDb(overrides: {
  exitRequest?: Record<string, unknown> | null;
  salary?: { ctc_annual: number } | null;
  notice?: Record<string, unknown> | null;
  encashmentDivisor?: string | null;
  advancesOutstanding?: number;
  loansOutstanding?: number;
}) {
  execute.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM exit_request er") && sql.includes("last_working_day")) {
      return [overrides.notice ? [overrides.notice] : []];
    }
    if (sql.includes("SELECT id, employee_id FROM exit_request")) {
      return [overrides.exitRequest === null ? [] : [overrides.exitRequest ?? { id: EXIT_REQUEST_ID, employee_id: EMPLOYEE_ID }]];
    }
    if (sql.includes("FROM employee_salary_assignment esa")) {
      return [overrides.salary === null ? [] : [overrides.salary ?? { ctc_annual: 600000 }]];
    }
    if (sql.includes("leave_encashment_day_divisor")) {
      return [overrides.encashmentDivisor === null || overrides.encashmentDivisor === undefined ? [] : [{ config_value: overrides.encashmentDivisor }]];
    }
    if (sql.includes("FROM salary_advance_log")) {
      return [[{ outstanding: overrides.advancesOutstanding ?? 0 }]];
    }
    if (sql.includes("FROM employee_loans")) {
      return [[{ outstanding: overrides.loansOutstanding ?? 0 }]];
    }
    throw new Error(`Unexpected query in test: ${sql.slice(0, 80)}`);
  });
}

const DEFAULT_GRATUITY = { amount: 40000, status: "draft" as const, note: "computed" };
const DEFAULT_NOTICE_ROW = {
  employee_id: EMPLOYEE_ID,
  notice_period_days: 30,
  submitted_at: "2026-06-01",
  last_working_day: "2026-06-20",
  served_days: 19,
};

beforeEach(() => {
  execute.mockReset();
  getPolicyValue.mockReset().mockResolvedValue("26");
  getBalance.mockReset().mockResolvedValue([{ leave_code: "EL", available_days: 12 }]);
  calculateGratuityFromEmployee.mockReset().mockResolvedValue(DEFAULT_GRATUITY);
  getPayrollAlreadyPaid.mockReset().mockResolvedValue([]);
});

describe("computeFfPreview — notice pay", () => {
  it("is pending_configuration when notice_period_days is 0 — ambiguous, not a real zero", async () => {
    mockDb({ notice: { ...DEFAULT_NOTICE_ROW, notice_period_days: 0 } });
    const preview = await computeFfPreview(EXIT_REQUEST_ID);
    expect(preview.notice.required_days.status).toBe("pending_configuration");
    expect(preview.notice.shortfall_days.status).toBe("pending_configuration");
    expect(preview.notice.recovery_amount.value).toBe(0);
  });

  it("computes zero shortfall when served >= required", async () => {
    mockDb({ notice: { ...DEFAULT_NOTICE_ROW, notice_period_days: 15, served_days: 20 } });
    const preview = await computeFfPreview(EXIT_REQUEST_ID);
    expect(preview.notice.shortfall_days.status).toBe("computed");
    expect(preview.notice.shortfall_days.value).toBe(0);
    expect(preview.notice.recovery_amount.value).toBe(0);
  });

  it("computes shortfall days and recovery amount when served < required", async () => {
    mockDb({ notice: DEFAULT_NOTICE_ROW, salary: { ctc_annual: 312000 } }); // gross monthly 26000
    const preview = await computeFfPreview(EXIT_REQUEST_ID);
    expect(preview.notice.shortfall_days.value).toBe(11); // 30 - 19
    expect(preview.notice.per_day_rate.value).toBe(1000); // 26000 / 26
    expect(preview.notice.recovery_amount.status).toBe("computed");
    expect(preview.notice.recovery_amount.value).toBe(11000); // 11 * 1000
  });

  it("propagates pending_configuration when no active salary assignment exists", async () => {
    mockDb({ notice: DEFAULT_NOTICE_ROW, salary: null });
    const preview = await computeFfPreview(EXIT_REQUEST_ID);
    expect(preview.notice.per_day_rate.status).toBe("pending_configuration");
    expect(preview.notice.recovery_amount.status).toBe("pending_configuration");
  });
});

describe("computeFfPreview — leave encashment", () => {
  it("computes an amount when the EL balance and rate are both available", async () => {
    mockDb({ notice: DEFAULT_NOTICE_ROW, salary: { ctc_annual: 312000 }, encashmentDivisor: "26" });
    getBalance.mockResolvedValue([{ leave_code: "EL", available_days: 10 }]);
    const preview = await computeFfPreview(EXIT_REQUEST_ID);
    expect(preview.leave_encashment.amount.status).toBe("computed");
    expect(preview.leave_encashment.amount.value).toBe(10000); // (26000/26) * 10
  });

  it("is pending_configuration and names the missing key when the rate isn't configured", async () => {
    mockDb({ notice: DEFAULT_NOTICE_ROW, salary: { ctc_annual: 312000 }, encashmentDivisor: null });
    const preview = await computeFfPreview(EXIT_REQUEST_ID);
    expect(preview.leave_encashment.amount.status).toBe("pending_configuration");
    expect(preview.leave_encashment.amount.note).toMatch(/leave_encashment_day_divisor/);
  });

  it("is not_applicable, not pending_configuration, when there's no EL row at all", async () => {
    mockDb({ notice: DEFAULT_NOTICE_ROW, salary: { ctc_annual: 312000 } });
    getBalance.mockResolvedValue([{ leave_code: "CL", available_days: 5 }]);
    const preview = await computeFfPreview(EXIT_REQUEST_ID);
    expect(preview.leave_encashment.amount.status).toBe("not_applicable");
  });
});

describe("computeFfPreview — advances/loans full payoff", () => {
  it("sums the full outstanding balance, not an installment", async () => {
    // Chosen so full-balance and installment sums are visibly different — if this
    // regressed to the installment query the assertion below would fail.
    mockDb({ notice: DEFAULT_NOTICE_ROW, salary: { ctc_annual: 312000 }, advancesOutstanding: 18000, loansOutstanding: 7000 });
    const preview = await computeFfPreview(EXIT_REQUEST_ID);
    expect(preview.advances_loans.salary_advances_outstanding).toBe(18000);
    expect(preview.advances_loans.employee_loans_outstanding).toBe(7000);
    expect(preview.advances_loans.total_recovery.value).toBe(25000);
    expect(preview.advances_loans.total_recovery.status).toBe("computed");
  });

  it("a zero-row sum is a legitimate computed zero, not a config gap", async () => {
    mockDb({ notice: DEFAULT_NOTICE_ROW, salary: { ctc_annual: 312000 } });
    const preview = await computeFfPreview(EXIT_REQUEST_ID);
    expect(preview.advances_loans.total_recovery.status).toBe("computed");
    expect(preview.advances_loans.total_recovery.value).toBe(0);
  });

  it("degrades non-fatally when employee_loans query throws", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT id, employee_id FROM exit_request")) return [[{ id: EXIT_REQUEST_ID, employee_id: EMPLOYEE_ID }]];
      if (sql.includes("FROM exit_request er")) return [[DEFAULT_NOTICE_ROW]];
      if (sql.includes("FROM employee_salary_assignment esa")) return [[{ ctc_annual: 312000 }]];
      if (sql.includes("leave_encashment_day_divisor")) return [[]];
      if (sql.includes("FROM salary_advance_log")) return [[{ outstanding: 5000 }]];
      if (sql.includes("FROM employee_loans")) throw new Error("table does not exist");
      throw new Error(`Unexpected query: ${sql.slice(0, 80)}`);
    });
    const preview = await computeFfPreview(EXIT_REQUEST_ID);
    expect(preview.advances_loans.employee_loans_outstanding).toBe(0);
    expect(preview.advances_loans.salary_advances_outstanding).toBe(5000);
    expect(preview.advances_loans.total_recovery.status).toBe("computed");
  });
});

describe("computeFfPreview — gratuity and payroll-overlap passthrough", () => {
  it("delegates gratuity to ffService.calculateGratuityFromEmployee with the resolved last working day", async () => {
    mockDb({ notice: DEFAULT_NOTICE_ROW, salary: { ctc_annual: 312000 } });
    const preview = await computeFfPreview(EXIT_REQUEST_ID);
    expect(calculateGratuityFromEmployee).toHaveBeenCalledWith(EMPLOYEE_ID, DEFAULT_NOTICE_ROW.last_working_day);
    expect(preview.gratuity).toEqual(DEFAULT_GRATUITY);
  });

  it("passes payroll_already_paid through from ffService", async () => {
    mockDb({ notice: DEFAULT_NOTICE_ROW, salary: { ctc_annual: 312000 } });
    getPayrollAlreadyPaid.mockResolvedValue([{ run_month: "2026-06", run_status: "processing", gross_salary: 1, net_salary: 1, paid_working_days: 1 }]);
    const preview = await computeFfPreview(EXIT_REQUEST_ID);
    expect(preview.payroll_already_paid).toHaveLength(1);
  });
});

describe("computeFfPreview — exit request not found", () => {
  it("throws a 404-tagged error", async () => {
    mockDb({ exitRequest: null });
    await expect(computeFfPreview(EXIT_REQUEST_ID)).rejects.toMatchObject({ statusCode: 404 });
  });
});
