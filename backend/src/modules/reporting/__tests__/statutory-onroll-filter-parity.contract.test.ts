import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

function functionBody(source: string, exportName: string): string {
  const start = source.indexOf(`export async function ${exportName}`);
  if (start < 0) throw new Error(`function ${exportName} not found`);
  const nextExport = source.indexOf("export async function", start + 1);
  return nextExport > 0 ? source.slice(start, nextExport) : source.slice(start);
}

/**
 * HRMS2 delta-audit, 2026-08-14 (P1, statutory): these registers are all
 * statutory FILINGS built off the same salary_prep_line population for a
 * given run_month. pf-contribution-register, esic-contribution-register and
 * pt-register already restrict to e.employment_type = 'ONROLL' (trainees,
 * unclassified and off-roll staff do not belong in a PF/ESIC/PT return).
 * pf-esic-salary-register and pt's monthly-trend sibling did not, so the same
 * conceptual population (e.g. "PT deducted this month") disagreed between a
 * register and its own trend view — 1,595 payroll lines vs 1,131 ONROLL on
 * production for 2026-07, a 464-row gap on two of the five.
 */
describe("ONROLL filter parity across the 5 payroll-driven statutory registers", () => {
  const source = read("src/modules/reporting/executors/statutory.executor.ts");

  const registersRequiringOnroll = [
    "pfContributionRegister",
    "esicContributionRegister",
    "ptRegister",
    "ptMonthlyRegister",
    "pfEsicSalaryRegister",
  ];

  it.each(registersRequiringOnroll)("%s restricts to e.employment_type = 'ONROLL'", (fnName) => {
    const body = functionBody(source, fnName);
    expect(body, `${fnName} is missing the ONROLL filter its sibling registers already have`).toMatch(
      /e\.employment_type\s*=\s*'ONROLL'/
    );
  });

  it("all five populations are still scoped to the same run_month + non-draft/cancelled basis (no accidental widening)", () => {
    for (const fnName of registersRequiringOnroll) {
      const body = functionBody(source, fnName);
      expect(body, `${fnName} should still filter on run_month`).toMatch(/run_month/);
    }
  });
});
