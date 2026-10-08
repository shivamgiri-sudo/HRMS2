import { describe, expect, it } from "vitest";
import { aprSyncDates, aprSyncDaysBack, changedAprUsers, DEEP_SWEEP_DAYS } from "../apr-sync-window.js";

// 2026-10-05 10:00 IST = 04:30 UTC
const AT_10_IST = Date.UTC(2026, 9, 5, 4, 30);
// 2026-10-06 00:30 IST = 2026-10-05 19:00 UTC
const AFTER_MIDNIGHT_IST = Date.UTC(2026, 9, 5, 19, 0);

describe("apr-vicidial-sync date window", () => {
  it("every hourly run pulls yesterday as well as today", () => {
    const { daysBack, deep } = aprSyncDaysBack(AT_10_IST, "2026-10-05");
    expect(deep).toBe(false);
    expect(aprSyncDates(AT_10_IST, daysBack)).toEqual(["2026-10-04", "2026-10-05"]);
  });

  it("just after midnight IST the run still finishes the day that just ended", () => {
    const { daysBack } = aprSyncDaysBack(AFTER_MIDNIGHT_IST, "2026-10-06");
    expect(aprSyncDates(AFTER_MIDNIGHT_IST, daysBack)).toEqual(["2026-10-05", "2026-10-06"]);
  });

  it("re-pulls the last week once a day so a dialler outage heals by itself", () => {
    const first = aprSyncDaysBack(AT_10_IST, "2026-10-04");
    expect(first).toEqual({ daysBack: DEEP_SWEEP_DAYS, deep: true, today: "2026-10-05" });
    const dates = aprSyncDates(AT_10_IST, first.daysBack);
    expect(dates[0]).toBe("2026-09-28");
    expect(dates).toContain("2026-10-02"); // the day with no APR at all
    expect(dates.at(-1)).toBe("2026-10-05");
  });

  it("does not deep-sweep before 06:00 IST", () => {
    expect(aprSyncDaysBack(AFTER_MIDNIGHT_IST, "2026-10-05").deep).toBe(false);
  });

  it("reports only employees whose stored minutes changed", () => {
    const before = new Map([["MAS1", 480 * 60], ["MAS2", 300 * 60]]);
    const after = new Map([["MAS1", 480 * 60], ["MAS2", 520 * 60], ["MAS3", 60 * 60]]);
    expect([...changedAprUsers(before, after)].sort()).toEqual(["MAS2", "MAS3"]);
  });
});
