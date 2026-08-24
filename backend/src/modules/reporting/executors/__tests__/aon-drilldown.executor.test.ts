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
});
