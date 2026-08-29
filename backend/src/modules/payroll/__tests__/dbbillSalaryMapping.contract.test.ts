import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * db_bill -> HRMS salary mapping contract.
 *
 * `db_bill.salary_data` carries two parallel sets of earning columns:
 *   Basic,  HRA,  Conv,  Bonus,  Portfolio,  ... Gross   full monthly ENTITLEMENT
 *   Basic1, HRA1, Conv1, Bonus1, Portfolio1, ... Gross1  EARNED (pro-rated)
 *
 * Every importer written before 2026-08-29 took the entitlement set. Measured over
 * all 129,696 salary_prep_line rows joined to db_bill on employee code + month
 * (100% matched): gross_salary equalled db_bill `Gross` on 129,696 of 129,696.
 * That one mis-mapping is the whole of the "net <> gross - deductions" finding.
 *
 * These assertions exist so a future edit cannot quietly reintroduce it, and so a
 * fourth divergent copy of the component map cannot appear.
 */

const ROOT = resolve(process.cwd(), "scripts");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const MAPPING = "lib/dbbill-salary-mapping.mjs";
const IMPORTERS = ["sync-salary-gap-from-dbbill.mjs", "resync-diff-months-salary.mjs"];

/** Strip comments so prose naming a retired column is not a false match. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Parse the COMPONENT_MAP tuples out of the module without importing it. */
function componentMap(): Array<[string, string, string, string]> {
  const src = read(MAPPING);
  const body = src.slice(src.indexOf("export const COMPONENT_MAP"), src.indexOf("];", src.indexOf("export const COMPONENT_MAP")));
  return [...body.matchAll(/\[\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\s*\]/g)]
    .map((m) => [m[1], m[2], m[3], m[4]] as [string, string, string, string]);
}

const COMPONENT_TYPES = ["earning", "deduction", "employer_cost"];

/** Entitlement column -> the earned column that must be used instead. */
const MUST_USE_EARNED: Record<string, string> = {
  Basic: "Basic1",
  HRA: "HRA1",
  Bonus: "Bonus1",
  Conv: "Conv1",
  Portfolio: "Portfolio1",
  MedicalAllowance: "MedicalAllowance1",
  SpecialAllowance: "SpecialAllowance1",
  OtherAllowance: "OtherAllowance1",
};

describe("db_bill salary mapping", () => {
  const map = componentMap();

  it("parsed the map — the assertions below are not vacuous", () => {
    expect(map.length).toBeGreaterThanOrEqual(27);
  });

  it("every component_type is a member of the live column enum", () => {
    for (const [codeName, , type] of map) {
      expect(COMPONENT_TYPES, `${codeName} has component_type '${type}'`).toContain(type);
    }
  });

  it("no head maps to an entitlement column that has an earned counterpart", () => {
    for (const [codeName, , , billCol] of map) {
      expect(
        Object.keys(MUST_USE_EARNED),
        `${codeName} maps to '${billCol}', the full-month entitlement. Use '${MUST_USE_EARNED[billCol]}'.`,
      ).not.toContain(billCol);
    }
  });

  it("carries the three heads no importer ever mapped", () => {
    // SHSH 54,953 rows / Rs 9,01,315 · ShortCollection 462 / Rs 8,50,876 · PLI 92.
    // Their money always reached the net through TotalDeduction, but no payslip
    // could tell the employee what the deduction was for.
    const codes = map.map(([c]) => c);
    for (const required of ["SHSH", "SHORT_COLL", "PLI"]) {
      expect(codes, `${required} is missing from COMPONENT_MAP`).toContain(required);
    }
  });

  it("names PORTFOLIO what the issued payslip calls it", () => {
    // db_bill's own SalarySlipMaster prints this head as PersonalAllowance, equal
    // to Portfolio1 on MAS54221 (3,238), MAS54639 (1,390), MAS54643 (1,345).
    const portfolio = map.find(([c]) => c === "PORTFOLIO");
    expect(portfolio?.[1]).toBe("Personal Allowance");
  });

  it.each(IMPORTERS)("%s reads no entitlement column for money", (file) => {
    const src = code(read(file));
    for (const entitlement of Object.keys(MUST_USE_EARNED)) {
      // `r.Basic` / `br.HRA` style property reads. The `1`-suffixed names are fine.
      const bad = new RegExp(`\\b(?:r|br|s)\\.${entitlement}\\b(?!1)`);
      expect(bad.test(src), `${file} reads entitlement column ${entitlement}`).toBe(false);
    }
  });

  it.each(IMPORTERS)("%s defines no second copy of the component map", (file) => {
    const src = code(read(file));
    // A literal tuple list would mean the map drifted out of the shared module again.
    expect(src).not.toMatch(/\[\s*'BASIC'\s*,\s*'Basic'/);
    expect(src).toContain("dbbill-salary-mapping.mjs");
  });

  it.each(IMPORTERS)("%s uses no INSERT IGNORE on a money table", (file) => {
    expect(code(read(file))).not.toMatch(/INSERT IGNORE INTO salary_prep/);
  });

  it.each(IMPORTERS)("%s writes no non-member enum value", (file) => {
    expect(code(read(file))).not.toContain("legacy_migration");
  });
});
