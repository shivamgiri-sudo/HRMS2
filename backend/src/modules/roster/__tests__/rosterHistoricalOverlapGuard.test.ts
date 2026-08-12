/**
 * Generating a roster cycle must not overwrite roster history.
 *
 * The two roster stores are a pipeline, not rivals: roster-generation writes
 * roster_daily_assignment, then syncGeneratedToLiveAssignments copies those rows into
 * wfm_roster_assignment — the live ops table — with
 *
 *   ON DUPLICATE KEY UPDATE shift_id = VALUES(shift_id), decision_source = 'rule_engine'
 *
 * So generating a cycle whose week overlaps dates that already have live assignments does not
 * create a parallel roster; it REPLACES the shift on the existing one with a shift derived
 * from templates and rotation rules. wfm_roster_assignment holds 413,386 rows spanning
 * 2025-04-01 to 2026-07-19, and attendance is derived against rosters, so that is history
 * being rewritten from a template.
 *
 * The decision taken (2026-08-12) is to adopt the roster-gov lifecycle GOING FORWARD ONLY and
 * leave the historical rows as a closed record. This guard is what makes that decision hold
 * when someone later generates a cycle dated in the past — by accident or to "backfill".
 *
 * It refuses outright rather than offering an override flag: an override nothing calls is
 * dead code, and it can be added deliberately if a real backfill case appears.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute }, pingDb: vi.fn() }));

import { assertNoHistoricalRosterOverlap } from "../rosterHistoricalOverlapGuard.js";

beforeEach(() => execute.mockReset());

const overlap = (n: number) => execute.mockResolvedValueOnce([[{ overlapping: n }], []]);

describe("assertNoHistoricalRosterOverlap", () => {
  it("allows a cycle whose week has no existing live assignments", async () => {
    overlap(0);
    await expect(
      assertNoHistoricalRosterOverlap("2026-09-01", "2026-09-07"),
    ).resolves.toBeUndefined();
  });

  it("refuses when live assignments already exist for those dates", async () => {
    overlap(742);
    await expect(
      assertNoHistoricalRosterOverlap("2026-07-13", "2026-07-19"),
    ).rejects.toThrow(/742/);
  });

  it("names the date range in the refusal, so the fix is obvious", async () => {
    overlap(5);
    await expect(
      assertNoHistoricalRosterOverlap("2026-07-13", "2026-07-19"),
    ).rejects.toThrow(/2026-07-13[\s\S]*2026-07-19/);
  });

  it("refuses with a 409, not a 500 — this is a conflict, not a crash", async () => {
    overlap(1);
    await expect(assertNoHistoricalRosterOverlap("2026-07-13", "2026-07-19"))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it("counts against the LIVE ops table, which is the one that gets overwritten", async () => {
    overlap(0);
    await assertNoHistoricalRosterOverlap("2026-09-01", "2026-09-07");
    const [sql, params] = execute.mock.calls[0];
    expect(String(sql)).toMatch(/FROM wfm_roster_assignment/i);
    expect(String(sql)).toMatch(/roster_date BETWEEN \? AND \?/);
    expect(params).toEqual(["2026-09-01", "2026-09-07"]);
  });

  it("fails CLOSED when the check itself errors", async () => {
    // A guard that cannot verify must not wave the write through: the cost of a false refusal
    // is a retry, the cost of a false pass is overwritten roster history.
    execute.mockRejectedValueOnce(new Error("db down"));
    await expect(assertNoHistoricalRosterOverlap("2026-09-01", "2026-09-07")).rejects.toThrow();
  });
});
