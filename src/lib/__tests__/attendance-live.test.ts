import { describe, expect, it } from "vitest";
import {
  canFetchPersonalAttendance,
  resolveAttendanceDisplay,
} from "../attendance-live";

describe("canFetchPersonalAttendance", () => {
  it("waits for the current employee before querying attendance", () => {
    expect(canFetchPersonalAttendance(undefined)).toBe(false);
    expect(canFetchPersonalAttendance("")).toBe(false);
    expect(canFetchPersonalAttendance("employee-1")).toBe(true);
  });
});

describe("resolveAttendanceDisplay", () => {
  it("prefers the frequently refreshed live NCOSEC snapshot", () => {
    const display = resolveAttendanceDisplay(
      {
        clock_in: "2026-07-19T09:00:00+05:30",
        clock_out: "2026-07-19T12:00:00+05:30",
        total_hours: 3,
      },
      {
        first_punch_in: "2026-07-19T08:58:00+05:30",
        last_punch_out: "2026-07-19T13:15:00+05:30",
        raw_minutes: 257,
      },
    );

    expect(display).toEqual({
      clockIn: "2026-07-19T08:58:00+05:30",
      clockOut: "2026-07-19T13:15:00+05:30",
      hours: 4.28,
      hasLivePunch: true,
    });
  });

  it("keeps an open live punch open instead of using a stale migrated clock-out", () => {
    const display = resolveAttendanceDisplay(
      {
        clock_in_time: "2026-07-19T09:00:00+05:30",
        clock_out_time: "2026-07-19T18:00:00+05:30",
        total_hours: 9,
      },
      {
        first_punch_in: "2026-07-19T09:00:00+05:30",
        last_punch_out: null,
        raw_minutes: 0,
      },
    );

    expect(display).toEqual({
      clockIn: "2026-07-19T09:00:00+05:30",
      clockOut: null,
      hours: 0,
      hasLivePunch: true,
    });
  });

  it("uses the migrated attendance record when no live punch exists", () => {
    const display = resolveAttendanceDisplay(
      {
        clock_in: "2026-07-19T09:00:00+05:30",
        clock_out: null,
        total_hours: 1.5,
      },
      null,
    );

    expect(display).toEqual({
      clockIn: "2026-07-19T09:00:00+05:30",
      clockOut: null,
      hours: 1.5,
      hasLivePunch: false,
    });
  });

  it("returns empty display values when neither source has attendance", () => {
    expect(resolveAttendanceDisplay(null, null)).toEqual({
      clockIn: null,
      clockOut: null,
      hours: null,
      hasLivePunch: false,
    });
  });
});
