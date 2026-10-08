/**
 * COSEC sync must stop rewriting days that have not changed.
 *
 * WHAT WENT WRONG. The source query aggregates punches per (user, date) across a rolling two-day
 * window, so every ten-minute run returned the same ~13,000 punches and re-did the full downstream
 * write for each. Measured live on 2026-09-04: 745 rows for the previous day, whose last punch was
 * at 18:29 the evening before and could not change again, were being rewritten at 07:24 that
 * morning and every ten minutes after. That saturated the shared connection pool and tripped the
 * database circuit breaker at the exact second each run finished (11:54:55, 12:05:25, 12:15:54,
 * 12:26:23, 12:36:48), which is what took report downloads and report email down.
 *
 * WHAT MUST HOLD. Skipping is an optimisation whose failure mode is silent: attendance that never
 * lands looks exactly like attendance that was never punched. So the filter must be conservative in
 * one specific direction — it may do redundant work, it may never skip a day whose stored values
 * differ from what would now be written.
 *
 * The subtlety these tests exist to pin: biometric_attendance_log stores the OUTPUT of
 * assessAggregatePunches, not the raw source aggregate. A single punch is stored with a null
 * punch-out and a count of 1; an odd punch count is read differently in historical mode than live.
 * Comparing the raw group against the stored row would therefore mark nearly every day as changed —
 * safe, but useless — and comparing carelessly the other way would skip real edits.
 */

import { describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { query: (...a: unknown[]) => query(...a) } }));
vi.mock("../../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { filterUnchangedGroups } = await import("../cosec-sync.service.js");

/** A settled day: two punches, an in and an out — the ordinary shape of a finished shift. */
const group = (over: Record<string, unknown> = {}) => ({
  cosecUserId: "77262",
  punchDate: "2026-09-03",
  firstPunch: "2026-09-03 09:31:02",
  lastPunch: "2026-09-03 18:29:25",
  totalPunches: 2,
  workingMinutes: 538,
  sourceSystem: "NCOSEC",
  sourceTable: "AttendanceLogs",
  ...over,
}) as any;

/** What the log holds for that day once it has been written the first time. */
const storedRow = (over: Record<string, unknown> = {}) => ({
  cosec_user_id: "77262",
  punch_date: "2026-09-03",
  total_punches: 2,
  raw_minutes: 538,
  first_punch_in: "2026-09-03 09:31:02",
  last_punch_out: "2026-09-03 18:29:25",
  ...over,
});

/** Sync end date after the punch date, so these days assess in historical mode. */
const TO = "2026-09-04";

/*
 * Each test sets the mock it needs rather than sharing a beforeEach reset. Vitest 4 reports an
 * error raised inside a mock implementation as a test failure when a beforeEach reset is also
 * registered on that mock, even where the code under test catches it — which is precisely what the
 * failure-path test below has to assert.
 */

describe("a day already stored identically is not written again", () => {
  it("skips it", async () => {
    query.mockResolvedValue([[storedRow()], []]);
    expect(await filterUnchangedGroups([group()], TO)).toEqual([]);
  });

  it("reads the stored rows in one batched query, not one per day", async () => {
    query.mockClear();
    query.mockResolvedValue([[], []]);
    const days = Array.from({ length: 300 }, (_, i) => group({ cosecUserId: String(i) }));
    await filterUnchangedGroups(days, TO);
    // The whole point is to replace many writes with one read; a per-day lookup would reintroduce
    // exactly the round-trip volume this change removes.
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe("anything that would write a different row is still processed", () => {
  it("processes a day that has never been stored", async () => {
    query.mockResolvedValue([[], []]);
    expect(await filterUnchangedGroups([group()], TO)).toHaveLength(1);
  });

  it("processes a day whose punch count moved", async () => {
    query.mockResolvedValue([[storedRow({ total_punches: 2 })], []]);
    const later = group({ totalPunches: 4, lastPunch: "2026-09-03 20:10:00", workingMinutes: 638 });
    expect(await filterUnchangedGroups([later], TO)).toHaveLength(1);
  });

  it("processes a day whose last punch moved but whose count did not", async () => {
    // An employee re-punching out corrects the punch-out without adding a punch pair.
    query.mockResolvedValue([[storedRow({ last_punch_out: "2026-09-03 18:00:00" })], []]);
    expect(await filterUnchangedGroups([group()], TO)).toHaveLength(1);
  });

  it("processes a day whose worked minutes moved", async () => {
    query.mockResolvedValue([[storedRow({ raw_minutes: 400 })], []]);
    expect(await filterUnchangedGroups([group()], TO)).toHaveLength(1);
  });

  it("processes a back-dated correction to an old day", async () => {
    /*
     * The reason this is change-detection and not a source watermark. A punch edited today for a
     * day last week carries last week's timestamp, so a watermark on the source datetime would
     * never see it. Comparing against what we stored does.
     */
    query.mockResolvedValue([[storedRow({ punch_date: "2026-08-20", raw_minutes: 300 })], []]);
    const old = group({
      punchDate: "2026-08-20",
      firstPunch: "2026-08-20 09:31:02",
      lastPunch: "2026-08-20 18:29:25",
    });
    expect(await filterUnchangedGroups([old], TO)).toHaveLength(1);
  });
});

describe("comparison is against the values that would actually be written", () => {
  it("skips a single-punch day stored as count 1 with no punch-out", async () => {
    /*
     * assessAggregatePunches collapses a lone punch to count 1 with a null punch-out, which is what
     * lands in the log. Comparing the raw group (totalPunches 1, lastPunch equal to firstPunch)
     * against that row must not read as a difference, or every single-punch day in the window is
     * rewritten forever.
     */
    query.mockResolvedValue([[storedRow({
      total_punches: 1,
      raw_minutes: 0,
      last_punch_out: null,
      first_punch_in: "2026-09-03 09:31:02",
    })], []]);
    const lone = group({ totalPunches: 1, lastPunch: "2026-09-03 09:31:02", workingMinutes: 0 });
    expect(await filterUnchangedGroups([lone], TO)).toEqual([]);
  });
});

describe("night shifts that cross midnight", () => {
  /*
   * ORDERING IS THE WHOLE GAME HERE. mergeNightShiftRollover folds day N+1's exit punch into day
   * N's group and consumes the N+1 entry, so the merge must see the complete pull. The filter
   * therefore runs AFTER the merge (service line 840 merges, 884 filters) and only ever sees
   * already-merged groups. Filtering first would hide the exit punch from the merge and strand
   * every night shift as an open one — which is why these tests describe merged groups, not raw
   * per-date groups.
   */

  /** A finished night shift: in at 22:05 on day N, out at 06:30 on day N+1, merged into one group. */
  const merged = (over: Record<string, unknown> = {}) => group({
    punchDate: "2026-09-03",
    firstPunch: "2026-09-03 22:05:00",
    lastPunch: "2026-09-04 06:30:00",
    totalPunches: 2,
    workingMinutes: 505,
    ...over,
  });

  const mergedStored = (over: Record<string, unknown> = {}) => storedRow({
    punch_date: "2026-09-03",
    first_punch_in: "2026-09-03 22:05:00",
    last_punch_out: "2026-09-04 06:30:00",
    total_punches: 2,
    raw_minutes: 505,
    ...over,
  });

  it("skips a completed night shift whose merged row is already stored", async () => {
    // The punch-out is on the following calendar date; the comparison must not read that as a
    // difference simply because the dates differ.
    query.mockResolvedValue([[mergedStored()], []]);
    expect(await filterUnchangedGroups([merged()], "2026-09-05")).toEqual([]);
  });

  it("reprocesses the shift on the run where its exit punch first arrives", async () => {
    /*
     * THE CASE THAT MATTERS. At 23:30 the employee has punched in and not out, so the day is stored
     * as a single punch with no punch-out. By 06:40 the exit punch exists on day N+1, the rollover
     * merges it in, and the group becomes two punches ending the next morning. That must be written,
     * or the night worker's shift is recorded as a lone punch and never completed.
     */
    query.mockResolvedValue([[mergedStored({
      total_punches: 1,
      raw_minutes: 0,
      last_punch_out: null,
    })], []]);
    expect(await filterUnchangedGroups([merged()], "2026-09-05")).toHaveLength(1);
  });

  it("skips an open night shift only while it is genuinely unchanged", async () => {
    // Mid-shift, no exit punch yet. Rewriting the identical single-punch row every ten minutes
    // achieves nothing; the run where the exit lands is covered by the test above.
    query.mockResolvedValue([[mergedStored({
      total_punches: 1,
      raw_minutes: 0,
      last_punch_out: null,
    })], []]);
    const open = merged({ lastPunch: "2026-09-03 22:05:00", totalPunches: 1, workingMinutes: 0 });
    expect(await filterUnchangedGroups([open], "2026-09-05")).toEqual([]);
  });

  it("never skips a night shift that the rollover flagged as a missing punch", async () => {
    /*
     * Guard 3: night shift started, day N+1 is a rostered week-off, no exit scan ever arrives. That
     * group goes to the exception path rather than biometric_attendance_log, so the stale row left
     * from the punch-in must not be read as "already handled".
     */
    query.mockResolvedValue([[mergedStored({ total_punches: 1, last_punch_out: null })], []]);
    const flagged = merged({ totalPunches: 1, lastPunch: "2026-09-03 22:05:00", missingPunch: true });
    expect(await filterUnchangedGroups([flagged], "2026-09-05")).toHaveLength(1);
  });
});

describe("categories that must never be skipped", () => {
  it("always processes a missing-punch group", async () => {
    /*
     * Guard 3 groups are written to the exception path, not to biometric_attendance_log. A stale
     * row under the same (user, date) key would otherwise be read as "already done" and the
     * exception would never be raised.
     */
    query.mockResolvedValue([[storedRow()], []]);
    expect(await filterUnchangedGroups([group({ missingPunch: true })], TO)).toHaveLength(1);
  });

  it("processes everything when the lookup itself fails", async () => {
    // Falling back to the old behaviour costs load. Falling back to skipping costs attendance.
    query.mockImplementation(() => Promise.reject(new Error("Queue limit reached")));
    const pulled = [group(), group({ cosecUserId: "63389C" })];
    expect(await filterUnchangedGroups(pulled, TO)).toHaveLength(2);
  });

  it("handles an empty pull without querying at all", async () => {
    query.mockClear();
    expect(await filterUnchangedGroups([], TO)).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
