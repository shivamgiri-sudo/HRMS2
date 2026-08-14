import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

/**
 * HRMS2 delta-audit, 2026-08-14 (P1, statutory): pfEcrFormat's eps_employer
 * column was a raw passthrough of spl.pf_employer — which stores the FULL
 * combined employer PF contribution (EPF 3.67% + EPS 8.33%), not the EPS-only
 * 8.33% share. Every ECR export therefore overstated EPS employer
 * contribution by the full EPF portion, understating EPF by the same amount
 * (silently, since the column total wasn't cross-checked against anything).
 *
 * pf-esic-salary-register elsewhere in this same file already derives EPS
 * correctly (8.33/12 of the combined total) — this pins pfEcrFormat to the
 * same formula. Column set is UNCHANGED: identity-spine.contract.test.ts
 * documents this file's columns as EPFO-mandated for direct portal upload;
 * this is a value fix, not a schema change.
 */
describe("pf-ecr-format eps_employer derives the EPS-only share, not the full employer PF total", () => {
  const source = read("src/modules/reporting/executors/statutory.executor.ts");
  const pfEcrBlock = source.slice(
    source.indexOf("export async function pfEcrFormat"),
    source.indexOf("try {", source.indexOf("export async function pfEcrFormat"))
  );

  it("no longer passes spl.pf_employer straight through as eps_employer", () => {
    expect(pfEcrBlock).not.toMatch(/COALESCE\(spl\.pf_employer,\s*0\)\s+AS\s+eps_employer/i);
  });

  it("derives eps_employer as 8.33/12 of the combined employer PF total, matching pf-esic-salary-register's existing formula", () => {
    expect(pfEcrBlock).toMatch(/spl\.pf_employer,\s*0\)\s*\*\s*8\.33\s*\/\s*12.*AS\s+eps_employer/is);
  });

  it("does not add any new column to the query — EPFO upload format is fixed", () => {
    // The exact column list this query has always returned. A new column here
    // would corrupt the government upload per identity-spine.contract.test.ts's
    // EXEMPT_WITH_REASON note for this same report code.
    const expectedColumns = [
      "employee_code",
      "uan",
      "member_name",
      "pf_wages",
      "epf_employee",
      "eps_employer",
      "run_month",
    ];
    for (const col of expectedColumns) {
      expect(pfEcrBlock, `missing expected column: ${col}`).toMatch(new RegExp(`AS\\s+${col}\\b|\\.${col}\\b|e\\.${col}\\b`, "i"));
    }
    // No stray "AS epf_employer" (the reverted, over-scoped addition).
    expect(pfEcrBlock).not.toMatch(/AS\s+epf_employer\b/i);
  });
});
