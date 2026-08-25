import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../db/mysql.js", () => ({
  db: { execute: vi.fn() },
}));

import { db } from "../../../../db/mysql.js";
import { aonDrilldownEmployees } from "../aon-drilldown.executor.js";
import type { ExecScope, ExecOptions } from "../types.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;

const SCOPE: ExecScope = {
  companyId: "co-1",
  isSuperAdmin: true,
  branchScope: { mode: "all", ids: [] },
  processScope: { mode: "all", ids: [] },
  departmentScope: { mode: "all", ids: [] },
  costCentreScope: { mode: "all", ids: [] },
  canViewAllEmployees: true,
  canViewSensitiveFields: true,
  canExportSensitiveReports: true,
  roles: ["super_admin"],
};

const OPTIONS: ExecOptions = { limit: 100, offset: 0, cursor: null, includeTotal: true, mode: "preview" };

describe("aonDrilldownEmployees", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("headcount context queries active employees with risk fields and employee_id", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await aonDrilldownEmployees({ metric: "headcount", costCentreId: "cc-1", aonBucket: "31-60" }, SCOPE, OPTIONS);
    const sql = String(mockExecute.mock.calls[0][0]);
    expect(sql).toContain("e.active_status = 1");
    expect(sql).toContain("risk_score");
    expect(sql).toContain("cost_centre_id = ?");
    expect(sql).toContain("employee_id");
  });

  it("exits context queries exited employees with exit date, tenure, and employee_id", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await aonDrilldownEmployees({ metric: "exits", costCentreId: "cc-1", aonBucket: "0-30" }, SCOPE, OPTIONS);
    const sql = String(mockExecute.mock.calls[0][0]);
    expect(sql).toContain("date_of_exit");
    expect(sql).not.toContain("active_status = 1");
    expect(sql).toContain("employee_id");
  });

  it("defaults to headcount context when metric is not provided", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await aonDrilldownEmployees({}, SCOPE, OPTIONS);
    const sql = String(mockExecute.mock.calls[0][0]);
    expect(sql).toContain("e.active_status = 1");
  });

  // Regression test for IMPORTANT-1 of the final whole-branch review: the exits branch
  // previously ignored filters.from/filters.to entirely, returning ALL historical exits for
  // the slice (capped only by the row limit) instead of the same date window the heatmap cell
  // that led here was built from.
  it("exits context applies an explicit from/to date window to date_of_exit", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await aonDrilldownEmployees(
      { metric: "exits", costCentreId: "cc-1", from: "2026-01-01", to: "2026-03-31" },
      SCOPE,
      OPTIONS,
    );
    const sql = String(mockExecute.mock.calls[0][0]);
    const params = mockExecute.mock.calls[0][1] as unknown[];
    expect(sql).toContain("e.date_of_exit BETWEEN ? AND ?");
    expect(params).toContain("2026-01-01");
    expect(params).toContain("2026-03-31");
  });

  it("exits context defaults to a twelve-month window when from/to are absent", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await aonDrilldownEmployees({ metric: "exits", costCentreId: "cc-1" }, SCOPE, OPTIONS);
    const sql = String(mockExecute.mock.calls[0][0]);
    const params = mockExecute.mock.calls[0][1] as unknown[];
    expect(sql).toContain("e.date_of_exit BETWEEN ? AND ?");
    // Both bounds must be real YYYY-MM-DD strings, not undefined/NaN, and to must not precede from.
    const [from, to] = params.filter((p): p is string => typeof p === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p)).slice(-2);
    expect(from).toBeDefined();
    expect(to).toBeDefined();
    expect(new Date(from!).getTime()).toBeLessThan(new Date(to!).getTime());
  });

  it("filters by cohortMonth for a headcount-context call, matching join-date month", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await aonDrilldownEmployees({ metric: "headcount", cohortMonth: "2026-03" }, SCOPE, OPTIONS);
    const sql = String(mockExecute.mock.calls[0][0]);
    expect(sql).toContain("DATE_FORMAT");
    const params = mockExecute.mock.calls[0][1];
    expect(params).toContain("2026-03");
  });

  // Regression test: a cohort-month drill must show everyone who joined that month,
  // INCLUDING those who have since left (see aonCohortSurvival's own doc comment and
  // AonAnalyticsView.tsx's CohortRow/CohortSurvival doc comment) — active_status must NOT be
  // filtered when cohortMonth is present, or the drawer silently excludes since-left
  // employees and never reconciles against the cohort row's own joined/left-by-30d counts.
  it("does NOT filter by active_status when cohortMonth is present (drilling from Cohort Survival)", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await aonDrilldownEmployees({ metric: "headcount", cohortMonth: "2026-03" }, SCOPE, OPTIONS);
    const sql = String(mockExecute.mock.calls[0][0]);
    expect(sql).not.toContain("active_status");
  });

  // The Overview-heatmap headcount call (aonBucket, no cohortMonth) is genuinely "who is
  // currently active in this AON bucket" and must keep filtering by active_status = 1 —
  // the cohortMonth fix above must not change this call's behaviour.
  it("still filters by active_status = 1 for a headcount call with aonBucket and no cohortMonth", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await aonDrilldownEmployees({ metric: "headcount", aonBucket: "90+" }, SCOPE, OPTIONS);
    const sql = String(mockExecute.mock.calls[0][0]);
    expect(sql).toContain("e.active_status = 1");
  });
});
