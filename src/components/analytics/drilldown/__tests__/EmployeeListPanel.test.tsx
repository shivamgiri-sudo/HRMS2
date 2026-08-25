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
