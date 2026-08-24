import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../db/mysql.js", () => ({
  db: { execute: vi.fn() },
}));

import { db } from "../../../../db/mysql.js";
import { aonBucketHeadcount, AON_REFERENCE_JOIN_DATE_SQL } from "../aon.executor.js";
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
});
