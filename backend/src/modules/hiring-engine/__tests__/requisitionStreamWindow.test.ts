import { describe, it, expect } from "vitest";
import {
  addDays,
  applyWindowChange,
  countPlannedDays,
  coversDay,
  isPlannedDay,
  isSunday,
  istToday,
  windowDays,
  windowEnd,
  windowLabel,
  windowStatus,
  WINDOW_MESSAGES,
  type StreamWindow,
  type WindowChange,
} from "../requisition-stream.window.js";

const TODAY = "2026-10-07"; // Wednesday
const w = (openFrom: string, openDays: number, add: string[] = [], skip: string[] = []): StreamWindow => ({
  openFrom,
  openDays,
  add,
  skip,
});
function ok(win: StreamWindow, c: WindowChange, today = TODAY): StreamWindow {
  const r = applyWindowChange(win, c, today);
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r.next;
}
function err(win: StreamWindow, c: WindowChange, today = TODAY): string {
  const r = applyWindowChange(win, c, today);
  if (r.ok) throw new Error("expected error");
  expect(r.message).toBe(WINDOW_MESSAGES[r.error]);
  return r.error;
}

describe("date helpers", () => {
  it("adds days across month, year and leap day", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(addDays("2026-10-07", -7)).toBe("2026-09-30");
  });
  it("knows Sundays", () => {
    expect(isSunday("2026-10-11")).toBe(true);
    expect(isSunday("2026-10-10")).toBe(false);
    expect(isSunday("2027-01-03")).toBe(true);
  });
  it("istToday uses a fixed +05:30 offset", () => {
    expect(istToday(new Date("2026-10-07T23:30:00+05:30"))).toBe("2026-10-07");
    expect(istToday(new Date("2026-10-08T00:10:00+05:30"))).toBe("2026-10-08");
    expect(istToday(new Date("2026-12-31T18:29:59Z"))).toBe("2026-12-31");
    expect(istToday(new Date("2026-12-31T18:30:00Z"))).toBe("2027-01-01");
  });
  it("isPlannedDay honours add and skip", () => {
    expect(isPlannedDay("2026-10-11", w("2026-10-09", 3))).toBe(false);
    expect(isPlannedDay("2026-10-11", w("2026-10-09", 3, ["2026-10-11"]))).toBe(true);
    expect(isPlannedDay("2026-10-10", w("2026-10-09", 3, [], ["2026-10-10"]))).toBe(false);
    expect(isPlannedDay("2026-10-11", w("2026-10-09", 3, ["2026-10-11"], ["2026-10-11"]))).toBe(false);
  });
});

describe("windowDays / windowEnd / countPlannedDays", () => {
  it("skips Sundays", () => {
    expect(windowDays(w("2026-10-09", 3))).toEqual(["2026-10-09", "2026-10-10", "2026-10-12"]);
  });
  it("starting on a Sunday starts Monday", () => {
    expect(windowDays(w("2026-10-11", 2))).toEqual(["2026-10-12", "2026-10-13"]);
  });
  it("ending on a Sunday is impossible: the window runs past it", () => {
    expect(windowEnd(w("2026-10-08", 3))).toBe("2026-10-10");
    expect(windowEnd(w("2026-10-08", 4))).toBe("2026-10-12");
  });
  it("crosses year end", () => {
    expect(windowDays(w("2026-12-31", 2))).toEqual(["2026-12-31", "2027-01-01"]);
  });
  it("crosses the February 2028 leap day", () => {
    expect(windowDays(w("2028-02-28", 3))).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
    expect(windowDays(w("2027-02-27", 3))).toEqual(["2027-02-27", "2027-03-01", "2027-03-02"]);
  });
  it("crosses month end with a Sunday on the 1st", () => {
    expect(windowDays(w("2026-10-30", 3))).toEqual(["2026-10-30", "2026-10-31", "2026-11-02"]);
  });
  it("an added Sunday is included, a skipped day is not", () => {
    expect(windowDays(w("2026-10-09", 3, ["2026-10-11"]))).toEqual(["2026-10-09", "2026-10-10", "2026-10-11"]);
    expect(windowDays(w("2026-10-09", 3, [], ["2026-10-10"]))).toEqual(["2026-10-09", "2026-10-12", "2026-10-13"]);
    expect(windowDays(w("2026-10-11", 2, ["2026-10-11"]))).toEqual(["2026-10-11", "2026-10-12"]);
  });
  it("empty and bounded", () => {
    expect(windowDays(w("2026-10-09", 0))).toEqual([]);
    expect(windowEnd(w("2026-10-09", 0))).toBe("2026-10-09");
    expect(windowDays(w("2026-10-09", 1000)).length).toBeLessThanOrEqual(400);
  });
  it("counts planned days inclusively", () => {
    expect(countPlannedDays("2026-10-09", "2026-10-12", w("2026-10-09", 3))).toBe(3);
    expect(countPlannedDays("2026-10-11", "2026-10-11", w("2026-10-11", 1))).toBe(0);
    expect(countPlannedDays("2026-10-12", "2026-10-09", w("2026-10-09", 1))).toBe(0);
  });
  it("coversDay", () => {
    const win = w("2026-10-09", 3);
    expect(coversDay(win, "2026-10-12")).toBe(true);
    expect(coversDay(win, "2026-10-11")).toBe(false);
    expect(coversDay(win, "2026-10-13")).toBe(false);
    expect(coversDay(win, "2026-10-08")).toBe(false);
  });
});

describe("extend", () => {
  it("adds days across a Sunday", () => {
    const n = ok(w("2026-10-09", 3), { kind: "extend", days: 2 });
    expect(n.openDays).toBe(5);
    expect(windowEnd(n)).toBe("2026-10-14");
  });
  it("month end: 29 Oct + 3 ends 31 Oct, +1 lands Mon 2 Nov", () => {
    expect(windowEnd(w("2026-10-29", 3))).toBe("2026-10-31");
    const n = ok(w("2026-10-29", 3), { kind: "extend", days: 1 });
    expect(n.openDays).toBe(4);
    expect(windowEnd(n)).toBe("2026-11-02");
  });
  it("year end", () => {
    const n = ok(w("2026-12-30", 2), { kind: "extend", days: 1 });
    expect(windowEnd(n)).toBe("2027-01-01");
  });
  it("leap day", () => {
    const n = ok(w("2028-02-28", 1), { kind: "extend", days: 1 });
    expect(windowEnd(n)).toBe("2028-02-29");
  });
  it("keeps exceptions and recomputes with a skipped day inside", () => {
    const n = ok(w("2026-10-09", 3, [], ["2026-10-10"]), { kind: "extend", days: 1 });
    expect(n.openDays).toBe(4);
    expect(windowEnd(n)).toBe("2026-10-14");
    expect(n.skip).toEqual(["2026-10-10"]);
  });
  it("validates days", () => {
    expect(err(w("2026-10-09", 3), { kind: "extend", days: 0 })).toBe("invalid_days");
    expect(err(w("2026-10-09", 3), { kind: "extend", days: 61 })).toBe("invalid_days");
    expect(err(w("2026-10-09", 3), { kind: "extend", days: 1.5 })).toBe("invalid_days");
    expect(err(w("2026-10-09", 3), { kind: "extend", days: NaN })).toBe("invalid_days");
    expect(ok(w("2026-10-09", 3), { kind: "extend", days: 60 }).openDays).toBe(63);
  });
  it("rejects an ended window that stays in the past", () => {
    expect(err(w("2026-09-28", 2), { kind: "extend", days: 1 })).toBe("before_today");
    expect(err(w("2026-09-28", 2), { kind: "extend", days: 0 })).toBe("invalid_days");
  });
  it("revives an ended window when the extension reaches today", () => {
    const n = ok(w("2026-09-28", 2), { kind: "extend", days: 8 });
    expect(windowEnd(n) >= TODAY).toBe(true);
  });
  it("open_days limit is 120", () => {
    expect(err(w("2026-10-09", 100), { kind: "extend", days: 60 })).toBe("too_long");
    expect(ok(w("2026-10-09", 100), { kind: "extend", days: 20 }).openDays).toBe(120);
    expect(err(w("2026-10-09", 120), { kind: "extend", days: 1 })).toBe("too_long");
  });
});

describe("extend_to", () => {
  it("lands on the last planned day before a Sunday", () => {
    const n = ok(w("2026-10-09", 1), { kind: "extend_to", date: "2026-10-11" });
    expect(windowEnd(n)).toBe("2026-10-10");
    expect(n.openDays).toBe(2);
  });
  it("lands on an added Sunday", () => {
    const n = ok(w("2026-10-09", 1, ["2026-10-11"]), { kind: "extend_to", date: "2026-10-11" });
    expect(windowEnd(n)).toBe("2026-10-11");
    expect(n.openDays).toBe(3);
  });
  it("counts a skipped day out", () => {
    const n = ok(w("2026-10-09", 1, [], ["2026-10-10"]), { kind: "extend_to", date: "2026-10-12" });
    expect(n.openDays).toBe(2);
    expect(windowEnd(n)).toBe("2026-10-12");
  });
  it("crosses month end, year end and leap day", () => {
    expect(ok(w("2026-10-29", 1), { kind: "extend_to", date: "2026-11-02" }).openDays).toBe(4);
    expect(windowEnd(ok(w("2026-12-30", 1), { kind: "extend_to", date: "2027-01-01" }))).toBe("2027-01-01");
    expect(windowEnd(ok(w("2028-02-28", 1), { kind: "extend_to", date: "2028-02-29" }))).toBe("2028-02-29");
  });
  it("same end is no_change, also when a Sunday maps onto it", () => {
    expect(err(w("2026-10-09", 2), { kind: "extend_to", date: "2026-10-10" })).toBe("no_change");
    expect(err(w("2026-10-09", 2), { kind: "extend_to", date: "2026-10-11" })).toBe("no_change");
  });
  it("a date earlier than the end shortens", () => {
    const n = ok(w("2026-10-09", 5), { kind: "extend_to", date: "2026-10-10" });
    expect(n.openDays).toBe(2);
  });
  it("rejections", () => {
    expect(err(w("2026-10-09", 1), { kind: "extend_to", date: "2026-10-06" })).toBe("before_today");
    expect(err(w("2026-10-09", 1), { kind: "extend_to", date: "2026-10-08" })).toBe("before_start");
    expect(err(w("2026-10-09", 1), { kind: "extend_to", date: "2026/10/12" })).toBe("invalid_date");
    expect(err(w("2026-10-09", 1), { kind: "extend_to", date: "2026-02-30" })).toBe("invalid_date");
    expect(err(w("2026-10-11", 1), { kind: "extend_to", date: "2026-10-11" })).toBe("before_start");
  });
  it("limits to 120 open days", () => {
    expect(err(w("2026-10-09", 1), { kind: "extend_to", date: "2027-06-01" })).toBe("too_long");
    expect(err(w("2026-10-09", 1), { kind: "extend_to", date: "2999-01-01" })).toBe("too_long");
  });
});

describe("add_day", () => {
  it("adds a Sunday inside the window", () => {
    const n = ok(w("2026-10-09", 3), { kind: "add_day", day: "2026-10-11" });
    expect(n.add).toEqual(["2026-10-11"]);
    expect(n.openDays).toBe(4);
    expect(windowEnd(n)).toBe("2026-10-12");
    expect(coversDay(n, "2026-10-11")).toBe(true);
  });
  it("adds a Sunday after the end and extends to it", () => {
    const n = ok(w("2026-10-09", 3), { kind: "add_day", day: "2026-10-18" });
    expect(windowEnd(n)).toBe("2026-10-18");
    expect(n.openDays).toBe(9);
  });
  it("adds Sunday 31 Dec 2028-style year end and leap day Sundays", () => {
    expect(isSunday("2028-02-27")).toBe(true);
    const n = ok(w("2028-02-26", 2), { kind: "add_day", day: "2028-02-27" });
    expect(windowDays(n)).toEqual(["2028-02-26", "2028-02-27", "2028-02-28"]);
    expect(isSunday("2026-12-27")).toBe(true);
    expect(windowEnd(ok(w("2026-12-26", 1), { kind: "add_day", day: "2026-12-27" }))).toBe("2026-12-27");
  });
  it("already planned inside the window is no_change", () => {
    expect(err(w("2026-10-09", 3), { kind: "add_day", day: "2026-10-10" })).toBe("no_change");
    expect(err(w("2026-10-09", 3, ["2026-10-11"]), { kind: "add_day", day: "2026-10-11" })).toBe("no_change");
  });
  it("re-adds a skipped weekday and drops the skip, not touching add", () => {
    const n = ok(w("2026-10-09", 2, [], ["2026-10-10"]), { kind: "add_day", day: "2026-10-10" });
    expect(n.skip).toEqual([]);
    expect(n.add).toEqual([]);
    expect(n.openDays).toBe(3);
    expect(windowEnd(n)).toBe("2026-10-12");
  });
  it("a non-Sunday after the end extends the window to it", () => {
    const n = ok(w("2026-10-09", 1), { kind: "add_day", day: "2026-10-14" });
    expect(windowEnd(n)).toBe("2026-10-14");
    expect(n.openDays).toBe(5);
    expect(n.add).toEqual([]);
  });
  it("sorts add and keeps existing ones", () => {
    const n = ok(w("2026-10-09", 9, ["2026-10-18"]), { kind: "add_day", day: "2026-10-11" });
    expect(n.add).toEqual(["2026-10-11", "2026-10-18"]);
  });
  it("rejections", () => {
    expect(err(w("2026-10-09", 3), { kind: "add_day", day: "2026-10-06" })).toBe("before_today");
    expect(err(w("2026-10-09", 3), { kind: "add_day", day: "2026-10-08" })).toBe("before_start");
    expect(err(w("2026-10-09", 3), { kind: "add_day", day: "bad" })).toBe("invalid_date");
    expect(err(w("2026-10-09", 100), { kind: "add_day", day: "2027-03-14" })).toBe("too_long");
  });
});

describe("skip_day", () => {
  it("skips a middle day", () => {
    const n = ok(w("2026-10-09", 3), { kind: "skip_day", day: "2026-10-10" });
    expect(n.skip).toEqual(["2026-10-10"]);
    expect(n.openDays).toBe(2);
    expect(windowEnd(n)).toBe("2026-10-12");
  });
  it("skipping the end moves it to the previous planned day", () => {
    const n = ok(w("2026-10-09", 3), { kind: "skip_day", day: "2026-10-12" });
    expect(windowEnd(n)).toBe("2026-10-10");
    expect(n.openDays).toBe(2);
  });
  it("skipping an added Sunday removes the add and leaves no skip row", () => {
    const n = ok(w("2026-10-09", 4, ["2026-10-11"]), { kind: "skip_day", day: "2026-10-11" });
    expect(n.add).toEqual([]);
    expect(n.skip).toEqual([]);
    expect(n.openDays).toBe(3);
    expect(windowEnd(n)).toBe("2026-10-12");
  });
  it("skipping an added Sunday that is the end", () => {
    const n = ok(w("2026-10-09", 3, ["2026-10-11"]), { kind: "skip_day", day: "2026-10-11" });
    expect(windowEnd(n)).toBe("2026-10-10");
    expect(n.openDays).toBe(2);
  });
  it("skipping the end when the previous day is a skipped one steps back further", () => {
    const n = ok(w("2026-10-08", 3, [], ["2026-10-10"]), { kind: "skip_day", day: "2026-10-12" });
    expect(windowDays(n)).toEqual(["2026-10-08", "2026-10-09"]);
    expect(n.openDays).toBe(2);
  });
  it("skipping across month end and year end", () => {
    const n = ok(w("2026-12-30", 3), { kind: "skip_day", day: "2026-12-31" });
    expect(windowDays(n)).toEqual(["2026-12-30", "2027-01-01"]);
  });
  it("last planned day gives empty_window", () => {
    expect(err(w("2026-10-09", 1), { kind: "skip_day", day: "2026-10-09" })).toBe("empty_window");
  });
  it("outside the window or already unplanned is not_in_window", () => {
    expect(err(w("2026-10-09", 3), { kind: "skip_day", day: "2026-10-20" })).toBe("not_in_window");
    expect(err(w("2026-10-09", 3), { kind: "skip_day", day: "2026-10-11" })).toBe("not_in_window");
    expect(err(w("2026-10-09", 3), { kind: "skip_day", day: "2026-10-08" })).toBe("not_in_window");
    expect(err(w("2026-10-09", 3, [], ["2026-10-10"]), { kind: "skip_day", day: "2026-10-10" })).toBe("not_in_window");
  });
  it("past days are before_today, bad dates invalid_date", () => {
    expect(err(w("2026-10-05", 5), { kind: "skip_day", day: "2026-10-06" })).toBe("before_today");
    expect(err(w("2026-10-05", 5), { kind: "skip_day", day: "x" })).toBe("invalid_date");
  });
  it("skipping today is allowed", () => {
    const n = ok(w("2026-10-05", 5), { kind: "skip_day", day: TODAY });
    expect(n.skip).toEqual([TODAY]);
    expect(n.openDays).toBe(4);
  });
});

describe("shorten", () => {
  it("shortens to a date", () => {
    const n = ok(w("2026-10-09", 5), { kind: "shorten", date: "2026-10-10" });
    expect(n.openDays).toBe(2);
    expect(windowEnd(n)).toBe("2026-10-10");
  });
  it("a Sunday date lands on Saturday", () => {
    const n = ok(w("2026-10-09", 5), { kind: "shorten", date: "2026-10-11" });
    expect(windowEnd(n)).toBe("2026-10-10");
  });
  it("shortening to today", () => {
    const n = ok(w("2026-10-05", 5), { kind: "shorten", date: TODAY });
    expect(windowEnd(n)).toBe(TODAY);
    expect(n.openDays).toBe(3);
  });
  it("shortening to today when today is a Sunday keeps no future end", () => {
    const sunday = "2026-10-11";
    expect(err(w("2026-10-05", 7), { kind: "shorten", date: sunday }, sunday)).toBe("before_today");
    const n = ok(w("2026-10-05", 8, [sunday]), { kind: "shorten", date: sunday }, sunday);
    expect(windowEnd(n)).toBe(sunday);
  });
  it("rejections", () => {
    expect(err(w("2026-10-09", 5), { kind: "shorten", date: "2026-10-06" })).toBe("before_today");
    expect(err(w("2026-10-09", 5), { kind: "shorten", date: "2026-10-14" })).toBe("no_change");
    expect(err(w("2026-10-09", 5), { kind: "shorten", date: "2026-11-14" })).toBe("no_change");
    expect(err(w("2026-10-12", 5), { kind: "shorten", date: "2026-10-11" })).toBe("empty_window");
    expect(err(w("2026-10-09", 5), { kind: "shorten", date: "nope" })).toBe("invalid_date");
  });
  it("shortening an ended window to a past date is before_today", () => {
    expect(err(w("2026-09-28", 5), { kind: "shorten", date: "2026-09-30" })).toBe("before_today");
  });
});

describe("windowStatus / windowLabel", () => {
  const win = w("2026-10-09", 5);
  it("running", () => {
    expect(windowStatus(win, "2026-10-12")).toEqual({
      from: "2026-10-09",
      to: "2026-10-14",
      dayIndex: 3,
      days: 5,
      state: "running",
    });
    expect(windowLabel(win, "2026-10-12")).toBe("day 3 of 5, ends Wed 14 Oct");
  });
  it("a Sunday inside the window keeps the previous index", () => {
    expect(windowStatus(win, "2026-10-11").dayIndex).toBe(2);
  });
  it("first and last day", () => {
    expect(windowStatus(win, "2026-10-09")).toMatchObject({ dayIndex: 1, state: "running" });
    expect(windowStatus(win, "2026-10-14")).toMatchObject({ dayIndex: 5, state: "running" });
  });
  it("upcoming", () => {
    expect(windowStatus(win, TODAY)).toMatchObject({ dayIndex: 0, state: "upcoming" });
    expect(windowLabel(win, TODAY)).toBe("starts Fri 9 Oct, 5 days");
    expect(windowLabel(w("2026-10-09", 1), TODAY)).toBe("starts Fri 9 Oct, 1 day");
  });
  it("ended", () => {
    expect(windowStatus(win, "2026-10-15")).toMatchObject({ dayIndex: 5, state: "ended" });
    expect(windowLabel(win, "2026-10-15")).toBe("ended Wed 14 Oct");
  });
  it("a Sunday start is reported as the Monday", () => {
    expect(windowLabel(w("2026-10-11", 2), TODAY)).toBe("starts Mon 12 Oct, 2 days");
  });
  it("labels cross year end with no leading zero", () => {
    expect(windowLabel(w("2026-12-31", 2), "2026-12-31")).toBe("day 1 of 2, ends Fri 1 Jan");
  });
});
