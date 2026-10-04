/**
 * Rejoin v3 plan 3c — stint-aware payroll is wired into the calculator ONLY behind its flag.
 *
 * payrollCalculate.service.ts has no direct unit test for this path, so this file pins the source:
 * every stint behaviour hangs off a `stintScope` that can only be defined when `stintPayrollOn` is
 * true, and the flag-off code (the old activeCals IIFE, the 4-argument week-off call, the leaver
 * resolver wiring) is still there, unchanged.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const CALC = stripComments(read("src/modules/payroll/payrollCalculate.service.ts"));
const squash = (s: string) => s.replace(/\s+/g, " ");
const FLAT = squash(CALC);

const count = (hay: string, needle: string) => hay.split(needle).length - 1;

describe("stint-aware payroll imports", () => {
  it("imports the flag reader and the batch loader", () => {
    expect(CALC).toMatch(/import\s*\{[^}]*isStintPayrollEnabled[^}]*\}\s*from\s*"\.\/stint-payroll\.service\.js"/);
    expect(CALC).toMatch(/import\s*\{[^}]*loadStintScopes[^}]*\}\s*from\s*"\.\/stint-payroll\.service\.js"/);
  });
});

describe("everything sits behind the flag", () => {
  it("reads the flag once per run, before the employee loop", () => {
    expect(count(FLAT, "isStintPayrollEnabled(")).toBe(1);
    expect(FLAT).toContain("const stintPayrollOn = await isStintPayrollEnabled()");
    expect(FLAT.indexOf("const stintPayrollOn")).toBeLessThan(FLAT.indexOf("for (const emp of employees)"));
  });

  it("loadStintScopes( is only ever called inside a `stintPayrollOn ?` expression", () => {
    expect(count(FLAT, "loadStintScopes(")).toBe(1);
    expect(FLAT).toMatch(/const stintScopes = stintPayrollOn \? await loadStintScopes\(/);
  });

  it("the scopes keep the leaver bound: the resolved employment_end_date is passed to the loader", () => {
    const call = FLAT.slice(FLAT.indexOf("await loadStintScopes("), FLAT.indexOf("await loadStintScopes(") + 400);
    expect(call).toContain("e.salary_start_date ?? null");
    expect(call).toContain("e.employment_end_date ?? null");
  });

  it("the per-employee scope is undefined unless the flag is on", () => {
    expect(count(FLAT, "stintScopes.get(")).toBe(1);
    expect(FLAT).toContain("const stintScope = stintPayrollOn ? stintScopes.get(emp.employee_id) : undefined;");
    // stintScope is assigned exactly once, there.
    expect(count(FLAT, "const stintScope =")).toBe(1);
    expect(FLAT.match(/\bstintScope\s*=(?!=)/g) ?? []).toHaveLength(1);
    expect(FLAT).not.toMatch(/let stintScope\b/);
  });

  it("a month wholly inside the gap is skipped like the salary-start skip, before processedCount++", () => {
    const skip = FLAT.indexOf("if (stintScope && stintScope.employedDays === 0) { continue; }");
    expect(skip).toBeGreaterThan(-1);
    expect(skip).toBeGreaterThan(FLAT.indexOf("if (ssd > monthEndDate)"));
    expect(skip).toBeLessThan(FLAT.indexOf("processedCount++;"));
  });
});

describe("the three call sites take the scope", () => {
  it("holidays are limited to the employed ranges", () => {
    expect(FLAT).toContain("resolveHolidaysForEmployeeV2(emp.employee_id, run.run_month, stintScope?.ranges)");
  });

  it("both week-off calls (first pass and post-reversal) take the stint employment, and only from the scope", () => {
    expect(FLAT).toContain(
      "const stintWeekoffArg: [] | [{ employedDays: number; sundays: number }] = stintScope ? [{ employedDays: stintScope.employedDays, sundays: stintScope.sundays }] : [];",
    );
    const calls = FLAT.split("calculateWeekoffEligibility(").slice(1);
    expect(calls).toHaveLength(2);
    for (const c of calls) expect(c.slice(0, 300)).toMatch(/eligibleHolidayCount, \.\.\.stintWeekoffArg,? \)/);
  });

  it("activeCals uses the employed days when a scope exists", () => {
    expect(FLAT).toContain("const activeCals = stintScope ? Math.min(stintScope.employedDays, daysInMonth) : (() => {");
  });
});

describe("the flag-off path is preserved", () => {
  it("the old activeCals IIFE is still there, intact", () => {
    expect(CALC).toContain("payableThrough(emp.employment_end_date, monthEnd)");
    expect(FLAT).toContain("return Math.max(1, Math.min(days, daysInMonth)); })();");
    expect(FLAT).toContain("const finalPayableDays = Math.min(basePayableDays, activeCals);");
  });

  it("the leaver resolver wiring still holds", () => {
    expect(CALC).toContain("employmentWindowPredicate()");
    expect(CALC).toContain("payableThrough(emp.employment_end_date");
  });

  it("the original salary-start skip is untouched", () => {
    expect(FLAT).toContain("if (ssd > monthEndDate) { continue; }");
  });
});
