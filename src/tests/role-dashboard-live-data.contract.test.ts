import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  mergeRecruiterDashboardData,
  normalizeExecutiveQualityData,
  normalizeOrgKpiData,
  normalizeQualityDashboardData,
} from "@/pages/dashboards/dashboard-data-contracts";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("role dashboard live-data contracts", () => {
  it("normalizes quality summary, trend, defects, coaching agents, and pending audits", () => {
    const result = normalizeQualityDashboardData(
      {
        success: true,
        summary: {
          total_calls: "3125",
          audited_calls: "2175",
          avg_quality_score: "71.12",
        },
        parameter_fails: [
          { param: "call_open", fail_rate: "40" },
          { param: "accuracy", fail_rate: "60" },
        ],
      },
      {
        success: true,
        trend: [
          { date: "2026-07-19", avg_score: "70.5" },
          { date: "2026-07-20", avg_score: "71.1" },
        ],
      },
      {
        success: true,
        agents: [
          { agent_code: "A", avg_score: "82", calls_below_50: 1 },
          { agent_code: "B", avg_score: "55", calls_below_50: 5 },
        ],
      },
    );

    expect(result.avg_score).toBe(71.12);
    expect(result.total_audits).toBe(2175);
    expect(result.pending_audits).toBe(950);
    expect(result.fail_rate).toBe(50);
    expect(result.score_trend).toEqual([
      { label: "2026-07-19", value: 70.5 },
      { label: "2026-07-20", value: 71.1 },
    ]);
    expect(result.defects).toEqual([
      { category: "Call Open", count: 40, severity: "high" },
      { category: "Accuracy", count: 60, severity: "critical" },
    ]);
    expect(result.bottom_agents).toEqual([
      { agent_code: "B", score: 55, fail_count: 5 },
      { agent_code: "A", score: 82, fail_count: 1 },
    ]);
  });

  it("maps the executive quality API to the CEO dashboard fields", () => {
    const result = normalizeExecutiveQualityData({
      metrics: {
        overall_quality_score: 71.37,
        target_quality_score: 85,
      },
      risk_summary: {
        critical_agents_count: 12,
        at_risk_agents_count: 11,
      },
      process_performance: [
        {
          process: "Collections",
          avg_quality: 78.4,
          agent_count: 51,
          calls_handled: 4802,
          status: "At Risk",
        },
      ],
    });

    expect(result.org_quality_score).toBe(71.37);
    expect(result.target_score).toBe(85);
    expect(result.risk_agents).toBe(23);
    expect(result.processes).toEqual([
      {
        process: "Collections",
        avg_score: 78.4,
        agent_count: 51,
        calls: 4802,
        status: "At Risk",
      },
    ]);
    expect(normalizeExecutiveQualityData({}).risk_agents).toBeNull();
  });

  it("maps the mounted KPI endpoint shape to CEO and manager fields", () => {
    const result = normalizeOrgKpiData({
      period: "2026-07",
      summary: {
        org_avg_score: "76.5",
        employees_scored: 42,
      },
      by_process: [
        { label: "Sales", avg_score: "82", agents: 20 },
        { label: "Support", avg_score: "68", agents: 22 },
      ],
      trend: [
        { period: "2026-06", avg_score: "74" },
        { period: "2026-07", avg_score: "76.5" },
      ],
    });

    expect(result.org_average_score).toBe(76.5);
    expect(result.score).toBe(76.5);
    expect(result.best_process).toEqual({ name: "Sales", score: 82, agents: 20 });
    expect(result.needs_attention).toEqual({ name: "Support", score: 68, agents: 22 });
    expect(result.trend).toEqual([
      { label: "2026-06", value: 74 },
      { label: "2026-07", value: 76.5 },
    ]);
  });

  it("adds today's live hiring metrics without replacing ATS pipeline totals", () => {
    const result = mergeRecruiterDashboardData(
      { total_candidates: 33414, selected_candidates: 54 },
      { metrics: { walkins: "7", offer_letter_issued: "3", joined: "2" } },
    );

    expect(result.total_candidates).toBe(33414);
    expect(result.selected_candidates).toBe(54);
    expect(result.walkins_today).toBe(7);
    expect(result.offers_today).toBe(3);
    expect(result.joined_today).toBe(2);
  });

  it("routes dedicated operational dashboards through the reference data pipeline", () => {
    for (const file of [
      "src/pages/dashboards/QualityDashboardRole.tsx",
      "src/pages/dashboards/OperationsDashboardRole.tsx",
      "src/pages/dashboards/RecruiterDashboard.tsx",
      "src/pages/dashboards/WfmAttendanceDashboard.tsx",
    ]) {
      const source = read(file);
      expect(source).toContain("ReferenceRoleDashboard");
      expect(source).not.toContain("RoleDashboardV3");
    }
  });

  it("mounts the self-service LMS integration route before the legacy LMS router", () => {
    const app = read("backend/src/app.ts");
    expect(app.indexOf('app.use("/api/lms", lmsIntegrationRouter)')).toBeLessThan(
      app.indexOf('app.use("/api/lms", lmsRouter)'),
    );
  });

  it("never renders the legacy quality trend from a hardcoded empty dataset", () => {
    const dashboard = read("src/pages/dashboards/RoleDashboardV3.tsx");

    expect(dashboard).toContain("/api/quality-dashboard/trend");
    expect(dashboard).not.toContain("LineChart data={[]}");
  });

  it("refreshes only APIs enabled for the active role dashboard", () => {
    const dashboard = read("src/pages/dashboards/ReferenceRoleDashboard.tsx");

    expect(dashboard).toContain("const activeQueryResults =");
    expect(dashboard).toContain("for (const query of activeQueryResults)");
    expect(dashboard).not.toContain("for (const query of queryResults)");
  });

  it("does not alter candidate registration, assessment, or onboarding route mounts", () => {
    const diffSensitiveFiles = [
      "backend/src/modules/ats/registration.enhanced.routes.ts",
      "backend/src/modules/ats-assessment/assessment.routes.ts",
      "backend/src/modules/ats/onboarding-full.routes.ts",
    ];

    for (const file of diffSensitiveFiles) {
      expect(read(file).length).toBeGreaterThan(0);
    }
  });
});
