import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, resolveHolidaysForEmployeeV2, calculateWeekoffEligibility, calculateNetSalary, getPtFromSlab } = vi.hoisted(() => ({
  execute: vi.fn(),
  resolveHolidaysForEmployeeV2: vi.fn(),
  calculateWeekoffEligibility: vi.fn(),
  calculateNetSalary: vi.fn(),
  getPtFromSlab: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({
  db: { execute },
}));

vi.mock("../holiday-work.service.js", () => ({
  resolveHolidaysForEmployeeV2,
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

/**
 * Imported statically, not via `await import()` inside each test.
 *
 * vi.mock is hoisted above imports, so a static import is guaranteed to bind the
 * mocked dependencies. A dynamic import inside a test body has no such guarantee
 * and raced the mock registry whenever this file ran alongside others: the
 * service would occasionally bind the REAL holiday-work service, whose own
 * queries then consumed the db mock's queued values and left a later call
 * returning undefined. It surfaced as `(intermediate value) is not iterable` at
 * the employee_statutory_override query — a crash with no connection to the
 * actual cause. Passed alone, failed roughly two runs in three in a full suite.
 */
import { computeRunningSalary } from "../running-salary.service.js";

describe("computeRunningSalary", () => {
  beforeEach(() => {
    execute.mockReset();
    // mockReset() clears the default too, leaving any call beyond the queued
    // sequence returning undefined — which destructures into an opaque
    // TypeError rather than a readable assertion failure. tests/setup.ts mocks
    // this module with exactly this default for the same reason; restore it so
    // a miscounted query fails by asserting a wrong number, not by crashing.
    execute.mockResolvedValue([[], []]);
    resolveHolidaysForEmployeeV2.mockReset();
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

    // computeRunningSalary now resolves the month's holidays once (correctly, with a
    // "YYYY-MM" string) instead of re-querying per day — see running-salary.service.ts.
    resolveHolidaysForEmployeeV2.mockResolvedValueOnce({
      eligibleHolidayCount: 0,
      eligibleHolidayDates: [],
      holidayWorkExtraPayout: 0,
    });

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

    const result = await computeRunningSalary("emp-1", "2026-07-01", "2026-07-25");

    expect(result.earned_payable_days).toBe(4.5);
    expect(result.eligible_weekoff_till_date).toBe(1);
    expect(result.eligible_holiday_till_date).toBe(0);
    expect(result.earned_salary_till_date).toBe(4354.84);

    // Projection figures updated for the roster-free projection (19990a4b,
    // 2026-07-28). Remaining days now come from the calendar instead of the
    // roster rows mocked above, so the projected base is the days after the 25th
    // rather than the single "Rostered" row: 2.5 present + 1 paid leave
    // + 2 week-off + 6 future = 11.5, and 30000/31 x 11.5 = 11129.03.
    //
    // 6 future, not 5, and this is a money change. These numbers were recorded on an
    // IST machine while monthEnd was `new Date(y, m, 0).toISOString()` — a local instant
    // serialised as UTC, which resolved July to the 30th and silently dropped the 31st.
    // The 26th to the 31st is six days. monthEnd is now built from the date string, so the
    // figure is identical under TZ=UTC and TZ=Asia/Kolkata; previously this test passed
    // only in IST and failed on CI's UTC runner, which is how the shortfall stayed hidden.
    expect(result.projected_payable_days).toBe(11.5);
    expect(result.projected_salary).toBe(11129.03);
    // The 4th argument is the employee's own eligible holiday count for the month, which the
    // eligibility test subtracts from available working days so a company holiday cannot count
    // against "worked everything available". This fixture declares no holidays, hence 0 —
    // holiday-count-varies-per-employee is covered in weekoff-holiday-aware.test.ts.
    expect(calculateWeekoffEligibility).toHaveBeenNthCalledWith(1, "emp-1", 3.5, "2026-07-01", 0);
    // 3.5, not 9.5: the projection deliberately uses the EARNED paid base only. Adding the
    // remaining calendar days would mix calendar days into a working-day count and trip the
    // full-attendance branch for someone who has not earned it — see the comment on
    // projectedEligibleWeekoffs in running-salary.service.ts. This expectation still held the
    // pre-change value and was failing at HEAD before the holiday-count parameter existed.
    expect(calculateWeekoffEligibility).toHaveBeenNthCalledWith(2, "emp-1", 3.5, "2026-07-01", 0);
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

    // computeRunningSalary now resolves the month's holidays once (correctly, with a
    // "YYYY-MM" string) instead of re-querying per day — see running-salary.service.ts.
    resolveHolidaysForEmployeeV2.mockResolvedValueOnce({
      eligibleHolidayCount: 0,
      eligibleHolidayDates: [],
      holidayWorkExtraPayout: 0,
    });

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

    const result = await computeRunningSalary("emp-1", "2026-07-01", "2026-07-25");

    // The assertion this test exists for: the locked night-shift half day counts
    // as 0.5 payable on its own record_date, not split across midnight.
    expect(result.earned_payable_days).toBe(0.5);
    expect(result.earned_salary_till_date).toBe(483.87);

    // Roster-free projection (19990a4b): 0.5 earned + 6 remaining calendar days
    // (the 26th to the 31st). Was 5 while monthEnd dropped the month's last day on an
    // IST host — see the note on the projection assertions in the test above.
    expect(result.projected_payable_days).toBe(6.5);
  });

  it("counts an eligible holiday inside the till-date window, and resolves it with the correct YYYY-MM format", async () => {
    // Regression test for the bug this fix corrects: computeRunningSalary used to call
    // resolveHolidaysForEmployee(employeeId, d) once per day with a full "YYYY-MM-DD"
    // date, which resolveHolidaysForEmployeeV2 silently turned into a malformed date
    // range (confirmed live) — eligible_holiday_till_date was always 0, for every
    // employee, always. Now it resolves the month once, correctly, and filters dates.
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
        { attendance_status: "half_day", lwp_value: 0.5, record_date: "2026-07-25" },
      ], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ total_incentives: 0 }], []]);

    // A holiday on July 15 — inside the July 1-25 till-date window this test asks for.
    resolveHolidaysForEmployeeV2.mockResolvedValueOnce({
      eligibleHolidayCount: 1,
      eligibleHolidayDates: ["2026-07-15"],
      holidayWorkExtraPayout: 0,
    });

    calculateWeekoffEligibility
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    getPtFromSlab
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    calculateNetSalary
      .mockReturnValueOnce({ net_salary: 0, pf_employee: 0, esic_employee: 0, professional_tax: 0 })
      .mockReturnValueOnce({ net_salary: 0, pf_employee: 0, esic_employee: 0, professional_tax: 0 });

    const result = await computeRunningSalary("emp-1", "2026-07-01", "2026-07-25");

    expect(resolveHolidaysForEmployeeV2).toHaveBeenCalledWith("emp-1", "2026-07");
    expect(result.eligible_holiday_till_date).toBe(1);
    // 0.5 (half day) + 0 weekoffs + 1 holiday = 1.5 payable days earned.
    expect(result.earned_payable_days).toBe(1.5);
  });
});
