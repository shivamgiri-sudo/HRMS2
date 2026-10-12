/**
 * Night shifts must be attributed to the date they STARTED on.
 *
 * Fixtures are MAS47157's real COSEC punches (Sep-Oct 2026): a 22:00-07:00 night worker whose
 * calendar-date groups used to read 22-25 h and whose exit-only mornings were graded absent LWP 1.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../db/mysql.js", () => ({ db: { query: vi.fn(), execute: vi.fn() } }));
vi.mock("../../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { attributeNightShifts } = await import("../cosec-sync.service.js");

type B = { punchDate: string; firstPunch: string; lastPunch: string; totalPunches: number };
const U = "MAS47157";
const blk = (b: B) => ({ cosecUserId: U, ...b });
const run = (blocks: B[]) => attributeNightShifts(blocks.map(blk), "cosec_sqlserver", "dbo.Mx_ATDEventTrn");

describe("attributeNightShifts", () => {
  it("assigns each night to its start date and stops the 24h span (13-14 Sep, 14-15 Sep)", () => {
    const { groups, consumedDates } = run([
      { punchDate: "2026-09-13", firstPunch: "2026-09-13 21:54:42", lastPunch: "2026-09-13 23:11:16", totalPunches: 6 },
      { punchDate: "2026-09-14", firstPunch: "2026-09-14 00:27:52", lastPunch: "2026-09-14 06:55:00", totalPunches: 13 },
      { punchDate: "2026-09-14", firstPunch: "2026-09-14 19:09:00", lastPunch: "2026-09-14 23:59:19", totalPunches: 26 },
      { punchDate: "2026-09-15", firstPunch: "2026-09-15 00:00:23", lastPunch: "2026-09-15 07:01:00", totalPunches: 6 },
    ]);
    const by = Object.fromEntries(groups.map((g) => [g.punchDate, g]));
    expect(by["2026-09-13"].firstPunch).toBe("2026-09-13 21:54:42");
    expect(by["2026-09-13"].lastPunch).toBe("2026-09-14 06:55:00");
    expect(by["2026-09-13"].workingMinutes).toBeLessThan(10 * 60);
    expect(by["2026-09-14"].firstPunch).toBe("2026-09-14 19:09:00");
    expect(by["2026-09-14"].lastPunch).toBe("2026-09-15 07:01:00");
    // 15 Sep only held the exit of the 14th's shift: no day of its own.
    expect(by["2026-09-15"]).toBeUndefined();
    expect(consumedDates).toEqual([{ cosecUserId: U, punchDate: "2026-09-15" }]);
  });

  it("keeps an exit-only morning that follows a long silent gap in the same shift (9-10 Oct)", () => {
    const { groups, consumedDates } = run([
      { punchDate: "2026-10-09", firstPunch: "2026-10-09 21:10:00", lastPunch: "2026-10-09 23:28:45", totalPunches: 12 },
      { punchDate: "2026-10-10", firstPunch: "2026-10-10 06:57:16", lastPunch: "2026-10-10 07:43:49", totalPunches: 8 },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].punchDate).toBe("2026-10-09");
    expect(groups[0].lastPunch).toBe("2026-10-10 07:43:49");
    expect(groups[0].totalPunches).toBe(20);
    expect(groups[0].tailMerged).toBe(true);
    expect(consumedDates).toHaveLength(1);
  });

  it("leaves a plain day shift exactly as the calendar-date grouping had it", () => {
    const { groups, consumedDates } = run([
      { punchDate: "2026-09-02", firstPunch: "2026-09-02 13:04:21", lastPunch: "2026-09-02 13:30:00", totalPunches: 3 },
      { punchDate: "2026-09-02", firstPunch: "2026-09-02 14:10:00", lastPunch: "2026-09-02 22:05:08", totalPunches: 42 },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].firstPunch).toBe("2026-09-02 13:04:21");
    expect(groups[0].lastPunch).toBe("2026-09-02 22:05:08");
    expect(groups[0].totalPunches).toBe(45);
    expect(consumedDates).toEqual([]);
  });

  it("does not glue a morning-shift worker to the previous evening", () => {
    // Evening shift ends 23:30, next morning shift starts 06:00 and runs to 11:50: 17h30 apart
    // end-to-end, so it is a shift of its own.
    const { groups } = run([
      { punchDate: "2026-09-20", firstPunch: "2026-09-20 17:00:00", lastPunch: "2026-09-20 23:30:00", totalPunches: 6 },
      { punchDate: "2026-09-21", firstPunch: "2026-09-21 06:00:00", lastPunch: "2026-09-21 11:50:00", totalPunches: 6 },
    ]);
    expect(groups.map((g) => g.punchDate).sort()).toEqual(["2026-09-20", "2026-09-21"]);
  });

  it("leaves a shift that has started and not yet ended as an open evening group", () => {
    const { groups, consumedDates } = run([
      { punchDate: "2026-10-11", firstPunch: "2026-10-11 21:57:58", lastPunch: "2026-10-11 22:48:09", totalPunches: 8 },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].punchDate).toBe("2026-10-11");
    expect(groups[0].tailMerged).toBeUndefined();
    expect(consumedDates).toEqual([]);
  });

  it("does not lump a 13:00 shift's start with the previous shift's 00:13 exit (MAS36220)", () => {
    // Day shift 14:56-21:49 left at 00:13; next day starts 13:36. With a 14:00 cutoff the 00:13 and
    // the 13:36 shared one block and the day read 00:13 -> 19:02 = 18.8h.
    const { groups, consumedDates } = run([
      { punchDate: "2026-10-05", firstPunch: "2026-10-05 14:56:00", lastPunch: "2026-10-05 21:49:00", totalPunches: 8 },
      { punchDate: "2026-10-06", firstPunch: "2026-10-06 00:13:00", lastPunch: "2026-10-06 00:13:00", totalPunches: 1 },
      { punchDate: "2026-10-06", firstPunch: "2026-10-06 13:36:00", lastPunch: "2026-10-06 19:02:00", totalPunches: 9 },
    ]);
    const by = Object.fromEntries(groups.map((g) => [g.punchDate, g]));
    expect(by["2026-10-05"].lastPunch).toBe("2026-10-06 00:13:00");
    expect(by["2026-10-06"].firstPunch).toBe("2026-10-06 13:36:00");
    expect(by["2026-10-06"].workingMinutes).toBeLessThan(6 * 60);
    expect(consumedDates).toEqual([]);
  });

  it("treats the leading exit block of the pull as a shift that began before the window (MAS48068)", () => {
    // First date in the pull has an exit (01:22-07:16) and an evening start (21:50). The exit has no
    // previous day to join, so it must not be glued to the 21:50 start (22h span).
    const { groups } = run([
      { punchDate: "2026-10-01", firstPunch: "2026-10-01 01:22:00", lastPunch: "2026-10-01 07:16:00", totalPunches: 10 },
      { punchDate: "2026-10-01", firstPunch: "2026-10-01 21:50:00", lastPunch: "2026-10-01 23:40:00", totalPunches: 4 },
      { punchDate: "2026-10-02", firstPunch: "2026-10-02 01:46:00", lastPunch: "2026-10-02 07:17:00", totalPunches: 11 },
      { punchDate: "2026-10-02", firstPunch: "2026-10-02 22:08:00", lastPunch: "2026-10-02 22:09:00", totalPunches: 2 },
    ]);
    const by = Object.fromEntries(groups.map((g) => [g.punchDate, g]));
    expect(by["2026-10-01"].firstPunch).toBe("2026-10-01 21:50:00");
    expect(by["2026-10-01"].lastPunch).toBe("2026-10-02 07:17:00");
    expect(by["2026-10-01"].workingMinutes).toBeLessThan(10 * 60);
    expect(by["2026-10-02"].firstPunch).toBe("2026-10-02 22:08:00");
    for (const g of groups) expect(g.workingMinutes).toBeLessThan(15 * 60);
  });
});
