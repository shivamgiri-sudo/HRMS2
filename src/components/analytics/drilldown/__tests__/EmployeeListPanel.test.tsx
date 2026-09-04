/**
 * EmployeeListPanel tests (Task 6 of the AON drill-down plan).
 *
 * Same deviation as DrillDownProvider.test.tsx / RosterPivotGrid.test.tsx: this repo does not
 * have @testing-library/react or jsdom installed, and vitest.config.ts runs frontend tests
 * under `environment: "node"` — there is no `render()`/`fireEvent.click()` DOM available.
 *   - Section A renders the REAL provider + a consuming component through `renderToStaticMarkup`,
 *     proving the panel's own mount-time wiring (via `useDrillDown()`) is correct.
 *   - Section B drives the exported pure helpers the component itself calls for data-fetch and
 *     the flag action, so the brief's fireEvent-based "renders rows / fires the flag action"
 *     intent is verified against the real, live logic rather than a re-implementation in the
 *     test. Critically, this asserts the flag call uses `employee_id` (the UUID Task 4's
 *     endpoint expects), never `employee_code`.
 */
import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/hrmsApi", () => ({
  hrmsApi: {
    get: vi.fn().mockResolvedValue({
      data: [
        {
          employee_id: "uuid-123",
          employee_code: "MAS1",
          employee_name: "Test One",
          aon_days: 45,
          risk_score: 62,
        },
      ],
    }),
    post: vi.fn().mockResolvedValue({ success: true, outcome: "created" }),
  },
}));

import { hrmsApi } from "@/lib/hrmsApi";
import { DrillDownProvider, useDrillDown } from "../DrillDownProvider";
import {
  EmployeeListPanel,
  buildEmployeeListFilterParams,
  fetchAonDrilldownEmployees,
  flagForRetentionReview,
  riskBandFor,
  shouldShowFlagButton,
  type EmployeeRow,
} from "../EmployeeListPanel";

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Section A — real render, mount-time wiring through useDrillDown()
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("EmployeeListPanel — mount", () => {
  it("renders inside a DrillDownProvider without crashing while the employee list is closed", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <DrillDownProvider>
          <EmployeeListPanel open metric="headcount" from="2026-01-01" to="2026-08-25" />
        </DrillDownProvider>
      </QueryClientProvider>,
    );
    // showEmployeeList defaults to false, so the Sheet content should not be in the static markup.
    expect(html).not.toContain("Employees in this slice");
  });

  it("throws outside a DrillDownProvider (guards against a missing wrapper)", () => {
    function Bare() {
      useDrillDown();
      return null;
    }
    expect(() => renderToStaticMarkup(<Bare />)).toThrow(
      "useDrillDown must be used inside a DrillDownProvider",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Section B — the real helpers the component's useQuery/useMutation call
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("EmployeeListPanel — data fetch", () => {
  it("fetchAonDrilldownEmployees hits the report endpoint and unwraps res.data", async () => {
    const rows = await fetchAonDrilldownEmployees({ metric: "headcount", from: "2026-01-01", to: "2026-08-25" });
    expect(hrmsApi.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/reports/suite/aon-drilldown-employees?"),
      60_000,
    );
    expect(rows).toEqual([
      expect.objectContaining({ employee_id: "uuid-123", employee_name: "Test One" }),
    ]);
  });

  it("buildEmployeeListFilterParams merges chips with metric/from/to", () => {
    const params = buildEmployeeListFilterParams(
      [{ dimension: "costCentre", value: "cc-1" }, { dimension: "aonBucket", value: "31-60" }],
      "headcount",
      "2026-01-01",
      "2026-08-25",
    );
    expect(params).toEqual(
      expect.objectContaining({
        metric: "headcount",
        from: "2026-01-01",
        to: "2026-08-25",
        costCentreId: "cc-1",
        aonBucket: "31-60",
      }),
    );
  });

  // Regression test for IMPORTANT-4 of the final whole-branch review: the page-level Branch
  // filter must reach the drilled Employee List query for Cohort Survival and Deep Dive, not
  // just Overview.
  it("buildEmployeeListFilterParams includes the page-level branchId when no chip overrides it", () => {
    const params = buildEmployeeListFilterParams(
      [{ dimension: "cohortMonth", value: "2026-03" }],
      "headcount",
      "2026-01-01",
      "2026-08-25",
      "branch-page-1",
    );
    expect(params).toEqual(
      expect.objectContaining({ branchId: "branch-page-1", cohortMonth: "2026-03" }),
    );
  });

  it("a `branch` dimension chip overrides the page-level branchId, never both/neither", () => {
    const params = buildEmployeeListFilterParams(
      [{ dimension: "branch", value: "branch-clicked-2" }],
      "exits",
      "2026-01-01",
      "2026-08-25",
      "branch-page-1",
    );
    expect(params.branchId).toBe("branch-clicked-2");
  });

  it("omits branchId entirely when the page-level filter is unset (unchanged prior behaviour)", () => {
    const params = buildEmployeeListFilterParams(
      [{ dimension: "aonBucket", value: "0-30" }],
      "exits",
      "2026-01-01",
      "2026-08-25",
    );
    expect(params.branchId).toBeUndefined();
  });

  // Same reconciliation fix as branchId (IMPORTANT-4) applied to the page-level
  // Designation filter, added 2026-09-04.
  it("includes the page-level designationId when no chip overrides it", () => {
    const params = buildEmployeeListFilterParams(
      [{ dimension: "cohortMonth", value: "2026-03" }],
      "headcount",
      "2026-01-01",
      "2026-08-25",
      undefined,
      "desig-page-1",
    );
    expect(params).toEqual(
      expect.objectContaining({ designationId: "desig-page-1", cohortMonth: "2026-03" }),
    );
  });

  it("a `designation` dimension chip overrides the page-level designationId", () => {
    const params = buildEmployeeListFilterParams(
      [{ dimension: "designation", value: "desig-clicked-2" }],
      "exits",
      "2026-01-01",
      "2026-08-25",
      undefined,
      "desig-page-1",
    );
    expect(params.designationId).toBe("desig-clicked-2");
  });

  it("branchId and designationId compose independently", () => {
    const params = buildEmployeeListFilterParams(
      [{ dimension: "aonBucket", value: "31-60" }],
      "headcount",
      "2026-01-01",
      "2026-08-25",
      "branch-page-1",
      "desig-page-1",
    );
    expect(params).toEqual(
      expect.objectContaining({ branchId: "branch-page-1", designationId: "desig-page-1", aonBucket: "31-60" }),
    );
  });
});

// Regression tests for IMPORTANT-3 of the final whole-branch review: a cohort-month drill can
// return an exited employee alongside active ones in the SAME headcount-context response, and
// flagging an already-exited employee for "retention review" is nonsensical.
describe("shouldShowFlagButton", () => {
  const baseRow: EmployeeRow = { employee_id: "e1", employee_code: "MAS1", employee_name: "X" };

  it("never shows the button for an exits-context row, regardless of is_active", () => {
    expect(shouldShowFlagButton("exits", { ...baseRow, is_active: true })).toBe(false);
    expect(shouldShowFlagButton("exits", baseRow)).toBe(false);
  });

  it("shows the button for an active headcount-context row", () => {
    expect(shouldShowFlagButton("headcount", { ...baseRow, is_active: true })).toBe(true);
    expect(shouldShowFlagButton("headcount", { ...baseRow, is_active: 1 })).toBe(true);
  });

  it("hides the button for an inactive/exited employee surfaced via a cohort headcount drill", () => {
    expect(shouldShowFlagButton("headcount", { ...baseRow, is_active: false })).toBe(false);
    expect(shouldShowFlagButton("headcount", { ...baseRow, is_active: 0 })).toBe(false);
  });

  it("defaults to showing the button when is_active is absent (pre-fix rows / other code paths)", () => {
    expect(shouldShowFlagButton("headcount", baseRow)).toBe(true);
    expect(shouldShowFlagButton("shrinkage", baseRow)).toBe(true);
  });
});

describe("EmployeeListPanel — Flag for Retention Review", () => {
  it("riskBandFor buckets scores into High/Medium/Low", () => {
    expect(riskBandFor(62)).toBe("High");
    expect(riskBandFor(40)).toBe("Medium");
    expect(riskBandFor(10)).toBe("Low");
    expect(riskBandFor(undefined)).toBe("Low");
  });

  it("flagForRetentionReview posts employeeId (the UUID), not employee_code", async () => {
    await flagForRetentionReview("uuid-123", 62);
    expect(hrmsApi.post).toHaveBeenCalledWith(
      "/api/reports/aon-analytics/flag-retention",
      expect.objectContaining({ employeeId: "uuid-123", riskBand: "High" }),
    );
    // The mocked report row's identity is employee_id, not employee_code — confirm the two are
    // not accidentally interchangeable in the payload the component sends.
    expect(hrmsApi.post).not.toHaveBeenCalledWith(
      "/api/reports/aon-analytics/flag-retention",
      expect.objectContaining({ employeeId: "MAS1" }),
    );
  });
});
