import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../db/mysql.js", () => ({
  db: { execute: vi.fn() },
}));

import { db } from "../../../../db/mysql.js";
import {
  aonBucketHeadcount,
  aonCohortSurvival,
  attritionDeepDive,
  AON_REFERENCE_JOIN_DATE_SQL,
} from "../aon.executor.js";
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

const OPTIONS: ExecOptions = {
  limit: 100,
  offset: 0,
  cursor: null,
  includeTotal: true,
  mode: "preview",
};

describe("AON reference date uses salary_start_date with date_of_joining fallback", () => {
  it("AON_REFERENCE_JOIN_DATE_SQL is the documented COALESCE expression", () => {
    expect(AON_REFERENCE_JOIN_DATE_SQL).toBe("COALESCE(e.salary_start_date, e.date_of_joining)");
  });

  it("aonBucketHeadcount's SQL references salary_start_date, not date_of_joining alone", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await aonBucketHeadcount({}, SCOPE, OPTIONS);
    const sql = String(mockExecute.mock.calls[0][0]);
    expect(sql).toContain("COALESCE(e.salary_start_date, e.date_of_joining)");
    // The old bare form must not appear anywhere in the bucket expression itself —
    // date_of_joining alone is still fine as the fallback INSIDE the COALESCE, so this
    // checks specifically that DATEDIFF is never called against date_of_joining directly.
    expect(sql).not.toMatch(/DATEDIFF\([^)]*,\s*e\.date_of_joining\)/);
  });

  it("aonCohortSurvival's SQL uses AON_REFERENCE_JOIN_DATE_SQL for cohort maturity and departure measures", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await aonCohortSurvival({}, SCOPE, OPTIONS);
    const sql = String(mockExecute.mock.calls[0][0]);
    // Must contain the COALESCE form in both leftBy (departure measure) and cohortAge (maturity measure)
    expect(sql).toContain("COALESCE(e.salary_start_date, e.date_of_joining)");
    // Must NOT contain bare DATEDIFF(..., e.date_of_joining) or LAST_DAY(e.date_of_joining)
    expect(sql).not.toMatch(/DATEDIFF\([^)]*,\s*e\.date_of_joining\)/);
    expect(sql).not.toMatch(/LAST_DAY\s*\(\s*e\.date_of_joining\s*\)/);
  });
});

describe("aonCohortSurvival drill-down ids", () => {
  it("aonCohortSurvival's SQL selects branch_id/cost_centre_id/process_id", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await aonCohortSurvival({}, SCOPE, OPTIONS);
    const sql = String(mockExecute.mock.calls[0][0]);
    expect(sql).toContain("b.id");
    expect(sql).toContain("cc.id");
    expect(sql).toContain("p.id");
  });
});

describe("attritionDeepDive dimension_id", () => {
  // NOTE: mockExecute.mock.calls accumulates across every "it" in this file (isolation
  // here is per-file, not per-test, and no beforeEach clears it), so "calls[0]" would
  // silently pick up whichever query ran first in the whole file rather than this test's
  // own call -- these two tests read the LATEST call instead, to stay correct regardless
  // of run order or how many tests precede them.
  const lastCallSql = () => {
    const calls = mockExecute.mock.calls;
    return String(calls[calls.length - 1][0]);
  };

  it("attritionDeepDive selects a dimension_id, populated for id-backed dimensions", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await attritionDeepDive({ dimension: "branch" }, SCOPE, OPTIONS);
    const sql = lastCallSql();
    expect(sql).toContain("dimension_id");
    expect(sql).toContain("b.id");
  });

  it("attritionDeepDive's dimension_id is NULL for a proxy dimension with no master table", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await attritionDeepDive({ dimension: "source" }, SCOPE, OPTIONS);
    const sql = lastCallSql();
    expect(sql).toMatch(/NULL\s+AS\s+dimension_id/i);
  });
});
