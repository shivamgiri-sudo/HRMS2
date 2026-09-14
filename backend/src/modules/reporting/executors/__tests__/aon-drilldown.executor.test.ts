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

  // Regression test for IMPORTANT-3 of the final whole-branch review: the headcount/shrinkage
  // response shape had no column distinguishing an active employee from an exited one, so
  // EmployeeListPanel could not know when to hide "Flag for Retention Review" -- a cohort-month
  // drill mixes both populations in this exact response shape (see the cohortMonth test below).
  it("headcount context SELECTs is_active on every row", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await aonDrilldownEmployees({ metric: "headcount", costCentreId: "cc-1" }, SCOPE, OPTIONS);
    const sql = String(mockExecute.mock.calls[0][0]);
    expect(sql).toMatch(/AS is_active/);
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
  // FILTERED when cohortMonth is present, or the drawer silently excludes since-left
  // employees and never reconciles against the cohort row's own joined/left-by-30d counts.
  //
  // The query DOES still reference active_status -- IMPORTANT-3 of the final whole-branch
  // review added `(e.active_status = 1) AS is_active` to every row unconditionally, precisely
  // so a cohort drill mixing active and exited employees can tell them apart. So this asserts
  // against the WHERE clause specifically, not the SQL text as a whole.
  it("does NOT filter by active_status when cohortMonth is present (drilling from Cohort Survival)", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await aonDrilldownEmployees({ metric: "headcount", cohortMonth: "2026-03" }, SCOPE, OPTIONS);
    const sql = String(mockExecute.mock.calls[0][0]);
    const whereClause = sql.slice(sql.indexOf("WHERE"), sql.indexOf(")\n    SELECT f.*"));
    expect(whereClause).not.toContain("active_status");
    // But the row shape must still carry is_active for the frontend to distinguish exited
    // employees from active ones in this same response.
    expect(sql).toContain("(e.active_status = 1) AS is_active");
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

  // Regression test for IMPORTANT-1 of the final whole-branch review: a managerId passed here
  // comes from clicking a `reporting_manager` dimension row in attritionDeepDive, which groups
  // exclusively by e.reporting_manager_id (see DEEP_DIVE_DIMENSIONS.reporting_manager in
  // aon.executor.ts). Before this fix the generic appendFilterConditions managerId clause
  // (`reporting_manager_id = ? OR manager_id = ?`) made the drill-down a SUPERSET of the
  // aggregate's own count — live-verified against mas_hrms: a manager row showing 46 exits
  // returned 123 drill-down rows (KAMAL SINGH) because of employees matching on manager_id
  // alone. The drill-down must filter on reporting_manager_id ONLY, with no OR.
  it("filters by reporting_manager_id ALONE for managerId, never the manager_id OR-union", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await aonDrilldownEmployees({ metric: "exits", managerId: "mgr-123" }, SCOPE, OPTIONS);
    const sql = String(mockExecute.mock.calls[0][0]);
    const params = mockExecute.mock.calls[0][1] as unknown[];
    expect(sql).toContain("e.reporting_manager_id = ?");
    expect(sql).not.toMatch(/reporting_manager_id\s*=\s*\?\s*OR\s*.*manager_id\s*=\s*\?/);
    expect(sql).not.toContain("e.manager_id = ?");
    // managerId must be bound exactly once, not twice (the OR-union's shape).
    expect(params.filter((p) => p === "mgr-123")).toHaveLength(1);
  });
});
