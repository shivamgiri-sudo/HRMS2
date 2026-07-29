import { describe, expect, it } from "vitest";

import { adaptLegacyMetric } from "../dashboard-definition.service.js";
import type { MetricResult } from "../dashboard-metric.service.js";
import type { DashboardScope } from "../../../shared/dashboardScope.js";

/**
 * Three outcomes render as a blank-or-zero tile but need completely different
 * responses. Before this, all three collapsed into a single generic
 * "SOURCE_UNAVAILABLE", which is why a query against a nonexistent column looked
 * exactly like an empty table for three audit cycles.
 */
const scope: DashboardScope = {
  level: "ORG_ALL",
  branchIds: [],
  processIds: [],
  employeeIds: [],
  userId: "u1",
  role: "ceo",
};

const base: MetricResult = {
  value: null,
  previousValue: null,
  target: null,
  variance: null,
  variancePct: null,
  status: "unknown",
  trend: null,
  drilldownApi: "/api/dashboards/:dashboardCode/metric/HEADCOUNT/drilldown",
  actionUrl: null,
  detail: {},
};

const asOf = new Date("2026-07-29T00:00:00.000Z");

describe("dashboard metric error states", () => {
  it("reports a failed query with its driver code, not a generic message", () => {
    const metric = adaptLegacyMetric(
      "HEADCOUNT",
      {
        ...base,
        errorCode: "QUERY_FAILED",
        errorMessage: "ER_BAD_FIELD_ERROR: Unknown column 'foo' in 'field list'",
      },
      scope,
      asOf,
    );

    expect(metric.available).toBe(false);
    expect(metric.errorCode).toBe("QUERY_FAILED");
    expect(metric.errorMessage).toContain("ER_BAD_FIELD_ERROR");
  });

  it("distinguishes an empty source from a broken one, and keeps it available", () => {
    const metric = adaptLegacyMetric(
      "TAT",
      { ...base, value: 0, status: "ok", detail: { open: 0 }, sourceRowCount: 0 },
      scope,
      asOf,
    );

    // available stays true: the read succeeded, so this must NOT appear in the
    // dashboard's "sources unavailable" banner alongside genuine failures.
    expect(metric.available).toBe(true);
    expect(metric.errorCode).toBe("NO_DATA_IN_SOURCE");
    expect(metric.value).toBe(0);
  });

  it("leaves a genuine zero measurement unflagged", () => {
    const metric = adaptLegacyMetric(
      "TAT",
      { ...base, value: 0, status: "ok", detail: { open: 0 }, sourceRowCount: 42 },
      scope,
      asOf,
    );

    expect(metric.available).toBe(true);
    expect(metric.errorCode).toBeNull();
    expect(metric.value).toBe(0);
  });

  it("falls back to the legacy code when a metric reports no error detail", () => {
    const metric = adaptLegacyMetric("HEADCOUNT", { ...base }, scope, asOf);

    expect(metric.available).toBe(false);
    expect(metric.errorCode).toBe("SOURCE_UNAVAILABLE");
  });

  it("does not flag a metric that reports no row count at all", () => {
    const metric = adaptLegacyMetric(
      "HEADCOUNT",
      { ...base, value: 1342, status: "ok", detail: { active: 1342 } },
      scope,
      asOf,
    );

    expect(metric.available).toBe(true);
    expect(metric.errorCode).toBeNull();
  });
});
