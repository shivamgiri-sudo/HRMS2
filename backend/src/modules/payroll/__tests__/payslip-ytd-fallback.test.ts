import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));
vi.mock("../../engagement/badge.service.js", () => ({ queueAutoAwards: vi.fn() }));

import { foldLegacyLineIntoYtd, payslipService } from "../payslip.service.js";

describe("foldLegacyLineIntoYtd", () => {
  it("maps salary-line columns to the engine's component codes, itemising only what exists", () => {
    const ytd: Record<string, Record<string, number>> = {};
    foldLegacyLineIntoYtd(ytd, {
      run_month: "2026-04", gross_salary: 30000, basic: 15000, hra: 6000, special_allowance: 4000,
      pf_employee: 1800, esic_employee: 0, professional_tax: 200, tds: 0, tds_amount: 500,
      lwp_deduction: 0, advance_recovery: 1000, loan_emi: 0, other_deductions: 50,
    });
    expect(ytd.earning).toEqual({ BASIC: 15000, HRA: 6000, SPECIAL: 4000, OTHER_EARNINGS: 5000 });
    expect(ytd.deduction).toEqual({
      PF_EMPLOYEE: 1800, PROFESSIONAL_TAX: 200, TDS: 500, ADVANCE_RECOVERY: 1000, OTHER_DEDUCTIONS: 50,
    });
  });

  it("accumulates across months and ignores zero/garbage values", () => {
    const ytd: Record<string, Record<string, number>> = {};
    foldLegacyLineIntoYtd(ytd, { run_month: "2026-04", gross_salary: 20000, basic: 10000, hra: "x", special_allowance: null });
    foldLegacyLineIntoYtd(ytd, { run_month: "2026-05", gross_salary: 20000, basic: 10000 });
    expect(ytd.earning.BASIC).toBe(20000);
    expect(ytd.earning.HRA).toBeUndefined();
    expect(ytd.earning.OTHER_EARNINGS).toBe(20000); // gross not itemised beyond basic
    expect(ytd.deduction).toBeUndefined();
  });
});

describe("getYtdComponentsByType legacy fallback", () => {
  beforeEach(() => execute.mockReset());

  it("adds salary-line totals for months WITHOUT component rows, never for months that have them", async () => {
    execute
      // 1) component sums (months 2026-06 only)
      .mockResolvedValueOnce([[{ component_code: "BASIC", component_type: "earning", amount: 18000 }], []])
      // 2) months covered by component rows
      .mockResolvedValueOnce([[{ run_month: "2026-06" }], []])
      // 3) canonical salary lines for the FY: April+May are legacy, June already counted via components
      .mockResolvedValueOnce([[
        { run_month: "2026-04", gross_salary: 30000, basic: 15000, hra: 6000, special_allowance: 4000, pf_employee: 1800 },
        { run_month: "2026-05", gross_salary: 30000, basic: 15000, hra: 6000, special_allowance: 4000, pf_employee: 1800 },
        { run_month: "2026-06", gross_salary: 30000, basic: 18000, hra: 7000, special_allowance: 5000, pf_employee: 1800 },
      ], []]);

    const ytd = await payslipService.getYtdComponentsByType("emp-1", "2026-06");
    expect(ytd.earning.BASIC).toBe(18000 + 15000 * 2); // June components + Apr/May legacy lines, June line NOT double counted
    expect(ytd.earning.HRA).toBe(12000);
    expect(ytd.deduction.PF_EMPLOYEE).toBe(3600);

    const [, params] = execute.mock.calls[2];
    expect(params).toEqual(["emp-1", "2026-04", "2026-06"]); // FY start April, inclusive of the payslip month
    expect(String(execute.mock.calls[2][0])).toContain("PARTITION BY spr.run_month"); // one canonical line per month
  });

  it("empty everywhere stays empty (the PDF then prints zeros, not a crash)", async () => {
    execute.mockResolvedValue([[], []]);
    expect(await payslipService.getYtdComponentsByType("emp-1", "2026-01")).toEqual({});
    expect(execute.mock.calls[0][1]).toEqual(["emp-1", "2025-04", "2026-01"]); // Jan belongs to the FY that began the previous April
  });
});
