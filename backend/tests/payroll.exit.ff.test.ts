/**
 * payroll.exit.ff.test.ts
 * Package 4 — Payslip, Tax Declaration, F&F, Gratuity, LWP/Working-days gaps
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/db/mysql.js", () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]) },
}));
vi.mock("../src/db/supabaseAdmin.js", () => ({
  supabaseAdmin: {},
  supabaseAuthClient: { auth: { getUser: vi.fn() } },
}));
vi.mock("../src/shared/auditLog.js", () => ({
  logSensitiveAction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../src/modules/engagement/badge.service.js", () => ({ queueAutoAwards: vi.fn() }));

import { db } from "../src/db/mysql.js";
import { logSensitiveAction } from "../src/shared/auditLog.js";
import { payslipService } from "../src/modules/payroll/payslip.service.js";
import { taxDeclarationService } from "../src/modules/payroll/taxDeclaration.service.js";
import { payrollGapsService } from "../src/modules/payroll/payrollGaps.service.js";
import { ffService } from "../src/modules/exit/ff.service.js";

const exec = db.execute as ReturnType<typeof vi.fn>;
const auditMock = logSensitiveAction as ReturnType<typeof vi.fn>;

const fakeRun = { id: "run-1", run_month: "2026-05", status: "approved" };
const fakeLine = {
  id: "line-1", run_id: "run-1", employee_id: "emp-1", employee_code: "MCN001",
  run_month: "2026-05",
  gross_salary: 25000, total_deductions: 2400, net_salary: 22600,
  pf_employee: 1200, esic_employee: 0, professional_tax: 200, tds: 0,
  working_days: 26, present_days: 24, lwp_days: 2,
};
const fakePayslip = {
  ...fakeLine,
  id: "ps-1",
  payslip_ref: "PS-2026-05-MCN001",
  generated_at: "2026-05-29T10:00:00Z", generated_by: "admin-1",
  file_url: null, acknowledged_at: null,
};
const fakeExit = { id: "exit-1", employee_id: "emp-1" };
const fakeFf = {
  id: "ff-1", exit_request_id: "exit-1", employee_id: "emp-1",
  calculation_date: "2026-05-29",
  notice_period_days: 30, notice_shortfall_days: 5,
  notice_recovery: 5000, earned_leave_encashment: 8000,
  gratuity_amount: 0, salary_hold: 0, advances_recovery: 0,
  net_payable: 3000, status: "draft",
  prepared_by: "hr-1", approved_by: null, approved_at: null,
  created_at: "2026-05-29T10:00:00Z", updated_at: "2026-05-29T10:00:00Z",
};
const fakeTaxDecl = {
  id: "td-1", employee_id: "emp-1", financial_year: "2026-2027",
  regime: "new", total_investment: 50000,
  declared_hra: 0, declared_80c: 50000, declared_80d: 0,
  tds_projected: 0, submitted_by: "emp-1",
  created_at: "2026-05-29T10:00:00Z", updated_at: "2026-05-29T10:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  auditMock.mockResolvedValue(undefined);
});

// ─── Payslip Generation ───────────────────────────────────────────────────────

describe("payslipService.generatePayslip", () => {
  it("fetches prep_line, inserts salary_payslip, logs audit, returns payslip", async () => {
    exec
      .mockResolvedValueOnce([[fakeLine], []])   // SELECT prep_line JOIN run
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])  // INSERT/ON DUPLICATE
      .mockResolvedValueOnce([[fakePayslip], []]); // getPayslip re-fetch

    const result = await payslipService.generatePayslip("run-1", "emp-1", "admin-1");

    expect(result.payslip_ref).toBe("PS-2026-05-MCN001");
    expect(result.employee_id).toBe("emp-1");

    // Audit log must be called
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: "PAYSLIP_GENERATED",
        module_key: "payroll",
        entity_id: "emp-1",
      })
    );
  });

  it("throws when prep_line not found", async () => {
    exec.mockResolvedValueOnce([[], []]);
    await expect(payslipService.generatePayslip("run-x", "emp-x", "admin-1"))
      .rejects.toThrow("Prep line not found");
  });
});

describe("payslipService.getPayslip", () => {
  it("returns merged payslip + prep_line data", async () => {
    exec.mockResolvedValueOnce([[fakePayslip], []]);
    const result = await payslipService.getPayslip("emp-1", "run-1");
    expect(result.gross_salary).toBe(25000);
    expect(result.net_salary).toBe(22600);
  });

  it("throws when payslip not found", async () => {
    exec.mockResolvedValueOnce([[], []]);
    await expect(payslipService.getPayslip("emp-x", "run-x"))
      .rejects.toThrow("Payslip not found");
  });
});

// ─── Payslip Acknowledgement ──────────────────────────────────────────────────

describe("payslipService.acknowledgePayslip", () => {
  it("allows employee to acknowledge own payslip (200)", async () => {
    exec
      .mockResolvedValueOnce([[{ ...fakePayslip, id: "ps-1" }], []])  // SELECT by id
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])                // UPDATE
      .mockResolvedValueOnce([[{ ...fakePayslip, acknowledged_at: "2026-05-29T11:00:00Z" }], []]); // re-fetch
    const result = await payslipService.acknowledgePayslip("ps-1", "emp-1");
    expect(result.acknowledged_at).toBeTruthy();
  });

  it("returns 403 when employee tries to acknowledge another employee payslip", async () => {
    exec.mockResolvedValueOnce([[{ ...fakePayslip, id: "ps-1", employee_id: "emp-1" }], []]);
    await expect(payslipService.acknowledgePayslip("ps-1", "emp-OTHER"))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it("throws when payslip not found", async () => {
    exec.mockResolvedValueOnce([[], []]);
    await expect(payslipService.acknowledgePayslip("ps-x", "emp-1"))
      .rejects.toThrow("Payslip not found");
  });
});

// ─── Tax Declaration ──────────────────────────────────────────────────────────

describe("taxDeclarationService.upsert", () => {
  it("upserts tax declaration and returns record", async () => {
    exec
      .mockResolvedValueOnce([[{ ctc_annual: 600000 }], []])  // salary assignment
      .mockResolvedValueOnce([[], []])                         // existing declaration lookup
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])        // INSERT declaration
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])        // INSERT Form 12BB detail
      .mockResolvedValueOnce([[fakeTaxDecl], []]);              // get re-fetch

    const result = await taxDeclarationService.upsert(
      "emp-1", "2026-2027",
      { regime: "new", declared80c: 50000, totalInvestment: 50000 },
      "emp-1"
    );
    expect(result.employee_id).toBe("emp-1");
    expect(result.financial_year).toBe("2026-2027");
  });

  it("computes zero TDS when taxable income below threshold", async () => {
    exec
      .mockResolvedValueOnce([[{ ctc_annual: 200000 }], []])  // ctc very low
      .mockResolvedValueOnce([[], []])                         // existing declaration lookup
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])        // INSERT declaration
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])        // INSERT Form 12BB detail
      .mockResolvedValueOnce([[{ ...fakeTaxDecl, tds_projected: 0 }], []]);

    const result = await taxDeclarationService.upsert(
      "emp-1", "2026-2027", {}, "emp-1"
    );
    expect(result.tds_projected).toBe(0);
  });
});

describe("taxDeclarationService.get", () => {
  it("returns tax declaration for employee and year", async () => {
    exec.mockResolvedValueOnce([[fakeTaxDecl], []]);
    const result = await taxDeclarationService.get("emp-1", "2026-2027");
    expect(result.regime).toBe("new");
    expect(result.declared_80c).toBe(50000);
  });

  it("throws when not found", async () => {
    exec.mockResolvedValueOnce([[], []]);
    await expect(taxDeclarationService.get("emp-x", "2026-2027"))
      .rejects.toThrow("Tax declaration not found");
  });
});

// ─── Full & Final ─────────────────────────────────────────────────────────────

describe("ffService.createFF", () => {
  it("creates F&F linked to exit_request and logs FULL_FINAL_CREATED audit", async () => {
    exec
      .mockResolvedValueOnce([[fakeExit], []])         // SELECT exit_request
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])// INSERT full_final_calculation
      .mockResolvedValueOnce([[fakeFf], []])            // getFF re-fetch (JOIN employees)
    ;

    const result = await ffService.createFF(
      "exit-1",
      {
        calculationDate: "2026-05-29",
        noticePeriodDays: 30,
        noticeShortfallDays: 5,
        noticeRecovery: 5000,
        earnedLeaveEncashment: 8000,
        netPayable: 3000,
      },
      "hr-1"
    );

    expect(result.exit_request_id).toBe("exit-1");
    expect(result.status).toBe("draft");
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: "FULL_FINAL_CREATED",
        module_key: "exit",
      })
    );
  });

  it("throws when exit_request not found", async () => {
    exec.mockResolvedValueOnce([[], []]);
    await expect(ffService.createFF("exit-x", { calculationDate: "2026-05-29" }, "hr-1"))
      .rejects.toThrow("Exit request not found");
  });
});

describe("ffService.getFF", () => {
  it("returns F&F with employee_name joined", async () => {
    exec.mockResolvedValueOnce([[{ ...fakeFf, employee_name: "John Doe" }], []]);
    const result = await ffService.getFF("exit-1");
    expect(result.employee_name).toBe("John Doe");
    expect(result.net_payable).toBe(3000);
  });

  it("throws when F&F not found", async () => {
    exec.mockResolvedValueOnce([[], []]);
    await expect(ffService.getFF("exit-x")).rejects.toThrow("F&F calculation not found");
  });
});

describe("ffService.approveFF", () => {
  it("approves F&F and logs FULL_FINAL_APPROVED audit", async () => {
    exec
      // is_ff_provisional = 0 so approval can proceed
      .mockResolvedValueOnce([[{ ...fakeFf, is_ff_provisional: 0 }], []])  // SELECT by id
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])                    // UPDATE
      .mockResolvedValueOnce([[{ ...fakeFf, status: "approved", approved_by: "admin-1" }], []]); // getFF

    const result = await ffService.approveFF("ff-1", "admin-1");
    expect(result.status).toBe("approved");
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: "FULL_FINAL_APPROVED",
        module_key: "exit",
      })
    );
  });

  it("throws when F&F not found", async () => {
    exec.mockResolvedValueOnce([[], []]);
    await expect(ffService.approveFF("ff-x", "admin-1")).rejects.toThrow("F&F calculation not found");
  });

  it("throws when F&F is already paid", async () => {
    exec.mockResolvedValueOnce([[{ ...fakeFf, status: "paid", is_ff_provisional: 0 }], []]);
    await expect(ffService.approveFF("ff-1", "admin-1")).rejects.toThrow("already paid");
  });

  it("blocks approval when is_ff_provisional = 1 (FIX H)", async () => {
    exec.mockResolvedValueOnce([[{ ...fakeFf, is_ff_provisional: 1 }], []]);
    await expect(ffService.approveFF("ff-1", "admin-1"))
      .rejects.toThrow("Cannot approve F&F: calculation contains provisional statutory values");
  });
});

// ─── Gratuity Calculation ─────────────────────────────────────────────────────

describe("ffService.calculateGratuity", () => {
  it("returns pending_configuration when gratuityWageBase is undefined", () => {
    const result = ffService.calculateGratuity("2020-01-01", "2026-01-01", undefined);
    expect(result.status).toBe("pending_configuration");
    expect(result.amount).toBe(0);
  });

  it("returns not_eligible for tenure less than 5 years", () => {
    const result = ffService.calculateGratuity("2022-01-01", "2026-05-29", 25000);
    expect(result.status).toBe("not_eligible");
    expect(result.amount).toBe(0);
  });

  it("returns not_eligible for exactly 4 completed years", () => {
    const result = ffService.calculateGratuity("2022-05-01", "2026-04-30", 25000);
    expect(result.status).toBe("not_eligible");
    expect(result.amount).toBe(0);
  });

  it("returns draft with correct amount for 5+ completed years", () => {
    // Use 2020-01-01 to 2026-01-01 = 6.0 years; floor = 6
    // (25000 / 26) * 15 * 6 = 86538.46...
    const result = ffService.calculateGratuity("2020-01-01", "2026-01-01", 25000);
    const expected = Math.round((25000 / 26) * 15 * 6 * 100) / 100;
    expect(result.status).toBe("draft");
    expect(result.amount).toBeCloseTo(expected, 0);
    expect(result.amount).toBeGreaterThan(0);
  });

  it("returns correct amount for 10 completed years", () => {
    const result = ffService.calculateGratuity("2016-01-01", "2026-01-01", 30000);
    const expected = Math.round((30000 / 26) * 15 * 10 * 100) / 100;
    expect(result.status).toBe("draft");
    expect(result.amount).toBeCloseTo(expected, 0);
  });

  it("uses floor for tenure — 5.9 years counts as 5", () => {
    const join = new Date("2020-06-01");
    const exit = new Date("2026-05-01"); // ~5.9 years
    const result = ffService.calculateGratuity(join, exit, 25000);
    const expected5 = Math.round((25000 / 26) * 15 * 5 * 100) / 100;
    expect(result.status).toBe("draft");
    expect(result.amount).toBeCloseTo(expected5, 0);
  });
});

// ─── LWP Deduction Calculation ────────────────────────────────────────────────

describe("payrollGapsService.calculateLwpDeduction", () => {
  it("returns pending_configuration when lwpBasis is undefined", () => {
    const result = payrollGapsService.calculateLwpDeduction(2, 300000, 26, undefined);
    expect(result.status).toBe("pending_configuration");
    expect(result.amount).toBe(0);
  });

  it("returns correct LWP deduction on ctc_annual basis", () => {
    // ctcAnnual=300000, workingDays=26, lwpDays=2
    // dailyRate = 300000/12/26 = 961.538...
    // deduction = 2 * 961.538 = 1923.08
    const result = payrollGapsService.calculateLwpDeduction(2, 300000, 26, "ctc_annual");
    const expected = Math.round(2 * (300000 / 12 / 26) * 100) / 100;
    expect(result.status).toBe("configured");
    expect(result.amount).toBeCloseTo(expected, 1);
    expect(result.amount).toBeGreaterThan(0);
  });

  it("returns 0 when lwpDays = 0 on ctc_annual basis", () => {
    const result = payrollGapsService.calculateLwpDeduction(0, 300000, 26, "ctc_annual");
    expect(result.status).toBe("configured");
    expect(result.amount).toBe(0);
  });

  it("returns 0 when ctcAnnual = 0 on ctc_annual basis", () => {
    const result = payrollGapsService.calculateLwpDeduction(2, 0, 26, "ctc_annual");
    expect(result.status).toBe("configured");
    expect(result.amount).toBe(0);
  });

  it("returns 0 when workingDays = 0 on ctc_annual basis", () => {
    const result = payrollGapsService.calculateLwpDeduction(2, 300000, 0, "ctc_annual");
    expect(result.status).toBe("configured");
    expect(result.amount).toBe(0);
  });

  it("correctly calculates for 5 LWP days on ctc_annual basis", () => {
    const result = payrollGapsService.calculateLwpDeduction(5, 360000, 26, "ctc_annual");
    const expected = Math.round(5 * (360000 / 12 / 26) * 100) / 100;
    expect(result.status).toBe("configured");
    expect(result.amount).toBeCloseTo(expected, 1);
  });

  it("returns pending_configuration for eligible_gross basis (not yet implemented)", () => {
    const result = payrollGapsService.calculateLwpDeduction(2, 300000, 26, "eligible_gross");
    expect(result.status).toBe("pending_configuration");
    expect(result.amount).toBe(0);
  });
});

// ─── Working Days from Holidays ───────────────────────────────────────────────

describe("payrollGapsService.calculateWorkingDaysFromHolidays", () => {
  it("returns 26 fallback when no holidays found", async () => {
    exec.mockResolvedValueOnce([[{ holiday_count: 0 }], []]);
    const result = await payrollGapsService.calculateWorkingDaysFromHolidays("2026-05");
    expect(result).toBe(26);
  });

  it("returns 26 fallback when DB query fails (table missing)", async () => {
    exec.mockRejectedValueOnce(new Error("Table not found"));
    const result = await payrollGapsService.calculateWorkingDaysFromHolidays("2026-05");
    expect(result).toBe(26);
  });

  it("subtracts holidays from 26 when holidays exist", async () => {
    exec.mockResolvedValueOnce([[{ holiday_count: 2 }], []]);
    const result = await payrollGapsService.calculateWorkingDaysFromHolidays("2026-05");
    expect(result).toBe(24); // 26 - 2
  });

  it("returns 26 fallback for invalid month format", async () => {
    const result = await payrollGapsService.calculateWorkingDaysFromHolidays("invalid");
    expect(result).toBe(26);
  });

  it("includes branchId filter in query when provided", async () => {
    exec.mockResolvedValueOnce([[{ holiday_count: 1 }], []]);
    const result = await payrollGapsService.calculateWorkingDaysFromHolidays("2026-05", "branch-1");
    expect(result).toBe(25);
    const [sql] = exec.mock.calls[0];
    expect(sql).toContain("branch_id");
  });
});

// ─── TDS Projection ───────────────────────────────────────────────────────────

describe("payrollGapsService.computeBasicTds", () => {
  it("returns pending_configuration when no slab config rows exist", async () => {
    // checkTdsConfigExists → COUNT=0; no second query
    exec.mockResolvedValueOnce([[{ cnt: 0 }], []]);
    const result = await payrollGapsService.computeBasicTds(500000);
    expect(result.status).toBe("pending_configuration");
    expect(result.tds).toBe(0);
  });

  it("returns pending_configuration when slab limit keys are incomplete", async () => {
    // checkTdsConfigExists → COUNT>0; slab query returns only 2 of 5 limits
    exec
      .mockResolvedValueOnce([[{ cnt: 2 }], []])
      .mockResolvedValueOnce([[
        { config_key: "tds_slab_1_limit", config_value: 300000 },
        { config_key: "tds_slab_2_limit", config_value: 600000 },
      ], []]);
    const result = await payrollGapsService.computeBasicTds(500000);
    expect(result.status).toBe("pending_configuration");
    expect(result.tds).toBe(0);
  });

  it("returns configured with zero TDS for income = 0", async () => {
    const result = await payrollGapsService.computeBasicTds(0);
    expect(result.status).toBe("configured");
    expect(result.tds).toBe(0);
  });

  it("returns pending_configuration when slab rate keys are missing (no hardcoded fallback)", async () => {
    // All 5 limit keys present, but NO rate keys — must not use hardcoded rates
    exec
      .mockResolvedValueOnce([[{ cnt: 5 }], []])
      .mockResolvedValueOnce([[
        { config_key: "tds_slab_1_limit", config_value: 300000 },
        { config_key: "tds_slab_2_limit", config_value: 600000 },
        { config_key: "tds_slab_3_limit", config_value: 900000 },
        { config_key: "tds_slab_4_limit", config_value: 1200000 },
        { config_key: "tds_slab_5_limit", config_value: 1500000 },
        // intentionally NO rate keys
      ], []]);
    const result = await payrollGapsService.computeBasicTds(700000);
    expect(result.status).toBe("pending_configuration");
    expect(result.tds).toBe(0);
  });

  it("computes correct TDS when all slab limit and rate keys are configured", async () => {
    // checkTdsConfigExists → COUNT>0; full slab config
    exec
      .mockResolvedValueOnce([[{ cnt: 11 }], []])
      .mockResolvedValueOnce([[
        { config_key: "tds_slab_1_limit", config_value: 300000 },
        { config_key: "tds_slab_2_limit", config_value: 600000 },
        { config_key: "tds_slab_3_limit", config_value: 900000 },
        { config_key: "tds_slab_4_limit", config_value: 1200000 },
        { config_key: "tds_slab_5_limit", config_value: 1500000 },
        { config_key: "tds_slab_1_rate",  config_value: 0 },
        { config_key: "tds_slab_2_rate",  config_value: 0.05 },
        { config_key: "tds_slab_3_rate",  config_value: 0.10 },
        { config_key: "tds_slab_4_rate",  config_value: 0.15 },
        { config_key: "tds_slab_5_rate",  config_value: 0.20 },
        { config_key: "tds_slab_6_rate",  config_value: 0.30 },
      ], []]);
    // annualTaxable=700000: 0 on 0-300k + 5% on 300k-600k + 10% on 600k-700k
    // = 0 + 15000 + 10000 = 25000
    const result = await payrollGapsService.computeBasicTds(700000);
    expect(result.status).toBe("configured");
    expect(result.tds).toBeCloseTo(25000, 0);
  });

  it("returns pending_configuration when checkTdsConfigExists DB query throws", async () => {
    exec.mockRejectedValueOnce(new Error("DB error"));
    const result = await payrollGapsService.computeBasicTds(400000);
    expect(result.status).toBe("pending_configuration");
    expect(result.tds).toBe(0);
  });
});

// ─── Client Portal Exclusion ──────────────────────────────────────────────────
// Verify no payroll/F&F service imports portal module by checking the loaded
// service objects do not expose portal-related methods or data.

describe("Client Portal payroll isolation", () => {
  it("payslipService has no portal-related methods", () => {
    const keys = Object.keys(payslipService);
    expect(keys.every(k => !k.toLowerCase().includes("portal"))).toBe(true);
  });

  it("ffService has no portal-related methods", () => {
    const keys = Object.keys(ffService);
    expect(keys.every(k => !k.toLowerCase().includes("portal"))).toBe(true);
  });

  it("taxDeclarationService has no portal-related methods", () => {
    const keys = Object.keys(taxDeclarationService);
    expect(keys.every(k => !k.toLowerCase().includes("portal"))).toBe(true);
  });

  it("payrollGapsService has no portal-related methods", () => {
    const keys = Object.keys(payrollGapsService);
    expect(keys.every(k => !k.toLowerCase().includes("portal"))).toBe(true);
  });
});
