import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import {
  LIVE_DAYS_DEFAULT, attributeSource, cutoffSql, formFillTime, isLiveFill, istDayOf, liveDaysOf, resolveLiveWindow, rollingLiveFrom, sourceTypeSql,
} from "../he-source-attribution.js";
import { clearLiveFromCache, loadLiveFrom, loadLiveWindow } from "../he-source-attribution.service.js";
import { PersonFacts } from "../he-person-facts.service.js";

// IST is a fixed +05:30 (no DST), so every "now" here is written as UTC = IST - 5:30.
const ist = (wall: string): Date => new Date(`${wall.replace(" ", "T")}+05:30`);
const params = (rows: Array<[string, number]>) => [rows.map(([param_key, value]) => ({ param_key, value }))];

describe("rolling Live Meta cutoff: the start of the IST day (today - 7 days)", () => {
  it("is 7 days by default; today 9 Oct 2026 gives 2 Oct 2026 00:00 IST", () => {
    expect(LIVE_DAYS_DEFAULT).toBe(7);
    expect(rollingLiveFrom(ist("2026-10-09 12:00:00"))).toBe("2026-10-02");
    expect(rollingLiveFrom(ist("2026-10-09 12:00:00"), 3)).toBe("2026-10-06");
    expect(rollingLiveFrom(ist("2026-10-09 12:00:00"), 0)).toBe("2026-10-09");
  });
  it("moves at midnight IST, not at midnight UTC", () => {
    expect(rollingLiveFrom(ist("2026-10-09 23:59:59"))).toBe("2026-10-02");
    expect(rollingLiveFrom(ist("2026-10-10 00:00:00"))).toBe("2026-10-03");
    // 00:01 IST is still the previous UTC day (18:31Z): the IST day decides
    expect(istDayOf(new Date("2026-10-09T18:31:00Z"))).toBe("2026-10-10");
    expect(rollingLiveFrom(new Date("2026-10-09T18:31:00Z"))).toBe("2026-10-03");
    expect(rollingLiveFrom(new Date("2026-10-09T18:29:00Z"))).toBe("2026-10-02");
  });
  it("crosses month and year ends and ignores DST elsewhere (IST is fixed +05:30)", () => {
    expect(rollingLiveFrom(ist("2026-11-03 09:00:00"))).toBe("2026-10-27");
    expect(rollingLiveFrom(ist("2027-01-03 09:00:00"))).toBe("2026-12-27");
    expect(rollingLiveFrom(ist("2027-03-08 00:00:00"))).toBe("2027-03-01"); // past 28 Feb
    // the US / EU DST switch days change nothing: still exactly 7 IST days
    for (const d of ["2026-11-01", "2026-10-25", "2027-03-14", "2027-03-28"]) {
      const n = ist(`${d} 00:30:00`);
      const back = new Date(Date.parse(`${d}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
      expect(rollingLiveFrom(n)).toBe(back);
    }
  });
  it("live_days: a whole number of days 0..365 (DECIMAL 7.0000 reads as 7); anything else is the default 7", () => {
    expect(liveDaysOf(7)).toBe(7);
    expect(liveDaysOf("7.0000")).toBe(7);
    expect(liveDaysOf(14)).toBe(14);
    expect(liveDaysOf(0)).toBe(0);
    expect(liveDaysOf(2.5)).toBe(2);
    for (const v of [-1, 366, NaN, null, undefined, "x", ""]) expect(liveDaysOf(v)).toBe(7);
  });
  it("mode: rolling by default; the fixed meta.live_from days only with meta.live_mode = 1; fixed mode without a day falls back to rolling", () => {
    const now = ist("2026-10-09 12:00:00");
    expect(resolveLiveWindow({}, now)).toEqual({ liveFrom: "2026-10-02", mode: "rolling", days: 7 });
    expect(resolveLiveWindow({ fixedDays: ["2026-10-08"] }, now)).toEqual({ liveFrom: "2026-10-02", mode: "rolling", days: 7 });
    expect(resolveLiveWindow({ liveMode: 1, fixedDays: ["2026-10-01", "2026-10-08", "bad"] }, now)).toEqual({ liveFrom: "2026-10-08", mode: "fixed", days: 7 });
    expect(resolveLiveWindow({ liveMode: 1, fixedDays: [] }, now)).toEqual({ liveFrom: "2026-10-02", mode: "rolling", days: 7 });
    expect(resolveLiveWindow({ liveMode: 0, liveDays: 3, fixedDays: ["2026-10-08"] }, now)).toEqual({ liveFrom: "2026-10-06", mode: "rolling", days: 3 });
  });
});

describe("the person rule under the rolling cutoff (fake clock)", () => {
  const now = ist("2026-10-09 12:00:00");
  const liveFrom = rollingLiveFrom(now);
  it("a first fill exactly on the boundary is Live; one second before it is Old", () => {
    expect(isLiveFill("2026-10-02 00:00:00", liveFrom)).toBe(true);
    expect(isLiveFill("2026-10-01 23:59:59", liveFrom)).toBe(false);
    expect(attributeSource({ metaOrigin: true, firstFillAt: "2026-10-02 00:00:00", activityAt: "2026-10-09 10:00:00", liveFrom })).toBe("meta_live");
    expect(attributeSource({ metaOrigin: true, firstFillAt: "2026-10-01 23:59:59", activityAt: "2026-10-09 10:00:00", liveFrom })).toBe("meta_old");
  });
  it("the day the window rolls: a 2 Oct fill is Live at 23:59 IST on 9 Oct and Old at 00:01 IST on 10 Oct", () => {
    const fill = "2026-10-02 10:00:00", act = "2026-10-09 10:00:00";
    expect(attributeSource({ metaOrigin: true, firstFillAt: fill, activityAt: act, now: ist("2026-10-09 23:59:00") })).toBe("meta_live");
    expect(attributeSource({ metaOrigin: true, firstFillAt: fill, activityAt: act, now: ist("2026-10-10 00:01:00") })).toBe("meta_old");
  });
  it("a re-filler keeps the FIRST-fill rule: Old once the first fill leaves the window, whatever their later fills", () => {
    // first fill 1 Oct (outside), re-filled 8 Oct (inside): the first fill decides
    expect(attributeSource({ metaOrigin: true, firstFillAt: "2026-10-01 09:00:00", activityAt: "2026-10-09 10:00:00", liveFrom })).toBe("meta_old");
  });
  it("a fill with a NULL or invalid Meta created_time is timed by its import (created_at), then judged by the same cutoff", () => {
    expect(formFillTime("2026-10-02 00:00:00", null)).toBe("2026-10-02 00:00:00");
    expect(formFillTime("2026-10-01 23:59:59", "not a time")).toBe("2026-10-01 23:59:59");
    expect(isLiveFill(formFillTime("2026-10-02 00:00:00", null), liveFrom)).toBe(true);
    expect(isLiveFill(formFillTime("2026-10-01 23:59:59", "not a time"), liveFrom)).toBe(false);
    // a valid created_time earlier than the import moves the fill back out of the window
    expect(isLiveFill(formFillTime("2026-10-02 08:00:00", "2026-10-01T18:00:00+0000"), liveFrom)).toBe(false);
  });
  it("an invalid cutoff day means the rolling cutoff of the clock (never a fixed date)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    try {
      expect(cutoffSql("2026-10-15' OR 1=1 --")).toBe("TIMESTAMP '2026-10-02 00:00:00'");
      expect(attributeSource({ metaOrigin: true, firstFillAt: "2026-10-03 10:00:00", activityAt: "2026-10-09", liveFrom: "not a day" })).toBe("meta_live");
      expect(isLiveFill("2026-10-02 00:00:00")).toBe(true);
      expect(isLiveFill("2026-10-01 23:59:59")).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});

describe("SQL and JS agree at four clocks (23:59 and 00:01 IST included)", () => {
  // The SQL compares the fill / activity with the same cutoff literal; the JS compares the IST wall-clock strings. Both use the loaded day.
  const clocks = [ist("2026-10-09 23:59:00"), ist("2026-10-10 00:01:00"), ist("2026-11-20 23:30:00"), ist("2026-12-31 11:00:00")];
  const fills = ["2026-10-02 00:00:00", "2026-10-02 23:59:59", "2026-10-03 00:00:00", "2026-11-13 00:00:00", "2026-11-12 23:59:59", "2026-12-24 00:00:00", "2026-12-23 12:00:00", null];
  it("the cutoff literal in every typed statement is the day the JS rule uses", () => {
    for (const now of clocks) {
      const lf = rollingLiveFrom(now);
      const sql = sourceTypeSql({ streams: false, d: "d", lead: "al", ref: "d.drive_date", liveFrom: lf });
      expect(sql).toContain(`d.drive_date >= TIMESTAMP '${lf} 00:00:00'`);
      expect(sql).not.toContain("2026-10-08");
      for (const fill of fills) {
        // the SQL's `fill >= TIMESTAMP 'lf 00:00:00'` on an IST DATETIME is the string comparison below
        const sqlSays = fill !== null && fill >= `${lf} 00:00:00`;
        expect(isLiveFill(fill, lf)).toBe(sqlSays);
        expect(attributeSource({ metaOrigin: true, firstFillAt: fill, activityAt: istDayOf(now), now }) === "meta_live").toBe(sqlSays);
      }
    }
    expect(clocks.map((c) => rollingLiveFrom(c))).toEqual(["2026-10-02", "2026-10-03", "2026-11-13", "2026-12-24"]);
  });
  it("PersonFacts types a row with the same answer as attributeSource for the loaded cutoff", () => {
    const pf = new PersonFacts(rollingLiveFrom(clocks[0]));
    (pf as unknown as { known: Map<string, { pm: boolean; fl: boolean }> }).known.set("L1", { pm: true, fl: true });
    expect(pf.typeOf({ tl: "L1", tm: 0, tr: 1 })).toBe("meta_live");
    expect(pf.typeOf({ tl: "L1", tm: 0, tr: 0 })).toBe("meta_old");
  });
});

describe("loadLiveWindow / loadLiveFrom: params cached 60 s, the day computed from the clock on every call", () => {
  beforeEach(() => { vi.clearAllMocks(); clearLiveFromCache(); });
  afterEach(() => clearLiveFromCache());
  it("no row, a failing read or a broken row: rolling 7 days", async () => {
    const now = ist("2026-10-09 12:00:00");
    execute.mockResolvedValueOnce([[]]);
    expect(await loadLiveFrom(now)).toBe("2026-10-02");
    clearLiveFromCache();
    execute.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "ER_NO_SUCH_TABLE" }));
    expect(await loadLiveWindow(now)).toEqual({ liveFrom: "2026-10-02", mode: "rolling", days: 7 });
    clearLiveFromCache();
    execute.mockResolvedValueOnce(params([["meta.live_days", -4], ["meta.live_from.2026-13-01", 1]]));
    expect(await loadLiveFrom(now)).toBe("2026-10-02");
  });
  it("reads the three params in one statement", async () => {
    execute.mockResolvedValueOnce([[]]);
    await loadLiveFrom(ist("2026-10-09 12:00:00"));
    expect(execute.mock.calls[0]).toEqual([
      "SELECT param_key, value FROM he_model_param WHERE param_key IN (?, ?) OR param_key LIKE ?", ["meta.live_days", "meta.live_mode", "meta.live_from.%"]]);
  });
  it("the old fixed-date keys no longer drive the default; with meta.live_mode = 1 the latest one does", async () => {
    const now = ist("2026-10-09 12:00:00");
    execute.mockResolvedValueOnce(params([["meta.live_from.2026-10-08", 1]]));
    expect(await loadLiveWindow(now)).toEqual({ liveFrom: "2026-10-02", mode: "rolling", days: 7 });
    clearLiveFromCache();
    execute.mockResolvedValueOnce(params([["meta.live_mode", 1], ["meta.live_from.2026-10-01", 1], ["meta.live_from.2026-10-08", 1], ["meta.live_from.2026-10-09", 0]]));
    expect(await loadLiveWindow(now)).toEqual({ liveFrom: "2026-10-08", mode: "fixed", days: 7 });
  });
  it("meta.live_days moves the window", async () => {
    execute.mockResolvedValueOnce(params([["meta.live_days", 14]]));
    expect(await loadLiveWindow(ist("2026-10-20 08:00:00"))).toEqual({ liveFrom: "2026-10-06", mode: "rolling", days: 14 });
  });
  it("the 60 s cache crossing midnight IST: no second read, but the new day at once", async () => {
    execute.mockResolvedValue([[]]);
    expect(await loadLiveFrom(ist("2026-10-09 23:59:30"))).toBe("2026-10-02");
    expect(await loadLiveFrom(ist("2026-10-10 00:00:20"))).toBe("2026-10-03");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(await loadLiveFrom(ist("2026-10-10 00:00:31"))).toBe("2026-10-03"); // 61 s after the read: read again
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it("defaults to the real clock", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(ist("2026-12-31 11:00:00"));
    try {
      execute.mockResolvedValueOnce([[]]);
      expect(await loadLiveFrom()).toBe("2026-12-24");
    } finally { vi.useRealTimers(); }
  });
});
