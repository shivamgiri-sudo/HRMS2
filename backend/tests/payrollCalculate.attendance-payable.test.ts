import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  dbExecute,
  connExecute,
  getConnection,
  beginTransaction,
  commit,
  rollback,
  release,
  getPolicyValue,
  getActiveEmployeeIdsForMonth,
  calculateWeekoffEligibility,
  resolveHolidaysForEmployeeV2,
  checkAndReverseLeave,
  isHolidayWorkAutoGenEnabled,
  detectAndCalculateHolidayWork,
  calculateNetSalary,
  breakSpecialAllowance,
} = vi.hoisted(() => {
  const dbExecute = vi.fn();
  const connExecute = vi.fn();
  return {
    dbExecute,
    connExecute,
    getConnection: vi.fn(async () => ({
      execute: connExecute,
      beginTransaction,
      commit,
      rollback,
      release,
    })),
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
    release: vi.fn(() => undefined),
    getPolicyValue: vi.fn(async () => "26"),
    getActiveEmployeeIdsForMonth: vi.fn(async () => new Set<string>()),
    calculateWeekoffEligibility: vi.fn(),
    resolveHolidaysForEmployeeV2: vi.fn(),
    checkAndReverseLeave: vi.fn(),
    isHolidayWorkAutoGenEnabled: vi.fn(async () => false),
    detectAndCalculateHolidayWork: vi.fn(async () => ({ payout: 0, holidaysWorked: [] })),
    calculateNetSalary: vi.fn(),
    breakSpecialAllowance: vi.fn(() => ({ conv: 0, ma: 0, pa: 0 })),
  };
});

vi.mock("../src/db/mysql.js", () => ({
  db: {
    execute: dbExecute,
    getConnection,
  },
}));

vi.mock("../src/modules/policy-engine/policy-engine.cache.js", () => ({
  getPolicyValue,
}));

vi.mock("../src/modules/compliance/maternity.service.js", () => ({
  maternityService: {
    getActiveEmployeeIdsForMonth,
  },
}));

vi.mock("../src/modules/payroll/weekoff-eligibility.service.js", () => ({
  calculateWeekoffEligibility,
}));

vi.mock("../src/modules/payroll/holiday-work.service.js", () => ({
  resolveHolidaysForEmployeeV2,
}));

vi.mock("../src/modules/payroll/leave-reversal.service.js", () => ({
  checkAndReverseLeave,
}));

vi.mock("../src/modules/payroll/holiday-work-auto.service.js", () => ({
  isHolidayWorkAutoGenEnabled,
  detectAndCalculateHolidayWork,
}));

vi.mock("../src/modules/payroll/payroll.service.js", () => ({
  payrollService: {
    calculateNetSalary,
  },
  breakSpecialAllowance,
}));

vi.mock("../src/modules/payroll-compliance/taxEngine.service.js", () => ({
  taxEngineService: {
    calculateMonthlyTds: vi.fn(),
  },
}));

import { calculatePayrollRun } from "../src/modules/payroll/payrollCalculate.service.js";

const runRow = {
  id: "run-1",
  run_month: "2026-07",
  process_filter: null,
  branch_filter: null,
  status: "draft",
  tds_mode: "manual",
};

const employeeRow = {
  employee_id: "emp-1",
  employee_code: "EMP001",
  prep_line_id: null,
  ctc_annual: 360000,
  structure_id: "struct-1",
  basic_pct: 40,
  hra_pct: 20,
  state_code: null,
  process_id: "proc-1",
  branch_id: "branch-1",
  salary_start_date: "2026-01-01",
};

function setupDbMocks() {
  dbExecute.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes("SELECT * FROM salary_prep_run")) {
      return [[runRow], []];
    }
    if (sql.includes("SELECT config_key, config_value FROM statutory_config")) {
      return [[
        { config_key: "pf_employee_pct", config_value: 12 },
        { config_key: "esic_employee_pct", config_value: 0.75 },
        { config_key: "esic_employer_pct", config_value: 3.25 },
        { config_key: "esic_wage_limit", config_value: 21000 },
        { config_key: "pf_wage_limit", config_value: 15000 },
        { config_key: "professional_tax", config_value: 200 },
      ], []];
    }
    if (sql.includes("FROM employees e") && sql.includes("employee_salary_assignment")) {
      return [[employeeRow], []];
    }
    if (sql.includes("FROM attendance_feature_config")) {
      return [[{ config_value: "0" }], []];
    }
    if (sql.includes("COUNT(*) AS cnt FROM attendance_daily_record")) {
      return [[{ cnt: 3 }], []];
    }
    if (sql.includes("COUNT(CASE WHEN adr.attendance_status = 'present'")) {
      return [[{
        employee_id: "emp-1",
        working_days: 3,
        present_days: 1,
        leave_days: 2,
        lwp_days: 0.5,
        late_marks: 0,
        dialer_hours: 5,
      }], []];
    }
    if (sql.includes("SUM(") && sql.includes("AS paid_base")) {
      return [[{ paid_base: 1.5 }], []];
    }
    if (sql.includes("FROM employee_loans")) {
      return [[{ loan_emi: 0 }], []];
    }
    if (sql.includes("FROM employee_deduction_entries")) {
      return [[], []];
    }
    if (sql.includes("FROM attendance_billing_config")) {
      return [[], []];
    }
    if (sql.includes("FROM salary_run_manual_tds")) {
      return [[], []];
    }
    if (sql.includes("UPDATE salary_prep_run SET status = 'draft'")) {
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes("SELECT * FROM salary_prep_run WHERE id = ? LIMIT 1") && params?.[0] === "run-1") {
      return [[{ ...runRow, status: "processing" }], []];
    }
    return [[], []];
  });

  connExecute.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM employees e") && sql.includes("designation_master")) {
      return [[{ designation_name: "Executive", dept_name: "Operations" }], []];
    }
    if (sql.includes("FROM salary_component_assignments")) {
      return [[{
        basic: 12000,
        hra: 6000,
        conveyance: 0,
        special_allowance: 3000,
        gross: 30000,
      }], []];
    }
    if (sql.includes("FROM salary_structure_component")) {
      return [[], []];
    }
    if (sql.includes("FROM tax_declaration")) {
      return [[], []];
    }
    if (sql.includes("FROM salary_advance_log") && sql.includes("monthly_recovery")) {
      return [[{ monthly_recovery: 0 }], []];
    }
    if (sql.includes("FROM employee_statutory_override")) {
      return [[], []];
    }
    if (sql.includes("INSERT INTO salary_prep_line")) {
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes("INSERT INTO salary_prep_line_component")) {
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes("INSERT INTO sensitive_action_log")) {
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes("SELECT COALESCE(SUM(gross_salary),0) AS tg")) {
      return [[{ tg: 3387.1, td: 387.1, tn: 3000 }], []];
    }
    if (sql.includes("UPDATE salary_prep_run")) {
      return [{ affectedRows: 1 }, []];
    }
    return [[], []];
  });
}

describe("calculatePayrollRun ADR payable-day batch logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbExecute.mockReset();
    connExecute.mockReset();
    setupDbMocks();
    calculateNetSalary.mockReturnValue({
      gross_salary: 3387.1,
      net_salary: 3000,
      total_deductions: 387.1,
      basic: 1354.84,
      hra: 677.42,
      special_allowance: 1354.84,
      pf_employee: 0,
      pf_employer: 0,
      esic_employee: 0,
      esic_employer: 0,
      professional_tax: 200,
    });
  });

  it("writes ADR paid base plus eligible weekoff and holiday into salary_prep_line final payable days", async () => {
    calculateWeekoffEligibility.mockResolvedValueOnce(1);
    resolveHolidaysForEmployeeV2.mockResolvedValue({
      eligibleHolidayCount: 1,
      holidayWorkExtraPayout: 0,
    });
    checkAndReverseLeave.mockResolvedValue({
      newPaidBase: 1.5,
      reversed: false,
      daysReversed: 0,
    });

    const result = await calculatePayrollRun("run-1", "user-1");

    const prepInsert = connExecute.mock.calls.find(([sql]: [string]) => sql.includes("INSERT INTO salary_prep_line"));
    expect(prepInsert).toBeTruthy();
    const prepParams = prepInsert?.[1] as unknown[];
    expect(prepParams[27]).toBe(1.5);
    expect(prepParams[28]).toBe(1);
    expect(prepParams[29]).toBe(1);
    expect(prepParams[30]).toBe(3.5);
    expect(prepParams[34]).toBe("ADR");
    expect(result.employees_processed).toBe(1);
  });

  it("uses reversed paid base and recalculated weekoff eligibility before writing final payable days", async () => {
    calculateWeekoffEligibility
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(0);
    resolveHolidaysForEmployeeV2.mockResolvedValue({
      eligibleHolidayCount: 1,
      holidayWorkExtraPayout: 0,
    });
    checkAndReverseLeave.mockResolvedValue({
      newPaidBase: 1,
      reversed: true,
      daysReversed: 0.5,
    });

    await calculatePayrollRun("run-1", "user-1");

    expect(calculateWeekoffEligibility).toHaveBeenNthCalledWith(1, "emp-1", 1.5, "2026-07");
    expect(calculateWeekoffEligibility).toHaveBeenNthCalledWith(2, "emp-1", 1, "2026-07");

    const prepInsert = connExecute.mock.calls.find(([sql]: [string]) => sql.includes("INSERT INTO salary_prep_line"));
    const prepParams = prepInsert?.[1] as unknown[];
    expect(prepParams[27]).toBe(1);
    expect(prepParams[28]).toBe(0);
    expect(prepParams[29]).toBe(1);
    expect(prepParams[30]).toBe(2);
  });
});
