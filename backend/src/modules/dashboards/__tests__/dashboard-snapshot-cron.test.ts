import { describe, expect, it } from "vitest";

import { istHourOf } from "../dashboard-snapshot.cron.js";

/**
 * The snapshot job must run in the 02:00 IST hour, after the nightly attendance
 * reconciliation and before the working day.
 *
 * The first implementation computed the IST hour as
 * `now.getTime() + (5.5 * 60 - now.getTimezoneOffset()) * 60 * 1000`. getTime() is already
 * a UTC epoch, so adding getTimezoneOffset() double-counted the shift: on an IST host the
 * window landed at 20:30 IST — the middle of the evening, before reconciliation had run and
 * while the database was busy. Nothing would have failed loudly; the snapshot would simply
 * have recorded a half-processed day every night and every trend arrow would have been
 * quietly derived from it.
 *
 * A wrong hour is invisible without a test like this, because the only symptom is a job
 * running at the wrong time of night on a server nobody is watching.
 */
describe("dashboard snapshot cron window", () => {
  const RUN_AT_HOUR_IST = 2;

  it.each([
    ["2026-07-31T20:30:00Z", 2, "02:00 IST"],
    ["2026-07-31T20:59:00Z", 2, "02:29 IST"],
    ["2026-07-31T21:29:00Z", 2, "02:59 IST, last minute of the window"],
    ["2026-07-31T21:30:00Z", 3, "03:00 IST, just past the window"],
    ["2026-07-31T18:30:00Z", 0, "midnight IST"],
    ["2026-07-31T06:30:00Z", 12, "noon IST"],
    ["2026-12-31T20:30:00Z", 2, "02:00 IST across a year boundary"],
  ])("derives the IST hour of %s as %i (%s)", (iso, expected) => {
    expect(istHourOf(new Date(iso))).toBe(expected);
  });

  it("fires only inside the 02:00 IST hour", () => {
    const fires = (iso: string) => istHourOf(new Date(iso)) === RUN_AT_HOUR_IST;

    expect(fires("2026-07-31T20:30:00Z"), "02:00 IST must fire").toBe(true);
    expect(fires("2026-07-31T21:29:00Z"), "02:59 IST must fire").toBe(true);
    expect(fires("2026-07-31T21:30:00Z"), "03:00 IST must not fire").toBe(false);
    expect(fires("2026-07-31T15:00:00Z"), "20:30 IST must not fire — the old buggy hour").toBe(false);
  });

  it("does not depend on the host timezone", () => {
    // The deploy host and developer machines differ, and the previous implementation was
    // correct on a UTC host and wrong on an IST one — which is why it survived review.
    const instant = new Date("2026-07-31T20:30:00Z");
    expect(istHourOf(instant)).toBe(2);
    // Same instant expressed differently must give the same IST hour.
    expect(istHourOf(new Date(instant.getTime()))).toBe(2);
    expect(istHourOf(new Date(instant.toISOString()))).toBe(2);
  });
});
