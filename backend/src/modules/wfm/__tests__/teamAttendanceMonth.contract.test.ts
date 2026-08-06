/**
 * The team month grid must not become a way to read someone else's team.
 *
 * This endpoint returns a manager's whole team for a whole month in one response,
 * which makes it the widest attendance read in the product. Two things keep it safe
 * and both are easy to lose in a refactor: the role gate decides who may ask, and the
 * scope predicate decides whose rows come back. A role check alone would let any
 * manager read any team.
 *
 * It also carries the one property nothing else has: a cell for every calendar day,
 * including days with NO attendance_daily_record row. That absence is
 * PARTIAL_ATTENDANCE_DAYS_MISSING — the blocker that refuses payroll when one employee
 * is missing one day. If a future change makes the response carry only rows that
 * exist, the grid goes quiet and the month looks closable when it is not.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const SOURCE = fs.readFileSync(
  path.resolve(__dirname, "..", "team-attendance-month.routes.ts"), "utf8");
const APP = fs.readFileSync(
  path.resolve(__dirname, "..", "..", "..", "app.ts"), "utf8");

describe("team-month grid is scoped and gated", () => {
  it("gates on role AND scopes rows — never one without the other", () => {
    expect(SOURCE).toMatch(/requireRole\(/);
    expect(SOURCE).toMatch(/e\.reporting_manager_id = \? OR e\.manager_id = \? OR e\.id = \?/);
  });

  it("only admin/hr/wfm-class roles escape the team predicate", () => {
    const at = SOURCE.indexOf("const isWide");
    expect(at).toBeGreaterThan(-1);
    const block = SOURCE.slice(at, at + 200);
    expect(block).toMatch(/hasRole\(/);
    for (const role of ["admin", "hr", "wfm", "ceo", "super_admin"]) {
      expect(block).toContain(`"${role}"`);
    }
    expect(block, "manager must not be treated as org-wide").not.toMatch(/"manager"/);
  });

  it("refuses a caller with no employee record rather than falling through unscoped", () => {
    const at = SOURCE.indexOf("if (!isWide)");
    const block = SOURCE.slice(at, at + 400);
    expect(block).toMatch(/callerEmp\?\.id/);
    expect(block).toMatch(/403/);
  });

  it("query filters can only narrow, never widen", () => {
    // branchId/processId/search must be APPENDED to the same WHERE that already
    // carries the team predicate. Reassigning `where` after the scope was pushed
    // would drop it and let a manager read anyone.
    const scopeAt = SOURCE.indexOf("e.reporting_manager_id = ?");
    expect(scopeAt).toBeGreaterThan(-1);

    const after = SOURCE.slice(scopeAt);
    expect(after).toMatch(/req\.query\.branchId/);
    // Every filter after the scope predicate appends; none rebuilds the array.
    expect(after, "`where` is reassigned after scoping — the team predicate would be lost")
      .not.toMatch(/\bwhere\s*=\s*\[/);
    expect(after, "`params` is reassigned after scoping")
      .not.toMatch(/\bparams\s*=\s*\[/);
  });

  it("returns a cell for every calendar day, not only days that have a record", () => {
    // The blocker is the ABSENCE of a row; a response built from rows alone cannot
    // express it.
    expect(SOURCE).toMatch(/Array\.from\(\{ length: win\.days \}/);
    expect(SOURCE).toMatch(/hasRecord: false/);
  });

  it("does not count days outside employment or in the future as gaps", () => {
    expect(SOURCE).toMatch(/applicable: false/);
    expect(SOURCE).toMatch(/date >= startsOn && date <= endsOn && date <= today/);
  });

  it("mirrors the payroll blockers when deciding a day needs attention", () => {
    const at = SOURCE.indexOf("function needsAttention");
    const block = SOURCE.slice(at, at + 500);
    expect(block).toMatch(/missing_punch/);
    expect(block).toMatch(/unreconciled/);
    expect(block).toMatch(/mismatch_flag/);
    expect(block).toMatch(/mismatch_resolved_at/);
  });

  it("drives the attendance query from employee ids so the index is usable", () => {
    // Driving from record_date alone scans every employee in the company for the
    // month and throws most of it away.
    expect(SOURCE).toMatch(/adr\.employee_id IN \(\$\{idPlaceholders\}\)/);
    expect(SOURCE).toMatch(/adr\.record_date BETWEEN \? AND \?/);
  });

  it("is mounted before the routers that share its prefix", () => {
    const mine = APP.indexOf("teamAttendanceMonthRouter);");
    const scoped = APP.indexOf("attendanceDailyScopedRouter);");
    expect(mine).toBeGreaterThan(-1);
    expect(scoped).toBeGreaterThan(-1);
    // /api/wfm/attendance/daily is already claimed three times and only the first
    // registration is ever reached; being first keeps /team-month reachable.
    expect(mine).toBeLessThan(scoped);
  });
});
