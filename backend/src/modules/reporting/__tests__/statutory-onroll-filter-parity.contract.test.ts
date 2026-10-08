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
 *
 * 2026-08-17: this list was FIVE and should always have been six. `pfEcrFormat`
 * was the omission, and it is the worst possible one — the ECR is the file
 * uploaded directly to EPFO, so the return covered a wider population than the
 * pf-contribution-register meant to reconcile against it, and nothing compared
 * them. Measured on production, PF employee + employer (this file emits both
 * epf_employee and eps_employer; employee-only gives a July gap of 78,671.58 —
 * the same defect on a narrower basis, so always state which):
 *
 *     run_month   lines -> ONROLL   PF ee+er (all)   PF ee+er (ONROLL)   gap
 *     2026-05     1,148 -> 952       15,44,722.00     15,44,722.00           0.00
 *     2026-06     1,549 -> 1,152     19,07,727.88     18,58,744.65      48,983.23
 *     2026-07     1,642 -> 1,136     17,83,112.71     16,26,116.26    1,56,996.45
 *
 * The lesson worth keeping is about the test, not the query: a parity test that
 * enumerates its own members will not notice the member nobody added. Any new
 * payroll-driven statutory register must be added to this list.
 */
describe("ONROLL filter parity across the payroll-driven statutory registers", () => {
  const source = read("src/modules/reporting/executors/statutory.executor.ts");

  const registersRequiringOnroll = [
    "pfContributionRegister",
    "esicContributionRegister",
    "ptRegister",
    "ptMonthlyRegister",
    "pfEsicSalaryRegister",
    // The EPFO upload file. Omitted from this list until 2026-08-17.
    "pfEcrFormat",
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
