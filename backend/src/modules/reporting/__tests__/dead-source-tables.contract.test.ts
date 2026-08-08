import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/**
 * Reports that query the wrong table, or filter on a column nobody populates.
 *
 * This class does not raise. The query is valid, the join resolves, the report renders — it
 * just returns rows that are not the rows asked for, or no rows at all. Every instance below
 * was found by counting rows in the live database rather than by reading the SQL, because the
 * SQL looks correct in all four cases.
 *
 * Measured against live mas_hrms on 2026-08-08.
 */
describe("reports must read the table that holds the data", () => {
  const routes = read("src/modules/reporting/report-suite.routes.ts");

  /** Slice one `case "<code>":` block out of the switch. */
  const block = (code: string) => {
    const start = routes.indexOf(`case "${code}":`);
    expect(start, `${code} branch not found`).toBeGreaterThan(-1);
    const next = routes.indexOf('\n    case "', start + 1);
    return routes.slice(start, next === -1 ? routes.length : next);
  };

  it("maternity-paternity-register does not select Medical Leave", () => {
    // 'ML' is Medical Leave in leave_type_master, not Maternity Leave. The old filter was
    // leave_code IN ('MAT','PAT','MATERNITY','PATERNITY','ML','PL'): four of those codes do
    // not exist, 'PL' is unused, and 'ML' matched 875 medical leave requests — 648 of them
    // belonging to men. The 13 real maternity/paternity rows (MTRL 2, PTRL 11) were all
    // excluded. Selecting on the leave NAME is what fixes it, because the master spells the
    // meaning out there while the codes have already drifted into four spellings of
    // "paternity" (PL, PML, PTRL, and MTRL for maternity).
    const sql = block("maternity-paternity-register");
    expect(sql).toContain("lt.leave_name REGEXP 'Maternity|Paternity'");
    expect(sql, "'ML' is Medical Leave — selecting it returns the wrong 875 rows").not.toMatch(
      /leave_code\s+IN\s*\([^)]*'ML'/,
    );
  });

  it("clearance-status-register reads exit_clearance_task, not the empty checklist table", () => {
    // Both tables exist. exit_clearance_checklist holds 0 rows; exit_clearance_task holds the
    // 16 rows the exit module actually writes. The report read the empty one and so reported
    // "no outstanding clearances" — the most reassuring possible way to be wrong.
    const sql = block("clearance-status-register");
    expect(sql).toContain("FROM exit_clearance_task");
    expect(sql).not.toContain("FROM exit_clearance_checklist");
  });

  it("clearance-status-register does not filter on a column that is always NULL", () => {
    // exit_request.submitted_at is NULL on 2 of 2 rows. `submitted_at BETWEEN ? AND ?` on a
    // NULL is UNKNOWN, so every row was dropped — the report still returned 0 even once it
    // was pointed at the right table. COALESCE to created_at, which the module does write,
    // and keep submitted_at first so the filter upgrades itself if it is ever populated.
    const sql = block("clearance-status-register");
    expect(sql).toContain("COALESCE(er.submitted_at, er.created_at) BETWEEN ? AND ?");
  });

  it("leave-encashment-register has no inline block shadowing its executor", () => {
    // The inline block queried `leave_encashment`, which does not exist — ER_NO_SUCH_TABLE,
    // so a guaranteed 500. Falling through reaches leaveEncashmentRegister, which raises
    // ReportSourceUnavailableError: the report reads as "blocked, no source" rather than
    // failing, and that is a materially different claim from an empty encashment register.
    expect(routes).not.toContain('case "leave-encashment-register":');
  });
});
