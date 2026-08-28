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
