import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  effectiveType, isGlobalApprover, isWfmApprover, snapshotMatches, snapshotOf, spanDays, eachDate, isValidYmd, parseWarnings,
} from "../team-roster-types.js";
import { templateProblem } from "../team-roster-guards.js";

const BACKEND = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const read = (rel: string) => readFileSync(resolve(BACKEND, rel), "utf8");

describe("stored-cell helpers", () => {
  it("derives the effective type: week-off flag wins, then explicit type, then shift times", () => {
    expect(effectiveType({ is_week_off: 1, assignment_type: "SHIFT" })).toBe("WEEK_OFF");
    expect(effectiveType({ assignment_type: "TRAINING" })).toBe("TRAINING");
    expect(effectiveType({ assignment_type: null, shift_start_time: "09:00:00" })).toBe("SHIFT");
    expect(effectiveType({ assignment_type: "REGULAR", shift_template_id: "t1" })).toBe("SHIFT");
    expect(effectiveType({})).toBe("UNASSIGNED");
  });

  it("compares a stored row with the snapshot on id, type, flag, template and times", () => {
    const row = { id: "a1", assignment_type: "SHIFT", is_week_off: 0, shift_template_id: "t1", shift_start_time: "09:00:00", shift_end_time: "18:00:00" };
    const snap = snapshotOf(row);
    expect(snap.shiftStartTime).toBe("09:00");
    expect(snapshotMatches(snapshotOf(row), snap)).toBe(true);
    expect(snapshotMatches(snapshotOf({ ...row, shift_end_time: "19:00:00" }), snap)).toBe(false);
    expect(snapshotMatches(snapshotOf({ ...row, id: "a2" }), snap)).toBe(false);
    expect(snapshotMatches(null, snap)).toBe(false);
  });

  it("date helpers: validity, inclusive span, enumeration", () => {
    expect(isValidYmd("2026-02-30")).toBe(false);
    expect(isValidYmd("2026-10-01")).toBe(true);
    expect(spanDays("2026-10-01", "2026-10-31")).toBe(31);
    expect(eachDate("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });

  it("parses stored warnings defensively", () => {
    expect(parseWarnings('["a","b"]')).toEqual(["a", "b"]);
    expect(parseWarnings("not json")).toEqual([]);
    expect(parseWarnings(null)).toEqual([]);
  });

  it("role helpers: admin/super_admin are global approvers; WFM roles approve the final step", () => {
    expect(isGlobalApprover({ id: "u", roles: ["Admin"] })).toBe(true);
    expect(isWfmApprover({ id: "u", roles: ["branch_wfm"] })).toBe(true);
    expect(isWfmApprover({ id: "u", roles: ["manager", "employee"] })).toBe(false);
    expect(isWfmApprover({ id: "u", role: "wfm" })).toBe(true);
  });

  it("templateProblem: inactive, wrong process, not yet effective, expired, no times", () => {
    const t = { id: "t", shiftCode: "GEN", shiftName: "General", processId: "p1", start: "09:00:00", end: "18:00:00", night: false, active: true, effectiveFrom: "2026-10-05", effectiveTo: "2026-10-20" };
    expect(templateProblem(t, "p1", "2026-10-10")).toBeNull();
    expect(templateProblem(t, "p2", "2026-10-10")).toMatch(/process/);
    expect(templateProblem(t, null, "2026-10-10")).toMatch(/process/);
    expect(templateProblem({ ...t, active: false }, "p1", "2026-10-10")).toMatch(/not active/);
    expect(templateProblem(t, "p1", "2026-10-01")).toMatch(/not effective until/);
    expect(templateProblem(t, "p1", "2026-10-25")).toMatch(/expired/);
    expect(templateProblem({ ...t, end: null }, "p1", "2026-10-10")).toMatch(/no start\/end/);
    expect(templateProblem(undefined, "p1", "2026-10-10")).toMatch(/not found/);
  });
});

describe("migrations 1859 / 1860", () => {
  const ddl = read("sql/1859_roster_team_submission.sql");
  const access = read("sql/1860_team_roster_page_access.sql");
  const manifest = read("src/db/runPendingMigrations.ts");
  const snapshot = JSON.parse(read("sql/schema-snapshot.json")) as { tableCount: number; columnCount: number; tables: Record<string, string[]> };

  it("are registered in MIGRATION_MANIFEST", () => {
    expect(manifest).toContain('"1859_roster_team_submission.sql"');
    expect(manifest).toContain('"1860_team_roster_page_access.sql"');
  });

  it("create the four tables, additively, with no FKs and no destructive statements", () => {
    for (const t of ["roster_team_submission", "roster_team_submission_line", "roster_team_pending_cell", "roster_team_submission_audit"]) {
      expect(ddl).toContain(`CREATE TABLE IF NOT EXISTS ${t} (`);
    }
    expect(ddl).not.toMatch(/FOREIGN KEY|REFERENCES/i);
    expect(ddl).not.toMatch(/\b(DROP|DELETE|TRUNCATE|ALTER)\b\s/i);
    expect(ddl).not.toMatch(/ROW_FORMAT|utf8mb4_0900/);
  });

  it("copy id collations from the parent columns via information_schema, and pin the table collation", () => {
    for (const [table, col] of [["employees", "id"], ["employees", "user_id"], ["wfm_shift_template", "id"], ["wfm_roster_assignment", "id"]]) {
      expect(ddl).toMatch(new RegExp(`TABLE_NAME = '${table}' AND COLUMN_NAME = '${col}'`));
    }
    expect(ddl.match(/COLLATE=utf8mb4_unicode_ci/g)).toHaveLength(4);
    expect(ddl).toMatch(/PRIMARY KEY \(employee_id, roster_date\)/); // the race-safe overlap lock
    expect(ddl).toMatch(/UNIQUE KEY uq_rts_line_cell \(submission_id, employee_id, roster_date\)/);
    expect(ddl).toMatch(/UNIQUE KEY uq_rts_open_draft \(draft_owner_key\)/);
  });

  it("the schema snapshot lists exactly the created columns and its counts are consistent", () => {
    const created = (table: string) => {
      const body = ddl.slice(ddl.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`));
      const block = body.slice(0, body.indexOf(") ENGINE"));
      return [...block.matchAll(/^\s+'? ?(\w+) (?:BIGINT|CHAR|VARCHAR|DATE|DATETIME|TINYINT|LONGTEXT)/gm)].map((m) => m[1]);
    };
    for (const t of ["roster_team_submission", "roster_team_submission_line", "roster_team_pending_cell", "roster_team_submission_audit"]) {
      expect(snapshot.tables[t]).toEqual(created(t));
    }
    expect(snapshot.tableCount).toBe(Object.keys(snapshot.tables).length);
    expect(snapshot.columnCount).toBe(Object.values(snapshot.tables).reduce((n, c) => n + c.length, 0));
  });

  it("page access registers WFM_TEAM_ROSTER at /wfm/team-roster for the employee role too (managers hold only that role)", () => {
    expect(access).toMatch(/'WFM_TEAM_ROSTER', 'Team Roster', 'WFM', '\/wfm\/team-roster'/);
    expect(access).toMatch(/'employee'/);
    expect(access).toMatch(/FROM workforce_role_catalog c/);
    expect(access).toMatch(/ON DUPLICATE KEY UPDATE/);
  });
});
