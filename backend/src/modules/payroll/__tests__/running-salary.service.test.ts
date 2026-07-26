import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, resolveHolidaysForEmployee, calculateWeekoffEligibility, calculateNetSalary, getPtFromSlab } = vi.hoisted(() => ({
  execute: vi.fn(),
  resolveHolidaysForEmployee: vi.fn(),
  calculateWeekoffEligibility: vi.fn(),
  calculateNetSalary: vi.fn(),
  getPtFromSlab: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({
  db: { execute },
}));

vi.mock("../holiday-work.service.js", () => ({
  resolveHolidaysForEmployee,
}));

vi.mock("../weekoff-eligibility.service.js", () => ({
  calculateWeekoffEligibility,
}));

vi.mock("../payroll.service.js", () => ({
  payrollService: {
    calculateNetSalary,
  },
}));

vi.mock("../payrollCalculate.service.js", () => ({
  getPtFromSlab,
}));

describe("computeRunningSalary", () => {
  beforeEach(() => {
    execute.mockReset();
    resolveHolidaysForEmployee.mockReset();
    calculateWeekoffEligibility.mockReset();
    calculateNetSalary.mockReset();
  });

  it("uses attendance_daily_record payable outcomes for the running month, including half day and approved leave", async () => {
    execute
      .mockResolvedValueOnce([[{
        branch_id: "branch-1",
        process_id: "proc-1",
        ctc_annual: 360000,
        structure_id: "struct-1",
        basic_pct: 40,
        hra_pct: 20,
        state_code: "UP",
      }], []])
      .mockResolvedValueOnce([[{
        basic: 12000,
        hra: 6000,
        conveyance: 0,
        special_allowance: 0,
        gross: 30000,
      }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[
        { config_key: "pf_employee_pct", config_value: 12 },
        { config_key: "esic_employee_pct", config_value: 0.75 },
        { config_key: "esic_employer_pct", config_value: 3.25 },
        { config_key: "esic_wage_limit", config_value: 21000 },
        { config_key: "pf_wage_limit", config_value: 15000 },
        { config_key: "professional_tax", config_value: 200 },
      ], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ salary_start_date: null, date_of_leaving: null }], []])
      .mockResolvedValueOnce([[
        { attendance_status: "present", lwp_value: 0, record_date: "2026-07-01" },
        { attendance_status: "present", lwp_value: 0, record_date: "2026-07-02" },
        { attendance_status: "half_day", lwp_value: 0.5, record_date: "2026-07-03" },
        { attendance_status: "leave_approved", lwp_value: 0, record_date: "2026-07-04" },
        { attendance_status: "week_off", lwp_value: 0, record_date: "2026-07-05" },
        { attendance_status: "absent", lwp_value: 1, record_date: "2026-07-06" },
      ], []])
      .mockResolvedValueOnce([[
        { roster_status: "Rostered", roster_date: "2026-07-26" },
        { roster_status: "Week Off", roster_date: "2026-07-27" },
      ]], [])
      .mockResolvedValueOnce([[{ total_incentives: 0 }], []]);

    for (let i = 0; i < 31; i += 1) {
      resolveHolidaysForEmployee.mockResolvedValueOnce([]);
    }

    calculateWeekoffEligibility
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);

    getPtFromSlab
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    calculateNetSalary
      .mockReturnValueOnce({
        net_salary: 3800,
        pf_employee: 0,
        esic_employee: 0,
        professional_tax: 0,
      })
      .mockReturnValueOnce({
        net_salary: 7600,
        pf_employee: 0,
        esic_employee: 0,
        professional_tax: 0,
      });

    const { computeRunningSalary } = await import("../running-salary.service.js");
    const result = await computeRunningSalary("emp-1", "2026-07-01", "2026-07-25");

    expect(result.earned_payable_days).toBe(4.5);
    expect(result.eligible_weekoff_till_date).toBe(1);
    expect(result.eligible_holiday_till_date).toBe(0);
    expect(result.earned_salary_till_date).toBe(4354.84);
    expect(result.projected_payable_days).toBe(6.5);
    expect(result.projected_salary).toBe(6290.32);
    expect(calculateWeekoffEligibility).toHaveBeenNthCalledWith(1, "emp-1", 3.5, "2026-07-01");
    expect(calculateWeekoffEligibility).toHaveBeenNthCalledWith(2, "emp-1", 4.5, "2026-07-01");
  });

  it("treats locked night-shift half day in ADR as payroll-visible half day instead of splitting the post-midnight date", async () => {
    execute
      .mockResolvedValueOnce([[{
        branch_id: "branch-1",
        process_id: "proc-1",
        ctc_annual: 360000,
        structure_id: "struct-1",
        basic_pct: 40,
        hra_pct: 20,
        state_code: "UP",
      }], []])
      .mockResolvedValueOnce([[{
        basic: 12000,
        hra: 6000,
        conveyance: 0,
        special_allowance: 0,
        gross: 30000,
      }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[
        { config_key: "pf_employee_pct", config_value: 12 },
        { config_key: "esic_employee_pct", config_value: 0.75 },
        { config_key: "esic_employer_pct", config_value: 3.25 },
        { config_key: "esic_wage_limit", config_value: 21000 },
        { config_key: "pf_wage_limit", config_value: 15000 },
        { config_key: "professional_tax", config_value: 200 },
      ], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ salary_start_date: null, date_of_leaving: null }], []])
      .mockResolvedValueOnce([[
        {
          attendance_status: "half_day",
          lwp_value: 0.5,
          record_date: "2026-07-25",
        },
      ], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ total_incentives: 0 }], []]);

    for (let i = 0; i < 31; i += 1) {
      resolveHolidaysForEmployee.mockResolvedValueOnce([]);
    }

    calculateWeekoffEligibility
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    getPtFromSlab
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    calculateNetSalary
      .mockReturnValueOnce({
        net_salary: 500,
        pf_employee: 0,
        esic_employee: 0,
        professional_tax: 0,
      })
      .mockReturnValueOnce({
        net_salary: 500,
        pf_employee: 0,
        esic_employee: 0,
        professional_tax: 0,
      });

    const { computeRunningSalary } = await import("../running-salary.service.js");
    const result = await computeRunningSalary("emp-1", "2026-07-01", "2026-07-25");

    expect(result.earned_payable_days).toBe(0.5);
    expect(result.projected_payable_days).toBe(0.5);
    expect(result.earned_salary_till_date).toBe(483.87);
  });
});
