/**
 * Attendance vocabulary and date anchor must come from shared/attendanceStatus.ts.
 *
 * Attendance was computed five different ways across the product, so every surface
 * disagreed. The CEO UAT of 31-Jul-2026 reported the symptoms without being able to
 * see the cause:
 *   - /operations/dashboard "Attendance Rate 2.3%" against headcount 1152
 *   - /my-dashboard "Present 0 Days" beside "Attendance % 13.8%"
 *   - Daily Attendance Report returning 350 rows against 1152 employees
 *
 * Two distinct bugs produced the org-wide figure, both verified against prod:
 *
 * 1. WRONG DAY. getDashboardSummary anchored on
 *      MAX(record_date) WHERE record_date <= CURDATE()
 *    which resolves to TODAY. Attendance rows are written at start of day and
 *    reconciled overnight, so today is always partial. Measured on 2026-07-31:
 *      old anchor (today)      -> 705 rows,   0 present,  0.0%
 *      LATEST_COMPLETE anchor  -> 810 rows, 628 present, 88.2%
 *
 * 2. WRONG VOCABULARY. It excluded 'on_leave' and 'leave' — neither is a member of
 *    the live ENUM — while counting only 'present', which omits 'week_off_worked'.
 *
 * These assertions are on source text because the failure mode is a query using the
 * wrong words or the wrong anchor; there is no live database in this suite, and a
 * mocked one would simply return whatever the mock was told to.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_ATTENDANCE_STATUSES } from "../../../shared/attendanceStatus.js";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** Surfaces that compute attendance and must not hand-roll it. */
const CANON_CONSUMERS = [
  "src/modules/management/management.service.ts",
  "src/modules/wfm/wfm.routes.ts",
  "src/modules/dashboards/dashboard.routes.ts",
];

/** Values that look like attendance statuses but are not in the live ENUM. */
const PHANTOM_STATUSES = ["on_leave", "leave", "late"];

describe("attendance canon", () => {
  it.each(CANON_CONSUMERS)("%s imports the shared vocabulary", (file) => {
    expect(read(file)).toMatch(/from "\.\.[^"]*shared\/attendanceStatus\.js"/);
  });

  it.each(CANON_CONSUMERS)("%s invents no attendance status of its own", (file) => {
    const source = stripComments(read(file));
    // Any 'x' compared against attendance_status must be a real ENUM member.
    const compared = [
      ...source.matchAll(/attendance_status\s*(?:=|IN\s*\()\s*'([a-z_]+)'/g),
    ].map((m) => m[1]);
    const invented = [...new Set(compared)].filter(
      (s) => !(ALL_ATTENDANCE_STATUSES as readonly string[]).includes(s),
    );
    expect(
      invented,
      `not members of the attendance_status ENUM, so these comparisons match nothing ` +
        `and the figure silently reads 0`
    ).toEqual([]);
  });

  it.each(PHANTOM_STATUSES)(
    "management.service.ts no longer compares attendance_status against '%s'",
    (phantom) => {
      const source = stripComments(read("src/modules/management/management.service.ts"));
      expect(source).not.toMatch(new RegExp(`attendance_status[^\\n]*'${phantom}'`));
    },
  );

  it("management dashboard reads a completed attendance day, never today", () => {
    const source = stripComments(read("src/modules/management/management.service.ts"));
    expect(source).toContain("LATEST_COMPLETE_ATTENDANCE_DATE_SQL");
    // The old anchor. It resolves to today, which is always partially written.
    expect(
      source,
      "MAX(record_date) <= CURDATE() resolves to today, whose rows are created " +
        "before reconciliation — this is what produced the 2.3% figure"
    ).not.toMatch(/MAX\(record_date\)[\s\S]{0,80}?record_date\s*<=\s*CURDATE\(\)/);
  });

  it("management headcount matches the definition every other tile uses", () => {
    // The point of this test is unchanged — every surface must size the organisation the
    // same way — but the canonical definition changed on 2026-08-07.
    //
    // It used to be `active_status = 1 AND LOWER(COALESCE(employment_status,'active')) =
    // 'active'`. Measured against live mas_hrms that returns 1,123 while employee-master,
    // the payroll register and every employee-grain report return 1,125, because two real
    // employees carry active_status = 1 with employment_status 'inactive'/'resigned'.
    // It also silently excluded anyone on probation, notice or suspension — including from
    // the payroll-readiness denominator, so their missing bank details never raised a flag.
    //
    // Ruling: active_status = 1 alone. Contradictory flags are a data-quality problem to
    // surface in an exception report, not a reason for two tiles to disagree.
    const surfaces = {
      "management.service.ts": stripComments(read("src/modules/management/management.service.ts")),
      "dashboard-metric.service.ts": stripComments(read("src/modules/dashboards/dashboard-metric.service.ts")),
      "employee.executor.ts": stripComments(read("src/modules/reporting/executors/employee.executor.ts")),
    };

    const supersededFilter = /employment_status\s*,\s*'active'\)\)\s*=\s*'active'/;
    for (const [name, source] of Object.entries(surfaces)) {
      expect(
        source,
        `${name} still narrows headcount by employment_status. That is the superseded ` +
          `definition and makes this surface report a different organisation size from the rest.`
      ).not.toMatch(supersededFilter);
      expect(source, `${name} must filter on active_status`).toMatch(/active_status\s*=\s*1/);
    }
  });

  it("the self-service attendance summary shares the org-wide numerator", () => {
    const source = stripComments(read("src/modules/wfm/wfm.routes.ts"));
    // presentDays and the percentage numerator must be the same expression, or the
    // two tiles measure different things and read as a contradiction.
    //
    // The COALESCE(..., 0) wrapper is permitted and expected: an empty month returns one
    // row of NULLs rather than zero rows, which blanked every tile on /my-dashboard on
    // 1 August. What matters here is that the canonical helper is what gets wrapped — a
    // hand-rolled expression in its place is the drift this guards against.
    expect(source).toMatch(/\$\{presentSql\(\)\}(?:,\s*0\))?\s+AS presentDays/);
    expect(source).toMatch(/\$\{attendedDaysSql\(\)\}\s*\/\s*NULLIF\(\$\{expectedToWorkSql\(\)\}/);
  });

  it("live tracker resolves today in IST, not UTC", () => {
    const source = stripComments(read("src/modules/wfm/liveTracker.service.ts"));
    expect(
      source,
      "toISOString() is UTC, so before 05:30 IST the tracker queried yesterday's " +
        "roster — during the night shift, which is when it is actually watched"
    ).not.toMatch(/new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/);
    expect(source).toContain("istToday");
  });
});
