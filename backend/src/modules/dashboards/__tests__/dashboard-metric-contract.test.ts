import { describe, expect, it } from "vitest";

import {
  dashboardMetricSchema,
  dashboardSummarySchema,
} from "../../../shared/dashboardMetricContract.js";
import {
  adaptLegacyMetric,
  getDashboardMetricKeys,
} from "../dashboard-definition.service.js";

const scope = {
  level: "BRANCH_ALL" as const,
  branchIds: ["branch-1"],
  processIds: [],
  employeeIds: [],
  userId: "user-1",
  role: "branch_hr",
};

describe("canonical dashboard metric contract", () => {
  it("preserves a genuine zero as available", () => {
    const metric = adaptLegacyMetric(
      "ATTENDANCE",
      {
        value: 0,
        previousValue: null,
        target: 90,
        variance: -90,
        variancePct: -100,
        status: "critical",
        trend: "down",
        drilldownApi: "/api/example",
        actionUrl: null,
        detail: { present: 0, expectedToWork: 10 },
      },
      scope,
      new Date("2026-07-23T10:00:00.000Z"),
    );

    expect(metric.available).toBe(true);
    expect(metric.value).toBe(0);
    expect(metric.errorCode).toBeNull();
    expect(metric.numerator).toBe(0);
    expect(metric.denominator).toBe(10);
    expect(dashboardMetricSchema.parse(metric)).toEqual(metric);
  });

  it("does not convert an unavailable source to zero or healthy", () => {
    const metric = adaptLegacyMetric(
      "HEADCOUNT",
      {
        value: null,
        previousValue: null,
        target: null,
        variance: null,
        variancePct: null,
        status: "unknown",
        trend: null,
        drilldownApi: "/api/example",
        actionUrl: null,
        detail: {},
      },
      scope,
      new Date("2026-07-23T10:00:00.000Z"),
    );

    expect(metric.value).toBeNull();
    expect(metric.available).toBe(false);
    expect(metric.errorCode).toBe("SOURCE_UNAVAILABLE");
    expect(metric.status).toBe("unknown");
  });

  it("validates the complete summary envelope", () => {
    const metric = adaptLegacyMetric(
      "HEADCOUNT",
      {
        value: 12,
        previousValue: 10,
        target: 15,
        variance: -3,
        variancePct: -20,
        status: "warn",
        trend: "up",
        drilldownApi: "/api/example",
        actionUrl: null,
        detail: { active: 12 },
      },
      scope,
      new Date("2026-07-23T10:00:00.000Z"),
    );

    expect(() => dashboardSummarySchema.parse({
      dashboardCode: "HR_DASHBOARD",
      generatedAt: "2026-07-23T10:00:00.000Z",
      scope,
      metrics: { hc: metric },
    })).not.toThrow();
  });
});

describe("role-specific metric execution definitions", () => {
  it("does not return the same metric bundle for every dashboard", () => {
    expect(getDashboardMetricKeys("HR_DASHBOARD")).toEqual([
      "onb", "tat", "resign", "dpdp", "appointmentEsign", "bgv", "nm", "joiningDocEsign",
    ]);
    expect(getDashboardMetricKeys("WFM_DASHBOARD")).toEqual(["hc", "att"]);
    expect(getDashboardMetricKeys("PAYROLL_HR_DASHBOARD")).toEqual(["payroll", "incentive"]);
    expect(getDashboardMetricKeys("QUALITY_DASHBOARD")).toEqual([]);
  });

  it("returns no generic business bundle for Super Admin", () => {
    expect(getDashboardMetricKeys("SUPER_ADMIN_DASHBOARD")).toEqual([]);
  });
});
