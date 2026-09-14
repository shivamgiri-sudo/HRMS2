import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The offer-approvals table showed one date column labelled "Joining" that was
 * really ats_employment_offer.date_of_joining -- whatever was typed into the
 * Employment Offer form, in practice the ATS walk-in date. The two dates Payroll
 * HR actually commits to (day 1 in office, and when salary generation starts)
 * live in ats_payroll_hr_validation and were never surfaced, so a branch head
 * approved against a date nobody had agreed to.
 *
 * All three are now distinct columns. These assertions read source because the
 * failure modes are invisible to a type checker: a join silently fans a
 * candidate out into duplicate rows, and a header/cell count mismatch shifts
 * every value one column left.
 */
const SERVICE = readFileSync(
  resolve(process.cwd(), "src/modules/ats/ats.onboarding.service.ts"),
  "utf8",
);
const PAGE = readFileSync(
  resolve(process.cwd(), "..", "src", "pages", "NativeBranchHeadApproval.tsx"),
  "utf8",
);
const QUERY = (() => {
  const fn = SERVICE.slice(SERVICE.indexOf("export async function listPendingApprovals"));
  const open = fn.indexOf("`");
  return fn.slice(open + 1, fn.indexOf("`", open + 1));
})();

describe("Offer approvals — Payroll HR joining dates", () => {
  it("selects both Payroll HR dates", () => {
    expect(QUERY).toContain("AS payroll_joining_date");
    expect(QUERY).toContain("AS payroll_salary_start_date");
  });

  it("reads them from ats_payroll_hr_validation, not from the offer row", () => {
    // ats_employment_offer has its own date_of_joining/date_of_salary pair. They
    // are a different thing -- sourcing from those would just relabel the same
    // walk-in date twice.
    const joining = QUERY.slice(QUERY.indexOf("AS payroll_joining_date") - 320, QUERY.indexOf("AS payroll_joining_date"));
    expect(joining).toContain("ats_payroll_hr_validation");
  });

  it("uses scalar subqueries so a second validation row cannot duplicate a candidate", () => {
    // candidate_id carries only INDEX idx_candidate -- no unique constraint --
    // so a LEFT JOIN would list the candidate once per validation row.
    for (const alias of ["pv2", "pv3"]) {
      const sub = QUERY.slice(QUERY.indexOf(`(SELECT ${alias}.`), QUERY.indexOf(`(SELECT ${alias}.`) + 260);
      expect(sub).toContain("LIMIT 1");
      expect(sub).toContain("ORDER BY");
    }
    expect(QUERY).not.toMatch(/JOIN\s+ats_payroll_hr_validation/i);
  });

  it("labels the offer's own date as ATS Walkin, not Joining", () => {
    expect(PAGE).toContain("'ATS Walkin'");
    expect(PAGE).toMatch(/'Joining \(Payroll HR\)'/);
    expect(PAGE).toMatch(/'Salary Start'/);
    // The bare 'Joining' header is what made the walk-in date look authoritative.
    expect(PAGE).not.toMatch(/\['Joining',/);
  });

  it("keeps header and cell counts equal, or every column shifts", () => {
    const headerBlock = PAGE.slice(
      PAGE.indexOf('<TableRow className="bg-slate-50'),
      PAGE.indexOf("].map(([label, cls])"),
    );
    const headers = headerBlock.match(/^\s*\['/gm)?.length ?? 0;
    const rowStart = PAGE.indexOf("function OfferRow");
    const rowEnd = PAGE.indexOf("\nfunction ", rowStart + 10);
    const cells = PAGE.slice(rowStart, rowEnd === -1 ? undefined : rowEnd).split("<TableCell").length - 1;
    expect(headers).toBeGreaterThan(0);
    expect(cells).toBe(headers);
  });
});
