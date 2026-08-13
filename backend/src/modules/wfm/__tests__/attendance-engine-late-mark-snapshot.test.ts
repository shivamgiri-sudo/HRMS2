import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * calculateLateArrival()'s shift-start resolution used to read wfm_shift_master.start_time
 * directly — a live, editable value (wfm.service.ts:updateShift has no versioning or
 * history) — with no regard for wfm_roster_assignment's own shift_start_time snapshot,
 * unlike getShiftWindow() a few dozen lines above it in the same file. Editing a shift's
 * start_time would silently recompute every historical late-mark figure for that shift,
 * including already-worked, already-paid days, the moment anyone touched it.
 *
 * The fix mirrors getShiftWindow()'s own COALESCE(wra.shift_start_time, wsm.start_time)
 * pattern. This is a source-text assertion rather than a mocked functional test: the
 * COALESCE runs inside MySQL, not in JS, so what matters is provably being sent to the
 * database, not a value a mock hands back regardless of the query text.
 */
describe("attendance-engine calculateLateArrival reads the roster snapshot before the live shift master", () => {
  const source = readFileSync(
    resolve(__dirname, "../attendance-engine.service.ts"),
    "utf-8",
  );

  function extractLateArrivalQuery(): string {
    const start = source.indexOf("async calculateLateArrival");
    expect(start, "calculateLateArrival not found").toBeGreaterThan(-1);
    const shiftStartIdx = source.indexOf("Shift start:", start);
    expect(shiftStartIdx, "shift-start resolution block not found").toBeGreaterThan(-1);
    return source.slice(shiftStartIdx, shiftStartIdx + 1100);
  }

  it("prefers the assignment's own shift_start_time snapshot over wfm_shift_master", () => {
    const query = extractLateArrivalQuery();
    expect(query).toMatch(/COALESCE\(wra\.shift_start_time,\s*wsm\.start_time\)/);
  });

  it("no longer reads wsm.start_time as the sole, unconditional source", () => {
    const query = extractLateArrivalQuery();
    // The only occurrence of wsm.start_time must be inside the COALESCE fallback, not
    // as a bare "SELECT wsm.start_time" — which was the exact shape of the bug.
    expect(query).not.toMatch(/SELECT wsm\.start_time FROM/);
  });

  it("still falls back through employees.working_hours_start when no roster row exists", () => {
    const query = extractLateArrivalQuery();
    expect(query).toMatch(/working_hours_start/);
  });
});
