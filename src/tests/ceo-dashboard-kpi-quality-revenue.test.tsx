import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { CeoReferenceLayout } from "@/pages/dashboards/reference/CeoReferenceLayout";
import {
  normalizeExecutiveQualityData,
  normalizeOrgKpiData,
} from "@/pages/dashboards/dashboard-data-contracts";
import type { ReferenceDashboardData } from "@/pages/dashboards/reference-dashboard-model";

/**
 * Three CEO-dashboard panels asserting things the data does not support. Every fixture
 * here is the payload the live system actually produced on 2026-08-28.
 */

function baseData(overrides: Partial<ReferenceDashboardData>): ReferenceDashboardData {
  return {
    variant: "ceo",
    summary: {} as never,
    metrics: {} as never,
    employee: {
      attendance: {}, balances: [], onboarding: {}, lms: {}, engagement: {},
      sourceErrors: [], sourceFreshness: {},
    },
    ats: {}, system: {}, workforce: {}, pnl: {}, payroll: {},
    biometric: {}, devices: {}, opsPulse: {},
    managerLeaves: [], managerInsights: {}, managerAccountability: [],
    quality: {}, orgKpi: {},
    loading: false,
    ...overrides,
  } as unknown as ReferenceDashboardData;
}

function render(data: ReferenceDashboardData): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CeoReferenceLayout data={data} filters={null} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ─── KPI Performance ──────────────────────────────────────────────────────────
/**
 * /api/kpi/org-summary picks a headline metric as "the percent, higher-is-better metric
 * with the most samples", excluding ATTENDANCE_PCT. In 2026-08 that resolves to
 * CONVERSION_RATE — sales conversion, averaging 9.10 — which the panel then displayed as
 * "Org Avg KPI Score 9.10 /100". The backend already returns metric_name saying exactly
 * which metric it is; the panel dropped it, so a CEO read a sales conversion rate as the
 * organisation scoring 9 out of 100 on its KPIs.
 */
const ORG_KPI_PAYLOAD = {
  success: true,
  data: {
    period: "2026-08",
    summary: {
      org_avg_score: "9.10",
      employees_scored: 62,
      metric_code: "CONVERSION_RATE",
      metric_name: "Sales Conversion Rate",
      metric_unit: "percent",
    },
    by_process: [
      { label: "IDAM Natural Wellness", avg_score: "12.41", agents: 11 },
      { label: "Bella-Vita Organic", avg_score: "11.09", agents: 10 },
      { label: "Neemans Private Limited", avg_score: "5.51", agents: 8 },
    ],
    by_metric: [],
    trend: [
      { period: "2026-07", avg_score: "9.73" },
      { period: "2026-08", avg_score: "9.10" },
    ],
  },
};

describe("normalizeOrgKpiData", () => {
  it("carries the headline metric name and unit through to the panel", () => {
    const result = normalizeOrgKpiData(ORG_KPI_PAYLOAD);

    expect(result.metric_name).toBe("Sales Conversion Rate");
    expect(result.metric_unit).toBe("percent");
  });

  it("carries the source-unavailable reason instead of silently reporting nothing", () => {
    const result = normalizeOrgKpiData({
      data: {
        period: "2026-08",
        summary: {},
        by_process: [],
        by_metric: [],
        trend: [],
        unavailableSources: { kpi: "No KPI actuals were recorded for 2026-08" },
      },
    });

    expect(result.unavailable).toBe("No KPI actuals were recorded for 2026-08");
  });
});

describe("CEO KPI Performance panel", () => {
  it("names the metric behind the headline number instead of calling it an org KPI score", () => {
    const html = render(baseData({ orgKpi: normalizeOrgKpiData(ORG_KPI_PAYLOAD) as never }));

    expect(html).toContain("Sales Conversion Rate");
    // "9.10 /100" framed a percentage metric as a score out of a hundred.
    expect(html).not.toContain("Org Avg KPI Score");
  });

  it("surfaces the reason when the KPI source returned nothing", () => {
    const html = render(baseData({
      orgKpi: normalizeOrgKpiData({
        data: {
          summary: {}, by_process: [], by_metric: [], trend: [],
          unavailableSources: { kpi: "No KPI actuals were recorded for 2026-08" },
        },
      }) as never,
    }));

    expect(html).toContain("No KPI actuals were recorded for 2026-08");
  });
});

// ─── Quality Overview ─────────────────────────────────────────────────────────
/**
 * Nine processes come back from the fixed executive-quality query. The table sliced to
 * six and said nothing about the three it dropped, and the "Quality vs Target" tile
 * printed the very same number as the "Org Quality Score" tile beside it.
 */
const QUALITY_PAYLOAD = {
  success: true,
  data: {
    metrics: { overall_quality_score: 73.59, target_quality_score: 85 },
    risk_summary: { critical_agents_count: 7, at_risk_agents_count: 8 },
    process_performance: [
      { process: "Clovia", avg_quality: 86.49, agent_count: 12, calls_handled: 1965, status: "On Track" },
      { process: "Client 487", avg_quality: 85.07, agent_count: 4, calls_handled: 601, status: "On Track" },
      { process: "Neemans", avg_quality: 82.44, agent_count: 11, calls_handled: 2316, status: "At Risk" },
      { process: "Client 417", avg_quality: 80.72, agent_count: 7, calls_handled: 463, status: "At Risk" },
      { process: "GNC", avg_quality: 71.66, agent_count: 6, calls_handled: 1651, status: "Critical" },
      { process: "Bellavita", avg_quality: 69.69, agent_count: 12, calls_handled: 6311, status: "Critical" },
      { process: "Viega", avg_quality: 67.04, agent_count: 1, calls_handled: 230, status: "Critical" },
      { process: "Du Digital BD", avg_quality: 54.39, agent_count: 3, calls_handled: 642, status: "Critical" },
      { process: "Exicom", avg_quality: 47.14, agent_count: 3, calls_handled: 310, status: "Critical" },
    ],
  },
};

describe("CEO Quality Overview panel", () => {
  it("lists every process, not just the first six", () => {
    const html = render(baseData({ quality: normalizeExecutiveQualityData(QUALITY_PAYLOAD) as never }));

    // Du Digital BD and Exicom are 8th and 9th — the two worst performers, and precisely
    // the rows a CEO needs. slice(0, 6) dropped them without saying so.
    expect(html).toContain("Du Digital BD");
    expect(html).toContain("Exicom");
    expect(html).toContain("Viega");
  });

  it("reports the gap against target rather than repeating the score", () => {
    const html = render(baseData({ quality: normalizeExecutiveQualityData(QUALITY_PAYLOAD) as never }));

    // 73.59 against a target of 85 is 11.41 points short.
    expect(html).toContain("11.41");
    expect(html).toContain("pts below target");
  });

  it("says when the quality source is unavailable rather than showing a zero score", () => {
    const html = render(baseData({
      quality: normalizeExecutiveQualityData({
        data: {
          metrics: { overall_quality_score: 0, target_quality_score: 85 },
          process_performance: [],
          risk_summary: {},
          data_status: "UNAVAILABLE",
          note: "Quality audit data is currently unavailable",
        },
      }) as never,
    }));

    expect(html).toContain("Quality audit data is currently unavailable");
  });
});

// ─── Revenue Gap MTD ──────────────────────────────────────────────────────────
describe("CEO Revenue Gap MTD tile", () => {
  it("shows no figure when the revenue-risk feed has never been generated", () => {
    const html = render(baseData({
      pnl: {
        kpis: {
          recognizedRevenue: 0,
          revenueAtRisk: null,
          revenueAtRiskUnavailable:
            "Revenue at risk has not been generated for this period — process_revenue_daily holds no rows.",
        },
      } as never,
    }));

    expect(html).toContain("Revenue Gap MTD");
    expect(html).toContain("Revenue-risk feed not generated");
  });

  it("still renders a real figure when the feed has run", () => {
    const html = render(baseData({
      pnl: { kpis: { recognizedRevenue: 4_50_00_000, revenueAtRisk: 12_50_000 } } as never,
    }));

    expect(html).toContain("12.50 L");
  });
});

// ─── Executive summary wording ────────────────────────────────────────────────
describe("CEO automated executive summary", () => {
  it("does not claim payroll readiness includes UAN", () => {
    const html = render(baseData({
      metrics: {
        payroll: { value: 882, available: true, detail: { readyCount: 882, blockerCount: 238 } },
      } as never,
    }));

    // getPayrollReadinessMetrics tests bank and PAN only; UAN is reported but not gated on.
    expect(html).not.toContain("complete bank, PAN and UAN details");
    expect(html).toContain("complete bank and PAN details");
  });
});
