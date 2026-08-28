import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Two defects on the Attendance Control Tower, both of which made the page look
 * broken rather than fail:
 *
 * 1. The Issue Type dropdown was built from `summary.issueTypes`, which the
 *    service computed *after* applying the issue-type filter. Selecting a type
 *    therefore reduced the dropdown to that single type, and there was no way
 *    back to another one without clearing the filter.
 *
 * 2. Each per-source query was capped at `LIMIT 500` with nothing reported when
 *    the cap bit. On live data aprGaps was already at 492 for 2026-08, so the
 *    next day of dialler data would have silently dropped rows while
 *    `summary.totalGaps` still presented itself as a complete count.
 */

const { execute, query } = vi.hoisted(() => ({
  execute: vi.fn(),
  query: vi.fn().mockResolvedValue([[], []]),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute, query } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));
vi.mock("../payroll-governance.service.js", () => ({ payrollGovernanceService: { readiness: vi.fn() } }));
vi.mock("../../inbox/inbox.service.js", () => ({ inboxService: { createItem: vi.fn() } }));

import { payrollAttendanceControlService } from "../payroll-attendance-control.service.js";

/** One APR gap row shaped the way aprGaps' SELECT returns it. */
function aprRow(code: string, date: string) {
  return {
    employee_id: `emp-${code}`,
    employee_code: code,
    employee_name: code,
    branch_name: "NOIDA",
    process_name: "OPS",
    issue_date: date,
    apr_minutes: 500,
    adr_id: null,
    attendance_status: null,
    adr_minutes: 0,
    is_locked: 0,
    regularization_id: null,
  };
}

/** One NCOSEC gap row — a different issueType, so the dropdown must list both. */
function ncosecRow(code: string, date: string) {
  return {
    employee_id: `emp-${code}`,
    employee_code: code,
    employee_name: code,
    branch_name: "NOIDA",
    process_name: "OPS",
    issue_date: date,
    biometric_minutes: 600,
    total_punches: 2,
    adr_id: null,
    attendance_status: null,
    adr_minutes: 0,
    is_locked: 0,
    regularization_id: null,
  };
}

/**
 * Routes each query to a result by matching the SQL, so the service's real
 * control flow runs unchanged. Anything unrecognised returns no rows.
 */
function mockDb(opts: { apr?: unknown[]; ncosec?: unknown[] }) {
  execute.mockReset();
  execute.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM apr a") && sql.includes("HAVING adr_id IS NULL")) return [opts.apr ?? [], []];
    if (sql.includes("FROM integration_biometric_daily ibd")) return [opts.ncosec ?? [], []];
    if (sql.includes("FROM salary_prep_run")) return [[], []];
    return [[], []];
  });
}

const BASE = { runMonth: "2026-08", from: "2026-08-01", to: "2026-08-31" };

describe("issue-type dropdown does not collapse to the selected value", () => {
  beforeEach(() => query.mockClear());

  it("lists every issue type present, even while filtered to one of them", async () => {
    mockDb({ apr: [aprRow("MAS1", "2026-08-04")], ncosec: [ncosecRow("MAS2", "2026-08-05")] });

    const unfiltered = await payrollAttendanceControlService.getControlTower({ ...BASE });
    expect(unfiltered.summary.availableIssueTypes).toEqual(
      expect.arrayContaining(["dialler_missing_adr", "ncosec_missing_adr"]),
    );

    // Filtering to one type must not remove the others from the option list —
    // that is precisely what stranded the user before.
    const filtered = await payrollAttendanceControlService.getControlTower({
      ...BASE,
      issueType: "dialler_missing_adr",
    });

    expect(filtered.summary.availableIssueTypes).toEqual(
      expect.arrayContaining(["dialler_missing_adr", "ncosec_missing_adr"]),
    );
    // The rows themselves are still filtered; only the option list is broader.
    expect(filtered.gaps.every((g) => g.issueType === "dialler_missing_adr")).toBe(true);
    // Guard against a regression to the old source: issueTypes stays filtered,
    // so reading the dropdown from it would still collapse.
    expect(Object.keys(filtered.summary.issueTypes)).toEqual(["dialler_missing_adr"]);
  });

  it("keeps the selected type listed even when nothing currently matches it", async () => {
    mockDb({ apr: [], ncosec: [ncosecRow("MAS2", "2026-08-05")] });

    const result = await payrollAttendanceControlService.getControlTower({
      ...BASE,
      issueType: "dialler_missing_adr",
    });

    expect(result.gaps).toHaveLength(0);
    expect(result.summary.availableIssueTypes).toContain("dialler_missing_adr");
  });
});

describe("per-source row cap is reported rather than silently applied", () => {
  it("says nothing when the cap is not reached", async () => {
    mockDb({ apr: [aprRow("MAS1", "2026-08-04")] });
    const result = await payrollAttendanceControlService.getControlTower({ ...BASE });
    expect(result.summary.truncatedSources).toEqual([]);
  });

  it("names the clipped source once the query returns more than the cap", async () => {
    const cap = 5000;
    // The query fetches cap + 1 precisely so the overflow is detectable.
    const overflowing = Array.from({ length: cap + 1 }, (_, i) =>
      aprRow(`MAS${i}`, "2026-08-04"),
    );
    mockDb({ apr: overflowing });

    const result = await payrollAttendanceControlService.getControlTower({ ...BASE });

    expect(result.summary.sourceRowCap).toBe(cap);
    expect(result.summary.truncatedSources).toContain("apr");
  });
});

describe("gap queries are scoped to employees actually in force on the gap date", () => {
  it("excludes leavers by date rather than dropping every inactive employee", async () => {
    mockDb({});
    await payrollAttendanceControlService.getControlTower({ ...BASE });

    const sqls = execute.mock.calls.map(([sql]) => String(sql));
    const aprSql = sqls.find((s) => s.includes("FROM apr a") && s.includes("HAVING adr_id IS NULL"));
    expect(aprSql).toBeDefined();

    // Active employees always qualify...
    expect(aprSql).toContain("e.active_status = 1");
    // ...and an inactive one only for days on or before the day they left, so a
    // mid-month leaver keeps the days they actually worked for their settlement.
    expect(aprSql).toContain("e.date_of_leaving >= a.ReportDate");
    // A blanket active_status filter would have hidden those days entirely.
    expect(aprSql).not.toMatch(/AND\s+e\.active_status\s*=\s*1\s*(AND|\))/);
  });

  it("scopes each source on its own date column", async () => {
    mockDb({});
    await payrollAttendanceControlService.getControlTower({ ...BASE });
    const sqls = execute.mock.calls.map(([sql]) => String(sql));

    const expectations: [string, string][] = [
      ["FROM integration_biometric_daily ibd", "e.date_of_leaving >= ibd.activity_date"],
      ["FROM attendance_regularization ar", "e.date_of_leaving >= ar.session_date"],
    ];
    for (const [needle, clause] of expectations) {
      const sql = sqls.find((s) => s.includes(needle));
      expect(sql, `no query matched ${needle}`).toBeDefined();
      expect(sql).toContain(clause);
    }
  });
});

describe("gap drill-down resolves every key shape to an employee-day", () => {
  it.each([
    ["apr:emp-1:2026-08-04", "emp-1", "2026-08-04"],
    ["ncosec:emp-2:2026-08-05", "emp-2", "2026-08-05"],
    ["conflict:dialler-penalty:emp-3:2026-08-06", "emp-3", "2026-08-06"],
    ["conflict:biometric-penalty:emp-4:2026-08-07", "emp-4", "2026-08-07"],
  ])("parses %s", async (key, employeeId, issueDate) => {
    mockDb({});
    const detail = await payrollAttendanceControlService.getGapDetail(key);
    expect(detail?.employeeId).toBe(employeeId);
    expect(detail?.issueDate).toBe(issueDate);
    expect(detail?.window).toEqual({ from: issueDate, to: issueDate });
  });

  it("widens a salary key's run month into that month's range", async () => {
    mockDb({});
    const detail = await payrollAttendanceControlService.getGapDetail("salary:emp-9:2026-08");
    expect(detail?.window).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("looks the employee-day up for a regularization key, which carries only its own id", async () => {
    execute.mockReset();
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM attendance_regularization WHERE id = ?")) {
        return [[{ employee_id: "emp-7", session_date: "2026-08-11" }], []];
      }
      return [[], []];
    });
    const detail = await payrollAttendanceControlService.getGapDetail("regularization:reg-1");
    expect(detail?.employeeId).toBe("emp-7");
    expect(detail?.issueDate).toBe("2026-08-11");
  });

  it("returns null for an unparseable key instead of querying on undefined", async () => {
    mockDb({});
    expect(await payrollAttendanceControlService.getGapDetail("nonsense")).toBeNull();
  });
});
