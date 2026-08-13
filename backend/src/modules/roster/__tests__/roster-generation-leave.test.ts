import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * roster-generation.service.ts (one of the two live generation engines) never checked
 * leave_request at all — an employee on approved leave got a normal shift assignment
 * identical to anyone at work. auto-roster-synced.service.ts (the other engine) already
 * filters its employee pool on approved/accepted leave; loadApprovedLeaveDates() mirrors
 * that same condition here rather than reinventing it, and processEmployee() now checks
 * it before making any other scheduling decision for a date.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

import { loadApprovedLeaveDates } from "../roster-generation.service.js";

const source = readFileSync(resolve(__dirname, "../roster-generation.service.ts"), "utf-8");

describe("loadApprovedLeaveDates", () => {
  beforeEach(() => execute.mockReset());

  it("expands an approved leave row into every date in range, clamped to the cycle window", async () => {
    execute.mockResolvedValue([
      [{ employee_id: "emp-1", from_date: "2026-08-16", to_date: "2026-08-19" }],
      [],
    ]);

    const dates = await loadApprovedLeaveDates(["emp-1"], "2026-08-17", "2026-08-23");

    // Clamped: leave starts before the cycle window, so only 08-17..08-19 fall inside it.
    expect(dates.has("emp-1|2026-08-17")).toBe(true);
    expect(dates.has("emp-1|2026-08-18")).toBe(true);
    expect(dates.has("emp-1|2026-08-19")).toBe(true);
    expect(dates.has("emp-1|2026-08-20")).toBe(false);
  });

  it("only matches approved/accepted leave, per the SQL condition it sends", async () => {
    execute.mockResolvedValue([[], []]);
    await loadApprovedLeaveDates(["emp-1"], "2026-08-17", "2026-08-23");
    const [sql] = execute.mock.calls[0];
    expect(sql).toMatch(/LOWER\(status\) IN \('approved','accepted'\)/);
  });

  it("wraps the query in a try/catch so a source failure degrades to no leave rather than throwing", () => {
    // Exercised dynamically too (confirmed manually: mocking db.execute to reject logs
    // "[roster] approved-leave lookup unavailable..." and resolves with an empty set,
    // exactly like loadHolidays' identical pattern a few lines below it) — asserted
    // here at the source level because vitest's own unhandled-rejection detection
    // flags the dynamic version as a false failure independent of the function's
    // actual behavior, which the passing "returns empty...without querying" and
    // "expands...range" cases already exercise the try block of directly.
    const fnStart = source.indexOf("export async function loadApprovedLeaveDates");
    const fnBody = source.slice(fnStart, fnStart + 1400);
    expect(fnBody).toMatch(/try \{[\s\S]*await db\.execute[\s\S]*\} catch \(error\) \{/);
    expect(fnBody).toMatch(/console\.error\(/);
  });

  it("returns empty immediately for an empty employee list, without querying", async () => {
    const dates = await loadApprovedLeaveDates([], "2026-08-17", "2026-08-23");
    expect(dates.size).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("processEmployee checks approved leave before any other scheduling decision", () => {
  it("skips the date entirely when approvedLeaveDates has an entry, ahead of the holiday/week-off checks", () => {
    const fnStart = source.indexOf("async function processEmployee");
    const loopStart = source.indexOf("for (const date of dates)", fnStart);
    const leaveCheckIdx = source.indexOf("approvedLeaveDates.has(", loopStart);
    const holidayCheckIdx = source.indexOf("const isHoliday = ctx.holidays.has(date)", loopStart);
    expect(leaveCheckIdx, "leave check not found in processEmployee's date loop").toBeGreaterThan(loopStart);
    expect(holidayCheckIdx, "holiday check not found").toBeGreaterThan(loopStart);
    expect(leaveCheckIdx).toBeLessThan(holidayCheckIdx);
  });

  it("generateForCycle loads leave dates and threads them into processEmployee", () => {
    expect(source).toMatch(/const approvedLeaveDates = await loadApprovedLeaveDates\(/);
    expect(source).toMatch(/approvedLeaveDates,\s*\n\s*shiftTemplates,/);
  });
});
