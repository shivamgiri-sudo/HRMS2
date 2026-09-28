import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Source-text contract tests for VendorPaymentDispatchPage.tsx's 2026-09-10 upgrade.
 * No rendering harness exists for this page (DashboardLayout + multiple useQuery hooks with
 * no test-time QueryClient/router setup) — same convention as
 * PnlMasterControlCenterPage.branch-filter.test.ts. Extended by later tasks in this plan.
 */

const SRC = readFileSync(
  new URL("../VendorPaymentDispatchPage.tsx", import.meta.url),
  "utf8",
);

describe("VendorPaymentDispatchPage — financialYear filter (Task 2)", () => {
  it("Filters interface declares financialYear", () => {
    expect(SRC).toMatch(/interface Filters \{[\s\S]*?financialYear: string;[\s\S]*?\}/);
  });

  it("initialFilters() sets financialYear to empty string", () => {
    expect(SRC).toMatch(/function initialFilters\(\): Filters \{[\s\S]*?financialYear: "",[\s\S]*?\}/);
  });

  it("defines financialYearOptions() generating YYYY-YY strings back to real-data floor 2017", () => {
    expect(SRC).toMatch(/function financialYearOptions\(\)/);
    expect(SRC).toMatch(/year >= 2017/);
    expect(SRC).toMatch(/\$\{year\}-\$\{String\(\(year \+ 1\) % 100\)\.padStart\(2, "0"\)\}/);
  });

  it("renders a financialYear Select (not a free-text Input) in the filter bar", () => {
    expect(SRC).toMatch(
      /value=\{filters\.financialYear \|\| "_all"\}[\s\S]{0,600}financialYearOptions\(\)\.map/
    );
  });
});

describe("VendorPaymentDispatchPage — Metric tile KPI strip + backlog query (Task 3)", () => {
  it("defines a local Metric tile component matching the sibling Finance page recipe", () => {
    expect(SRC).toMatch(/function Metric\(\{[\s\S]*?label[\s\S]*?value[\s\S]*?\}/);
    expect(SRC).toContain("rounded-2xl border");
    expect(SRC).toContain("uppercase tracking-[0.15em]");
  });

  it("queries GET /api/finance/grns/summary for the approval backlog", () => {
    expect(SRC).toContain('"/api/finance/grns/summary"');
    expect(SRC).toMatch(/queryKey:\s*\["grn-approval-summary"/);
  });

  it("derives pendingApproval from branch_head_approved + finance_head_approved buckets", () => {
    expect(SRC).toContain("branch_head_approved");
    expect(SRC).toContain("finance_head_approved");
  });

  it("renders the KPI strip as a Metric tile grid, not plain spans", () => {
    expect(SRC).toMatch(/grid grid-cols-2 md:grid-cols-5 gap-2/);
    expect(SRC).toMatch(/<Metric\s+label="Page due"/);
    expect(SRC).toMatch(/<Metric\s+label="Pending approval"/);
  });
});

describe("VendorPaymentDispatchPage — Approval Backlog panel (Task 4)", () => {
  it("declares a showBacklog toggle alongside showAging/showLedger", () => {
    expect(SRC).toMatch(/const \[showBacklog, setShowBacklog\] = useState\(false\);/);
  });

  it("renders a header button toggling showBacklog", () => {
    expect(SRC).toMatch(/onClick=\{\(\) => setShowBacklog\(\(v\) => !v\)\}/);
  });

  it("renders the backlog panel gated on showBacklog, listing both approval stages", () => {
    expect(SRC).toMatch(/\{showBacklog && \([\s\S]*?Approval Backlog[\s\S]*?\}\)\}/);
    expect(SRC).toMatch(/Branch Head[\s\S]{0,200}Finance Head/);
  });

  it("links out to the GRN approval page rather than adding new write actions here", () => {
    expect(SRC).toMatch(/href="\/finance\/grn|to="\/finance\/grn|navigate\(.\/finance\/grn/);
  });
});

describe("VendorPaymentDispatchPage — honest empty state (Task 5)", () => {
  it("empty-row branch explains the approval backlog when one exists, otherwise falls back to the plain message", () => {
    expect(SRC).toMatch(/No payments due for dispatch/);
    expect(SRC).toMatch(/awaiting approval before they reach this queue/);
    expect(SRC).toContain("No payments found");
  });

  it("empty-row branches on pendingApproval, not a hardcoded string", () => {
    expect(SRC).toMatch(/\(rows \?\? \[\]\)\.length === 0 &&[\s\S]{0,600}pendingApproval[\s\S]{0,600}/);
  });

  it("backlog message is suppressed once any filter is active, so it never blames the wrong cause", () => {
    expect(SRC).toMatch(/activeFilterCount === 0 && pendingApproval && pendingApproval\.count > 0 \?/);
  });
});

describe("VendorPaymentDispatchPage — honest scope badge (Task 6)", () => {
  it("PaymentCapabilities interface declares scopeBranchNames", () => {
    expect(SRC).toMatch(/interface PaymentCapabilities \{[\s\S]*?scopeBranchNames\??:\s*string\[\];[\s\S]*?\}/);
  });

  it("scope badge shows named branches for branch scope, not a generic 'branch scope' pill", () => {
    expect(SRC).toMatch(/capabilities\?\.scopeBranchNames/);
    expect(SRC).not.toMatch(/\{capabilities\.readScope\} scope/);
  });
});

describe("VendorPaymentDispatchPage — overdue chip, ledger tooltip, clearable month (Task 7)", () => {
  it("Due date cell shows an inline overdue chip using the existing agingDays() helper", () => {
    expect(SRC).toMatch(/agingDays\(p\.due_date\) > 0[\s\S]{0,200}days overdue/);
  });

  it("Ledger panel's Period column header carries a tooltip about accounting_period vs due_date", () => {
    expect(SRC).toMatch(/accounting_period[\s\S]{0,150}due_date/);
  });

  it("MonthYearPicker in the filter bar is clearable via emptyLabel", () => {
    // Bound widened 200->400 (2026-09-12): the element now also carries a longer
    // selectClassName prop for consistent filter-bar height, pushing emptyLabel further from
    // the opening tag with no change to the actual clearable-month behaviour this test checks.
    expect(SRC).toMatch(/<MonthYearPicker[\s\S]{0,400}emptyLabel="All months"/);
  });
});
