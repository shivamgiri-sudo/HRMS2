import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));
vi.mock("../../engagement/badge.service.js", () => ({ queueAutoAwards: vi.fn() }));

import { foldLegacyLineIntoYtd, foldLegacySnapshotIntoYtd, payslipService } from "../payslip.service.js";

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
      ], []])
      // 4) legacy snapshots: none
      .mockResolvedValueOnce([[], []]);

    const ytd = await payslipService.getYtdComponentsByType("emp-1", "2026-06");
    expect(ytd.earning.BASIC).toBe(18000 + 15000 * 2); // June components + Apr/May legacy lines, June line NOT double counted
    expect(ytd.earning.HRA).toBe(12000);
    expect(ytd.deduction.PF_EMPLOYEE).toBe(3600);

    const [, params] = execute.mock.calls[2];
    expect(params).toEqual(["", "emp-1", "2026-04", "2026-06", ""]); // FY start April, inclusive of the payslip month
    expect(String(execute.mock.calls[2][0])).toContain("PARTITION BY spr.run_month"); // one canonical line per month
  });

  it("always counts the viewed line even when its run is not finalized (new joiner / pre-finalisation slip)", async () => {
    execute.mockResolvedValue([[], []]);
    await payslipService.getYtdComponentsByType("emp-1", "2026-08", "line-aug");
    for (const idx of [0, 1, 2]) {
      const [sql, params] = execute.mock.calls[idx];
      expect(String(sql)).toContain("OR spl.id = ?");
      expect(params).toContain("line-aug");
    }
    // its own line outranks any run-status ordering within the month
    expect(String(execute.mock.calls[0][0])).toContain("ORDER BY (spl.id = ?) DESC, FIELD(spr.status");
  });

  it("empty everywhere stays empty (the PDF then prints zeros, not a crash)", async () => {
    execute.mockResolvedValue([[], []]);
    expect(await payslipService.getYtdComponentsByType("emp-1", "2026-01")).toEqual({});
    expect(execute.mock.calls[0][1]).toEqual(["", "emp-1", "2025-04", "2026-01", ""]); // Jan belongs to the FY that began the previous April
  });
});

describe("legacy_payslip_snapshot months (payslips with no run_id)", () => {
  beforeEach(() => execute.mockReset());

  it("maps a snapshot month to the codes the V2 slip slots by", () => {
    const ytd: Record<string, Record<string, number>> = {};
    foldLegacySnapshotIntoYtd(ytd, {
      run_month: "2026-05", basic: 10000, hra: 4000, conveyance: 800, portfolio: 500, medical_allowance: 1250,
      special_allowance: 2000, bonus: 0, lta: 300, other_allowance: 100, epf_employee: 1200, esic_employee: 150,
      income_tax: 400, leave_deduction: 250, loan_deduction: 0, advance_paid: 1000, professional_tax: 200, other_deduction: 75,
    });
    expect(ytd.earning).toMatchObject({ BASIC: 10000, HRA: 4000, CONVEYANCE: 800, PORTFOLIO: 500, MEDICAL_ALLOWANCE: 1250, SPECIAL: 2000, LTA: 300, OTHER_ALLOWANCE: 100 });
    expect(ytd.earning.BONUS).toBeUndefined();
    expect(ytd.deduction).toMatchObject({ PF_EMPLOYEE: 1200, ESIC_EMPLOYEE: 150, TDS: 400, LWP_DEDUCTION: 250, ADVANCE: 1000, PROFESSIONAL_TAX: 200, OTHER_DEDUCTION: 75 });
  });

  it("YTD for a legacy month (no run at all) is built from snapshots across the FY, skipping months a modern run covers", async () => {
    execute
      .mockResolvedValueOnce([[], []])                                // components: none
      .mockResolvedValueOnce([[], []])                                // covered months: none
      .mockResolvedValueOnce([[{ run_month: "2026-06", gross_salary: 30000, basic: 15000 }], []]) // modern salary line for June
      .mockResolvedValueOnce([[
        { run_month: "2026-04", basic: 10000, hra: 4000, epf_employee: 1200 },
        { run_month: "2026-05", basic: 10000, hra: 4000, epf_employee: 1200 },
        { run_month: "2026-06", basic: 9999, hra: 9999, epf_employee: 9999 }, // overlaps the modern June line: must be ignored
      ], []]);
    const ytd = await payslipService.getYtdComponentsByType("emp-1", "2026-06");
    expect(ytd.earning.BASIC).toBe(15000 + 10000 + 10000); // June (salary line) + Apr + May snapshots
    expect(ytd.earning.HRA).toBe(8000);
    expect(ytd.deduction.PF_EMPLOYEE).toBe(2400);
    expect(String(execute.mock.calls[3][0])).toContain("FROM legacy_payslip_snapshot");
    expect(execute.mock.calls[3][1]).toEqual(["emp-1", "2026-04", "2026-06"]);
  });

  it("a missing legacy table (fresh schema) is ignored, not fatal", async () => {
    execute
      .mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[], []])
      .mockRejectedValueOnce(Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE", errno: 1146 }));
    expect(await payslipService.getYtdComponentsByType("emp-1", "2026-06")).toEqual({});
  });

  it("getYtdForEmployee returns the flat map and the per-side map the slip reads", async () => {
    execute
      .mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ run_month: "2026-04", basic: 10000, epf_employee: 1200 }], []]);
    const out = await payslipService.getYtdForEmployee("emp-1", "2026-04");
    expect(out.ytd).toEqual({ BASIC: 10000, PF_EMPLOYEE: 1200 });
    expect(out.ytd_by_type).toEqual({ earning: { BASIC: 10000 }, deduction: { PF_EMPLOYEE: 1200 } });
  });
});
