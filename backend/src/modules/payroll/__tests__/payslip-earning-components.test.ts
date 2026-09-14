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
 * CONTRACT CHANGE 2026-08-30 — THE RESIDUAL IS GONE.
 * ------------------------------------------------
 * mas_hrms is becoming the ongoing payroll tool, so it must reproduce db_bill to the
 * rupee, not merely reach the same gross another way. db_bill stores SpecialAllowance
 * as a real component and prorates each component on its own:
 *
 *   <Component>1 = ROUND(<Component> * EarnedDays / WorkingDays)
 *   Gross1       = sum of the eight earned components
 *
 * A residual cannot match that. Correcting it to subtract EVERY in-gross sibling (not
 * conveyance alone) still landed within a rupee but not exact on 57 of 1,371 July lines,
 * because a residual compounds the rounding of each term it subtracts. Sourcing SPECIAL
 * straight from the assignment gives 0 mismatches at Rs 0 tolerance on all 1,371 July
 * lines, components and their sum alike (scripts/verify-calculator-parity-vs-dbbill.mjs).
 *
 * WHAT THIS MOVES. The reason SPECIAL was ever a residual is defect 2 below: the stored
 * value could be stale. That was a fact about the DATA, and it no longer holds -
 * salary_component_assignments is rebuilt from db_bill and satisfies Gross = sum-of-parts
 * on 1,080 of 1,080 active packages with zero drift. So the correctness guarantee has
 * moved OUT of this function and INTO the package data, and the last describe block pins
 * that dependency.
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
  const basic = 34700, hra = 17350, conv = 1600, bonus = 2891, portfolio = 15000;
  const special = 80096 - basic - hra - conv;   // 26446, the assignment's own value
  const gross_salary = 80096;

  it("with compAmounts reset to the assignment's own components, the total reconciles to gross exactly", () => {
    const components = buildPayslipEarningComponents({
      hasFixedComponents: true, usedScaRowAssignment: true,
      compAmounts: { BASIC: basic, HRA: hra, CONV: conv, SPECIAL: special },
      ratio: 1, calcBasic: 0, calcHra: 0, calcSpecialAllowance: 0,
      convAllowanceDefault: 0, medicalAllowanceDefault: 0,
    });
    expect(components.map((c) => c.code).sort()).toEqual(["BASIC", "CONV", "HRA", "SPECIAL"]);
    expect(components.find((c) => c.code === "PORTFOLIO")).toBeUndefined();
    expect(sum(components)).toBe(gross_salary);
  });

  it("an UNRESET compAmounts still overshoots — the caller reset is now the only thing preventing it", () => {
    // The honest consequence of dropping the residual. While SPECIAL was derived it
    // silently absorbed anything that leaked in, so the TOTAL stayed right even when the
    // itemisation was wrong. SPECIAL is now a stored value and absorbs nothing, so leakage
    // shows up in the total again — the more useful failure, because a wrong total is
    // detectable and a quietly wrong itemisation is not.
    const components = buildPayslipEarningComponents({
      hasFixedComponents: true, usedScaRowAssignment: true,
      compAmounts: { BASIC: basic, HRA: hra, CONV: conv, SPECIAL: special, BONUS: bonus, PORTFOLIO: portfolio },
      ratio: 1, calcBasic: 0, calcHra: 0, calcSpecialAllowance: 0,
      convAllowanceDefault: 0, medicalAllowanceDefault: 0,
    });
    expect(sum(components) - gross_salary).toBe(bonus + portfolio);
  });
});

describe("buildPayslipEarningComponents — MAS63025-equivalent (stored SPECIAL is authoritative)", () => {
  // Real production band (salary_package_master band G, 559 employees):
  //   basic 8000 + hra 4793 + conv 1600 + bonus 666 = gross 15059, special 0.
  // MAS63025 is the row that originally justified the residual: its stored
  // special_allowance was 0 while real gross existed. After the db_bill rebuild the
  // package is exact, so 0 here is the truth — the 666 hole belongs to BONUS.
  const basic = 8000, hra = 4793, conv = 1600, bonus = 666, special = 0;
  const gross_salary = basic + hra + conv + bonus + special; // 15059

  it("emits BONUS at its own value and no SPECIAL line, reconciling to gross exactly", () => {
    const components = buildPayslipEarningComponents({
      hasFixedComponents: true, usedScaRowAssignment: true,
      compAmounts: { BASIC: basic, HRA: hra, CONV: conv, BONUS: bonus, SPECIAL: special },
      ratio: 1, calcBasic: 0, calcHra: 0,
      calcSpecialAllowance: gross_salary - basic - hra,   // 2266 — deliberately ignored now
      convAllowanceDefault: 0, medicalAllowanceDefault: 0,
    });
    // The old residual path emitted SPECIAL=666 here: db_bill's Bonus, mislabelled.
    expect(components.find((c) => c.code === "SPECIAL")).toBeUndefined();
    expect(components.find((c) => c.code === "BONUS")?.amount).toBe(bonus);
    expect(sum(components)).toBe(gross_salary);
  });

  it("a band that does carry a special allowance emits it at its stored value", () => {
    const b = 9600, h = 4800, c = 1600, bo = 800, sp = 1617;
    const g = b + h + c + bo + sp;
    const components = buildPayslipEarningComponents({
      hasFixedComponents: true, usedScaRowAssignment: true,
      compAmounts: { BASIC: b, HRA: h, CONV: c, BONUS: bo, SPECIAL: sp },
      ratio: 1, calcBasic: 0, calcHra: 0, calcSpecialAllowance: 0,
      convAllowanceDefault: 0, medicalAllowanceDefault: 0,
    });
    expect(components.find((c2) => c2.code === "SPECIAL")?.amount).toBe(sp);
    expect(sum(components)).toBe(g);
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
    const gross = basic + hra + conv + bonus + special; // 16242

    const components = buildPayslipEarningComponents({
      hasFixedComponents: true,
      usedScaRowAssignment: true,
      // Portfolio genuinely absent. Every component the assignment holds is passed in,
      // SPECIAL included - that is the whole contract now.
      compAmounts: { BASIC: basic, HRA: hra, CONV: conv, BONUS: bonus, SPECIAL: special },
      ratio: 1,
      calcBasic: 0,
      calcHra: 0,
      calcSpecialAllowance: 0,
      convAllowanceDefault: 0,
      medicalAllowanceDefault: 0,
    });
    expect(components.find((c) => c.code === "PORTFOLIO")).toBeUndefined();
    expect(sum(components)).toBe(gross);
  });
});

describe("the calling code resets compAmounts and passes the assignment SPECIAL through", () => {
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

  it("sources compAmounts.SPECIAL from scaRow.special_allowance — the db_bill contract", () => {
    // Inverted 2026-08-30. This asserted the OPPOSITE, because the stored special_allowance
    // could be stale and was rebuilt downstream as a residual. The package is now rebuilt
    // from db_bill and exact, and db_bill computes SpecialAllowance1 directly. A residual
    // cannot reproduce that to the rupee. This assertion is load-bearing for parity: if the
    // caller stops passing SPECIAL through, the component disappears from every payslip.
    expect(SOURCE).toMatch(/compAmounts\.SPECIAL\s*=\s*Number\(scaRow\.special_allowance\)/);
  });

  it("no longer rebuilds SPECIAL from calculateNetSalary's residual", () => {
    expect(SOURCE).not.toMatch(/specialFromResidual/);
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

describe("buildPayslipEarningComponents — db_bill parity and proration", () => {
  const basic = 8000, hra = 4793, conv = 1600, bonus = 666;
  const pkgGross = basic + hra + conv + bonus; // 15059, special 0

  it("part month: every component prorates independently, as db_bill does", () => {
    const ratio = 26 / 31;
    const components = buildPayslipEarningComponents({
      hasFixedComponents: true, usedScaRowAssignment: true,
      compAmounts: { BASIC: basic, HRA: hra, CONV: conv, BONUS: bonus },
      ratio, ratioNumerator: 26, ratioDenominator: 31,
      calcBasic: 0, calcHra: 0, calcSpecialAllowance: 0,
      convAllowanceDefault: 0, medicalAllowanceDefault: 0,
    });
    const r2 = (n: number) => Math.round(n * 100) / 100;
    expect(components.find((c) => c.code === "BASIC")?.amount).toBe(r2((basic * 26) / 31));
    expect(components.find((c) => c.code === "BONUS")?.amount).toBe(r2((bonus * 26) / 31));
    expect(Math.abs(sum(components) - r2((pkgGross * 26) / 31))).toBeLessThanOrEqual(0.05);
  });

  it("reproduces db_bill's Bonus1 at a .5 rounding boundary", () => {
    // MAS60179, 2026-05. db_bill: Bonus 1333, EarnedDays 8.5, WorkingDays 31, Bonus1 = 366.
    // The exact value is 365.5 and db_bill rounds half up. A precomputed ratio cannot
    // reproduce it: 8.5/31 is not representable in binary floating point, so
    // 1333 * (8.5/31) = 365.49999999999994 and rounds DOWN to 365.
    const components = buildPayslipEarningComponents({
      hasFixedComponents: true, usedScaRowAssignment: true,
      compAmounts: { BONUS: 1333 },
      ratio: 8.5 / 31,        // the lossy form, deliberately still passed
      ratioNumerator: 8.5,    // the exact pair, which must win
      ratioDenominator: 31,
      calcBasic: 0, calcHra: 0, calcSpecialAllowance: 0,
      convAllowanceDefault: 0, medicalAllowanceDefault: 0,
    });
    expect(components.find((c) => c.code === "BONUS")?.amount).toBe(365.5);
  });

  it("falls back to the precomputed ratio when no pair is supplied", () => {
    const components = buildPayslipEarningComponents({
      hasFixedComponents: true, usedScaRowAssignment: true,
      compAmounts: { BASIC: 8000 }, ratio: 0.5,
      calcBasic: 0, calcHra: 0, calcSpecialAllowance: 0,
      convAllowanceDefault: 0, medicalAllowanceDefault: 0,
    });
    expect(components.find((c) => c.code === "BASIC")?.amount).toBe(4000);
  });
});
