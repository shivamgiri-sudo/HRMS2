import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  AttendanceCalendar,
  adrRecordsToAttendanceDays,
} from "@/components/attendance/AttendanceCalendar";

/**
 * Regression: the calendar and the tabular view of the same drawer must show the
 * same days.
 *
 * They used to read different databases. The tabular view reads
 * `attendance_daily_record`; the calendar called /attendance-source, got a single
 * verdict, and then queried only that one store — live COSEC for "biometric"
 * employees, the `apr` table for "dialler" ones.
 *
 * MAS61502 is classified dialler by apr_eligibility_config (designation EXECUTIVE +
 * department OPERATIONS) but has never had a single row in `apr`, while
 * `attendance_daily_record` holds a normal biometric month for her. So the calendar
 * asked the one source with nothing in it, got [], and rendered a blank month beside
 * a table full of Present days. 368 active employees showed this exact mismatch in
 * August 2026.
 *
 * The rows below are her real August 2026 records, read from the live database.
 */
const MAS61502_AUGUST_2026 = [
  { date: "2026-08-01", status: "present",       clock_in: "2026-08-01 09:44:10", clock_out: "2026-08-01 19:00:18", raw_minutes: 556, source: "biometric" },
  { date: "2026-08-02", status: "missing_punch", clock_in: null,                  clock_out: null,                  raw_minutes: 0,   source: "dialler"   },
  { date: "2026-08-03", status: "present",       clock_in: "2026-08-03 09:45:49", clock_out: "2026-08-03 19:02:23", raw_minutes: 557, source: "biometric" },
  { date: "2026-08-04", status: "present",       clock_in: "2026-08-04 10:00:03", clock_out: "2026-08-04 19:09:32", raw_minutes: 549, source: "biometric" },
  { date: "2026-08-05", status: "missing_punch", clock_in: null,                  clock_out: null,                  raw_minutes: 0,   source: "dialler"   },
  { date: "2026-08-07", status: "missing_punch", clock_in: "2026-08-07 09:34:00", clock_out: null,                  raw_minutes: 0,   source: "dialler"   },
  { date: "2026-08-08", status: "present",       clock_in: "2026-08-08 09:49:38", clock_out: "2026-08-08 19:04:29", raw_minutes: 555, source: "biometric" },
  { date: "2026-08-10", status: "present",       clock_in: "2026-08-10 09:46:15", clock_out: "2026-08-10 19:03:07", raw_minutes: 557, source: "biometric" },
];

/** Each day cell carries `title="YYYY-MM-DD — status"`, so the grid is readable from markup. */
function renderCalendar(rows: any[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <AttendanceCalendar
        employeeId="e534b232-6584-11f1-adb1-00155d0ab410"
        month={7}
        year={2026}
        hideNavigator
        records={adrRecordsToAttendanceDays(rows)}
      />
    </QueryClientProvider>,
  );
}

function statusOf(html: string, date: string): string | null {
  const m = html.match(new RegExp(`title="${date} — ([a-z_]+)"`));
  return m ? m[1]! : null;
}

describe("AttendanceCalendar renders the same days as the tabular view", () => {
  it("shows every ADR day at the status the table shows", () => {
    const html = renderCalendar(MAS61502_AUGUST_2026);

    for (const row of MAS61502_AUGUST_2026) {
      expect(statusOf(html, row.date)).toBe(row.status);
    }
  });

  it("does not collapse missing_punch into absent", () => {
    const html = renderCalendar(MAS61502_AUGUST_2026);

    // missing_punch is the second most common status in attendance_daily_record
    // (2,903 rows in August 2026). Rendering it as "absent" states a confirmed
    // absence where the engine only failed to resolve a punch pair.
    expect(statusOf(html, "2026-08-02")).toBe("missing_punch");
    expect(statusOf(html, "2026-08-05")).toBe("missing_punch");
    expect(statusOf(html, "2026-08-07")).toBe("missing_punch");
    expect(html).toContain("Missing Punch");
  });

  it("does not paint a day with no ADR row as a confirmed absence", () => {
    const html = renderCalendar(MAS61502_AUGUST_2026);

    // 6 Aug is a Thursday with no row at all. A blank month painting solid red is
    // what made an empty fetch indistinguishable from genuine absence.
    expect(statusOf(html, "2026-08-06")).toBe("unreconciled");
  });

  it("renders what it is given rather than fetching a different store", () => {
    // The whole failure mode: an employee whose resolved source returns nothing.
    // Fed an empty array the grid must still not invent absences, and fed real rows
    // it must show them without any network call — there is no fetch mock here, so a
    // component that still queried /apr-monthly would render an empty month.
    const empty = renderCalendar([]);
    expect(statusOf(empty, "2026-08-03")).toBe("unreconciled");

    const populated = renderCalendar(MAS61502_AUGUST_2026);
    expect(statusOf(populated, "2026-08-03")).toBe("present");
  });

  it("reproduces the reported bug on the source-routed fetch path", () => {
    // What the drawer actually did for MAS61502, with no records prop: resolve the
    // source to "dialler", query `apr` where she has never had a row, and render the
    // empty result. Seeding the two query keys the component uses lets the first
    // synchronous render show the settled state.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const employeeId = "e534b232-6584-11f1-adb1-00155d0ab410";
    client.setQueryData(["attendance-source", employeeId], {
      attendance_source: "dialler",
      source_label: "APR / Dialler",
    });
    client.setQueryData(["attendance-calendar", employeeId, 2026, 7, "dialler"], []);

    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <AttendanceCalendar employeeId={employeeId} month={7} year={2026} hideNavigator />
      </QueryClientProvider>,
    );

    // Every past weekday paints as a confirmed absence, including days the tabular
    // view shows as Present (3 and 4 August are a Monday and a Tuesday, both
    // `present` in attendance_daily_record). This is the bug, and it is why the tab
    // now feeds the grid instead of letting it pick its own store.
    expect(statusOf(html, "2026-08-03")).toBe("absent");
    expect(statusOf(html, "2026-08-04")).toBe("absent");

    // Same input through the fed path shows the real month.
    expect(statusOf(renderCalendar(MAS61502_AUGUST_2026), "2026-08-03")).toBe("present");
  });

  it("maps ADR rows onto calendar days without shifting the date", () => {
    const days = adrRecordsToAttendanceDays(MAS61502_AUGUST_2026);

    expect(days.map(d => d.date)).toEqual([
      "2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04",
      "2026-08-05", "2026-08-07", "2026-08-08", "2026-08-10",
    ]);

    // The cell lookup keys on a strict YYYY-MM-DD, so an ISO datetime from the API
    // must be narrowed rather than used raw — otherwise every lookup misses and the
    // whole month blanks.
    expect(adrRecordsToAttendanceDays([
      { record_date: "2026-08-01T00:00:00.000Z", attendance_status: "present" },
      { record_date: "2026-08-02 00:00:00",      attendance_status: "present" },
    ]).map(d => d.date)).toEqual(["2026-08-01", "2026-08-02"]);
  });
});
