import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PerformanceMetricGrid } from "@/components/performance-hub/PerformanceMetricGrid";
import { PerformancePeopleTable } from "@/components/performance-hub/PerformancePeopleTable";
import { PerformanceScopeBar } from "@/components/performance-hub/PerformanceScopeBar";
import { shouldShowPerformancePeople } from "@/types/performanceHub";

const teamContext = {
  effectiveRole: "team_leader",
  scopeLevel: "TEAM_ONLY" as const,
  scopeLabel: "My team",
  canViewPeople: true,
  canSelectBranch: false,
  canSelectProcess: false,
  effectiveBranchIds: [],
  effectiveProcessIds: [],
  subjectEmployeeId: "employee-1",
};

const verifiedMetric = {
  metricCode: "AHT" as const,
  label: "Average handle time",
  unit: "seconds" as const,
  value: 70,
  target: 80,
  achievementPct: 114.29,
  status: "on_track" as const,
  calculationStatus: "verified" as const,
  sourceSystems: ["apr"],
  recordCount: 50,
  latestComputedAt: "2026-07-18T10:00:00.000Z",
};

describe("Performance Hub presentation contracts", () => {
  it("shows the server-resolved scope and calculation freshness", () => {
    const html = renderToStaticMarkup(
      <PerformanceScopeBar
        context={teamContext}
        from="2026-07-01"
        to="2026-07-18"
        latestComputedAt="2026-07-18T10:00:00.000Z"
        onPeriodChange={() => undefined}
      />,
    );

    expect(html).toContain("My team");
    expect(html).toContain("Calculated");
  });

  it("labels legacy KPI facts as needing source verification", () => {
    const html = renderToStaticMarkup(
      <PerformanceMetricGrid
        metrics={[{ ...verifiedMetric, calculationStatus: "legacy_unverified" }]}
        loading={false}
      />,
    );

    expect(html).toContain("Needs source verification");
  });

  it("hides the people section for self-only context", () => {
    expect(shouldShowPerformancePeople({
      ...teamContext,
      scopeLevel: "SELF_ONLY",
      canViewPeople: false,
    })).toBe(false);
  });

  it("uses a semantic labelled table for team performance", () => {
    const html = renderToStaticMarkup(
      <PerformancePeopleTable
        people={{
          rows: [{
            employeeId: "employee-2",
            employeeCode: "MAS0002",
            employeeName: "Agent Two",
            branchName: "Delhi",
            processName: "Support",
            metrics: [verifiedMetric],
            overallAchievementPct: 114.29,
          }],
          total: 1,
          page: 1,
          pageSize: 25,
        }}
        loading={false}
      />,
    );

    expect(html).toContain('aria-label="Team performance"');
    expect(html).toContain("Agent Two");
  });
});
