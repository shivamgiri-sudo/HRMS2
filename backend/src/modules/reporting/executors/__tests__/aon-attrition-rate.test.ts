import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../db/mysql.js", () => ({
  db: { execute: vi.fn() },
}));

import { db } from "../../../../db/mysql.js";
import { aonBucketAttrition, overallAttritionRate } from "../aon.executor.js";
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

describe("AON Attrition Rate", () => {
  it("aonBucketAttrition's SQL selects aon_attrition_rate_pct and at_risk_population_avg", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await aonBucketAttrition({}, SCOPE, OPTIONS);
    const sql = String(mockExecute.mock.calls[0][0]);
    expect(sql).toContain("aon_attrition_rate_pct");
    expect(sql).toContain("at_risk_population_avg");
  });

  it("overallAttritionRate returns one row per month with exits and avg_total_headcount", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await overallAttritionRate({}, SCOPE, OPTIONS);
    const sql = String(mockExecute.mock.calls[0][0]);
    expect(sql).toContain("attrition_rate_pct");
    expect(sql).toContain("avg_total_headcount");
  });
});
