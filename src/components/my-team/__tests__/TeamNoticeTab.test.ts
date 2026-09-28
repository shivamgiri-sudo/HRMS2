import { describe, expect, it } from "vitest";
import { NOTICE_STATUSES, lastWorkingDay } from "../TeamNoticeTab";

describe("lastWorkingDay", () => {
  it("prefers the confirmed date", () => {
    expect(lastWorkingDay({ last_working_day_confirmed: "2026-10-31", last_working_day_proposed: "2026-10-25" })).toEqual({ date: "2026-10-31", confirmed: true });
  });

  it("falls back to the proposed date", () => {
    expect(lastWorkingDay({ last_working_day_confirmed: null, last_working_day_proposed: "2026-10-25" })).toEqual({ date: "2026-10-25", confirmed: false });
  });

  it("handles neither being set", () => {
    expect(lastWorkingDay({ last_working_day_confirmed: null, last_working_day_proposed: null })).toEqual({ date: null, confirmed: false });
  });
});

describe("NOTICE_STATUSES", () => {
  it("includes the submitted stage so it is visible from day one", () => {
    expect(NOTICE_STATUSES).toContain("submitted");
    expect(NOTICE_STATUSES).not.toContain("exited");
  });
});
