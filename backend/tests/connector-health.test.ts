import { describe, it, expect } from "vitest";
import { shouldAlertOnFailure, ALERT_AT } from "../src/modules/integration-hub/connectorHealth.js";

/**
 * dialer_1 failed 1,047 consecutive times over 36 days, hourly, and nothing
 * said so. shivamgiri_quality has failed 2,779 times and never once succeeded.
 * Every attempt wrote a `failed` row, so the information was always present —
 * nobody was counting it.
 *
 * These pin the alerting policy. It is pure, so no database is involved.
 */

describe("connector failure alerting", () => {
  it("stays quiet on a single failure", () => {
    // One failure is noise: a network blip, a source mid-restart.
    expect(shouldAlertOnFailure(1)).toBe(false);
    expect(shouldAlertOnFailure(2)).toBe(false);
  });

  it("alerts once a streak forms", () => {
    expect(shouldAlertOnFailure(3)).toBe(true);
  });

  it("alerts at each escalation point", () => {
    for (const n of ALERT_AT) expect(shouldAlertOnFailure(n)).toBe(true);
  });

  it("does not alert on every failure, which is how alerts get muted", () => {
    // An hourly connector firing 24 identical alerts a day gets filtered to
    // trash within a week — and then 1,047 failures are invisible again.
    const noisy = [4, 5, 6, 7, 8, 9, 11, 12, 26, 99, 101, 400].filter(shouldAlertOnFailure);
    expect(noisy).toEqual([]);
  });

  it("keeps reminding on a long-dead connector without shouting hourly", () => {
    // 250, 500, 750, 1000 — dialer_1 would have alerted 4 more times on its way
    // to 1,047, having already alerted at 3, 10, 25 and 100.
    expect(shouldAlertOnFailure(250)).toBe(true);
    expect(shouldAlertOnFailure(500)).toBe(true);
    expect(shouldAlertOnFailure(1000)).toBe(true);
    expect(shouldAlertOnFailure(1047)).toBe(false);
  });

  it("would have caught dialer_1 on day one", () => {
    // The whole point. Hourly cadence means the third failure lands within
    // three hours of the breakage, not 36 days later.
    expect(shouldAlertOnFailure(3)).toBe(true);
  });

  it("ignores nonsense streak values", () => {
    expect(shouldAlertOnFailure(0)).toBe(false);
    expect(shouldAlertOnFailure(-1)).toBe(false);
  });
});
