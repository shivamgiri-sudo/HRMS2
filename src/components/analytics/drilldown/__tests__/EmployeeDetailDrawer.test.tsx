/**
 * EmployeeDetailDrawer tests (Task 7 of the AON drill-down plan).
 *
 * Same deviation as DrillDownProvider.test.tsx / EmployeeListPanel.test.tsx: this repo has no
 * @testing-library/react or jsdom installed (confirmed directly: `import "@testing-library/react"`
 * fails with "Cannot find package"), and vitest.config.ts runs frontend tests under
 * `environment: "node"` -- there is no DOM to drive a real click/render against.
 *   - Section A renders the REAL provider + EmployeeDetailDrawer through `renderToStaticMarkup`,
 *     proving the component's own mount-time wiring (via `useDrillDown()`) is correct and that it
 *     renders nothing when no employee is selected.
 *   - Section B drives the exported pure helpers the component itself calls for the fetch and the
 *     date formatting, verifying against the real, live logic rather than a re-implementation in
 *     the test. Critically, this asserts the fetch hits `GET /api/employees/:id` -- the dedicated
 *     employee-detail endpoint -- and never a list-report path.
 */
import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/hrmsApi", () => ({
  hrmsApi: {
    get: vi.fn().mockResolvedValue({
      data: {
        id: "emp-1",
        employee_code: "MAS1",
        first_name: "Test",
        last_name: "One",
        full_name: "Test One",
        employment_type: "Permanent",
        employment_status: "Active",
        date_of_joining: "2026-06-01",
        salary_start_date: "2026-06-01",
        date_of_exit: null,
        branch_id: "branch-1",
        department_id: "dept-1",
        process_id: "proc-1",
        active_status: 1,
      },
    }),
  },
}));

import { hrmsApi } from "@/lib/hrmsApi";
import { DrillDownProvider, useDrillDown } from "../DrillDownProvider";
import { EmployeeDetailDrawer, fetchEmployeeDetail, formatDate } from "../EmployeeDetailDrawer";

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Section A — real render, mount-time wiring through useDrillDown()
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("EmployeeDetailDrawer — mount", () => {
  it("renders inside a DrillDownProvider without crashing while no employee is selected", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <DrillDownProvider>
          <EmployeeDetailDrawer />
        </DrillDownProvider>
      </QueryClientProvider>,
    );
    // selectedEmployeeId defaults to null, so the Sheet content should not be in the static markup.
    expect(html).not.toContain("Assignment");
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
// Section B — the real helpers the component's useQuery calls
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe("EmployeeDetailDrawer — data fetch", () => {
  it("fetchEmployeeDetail hits GET /api/employees/:id and unwraps res.data, never a list report path", async () => {
    const emp = await fetchEmployeeDetail("emp-1");
    expect(hrmsApi.get).toHaveBeenCalledWith("/api/employees/emp-1");
    expect(hrmsApi.get).not.toHaveBeenCalledWith(expect.stringContaining("/api/reports"));
    expect(emp).toEqual(expect.objectContaining({ id: "emp-1", full_name: "Test One" }));
  });
});

describe("EmployeeDetailDrawer — formatDate", () => {
  it("formats an ISO date string as DD/MM/YYYY", () => {
    expect(formatDate("2026-06-01")).toBe("01/06/2026");
  });

  it("returns a placeholder for null/undefined without crashing", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
  });

  it("returns a placeholder for an invalid date string without crashing", () => {
    expect(formatDate("not-a-date")).toBe("—");
  });
});
