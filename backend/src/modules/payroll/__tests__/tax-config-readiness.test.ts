import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { financialYearForMonth, nextFinancialYear } from "../payroll-governance.service.js";

/**
 * taxEngineService refuses when payroll_tax_fy_config / payroll_tax_slab_master
 * hold no row for a financial year, rather than falling back to hardcoded slabs —
 * a stale rate under-deducts and the shortfall is the employer's liability.
 *
 * Refusing is right. Discovering it during the first payroll run of a new
 * financial year is not: the rates come from the Finance Act each February, and
 * nothing reminds anyone. Production is seeded for FY2025-26 and FY2026-27 only,
 * so FY2027-28 becomes a live problem on 2027-04-01.
 *
 * The readiness check surfaces it in advance. It cannot fix it — the rates do not
 * exist until the Budget, and inventing them would be worse than an empty table
 * because the engine would trust them.
 */

describe("financialYearForMonth", () => {
  it("treats April to March as one year, in the format the tax tables use", () => {
    expect(financialYearForMonth("2026-04")).toBe("2026-27");
    expect(financialYearForMonth("2026-08")).toBe("2026-27"); // today
    expect(financialYearForMonth("2026-12")).toBe("2026-27");
    expect(financialYearForMonth("2027-03")).toBe("2026-27"); // last month of the FY
  });

  it("rolls back for January to March, which belong to the previous April's year", () => {
    // The trap: calendar year is not financial year. March 2027 is still FY2026-27.
    expect(financialYearForMonth("2027-01")).toBe("2026-27");
    expect(financialYearForMonth("2027-04")).toBe("2027-28"); // first month of the next
  });

  it("matches the derivation payrollCalculate.service.ts uses", () => {
    // Both must agree, or readiness would clear a year the calculation then refuses.
    const CALC = readFileSync(
      resolve(process.cwd(), "src/modules/payroll/payrollCalculate.service.ts"),
      "utf8",
    );
    expect(CALC).toContain("const fyStartYear = month >= 4 ? year : year - 1;");
    for (const m of ["2026-03", "2026-04", "2026-08", "2027-01"]) {
      const [y, mo] = m.split("-").map(Number);
      const startYear = mo >= 4 ? y : y - 1;
      expect(financialYearForMonth(m)).toBe(`${startYear}-${String(startYear + 1).slice(2)}`);
    }
  });
});

describe("nextFinancialYear", () => {
  it("returns the year that begins the following April", () => {
    expect(nextFinancialYear("2026-08")).toBe("2027-28");
    expect(nextFinancialYear("2027-01")).toBe("2027-28"); // Jan is still FY2026-27
    expect(nextFinancialYear("2027-04")).toBe("2028-29");
  });
});

describe("the readiness check reflects how TDS actually runs", () => {
  const SOURCE = readFileSync(
    resolve(process.cwd(), "src/modules/payroll/payroll-governance.service.ts"),
    "utf8",
  );

  it("blocks only when the run is in auto TDS mode", () => {
    // The engine is only invoked when tds_mode is 'auto'. All 66 production runs
    // are 'manual', so an unconditional blocker would stop payroll over a
    // configuration gap that cannot affect it.
    const idx = SOURCE.indexOf("TAX_CONFIG_MISSING_FOR_RUN_FY");
    expect(idx).toBeGreaterThan(-1);
    expect(SOURCE.slice(idx, idx + 200)).toMatch(/tdsMode === "auto" \? "blocker" : "warning"/);
  });

  it("raises the next-year warning only in the last quarter of the financial year", () => {
    // Otherwise it would nag for nine months and be tuned out long before it matters.
    // January to March also guarantees the Budget has happened, so the rates exist.
    const idx = SOURCE.indexOf("TAX_CONFIG_MISSING_FOR_NEXT_FY");
    expect(idx).toBeGreaterThan(-1);
    expect(SOURCE.slice(Math.max(0, idx - 300), idx)).toMatch(/runMonthNum >= 1 && runMonthNum <= 3/);
  });

  it("names both tables to seed, so the warning is actionable", () => {
    expect(SOURCE).toMatch(/TAX_CONFIG_MISSING_FOR_NEXT_FY[\s\S]{0,600}payroll_tax_slab_master/);
  });

  it("does not invent tax rates anywhere", () => {
    // The check reports a gap; it must never paper over one. Rates come from the
    // Finance Act, and a guessed slab the engine trusts is worse than none.
    expect(SOURCE).not.toMatch(/INSERT INTO payroll_tax_(fy_config|slab_master)/i);
  });
});
