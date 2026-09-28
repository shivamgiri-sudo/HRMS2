import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../db/mysql.js", () => ({
  db: { execute: vi.fn() },
}));

import { db } from "../../../../db/mysql.js";
import { newJoinExport, leftEmployeeExport } from "../employee.executor.js";
import type { ExecScope, ExecOptions } from "../types.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockExecute.mockReset();
});

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

describe("new-join-export honours month/year quick-filters over date_of_joining", () => {
  it("filters.month narrows the range to that calendar month", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await newJoinExport({ month: "2026-02" }, SCOPE, OPTIONS);
    const [sql, params] = mockExecute.mock.calls[0];
    expect(String(sql)).toContain("e.date_of_joining BETWEEN ? AND ?");
    // 2026 is not a leap year for Feb boundary purposes here — assert exact first/last day.
    expect(params).toContain("2026-02-01");
    expect(params).toContain("2026-02-28");
  });

  it("a leap-year month resolves the last day correctly (2028-02-29)", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await newJoinExport({ month: "2028-02" }, SCOPE, OPTIONS);
    const params = mockExecute.mock.calls[0][1];
    expect(params).toContain("2028-02-01");
    expect(params).toContain("2028-02-29");
  });

  it("filters.year (no month) narrows the range to that calendar year", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await newJoinExport({ year: "2025" }, SCOPE, OPTIONS);
    const params = mockExecute.mock.calls[0][1];
    expect(params).toContain("2025-01-01");
    expect(params).toContain("2025-12-31");
  });

  it("falls back to the existing from/to (year-to-date default) when neither is set", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await newJoinExport({}, SCOPE, OPTIONS);
    const params = mockExecute.mock.calls[0][1];
    const thisYear = new Date().getFullYear();
    expect(params).toContain(`${thisYear}-01-01`);
  });
});

describe("left-employee-export sources the last working day from exit_request first", () => {
  it("prefers exit_request's confirmed/proposed LWD over employees.date_of_leaving/date_of_exit", async () => {
    mockExecute.mockResolvedValueOnce([[], []]);
    await leftEmployeeExport({ from: "2026-01-01", to: "2026-12-31" }, SCOPE, OPTIONS);
    const sql = String(mockExecute.mock.calls[0][0]);
    expect(sql).toContain(
      "COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed, e.date_of_leaving, e.date_of_exit)",
    );
    // The old employees-only form must not remain as the filter/display source.
    expect(sql).not.toMatch(/BETWEEN \? AND \?[\s\S]*COALESCE\(e\.date_of_leaving, e\.date_of_exit\)\s*BETWEEN/);
  });
});
