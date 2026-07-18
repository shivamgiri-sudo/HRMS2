import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { RoleSalesPerformanceContent } from "@/components/performance-hub/RoleSalesPerformancePanel";
import type { PerformanceMetric } from "@/types/performanceHub";

function metric(overrides: Partial<PerformanceMetric>): PerformanceMetric {
  return {
    metricCode: "REVENUE",
    label: "Revenue",
    unit: "currency",
    value: 2400,
    target: null,
    achievementPct: null,
    status: "no_target",
    calculationStatus: "verified",
    sourceSystems: ["db_masmis.brand_sales"],
    recordCount: 4,
    latestComputedAt: "2026-07-18T10:00:00.000Z",
    ...overrides,
  };
}

describe("RoleSalesPerformanceContent", () => {
  it("renders manager sales metrics from Performance Hub facts", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <RoleSalesPerformanceContent
          variant="manager"
          loading={false}
          metrics={[
            metric({ metricCode: "REVENUE", label: "Revenue", value: 2400, unit: "currency" }),
            metric({ metricCode: "SALES_COUNT", label: "Sales count", value: 4, unit: "count" }),
            metric({ metricCode: "AOV", label: "Average order value", value: 600, unit: "currency" }),
          ]}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("Team sales performance");
    expect(html).toContain("Revenue");
    expect(html).toContain("₹2,400");
    expect(html).toContain("Formula verified");
    expect(html).toContain("/performance-hub");
  });

  it("shows a source-sync empty state when no sales facts are available", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <RoleSalesPerformanceContent variant="employee" loading={false} metrics={[]} />
      </MemoryRouter>,
    );

    expect(html).toContain("No sales facts for this period");
    expect(html).toContain("verified sales source sync");
  });
});
