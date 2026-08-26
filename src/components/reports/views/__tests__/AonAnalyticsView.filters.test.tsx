import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * appendFilterConditions has always supported branchId, processId, departmentId and
 * costCentreId. The page exposed Branch only, so four working filters were unreachable.
 *
 * Separately, From/To were never passed to aon-bucket-headcount — the default metric — so on
 * first load changing the dates did nothing at all. Headcount is an as-of-today snapshot, so
 * the honest fix is to disable those inputs for that metric, not to fake the filtering.
 */
const SRC = readFileSync(
  resolve(process.cwd(), "src/components/reports/views/AonAnalyticsView.tsx"), "utf8");

describe("AON filters", () => {
  it("has state for all four dimension filters", () => {
    for (const s of ["branchId", "processId", "departmentId", "costCentreId"]) {
      expect(SRC, `${s} filter state missing`).toContain(`${s}, set`);
    }
  });

  it("loads each dropdown from a real endpoint", () => {
    // CRITICAL-3 (final whole-branch review): the cost-centre dropdown used to point at
    // /api/finance/cost-centres, which is role-gated to a narrower set than the AON page itself
    // (super_admin/admin/finance_head/accounts_head/finance/branch_head/branch_admin) -- every
    // other AON-eligible role (hr, hr_head, payroll, wfm, manager, process_manager, ceo) got a
    // silent 403 and an empty dropdown. /api/org/cost-centres is auth-only, honours
    // active_status, and returns the same { data: [...] } shape this file already expects.
    for (const url of ["/api/org/branches", "/api/org/processes",
                       "/api/org/departments", "/api/org/cost-centres"]) {
      expect(SRC, `${url} not called`).toContain(url);
    }
    expect(SRC, "must no longer call the role-gated finance endpoint")
      .not.toContain("/api/finance/cost-centres");
  });

  it("passes every filter into the report params", () => {
    // A filter absent from `base` is one the user can set and the server never sees.
    const base = /const base\s*=\s*\{[\s\S]{0,500}?\n  \}/.exec(SRC)?.[0] ?? "";
    for (const p of ["branchId", "processId", "departmentId", "costCentreId"]) {
      expect(base, `${p} never reaches the query`).toContain(p);
    }
  });

  it("does not pretend the date range filters headcount", () => {
    expect(SRC).toMatch(/as of today/i);
  });

  it("includes all four dimension filters in the headline query", () => {
    // The headline query must pass all four filters to the backend, not just branchId.
    // Extract the headline useReport call and verify it spreads all four filters.
    const headlineMatch = /const headline\s*=\s*useReport\([^)]*\{[\s\S]{0,800}?\}\s*\);/.exec(SRC)?.[0] ?? "";
    expect(headlineMatch, "headline query not found").toContain("useReport");
    expect(headlineMatch, "branchId not in headline filters").toContain("branchId");
    expect(headlineMatch, "processId not in headline filters").toContain("processId");
    expect(headlineMatch, "departmentId not in headline filters").toContain("departmentId");
    expect(headlineMatch, "costCentreId not in headline filters").toContain("costCentreId");
  });
});
