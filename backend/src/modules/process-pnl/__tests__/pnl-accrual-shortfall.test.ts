import { describe, expect, it } from "vitest";
import { accrualShortfall } from "../pnl-reconciliation.service.js";

describe("running-month salary accrual plausibility", () => {
  it("flags October's prod shape: Rs 49.9 L accrued against a Rs 215.2 L month after 11 days", () => {
    const r = accrualShortfall({ asOfDate: "2026-10-12", period: "2026-10", accrued: 4_992_231, previousMonthPayroll: 21_518_410 });
    expect(r).not.toBeNull();
    expect(r!.elapsed).toBe(11);
    expect(r!.pctOfExpected).toBeLessThan(70);
  });
  it("stays quiet when the accrual follows the pace", () => {
    expect(accrualShortfall({ asOfDate: "2026-10-12", period: "2026-10", accrued: 7_400_000, previousMonthPayroll: 21_518_410 })).toBeNull();
  });
  it("stays quiet in the first days of a month and without a previous month", () => {
    expect(accrualShortfall({ asOfDate: "2026-10-03", period: "2026-10", accrued: 100, previousMonthPayroll: 21_518_410 })).toBeNull();
    expect(accrualShortfall({ asOfDate: "2026-10-20", period: "2026-10", accrued: 100, previousMonthPayroll: 0 })).toBeNull();
  });
});
