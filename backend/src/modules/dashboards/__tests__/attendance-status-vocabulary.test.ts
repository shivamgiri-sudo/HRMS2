import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ALL_ATTENDANCE_STATUSES,
  EXPECTED_TO_WORK_EXCLUSIONS,
  LATEST_COMPLETE_ATTENDANCE_DATE_SQL,
  LEAVE_STATUSES,
  PRESENT_STATUSES,
} from "../../../shared/attendanceStatus.js";

/**
 * Guards the class of bug where attendance SQL invents a status the ENUM does not have.
 *
 * Three shipped examples, each producing a wrong number rather than an error:
 *   attendance_status = 'late'          -> always 0 (lateness is the late_mark flag)
 *   NOT IN ('on_leave','leave', …)      -> left leave_approved in the denominator
 *   attendance_status = 'missed_punch'  -> typo for missing_punch
 */
const ENUM = new Set<string>(ALL_ATTENDANCE_STATUSES);

/** Statuses that are not live ENUM members but are tolerated as defensive extras. */
const TOLERATED_NON_MEMBERS = new Set(["on_leave", "leave"]);

/**
 * Strip comments before scanning. The fixes for these very bugs are documented in
 * comments that quote the offending literals, which a naive scan flags as violations.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");
}

function sourceOf(rel: string): string {
  return stripComments(readFileSync(resolve(__dirname, rel), "utf8"));
}

describe("attendance status vocabulary", () => {
  it("every declared present status is a real ENUM member", () => {
    for (const status of PRESENT_STATUSES) {
      expect(ENUM.has(status), `'${status}' is not an attendance_status ENUM member`).toBe(true);
    }
  });

  it("leave statuses are ENUM members or explicitly tolerated", () => {
    for (const status of LEAVE_STATUSES) {
      expect(
        ENUM.has(status) || TOLERATED_NON_MEMBERS.has(status),
        `'${status}' is neither an ENUM member nor a tolerated alias`,
      ).toBe(true);
    }
  });

  it("excludes approved leave from the expected-to-work denominator", () => {
    // The specific defect: leave_approved was counted as expected to work, which
    // depressed every attendance percentage on every dashboard.
    expect(EXPECTED_TO_WORK_EXCLUSIONS).toContain("leave_approved");
    expect(EXPECTED_TO_WORK_EXCLUSIONS).toContain("holiday");
    expect(EXPECTED_TO_WORK_EXCLUSIONS).toContain("week_off");
  });

  it("counts week_off_worked as present", () => {
    expect(PRESENT_STATUSES).toContain("week_off_worked");
  });

  it("dashboard attendance SQL never references a non-existent status", () => {
    const files = [
      "../dashboard-metric.service.ts",
      "../dashboard.routes.ts",
      "../dashboard-drilldown.service.ts",
    ].map((rel) => ({ rel, text: sourceOf(rel) }));

    const offenders: string[] = [];
    for (const { rel, text } of files) {
      // Find quoted literals compared against attendance_status.
      for (const match of text.matchAll(/attendance_status[^;]{0,400}?'([a-z_]+)'/g)) {
        const status = match[1];
        if (!ENUM.has(status) && !TOLERATED_NON_MEMBERS.has(status)) {
          offenders.push(`${rel}: '${status}'`);
        }
      }
    }

    expect(
      [...new Set(offenders)],
      `Attendance SQL compares attendance_status against values the ENUM does not ` +
        `contain, so those branches can never match:\n  ${[...new Set(offenders)].join("\n  ")}`,
    ).toEqual([]);
  });

  it("does not count lateness via attendance_status", () => {
    for (const rel of ["../dashboard-metric.service.ts", "../dashboard.routes.ts"]) {
      const text = sourceOf(rel);
      expect(
        /attendance_status\s*=\s*'late'/.test(text),
        `${rel} counts attendance_status = 'late', which is not an ENUM member; use late_mark`,
      ).toBe(false);
    }
  });

  it("excludes the in-progress day from the attendance anchor", () => {
    // Rows for the current day are created at start-of-day, before punches are
    // reconciled: on 2026-07-30 at 15:00 the day held 802 rows of which 1 was `present`
    // and 431 `missing_punch`, against 631/4 for the completed day before it. The
    // row-count threshold alone admitted that day, so every attendance tile read ~0%
    // present until the nightly job caught up. Without `record_date < CURDATE()` in BOTH
    // the candidate scan and the busiest-day subquery, that regresses silently — the
    // number stays plausible-looking, so only this assertion catches it.
    const occurrences = LATEST_COMPLETE_ATTENDANCE_DATE_SQL.match(/record_date\s*<\s*CURDATE\(\)/g) ?? [];
    expect(
      occurrences.length,
      "LATEST_COMPLETE_ATTENDANCE_DATE_SQL must exclude today in both the candidate " +
        "scan and the busiest-day subquery, or the in-progress day is selected again",
    ).toBe(2);
  });
});
