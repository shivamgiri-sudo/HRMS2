/**
 * The running month must not subtract a full month's EMI / advance recovery from a few days' pay.
 *
 * MAS47814 (3 Oct 2026): ~3,117 earned, 20,000 EMI -> running net clamped to 0 and read as "no salary".
 * The locked payroll run takes the full EMI from a full month's pay; the running figure takes it in
 * proportion to the days earned, and the projection takes it in full (it used to ignore it, so the
 * projected net disagreed with the locked run). Source contract, like its sibling
 * runningSalaryAprSource.contract.test.ts: the arithmetic is verified against production separately.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "..", "running-salary.service.ts"), "utf8");

describe("running salary recovery proration", () => {
  it("prorates EMI + advance recovery by days earned for the till-date net", () => {
    expect(src).toContain("const recoveryRatio = activeCalDays > 0 ? Math.min(1, cappedEarned / activeCalDays) : 1;");
    expect(src).toContain("(advanceRecoveryEarned + loanEmiEarned) * recoveryRatio");
    expect(src).toContain("earnedCalcRaw.net_salary + approvedIncentivesEarned - recoveryTillDate");
    // the old full-month subtraction from partial earnings must be gone
    expect(src).not.toContain("earnedCalcRaw.net_salary + approvedIncentivesEarned - advanceRecoveryEarned - loanEmiEarned");
  });

  it("takes the full recovery off the projected net, as the locked run does", () => {
    expect(src).toContain("projectedCalcRaw.net_salary + approvedIncentivesEarned - advanceRecoveryEarned - loanEmiEarned");
  });
});
