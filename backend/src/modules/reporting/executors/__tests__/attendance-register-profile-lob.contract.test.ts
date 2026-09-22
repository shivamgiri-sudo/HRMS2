import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Stakeholder feedback (Attendance Sheet report accuracy):
 *
 *   #9 "Incorrect Profile Name" — this report's `profile` column fell back to
 *      employment_type (e.g. "Permanent") whenever profile_type was blank, so
 *      an employee's employment type displayed mislabelled as their Profile.
 *      Every other report showing this same column (legacy-reports.service.ts,
 *      payroll.executor.ts, payroll-extended.routes.ts) leaves it blank instead —
 *      this report is now the same.
 *   #8 "Process LOB Name" — process_master.business_lob already exists and is
 *      shown on other reports (Process Master report), just never selected or
 *      catalogued here.
 */
const src = readFileSync(
  resolve(process.cwd(), "src/modules/reporting/executors/attendance.executor.ts"),
  "utf8",
);
const catalog = readFileSync(
  resolve(process.cwd(), "src/modules/reporting/report-catalog.ts"),
  "utf8",
);

describe("Attendance Register — Profile column has no employment_type fallback", () => {
  it("selects profile_type alone, not a fallback to employment_type", () => {
    expect(src).toContain("COALESCE(NULLIF(e.profile_type, ''), '') AS profile");
    expect(src).not.toContain("COALESCE(NULLIF(e.profile_type, ''), e.employment_type, '') AS profile");
  });
});

describe("Attendance Register — Process LOB Name", () => {
  it("selects process_master.business_lob as process_lob_name", () => {
    expect(src).toContain("COALESCE(p.business_lob, '') AS process_lob_name");
  });

  it("carries process_lob_name through both row-mapping stages (grouping + pivot output)", () => {
    const occurrences = (src.match(/process_lob_name/g) ?? []).length;
    // SELECT alias, empMap seed (row.*), and the final pivotRows return (emp.*) — 3 minimum.
    expect(occurrences).toBeGreaterThanOrEqual(3);
  });

  it("is declared as a column in the attendance-register-monthly catalog entry", () => {
    const start = catalog.indexOf('code: "attendance-register-monthly"');
    expect(start).toBeGreaterThanOrEqual(0);
    const nextCodeIdx = catalog.indexOf('code: "', start + 1);
    const segment = catalog.slice(start, nextCodeIdx === -1 ? catalog.length : nextCodeIdx);
    expect(segment).toContain('{ key: "process_lob_name"');
  });
});
