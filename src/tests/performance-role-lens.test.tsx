import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  defaultPerformanceLens,
  PerformanceRoleLens,
} from "@/components/performance-hub/PerformanceRoleLens";
import type { PerformanceContext } from "@/types/performanceHub";

const baseContext: PerformanceContext = {
  effectiveRole: "team_leader",
  scopeLevel: "TEAM_ONLY",
  scopeLabel: "My team",
  canViewPeople: true,
  canSelectBranch: false,
  canSelectProcess: false,
  effectiveBranchIds: [],
  effectiveProcessIds: [],
  subjectEmployeeId: "employee-1",
};

describe("PerformanceRoleLens", () => {
  it.each([
    ["SELF_ONLY", "self"],
    ["TEAM_ONLY", "team"],
    ["PROCESS_ALL", "team"],
    ["BRANCH_ALL", "operations"],
    ["ORG_ALL", "operations"],
  ] as const)("defaults %s scope to the %s lens", (scopeLevel, expectedLens) => {
    expect(defaultPerformanceLens({
      ...baseContext,
      scopeLevel,
    })).toBe(expectedLens);
  });

  it("renders team leader tabs and decision focus", () => {
    const html = renderToStaticMarkup(<PerformanceRoleLens context={baseContext} />);

    expect(html).toContain("Team leader view");
    expect(html).toContain("Team health");
    expect(html).toContain("coaching");
  });

  it("keeps employee self-only view focused on the user", () => {
    const html = renderToStaticMarkup(
      <PerformanceRoleLens
        context={{
          ...baseContext,
          effectiveRole: "employee",
          scopeLevel: "SELF_ONLY",
          scopeLabel: "My performance",
          canViewPeople: false,
        }}
      />,
    );

    expect(html).toContain("Employee view");
    expect(html).toContain("My scorecard");
    expect(html).not.toContain("Team health");
  });

  it("shows branch/process operations lens for larger scopes", () => {
    const html = renderToStaticMarkup(
      <PerformanceRoleLens
        context={{
          ...baseContext,
          effectiveRole: "branch_head",
          scopeLevel: "BRANCH_ALL",
          scopeLabel: "Branch performance",
          canSelectBranch: true,
          canSelectProcess: true,
        }}
      />,
    );

    expect(html).toContain("Branch head view");
    expect(html).toContain("Operations lens");
    expect(html).toContain("branch and process movement");
  });
});
