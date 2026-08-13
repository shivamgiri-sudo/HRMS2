/**
 * PAYSLIP_COMPONENT_TOTAL_MISMATCH — root-caused 2026-08-13, fixed 2026-08-14.
 *
 * buildPayslipEarningComponents() is the itemized payslip breakdown a payroll
 * line's `salary_prep_line_component` rows are built from. Before this fix it
 * was inline in calculatePayrollRunScoped and had two independent defects,
 * both reproduced from live production data (July 2026 run 93ff8899):
 *
 *   1. LEFTOVER COMPONENT LEAKAGE (MAS00175). When the per-employee
 *      salary_component_assignments row ("scaRow") is authoritative for
 *      gross, compAmounts was still carrying BONUS/PORTFOLIO values the
 *      structure template alone had set — written as extra payslip lines
 *      with no matching contribution to gross_salary. ₹11,612.90 (Portfolio
 *      Allowance) double-counted for this employee alone; 101 of 1,595 July
 *      lines affected in total (₹6,39,442.71).
 *
 *   2. SPECIAL RESIDUAL MISMATCH (MAS63025). The assignment's stored
 *      special_allowance (a static, human-entered figure) does not have to
 *      equal the residual calculateNetSalary actually computed
 *      (grossMonthlyCTC - basic - hra) and gross_salary was built from.
 *      ₹547.83 of real gross had no component row at all for this employee;
 *      736 of 1,595 July lines affected in total.
 *
 * A THIRD issue surfaced while writing these tests, caught before it reached
 * production: calculateNetSalary's residual has no concept of conveyance
 * either (its formula never subtracts it), so writing CONV as its own line
 * *and* the raw residual as SPECIAL double-counts conveyance. The fix
 * subtracts CONV's prorated contribution from the residual before treating
 * the remainder as SPECIAL — every reconciliation test below is exact
 * arithmetic (ratio=1) specifically so this and any future such error cannot
 * hide behind rounding tolerance.
 *
 * Does not call calculateNetSalary or touch gross/net arithmetic anywhere —
 * those stay exactly as they were; calc.basic/calc.hra/calc.special_allowance
 * are passed in here as already-authoritative, computed inputs.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildPayslipEarningComponents } from "../payrollCalculate.service.js";

function sum(components: Array<{ amount: number }>): number {
  return Math.round(components.reduce((s, c) => s + c.amount, 0) * 100) / 100;
}

describe("buildPayslipEarningComponents — MAS00175-equivalent (leftover leakage)", () => {
  // Real production figures: scaRow.gross=80096, basic=34700, hra=17350,
  // conveyance=1600. Structure template additionally defines BONUS=2891 and
  // PORTFOLIO=15000 — values the assignment knows nothing about. Ratio fixed
  // at 1 (full month) so every assertion here is exact arithmetic, not
  // rounding-tolerant — partial-month proration is its own test below.
  const basic = 34700, hra = 17350, conv = 1600, bonus = 2891, portfolio = 15000;
  // The residual calculateNetSalary actually computes: grossMonthlyCTC - basic
  // - hra. This is what gets passed in as calcSpecialAllowance — the function
  // itself is responsible for subtracting conveyance back out (see the third
  // bug in the file header).
  const trueResidual = 80096 - basic - hra; // 28046
  const gross_salary = basic + hra + trueResidual; // 80096, by construction

  it("with compAmounts correctly reset to only basic/hra/conv, the payslip total reconciles to gross_salary exactly", () => {
    const components = buildPayslipEarningComponents({
      hasFixedComponents: true,
      usedScaRowAssignment: true,
      compAmounts: { BASIC: basic, HRA: hra, CONV: conv }, // no BONUS, no PORTFOLIO — reset by caller
      ratio: 1,
      calcBasic: 0, // unused on this path
      calcHra: 0,
      calcSpecialAllowance: trueResidual,
      convAllowanceDefault: 0,
      medicalAllowanceDefault: 0,
    });

    expect(components.map((c) => c.code).sort()).toEqual(["BASIC", "CONV", "HRA", "SPECIAL"]);
    expect(components.find((c) => c.code === "PORTFOLIO")).toBeUndefined();
    expect(components.find((c) => c.code === "BONUS")).toBeUndefined();
    expect(sum(components)).toBe(gross_salary);
  });

  it("proves the defect: an UNRESET compAmounts (the pre-fix shape) breaks the invariant by exactly the leftover components' value", () => {
    // Same inputs, except compAmounts still carries what the structure
    // template set (the bug the caller no longer allows through).
    const components = buildPayslipEarningComponents({
      hasFixedComponents: true,
      usedScaRowAssignment: true,
      compAmounts: { BASIC: basic, HRA: hra, CONV: conv, BONUS: bonus, PORTFOLIO: portfolio },
      ratio: 1,
      calcBasic: 0,
      calcHra: 0,
      calcSpecialAllowance: trueResidual,
      convAllowanceDefault: 0,
      medicalAllowanceDefault: 0,
    });

    const overshoot = sum(components) - gross_salary;
    // CONV appears exactly once regardless of what else leaked through, so
    // the SPECIAL derivation is unaffected by the leftover keys — the entire
    // overshoot is exactly the leftover BONUS + PORTFOLIO values.
    expect(overshoot).toBe(bonus + portfolio);
    expect(components.find((c) => c.code === "PORTFOLIO")).toBeDefined();
    expect(components.find((c) => c.code === "BONUS")).toBeDefined();
  });
});

describe("buildPayslipEarningComponents — MAS63025-equivalent (SPECIAL residual mismatch)", () => {
  // Real production figures: scaRow.gross=15059, basic=8000, hra=4793,
  // conveyance=1600, stored special_allowance=0 (stale). Ratio=1 for exact
  // arithmetic, matching the MAS00175 block above.
  const basic = 8000, hra = 4793, conv = 1600;
  const trueResidual = 15059 - basic - hra; // 2266
  const gross_salary = basic + hra + trueResidual; // 15059

  it("sources SPECIAL from the computed residual (net of conveyance), not from a stale stored value, and reconciles to gross exactly", () => {
    const components = buildPayslipEarningComponents({
      hasFixedComponents: true,
      usedScaRowAssignment: true,
      compAmounts: { BASIC: basic, HRA: hra, CONV: conv }, // no SPECIAL key at all — reset by caller
      ratio: 1,
      calcBasic: 0,
      calcHra: 0,
      calcSpecialAllowance: trueResidual,
      convAllowanceDefault: 0,
      medicalAllowanceDefault: 0,
    });

    expect(components.find((c) => c.code === "SPECIAL")?.amount).toBe(trueResidual - conv); // 666
    expect(sum(components)).toBe(gross_salary);
  });

  it("proves the defect: trusting a stale stored special_allowance of 0 leaves real gross unexplained", () => {
    // Pre-fix shape: usedScaRowAssignment=false simulates the OLD code path,
    // where SPECIAL was read from compAmounts (sourced from
    // scaRow.special_allowance) rather than the computed residual.
    const components = buildPayslipEarningComponents({
      hasFixedComponents: true,
      usedScaRowAssignment: false,
      compAmounts: { BASIC: basic, HRA: hra, CONV: conv, SPECIAL: 0 }, // stale stored value
      ratio: 1,
      calcBasic: 0,
      calcHra: 0,
      calcSpecialAllowance: trueResidual, // ignored on this path — proving exactly why that was the bug
      convAllowanceDefault: 0,
      medicalAllowanceDefault: 0,
    });

    expect(components.find((c) => c.code === "SPECIAL")).toBeUndefined();
    const shortfall = gross_salary - sum(components);
    expect(shortfall).toBe(trueResidual - conv); // 666 — the exact unexplained-gross figure
  });
});

describe("buildPayslipEarningComponents — required coverage scenarios", () => {
  it("zero-gross / full-LWP line: every component amount prorates to exactly zero", () => {
    const components = buildPayslipEarningComponents({
      hasFixedComponents: true,
      usedScaRowAssignment: true,
      compAmounts: { BASIC: 8000, HRA: 4793, CONV: 1600 },
      ratio: 0, // 0 payable days
      calcBasic: 0,
      calcHra: 0,
      // In production this is calc.special_allowance, itself computed from
      // an already-ratio-scaled grossMonthlyCTC — at ratio=0 the real caller
      // would also supply 0 here, not a positive residual.
      calcSpecialAllowance: 0,
      convAllowanceDefault: 0,
      medicalAllowanceDefault: 0,
    });
    // The function itself filters on the unscaled configured value, not the
    // final amount (matching its pre-extraction behaviour) — a fully-zeroed
    // ratio still yields entries, each worth ₹0. The caller filters
    // comp.amount <= 0 before persisting (proven by source check below), so
    // nothing ₹0 ever reaches salary_prep_line_component.
    expect(components.every((c) => c.amount === 0)).toBe(true);
    expect(sum(components)).toBe(0);
  });

  it("component values that are exactly zero are excluded outright, never written as ₹0 lines", () => {
    const components = buildPayslipEarningComponents({
      hasFixedComponents: true,
      usedScaRowAssignment: true,
      compAmounts: { BASIC: 8000, HRA: 4793, CONV: 0 }, // no conveyance configured for this employee
      ratio: 1,
      calcBasic: 0,
      calcHra: 0,
      calcSpecialAllowance: 0, // no special allowance either
      convAllowanceDefault: 0,
      medicalAllowanceDefault: 0,
    });
    expect(components.map((c) => c.code).sort()).toEqual(["BASIC", "HRA"]);
    expect(components.some((c) => c.amount === 0)).toBe(false);
  });

  it("structure-only path (no scaRow): uses calc.basic/calc.hra/breakSpecialAllowance directly, unaffected by the fix", () => {
    const components = buildPayslipEarningComponents({
      hasFixedComponents: false,
      usedScaRowAssignment: false,
      compAmounts: {}, // irrelevant on this path
      ratio: 1,
      calcBasic: 5000,
      calcHra: 2500,
      calcSpecialAllowance: 3000,
      convAllowanceDefault: 800,
      medicalAllowanceDefault: 1250,
    });
    const codes = components.map((c) => c.code).sort();
    expect(codes).toEqual(["BASIC", "CONV", "HRA", "MA", "PA"]);
    expect(components.find((c) => c.code === "BASIC")?.amount).toBe(5000);
    expect(components.find((c) => c.code === "HRA")?.amount).toBe(2500);
  });

  it("partial-month proration scales every fixed-component amount by the same ratio", () => {
    const components = buildPayslipEarningComponents({
      hasFixedComponents: true,
      usedScaRowAssignment: true,
      compAmounts: { BASIC: 10000, HRA: 5000, CONV: 1600 },
      ratio: 0.5,
      calcBasic: 0,
      calcHra: 0,
      calcSpecialAllowance: 0,
      convAllowanceDefault: 0,
      medicalAllowanceDefault: 0,
    });
    expect(components.find((c) => c.code === "BASIC")?.amount).toBe(5000);
    expect(components.find((c) => c.code === "HRA")?.amount).toBe(2500);
    expect(components.find((c) => c.code === "CONV")?.amount).toBe(800);
  });

  it("no duplicate earning component codes are ever produced, across assignment, structure-with-leftovers, and structure-only inputs", () => {
    const scenarios = [
      { hasFixedComponents: true, usedScaRowAssignment: true, compAmounts: { BASIC: 34700, HRA: 17350, CONV: 1600 }, ratio: 0.77, calcBasic: 0, calcHra: 0, calcSpecialAllowance: 21713.03, convAllowanceDefault: 0, medicalAllowanceDefault: 0 },
      { hasFixedComponents: true, usedScaRowAssignment: false, compAmounts: { BASIC: 4500, HRA: 2393, BONUS: 375, CONV: 1600, PORTFOLIO: 7000, SPECIAL: 7374 }, ratio: 1, calcBasic: 0, calcHra: 0, calcSpecialAllowance: 0, convAllowanceDefault: 0, medicalAllowanceDefault: 0 },
      { hasFixedComponents: false, usedScaRowAssignment: false, compAmounts: {}, ratio: 1, calcBasic: 5000, calcHra: 2500, calcSpecialAllowance: 3000, convAllowanceDefault: 800, medicalAllowanceDefault: 1250 },
    ];
    for (const scenario of scenarios) {
      const components = buildPayslipEarningComponents(scenario);
      const codes = components.map((c) => c.code);
      expect(new Set(codes).size).toBe(codes.length);
    }
  });

  it("assignment path with a structure genuinely lacking Portfolio (no leftover keys) reconciles exactly — the clean baseline", () => {
    const basic = 4500, hra = 2393, conv = 1600, bonus = 375, special = 7374;
    const trueResidual = conv + bonus + special; // 9349 — what calculateNetSalary's formula would compute as the residual
    const gross = basic + hra + trueResidual; // 16242

    const components = buildPayslipEarningComponents({
      hasFixedComponents: true,
      usedScaRowAssignment: true,
      compAmounts: { BASIC: basic, HRA: hra, CONV: conv }, // Portfolio genuinely absent — nothing to leak
      ratio: 1,
      calcBasic: 0,
      calcHra: 0,
      calcSpecialAllowance: trueResidual,
      convAllowanceDefault: 0,
      medicalAllowanceDefault: 0,
    });
    expect(components.find((c) => c.code === "PORTFOLIO")).toBeUndefined();
    expect(sum(components)).toBe(gross);
  });
});

describe("the calling code actually resets compAmounts and sources SPECIAL from the residual", () => {
  // Source-level assertions, matching this codebase's existing convention
  // (see variance-canonical-run.test.ts) for proving the WIRING is correct —
  // the pure-function tests above prove the LOGIC is correct given proper
  // inputs; these prove calculatePayrollRunScoped actually supplies them.
  const SOURCE = readFileSync(
    resolve(process.cwd(), "src/modules/payroll/payrollCalculate.service.ts"),
    "utf8",
  );

  it("clears compAmounts before repopulating it from scaRow", () => {
    const scaBlockStart = SOURCE.indexOf("if (scaRow && Number(scaRow.gross) > 0) {");
    expect(scaBlockStart).toBeGreaterThan(-1);
    const scaBlock = SOURCE.slice(scaBlockStart, scaBlockStart + 1500);
    expect(scaBlock).toMatch(/for \(const key of Object\.keys\(compAmounts\)\) delete compAmounts\[key\]/);
  });

  it("never sets compAmounts.SPECIAL from scaRow.special_allowance", () => {
    expect(SOURCE).not.toMatch(/compAmounts\.SPECIAL\s*=\s*Number\(scaRow\.special_allowance\)/);
  });

  it("calls the extracted, tested builder instead of inlining the loop again", () => {
    expect(SOURCE).toMatch(/const payslipEarnings = buildPayslipEarningComponents\(/);
    // Guards against a future edit re-inlining the old, unreset loop right
    // next to the new call — the whole point of extraction is one place.
    expect(SOURCE.match(/for \(const \[code, val\] of Object\.entries\(params\.compAmounts\)\)/g) ?? []).toHaveLength(1);
  });

  it("the caller still filters non-positive component amounts before batch insert", () => {
    expect(SOURCE).toMatch(/for \(const comp of payslipEarnings\) \{\s*\n\s*if \(comp\.amount <= 0\) continue;/);
  });

  it("did not touch reconcileNetAndDeductions or calculateNetSalary's call site", () => {
    // Gross/net arithmetic is explicitly out of scope for this fix.
    expect(SOURCE).toMatch(/reconcileNetAndDeductions\(/);
    expect(SOURCE).toMatch(/payrollService\.calculateNetSalary\(/);
  });
});
