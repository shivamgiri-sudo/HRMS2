import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/**
 * CEO UAT Round 2 regression: on 01-Aug-2026 every attendance tile on /my-dashboard
 * rendered "—" (Present, Half Day, Absent, Late Marks, Attendance %). Round 1 showed 13.8%.
 *
 * The trigger was the calendar, not the data. 1 August was the first day of the month; the
 * caller had no attendance_daily_record rows in 2026-08 yet. SUM() over zero rows is NULL,
 * and an aggregate without GROUP BY still returns exactly one row — so the endpoint
 * answered with fourteen null fields rather than zeros, and asNumber(null) renders an
 * em-dash.
 *
 * Verified against production: the same query over an empty month returns
 * presentDays NULL / attendancePct NULL, and 0 / 0.0 once COALESCEd.
 *
 * Two independent guards, because either alone leaves the failure reachable:
 *   1. the endpoint coalesces, so it cannot emit nulls;
 *   2. the dashboard detects an all-null record, so a null payload from any source still
 *      falls through to the coalescing sibling endpoint.
 */
describe("my-dashboard attendance on an empty month", () => {
  const routes = read("backend/src/modules/wfm/wfm.routes.ts");
  const dashboard = read("src/pages/dashboards/ReferenceRoleDashboard.tsx");

  /** Comments stripped — negative assertions must not match the prose explaining them. */
  const strip = (source: string) =>
    source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");

  const routesCode = strip(routes);
  const dashboardCode = strip(dashboard);

  it("coalesces every tile the dashboard reads", () => {
    // The five the CEO saw as em-dashes, plus the denominator behind the percentage.
    // Every occurrence, not just the first — there are two aggregate blocks with the
    // identical defect (/my-attendance and /attendance/summary/:employeeId/:month), and
    // checking only the first left the second one broken through a full round of testing.
    for (const field of [
      "AS presentDays",
      "AS halfDays",
      "AS absentDays",
      "AS lateDays",
      "AS attendancePct",
      "AS expectedToWork",
    ]) {
      const occurrences = [...routesCode.matchAll(new RegExp(field.replace(/\$/g, "\\$"), "g"))];
      expect(occurrences.length, `${field} not found`).toBeGreaterThan(0);
      for (const match of occurrences) {
        // Look back far enough to span a multi-line COALESCE(ROUND(...), 0), which a
        // single-line window cannot see.
        const window = routesCode.slice(Math.max(0, match.index! - 400), match.index!);
        const selectItem = window.slice(window.lastIndexOf(",\n") + 1);
        expect(selectItem, `${field} is not coalesced`).toContain("COALESCE(");
      }
    }
  });

  it("does not keep an unreachable default object", () => {
    // rows[0] is always truthy for an aggregate without GROUP BY, so `?? {...}` never ran.
    // Leaving it in place implied a guard that did not exist, which is how this shipped.
    expect(routesCode).not.toMatch(/const data = \(rows as any\[\]\)\[0\] \?\?/);
    expect(routesCode).toContain("const data = (rows as any[])[0];");
  });

  it("treats an all-null attendance record as empty so the fallback is reachable", () => {
    expect(dashboardCode).toContain("attendanceHasValues");
    expect(dashboardCode).toContain("value !== null && value !== undefined");
    // The key-count test is what shadowed the fallback.
    expect(dashboardCode).not.toContain("Object.keys(attendanceRecord).length > 0 ? attendanceRecord");
  });
});
