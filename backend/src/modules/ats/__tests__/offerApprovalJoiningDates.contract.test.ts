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
  const fn = SERVICE.slice(
    SERVICE.indexOf("export async function listPendingApprovals"),
  );
  const open = fn.indexOf("`");
  return fn.slice(open + 1, fn.indexOf("`", open + 1));
})();

/**
 * listPendingApprovals was reshaped by ff58d4d67 (perf: eliminate N+1 on the
 * offer-approvals page). The two Payroll HR dates are no longer correlated
 * subqueries inside the main SELECT; they come from ONE batched query over
 * ats_payroll_hr_validation and are attached per candidate in JS. The contract
 * is unchanged — both dates, from the validation table, one row per candidate —
 * so the assertions follow the new shape rather than the old SQL text.
 */
const FN = (() => {
  const at = SERVICE.indexOf("export async function listPendingApprovals");
  const next = SERVICE.indexOf("export async function", at + 10);
  return SERVICE.slice(at, next === -1 ? undefined : next);
})();
const PV_QUERY = (() => {
  const from = FN.indexOf("FROM ats_payroll_hr_validation");
  return FN.slice(FN.lastIndexOf("`SELECT", from), FN.indexOf("`", from));
})();

describe("Offer approvals — Payroll HR joining dates", () => {
  it("selects both Payroll HR dates", () => {
    expect(PV_QUERY).toContain("AS latest_joining_date");
    expect(PV_QUERY).toContain("AS latest_salary_start_date");
    expect(FN).toMatch(/payroll_joining_date:\s*pv\?\.joiningDate\s*\?\?\s*null/);
    expect(FN).toMatch(/payroll_salary_start_date:\s*pv\?\.salaryStartDate\s*\?\?\s*null/);
  });

  it("reads them from ats_payroll_hr_validation, not from the offer row", () => {
    // ats_employment_offer has its own date_of_joining/date_of_salary pair. They
    // are a different thing -- sourcing from those would just relabel the same
    // walk-in date twice.
    expect(PV_QUERY).toContain("FROM ats_payroll_hr_validation");
    expect(PV_QUERY).toMatch(/pv\.joining_date[\s\S]{0,60}AS latest_joining_date/);
    expect(PV_QUERY).toMatch(/pv\.salary_start_date[\s\S]{0,60}AS latest_salary_start_date/);
    expect(PV_QUERY).not.toContain("ats_employment_offer");
    expect(FN).toMatch(/joiningDate:\s*\(r\.latest_joining_date/);
    expect(FN).toMatch(/salaryStartDate:\s*\(r\.latest_salary_start_date/);
  });

  it("takes one validation row per candidate so a second row cannot duplicate a candidate", () => {
    // candidate_id carries only INDEX idx_candidate -- no unique constraint --
    // so a LEFT JOIN would list the candidate once per validation row. The
    // batch picks the newest row per candidate and collapses to one row each;
    // the main query never joins the table at all.
    expect(PV_QUERY).toMatch(/ROW_NUMBER\(\) OVER \(\s*PARTITION BY candidate_id\s*ORDER BY/);
    expect(PV_QUERY).toContain("pv.rn = 1 THEN pv.joining_date");
    expect(PV_QUERY).toContain("pv.rn = 1 THEN pv.salary_start_date");
    expect(PV_QUERY).toContain("GROUP BY pv.candidate_id");
    expect(QUERY).toContain("FROM ats_employment_offer o");
    expect(QUERY).not.toContain("ats_payroll_hr_validation");
    expect(FN).not.toMatch(/JOIN\s+ats_payroll_hr_validation/i);
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
    const cells =
      PAGE.slice(rowStart, rowEnd === -1 ? undefined : rowEnd).split(
        "<TableCell",
      ).length - 1;
    expect(headers).toBeGreaterThan(0);
    expect(cells).toBe(headers);
  });
});
