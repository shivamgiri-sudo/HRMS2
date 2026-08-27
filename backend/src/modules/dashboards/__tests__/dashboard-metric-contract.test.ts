import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  dashboardMetricSchema,
  dashboardSummarySchema,
} from "../../../shared/dashboardMetricContract.js";
import {
  adaptLegacyMetric,
  getDashboardMetricKeys,
  isMetricConfiguredForDashboard,
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
        changePct: null,
        status: "critical",
        trend: "down",
        drilldownApi: "/api/example",
        actionUrl: null,
        // attendedDays, not present, is ATTENDANCE's numeratorKey — it is the value the
        // percentage is actually computed from (present + half a day per half day), so the
        // published numerator matches the published rate. Kept at 0 alongside present so
        // this still exercises a genuine zero rather than an unavailable metric.
        detail: { present: 0, attendedDays: 0, expectedToWork: 10 },
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

  it("uses the metric's own anchor date for asOf, not the request time it shares a parameter name with", () => {
    // getAttendanceMetrics anchors on the last substantially-processed day (often 1-2
    // days back) and attaches it as result.asOf — a bare date, e.g. "2026-08-11". The
    // function used to have its own Date parameter also named `asOf` (the request
    // time), which silently won every time because of the shared name: every metric's
    // asOf was "now", defeating the one freshness signal that says a two-day-old
    // attendance figure is old rather than broken.
    const generatedAt = new Date("2026-08-13T09:41:07.812Z");
    const metric = adaptLegacyMetric(
      "ATTENDANCE",
      {
        value: 78,
        previousValue: null,
        target: null,
        variance: null,
        variancePct: null,
        changePct: null,
        status: "ok",
        trend: null,
        drilldownApi: "/api/example",
        actionUrl: null,
        detail: {},
        asOf: "2026-08-11",
      },
      scope,
      generatedAt,
    );

    expect(metric.asOf).toBe("2026-08-11T00:00:00.000Z");
    expect(metric.asOf).not.toBe(generatedAt.toISOString());
    expect(dashboardMetricSchema.parse(metric)).toEqual(metric);
  });

  it("falls back to the request time when the metric didn't compute its own asOf", () => {
    const generatedAt = new Date("2026-08-13T09:41:07.812Z");
    const metric = adaptLegacyMetric(
      "HEADCOUNT",
      {
        value: 1337,
        previousValue: null,
        target: null,
        variance: null,
        variancePct: null,
        changePct: null,
        status: "ok",
        trend: null,
        drilldownApi: "/api/example",
        actionUrl: null,
        detail: {},
      },
      scope,
      generatedAt,
    );

    expect(metric.asOf).toBe(generatedAt.toISOString());
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
        changePct: null,
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
        changePct: null,
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
      "hc", "att", "docCompliance", "training", "leaveApprovals",
    ]);
    expect(getDashboardMetricKeys("WFM_DASHBOARD")).toEqual(["hc", "att", "attException", "biometric"]);
    expect(getDashboardMetricKeys("PAYROLL_HR_DASHBOARD")).toEqual([
      "payroll", "incentive", "salaryComponents", "attException",
    ]);
    expect(getDashboardMetricKeys("QUALITY_DASHBOARD")).toEqual(["hc", "att"]);
  });

  it("keeps salary component detail on the payroll dashboard only", () => {
    // CLAUDE.md: payroll/salary amounts must never be exposed through a non-payroll
    // surface. SALARY_COMPONENTS carries per-component rupee totals, so it belongs to
    // PAYROLL_HR_DASHBOARD alone — CEO and MANAGEMENT get readiness counts, not amounts.
    const dashboards = [
      "SUPER_ADMIN_DASHBOARD", "CEO_DASHBOARD", "HR_DASHBOARD", "WFM_DASHBOARD",
      "WFM_ATTENDANCE_DASHBOARD", "QUALITY_DASHBOARD", "OPERATIONS_DASHBOARD",
      "RECRUITER_DASHBOARD", "IT_MANAGER_DASHBOARD", "MANAGEMENT_DASHBOARD",
      "EMPLOYEE_SELF_DASHBOARD",
    ] as const;
    for (const code of dashboards) {
      expect(getDashboardMetricKeys(code), `${code} must not expose salary components`)
        .not.toContain("salaryComponents");
    }
    expect(getDashboardMetricKeys("PAYROLL_HR_DASHBOARD")).toContain("salaryComponents");
  });

  it("routes each new metric to the dashboards that own the work", () => {
    // Attendance exceptions block payroll, so WFM (who fix them) and Payroll (who are
    // blocked by them) both see the queue.
    expect(getDashboardMetricKeys("WFM_ATTENDANCE_DASHBOARD")).toContain("attException");
    expect(getDashboardMetricKeys("PAYROLL_HR_DASHBOARD")).toContain("attException");
    expect(getDashboardMetricKeys("HR_DASHBOARD")).toContain("docCompliance");
    expect(getDashboardMetricKeys("RECRUITER_DASHBOARD")).toContain("recruiterActivity");
    // Training surfaces on HR and Management; `trainer` keeps the self dashboard, so no
    // 13th dashboard is introduced for it.
    expect(getDashboardMetricKeys("MANAGEMENT_DASHBOARD")).toContain("training");
    expect(getDashboardMetricKeys("EMPLOYEE_SELF_DASHBOARD")).not.toContain("training");
  });

  it("gives every dashboard a non-empty metric bundle", () => {
    // SUPER_ADMIN, QUALITY and IT_MANAGER were empty arrays, so /summary returned
    // metrics:{} and SuperAdminReferenceLayout's four attendance-derived cards plus its
    // donut were permanently blank. An empty bundle is now a test failure.
    for (const code of ["SUPER_ADMIN_DASHBOARD", "QUALITY_DASHBOARD", "IT_MANAGER_DASHBOARD"] as const) {
      expect(getDashboardMetricKeys(code).length, `${code} has an empty metric bundle`).toBeGreaterThan(0);
    }
  });

  it("gives Super Admin the attendance detail its layout reads", () => {
    // SuperAdminReferenceLayout reads metricDetail(m,"att",…) for Present/On Leave/
    // Absent Today and the attendance donut, so "att" must be in the bundle.
    expect(getDashboardMetricKeys("SUPER_ADMIN_DASHBOARD")).toContain("att");
    expect(getDashboardMetricKeys("SUPER_ADMIN_DASHBOARD")).toContain("hc");
  });

  it("does not add metrics whose source table is empty in production", () => {
    // task_tat_instance holds no rows, so adding "tat" to a bundle ships a blank tile.
    // It stays only where it already existed.
    expect(getDashboardMetricKeys("SUPER_ADMIN_DASHBOARD")).not.toContain("tat");
    expect(getDashboardMetricKeys("QUALITY_DASHBOARD")).not.toContain("tat");
    expect(getDashboardMetricKeys("IT_MANAGER_DASHBOARD")).not.toContain("tat");
  });

  it("accepts drilldown and trend metrics only when they belong to the requested dashboard", () => {
    expect(isMetricConfiguredForDashboard("HR_DASHBOARD", "ONBOARDING")).toBe(true);
    expect(isMetricConfiguredForDashboard("WFM_DASHBOARD", "ATTENDANCE")).toBe(true);
    expect(isMetricConfiguredForDashboard("WFM_ATTENDANCE_DASHBOARD", "ATTENDANCE")).toBe(true);
    expect(isMetricConfiguredForDashboard("WFM_DASHBOARD", "ONBOARDING")).toBe(false);
    expect(isMetricConfiguredForDashboard("PAYROLL_HR_DASHBOARD", "ONBOARDING")).toBe(false);
  });

  it("enforces dashboard/metric pairing before drilldown and trend queries", () => {
    const routes = readFileSync(resolve(process.cwd(), "src/modules/dashboards/dashboard.routes.ts"), "utf8");
    const drilldown = routes.slice(
      routes.indexOf('router.get("/:dashboardCode/metric/:metricCode/drilldown"'),
      routes.indexOf('router.get("/:dashboardCode/metric/:metricCode/trend"'),
    );
    const trend = routes.slice(routes.indexOf('router.get("/:dashboardCode/metric/:metricCode/trend"'));

    expect(drilldown).toContain("requireDashboardMetric(dashboardCode, req.params.metricCode)");
    expect(trend).toContain("requireDashboardMetric(dashboardCode, req.params.metricCode)");
  });
});
