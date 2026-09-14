/**
 * A `pct_of_ctc` component carries a PERCENTAGE, never a rupee amount.
 *
 * payrollCalculate built its fixed-component dictionary with
 * `if (calc_type === 'fixed' || calc_type === 'pct_of_ctc') compAmounts[code] = value`, so
 * ss-std-001's BASIC — pct_of_ctc, value 40, meaning 40% — was stored as Rs 40. Added to the
 * genuinely-fixed CONV of Rs 1,600 that made a monthly gross of Rs 1,640 for every employee
 * resolved from the structure template, whatever their real CTC.
 *
 * Measured on the live 2026-08 run before the fix: 23 salary lines with a basic between Rs 2.58
 * and Rs 11.61 against a CTC of Rs 16,588/month. The run completed with no error — it was only
 * caught by reconciling against db_bill.
 *
 * Only employees with no usable salary_component_assignments row reach that path, which is why it
 * stayed hidden: the Payroll Head's assignment normally wins and is expressed in rupees.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(DIR, "..", "payrollCalculate.service.ts"), "utf8");

/** The loop that turns structure-template rows into rupee amounts. */
function dictionaryLoop(): string {
  const at = src.indexOf("const compAmounts: Record<string, number> = {};");
  expect(at, "component dictionary not found").toBeGreaterThan(-1);
  return src.slice(at, src.indexOf("let hasFixedComponents", at));
}

describe("only `fixed` components carry a rupee amount", () => {
  it("does not treat pct_of_ctc as money", () => {
    // The exact defect: a percentage assigned straight into the rupee dictionary.
    expect(dictionaryLoop()).not.toMatch(/calc_type\s*===\s*'pct_of_ctc'/);
  });

  it("still reads genuinely fixed components", () => {
    // 14,455 per-employee structures define BASIC as a real rupee amount. They must keep working.
    expect(dictionaryLoop()).toMatch(/calc_type\s*===\s*'fixed'/);
  });

  it("assigns from the row's own value, not a derived figure", () => {
    expect(dictionaryLoop()).toMatch(/compAmounts\[c\.component_code\]\s*=\s*Number\(c\.value\)/);
  });
});

describe("percentages are still honoured, via the CTC path", () => {
  it("keeps ctc_annual / 12 as the base when no fixed components exist", () => {
    // With BASIC absent from the dictionary, hasFixedComponents is false and this line is what
    // pays the employee — the structure's percentage applied to their real CTC.
    expect(src).toMatch(/monthlyGrossBase\s*=\s*hasFixedComponents\s*\?\s*fixedGross\s*:\s*\(emp\.ctc_annual\s*\/\s*12\)/);
  });

  it("keeps basic_pct / hra_pct as the percentage source", () => {
    expect(src).toContain("emp.basic_pct ?? 40");
    expect(src).toContain("emp.hra_pct ?? 20");
  });
});

describe("an implausible component gross is caught rather than paid", () => {
  it("compares the component gross against the employee's own CTC", () => {
    const at = src.indexOf("const ctcMonthly = Number(emp.ctc_annual ?? 0) / 12;");
    expect(at, "CTC sanity guard not found").toBeGreaterThan(-1);
    const guard = src.slice(at, at + 900);
    expect(guard).toMatch(/fixedGross\s*<\s*ctcMonthly\s*\*\s*0\.25/);
  });

  it("falls back to CTC instead of throwing", () => {
    /*
     * Refusing the line would drop the employee from the run and pay them nothing — worse than the
     * defect. The fallback pays their contracted CTC and the warning makes it visible.
     */
    const at = src.indexOf("const ctcMonthly = Number(emp.ctc_annual ?? 0) / 12;");
    const guard = src.slice(at, at + 900);
    expect(guard).toContain("hasFixedComponents = false");
    expect(guard).not.toMatch(/throw new/);
  });

  it("warns, so the run cannot complete silently on broken components", () => {
    const at = src.indexOf("const ctcMonthly = Number(emp.ctc_annual ?? 0) / 12;");
    const guard = src.slice(at, at + 900);
    expect(guard).toMatch(/logger\.warn/);
    expect(guard).toContain("employee_code");
  });

  it("does not fire on a zero CTC, where the comparison is meaningless", () => {
    const at = src.indexOf("const ctcMonthly = Number(emp.ctc_annual ?? 0) / 12;");
    const guard = src.slice(at, at + 900);
    expect(guard).toMatch(/ctcMonthly\s*>\s*0/);
    expect(guard).toMatch(/fixedGross\s*>\s*0/);
  });
});
