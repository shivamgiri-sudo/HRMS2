import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * The day-detail sheet used to hide biometric evidence whenever the engine had
 * attributed the day to the dialler:
 *
 *   {agg && adr?.attendance_source !== 'dialler' && (   // COSEC panel
 *   {punches.length > 0 && !isDialler && (               // raw punch timeline
 *
 * Measured on the live database for August 2026: **1,922** `attendance_daily_record`
 * rows tagged `attendance_source='dialler'` have a matching `biometric_attendance_log`
 * entry for the same employee and day, **1,502** of them with real worked minutes,
 * across **451** employees. On every one of those days the sheet showed
 * "No APR record found for this date" and suppressed the punches that did exist.
 *
 * The source verdict decides which feed drives the attendance status. It must not
 * decide whether a user may see what the biometric devices recorded.
 *
 * This is a source-level assertion rather than a render test on purpose: the sheet is
 * a Radix dialog rendered through a portal, and react-dom/server (which this suite
 * uses — see vitest.config.ts) cannot render portal content.
 */
const SOURCE = fs.readFileSync(
  path.resolve(__dirname, "../AttendanceCalendar.tsx"),
  "utf8",
);

describe("day-detail sheet does not hide biometric evidence behind the source verdict", () => {
  it("does not gate the COSEC panel on the day not being dialler", () => {
    expect(SOURCE).not.toContain("agg && adr?.attendance_source !== 'dialler'");
  });

  it("does not gate the raw punch timeline on the day not being dialler", () => {
    expect(SOURCE).not.toContain("punches.length > 0 && !isDialler");
  });

  it("tells the user biometric punches exist rather than only 'No APR record'", () => {
    // "No APR record found for this date" on its own reads as "no attendance at all",
    // which is what made a fully-punched day look like missing data.
    expect(SOURCE).toContain("No APR record found for this date");
    expect(SOURCE).toMatch(/Biometric punches[\s\S]{0,80}do[\s\S]{0,80}exist for this/);
  });
});
