import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchSheet = vi.fn();
const countSheetEmployees = vi.fn();

vi.mock("../../../wfm/attendance-source-sheet.service.js", async (orig) => ({
  ...(await orig<
    typeof import("../../../wfm/attendance-source-sheet.service.js")
  >()),
  fetchSheet: (...a: unknown[]) => fetchSheet(...a),
  countSheetEmployees: (...a: unknown[]) => countSheetEmployees(...a),
}));

import {
  attendanceSourceSheet,
  loadAttendanceSourceSheet,
} from "../attendance-source-sheet.executor.js";
import type { ExecScope } from "../types.js";

const allScope = {
  companyId: "c1",
  isSuperAdmin: true,
  branchScope: { mode: "all", ids: [] },
  processScope: { mode: "all", ids: [] },
  departmentScope: { mode: "all", ids: [] },
  costCentreScope: { mode: "all", ids: [] },
  canViewAllEmployees: true,
  canViewSensitiveFields: false,
  canExportSensitiveReports: false,
  roles: ["super_admin"],
} as ExecScope;

const emp = {
  employeeId: "e1",
  employeeCode: "MAS10000",
  employeeName: "XYZ",
  branch: "Noida",
  costCentre: "CC1",
  process: "P",
  lob: null,
  attendanceSource: "APR",
  days: {
    "2026-09-01": {
      code: "P",
      status: "present",
      cosecMinutes: 540,
      aprMinutes: 485,
      payrollSource: "apr",
    },
    "2026-09-02": {
      code: "HD",
      status: "half_day",
      cosecMinutes: 520,
      aprMinutes: 425,
      payrollSource: "apr",
    },
    "2026-09-03": {
      code: "MP",
      status: "missing_punch",
      cosecMinutes: null,
      aprMinutes: null,
      payrollSource: "cosec",
    },
  },
};

describe("attendance-source-sheet executor", () => {
  beforeEach(() => {
    fetchSheet.mockReset().mockResolvedValue([emp]);
    countSheetEmployees.mockReset().mockResolvedValue(1);
  });

  it("summarises each employee's month: status counts and both duration totals", async () => {
    const res = await attendanceSourceSheet({ month: "2026-09" }, allScope, {
      limit: 100,
      offset: 0,
      cursor: null,
      includeTotal: true,
      mode: "preview",
    });
    expect(res.rows[0]).toMatchObject({
      employee_code: "MAS10000",
      attendance_source: "APR",
      present_days: 1,
      half_days: 1,
      absent_days: 0,
      missing_punch_days: 1,
      cosec_hours: 17.67,
      apr_hours: 15.17,
    });
    expect(res.rowCount).toBe(1);
  });

  it("passes the month and the caller's scope through to the query", async () => {
    await attendanceSourceSheet(
      { month: "2026-09", branchId: "b1" },
      allScope,
      {
        limit: 10,
        offset: 20,
        cursor: null,
        includeTotal: false,
        mode: "preview",
      },
    );
    const [sheetFilters, scopeSql, page] = fetchSheet.mock.calls[0];
    expect(sheetFilters).toEqual({ month: "2026-09" });
    expect(scopeSql).toEqual({ sql: "e.branch_id = ?", params: ["b1"] });
    expect(page).toEqual({ limit: 10, offset: 20 });
  });

  it("refuses to load the export when the population is over the cap", async () => {
    countSheetEmployees.mockResolvedValue(6000);
    const out = await loadAttendanceSourceSheet(
      { month: "2026-09" },
      allScope,
      5000,
    );
    expect(out.total).toBe(6000);
    expect(out.employees).toEqual([]);
    expect(fetchSheet).not.toHaveBeenCalled();
  });
});
