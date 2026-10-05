import { describe, expect, it } from "vitest";
import { payslipDays } from "./payslipDays";

describe("payslipDays", () => {
  it("MAS60236 Aug 2026: 31 days in month, 25 paid days including week-offs (not working days 28)", () => {
    expect(payslipDays({
      run_month: "2026-08", working_days: 28, present_days: 22,
      eligible_weekoff_days: 3, final_payable_days: 25,
    })).toEqual({ daysInMonth: 31, paidDays: 25 });
  });

  it("derives paid days from present + leave + week-off + holiday when the engine stored none", () => {
    expect(payslipDays({
      run_month: "2026-06", present_days: 20, leave_days: 2,
      eligible_weekoff_days: 4, eligible_holiday_days: 1, final_payable_days: 0,
    })).toEqual({ daysInMonth: 30, paidDays: 27 });
  });

  it("never exceeds the month length and takes the month from month/year when run_month is absent", () => {
    expect(payslipDays({ month: 2, year: 2026, present_days: 40 })).toEqual({ daysInMonth: 28, paidDays: 28 });
  });
});
