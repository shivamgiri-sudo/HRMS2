/**
 * The rule the owner stated on 2026-08-21: an approved leave stands until a manager or branch WFM
 * discards it, and no roster write may put a working shift on it.
 */
import { describe, expect, it } from "vitest";
import { checkLeaveConflict, type LeaveMap } from "../roster-leave-guard.service.js";

const EMP = "emp-1";
function leave(entries: Record<string, "FULL" | "HALF">): LeaveMap {
  return new Map([[EMP, new Map(Object.entries(entries))]]);
}

describe("approved leave blocks a working shift", () => {
  it("refuses a shift on a full-day leave", () => {
    const v = checkLeaveConflict(leave({ "2026-08-25": "FULL" }), EMP, "2026-08-25");
    expect(v.blocked).toBe(true);
    expect(v.reason).toMatch(/approved leave/i);
  });

  it("says how to unblock it, because the leave is the thing that must move", () => {
    const v = checkLeaveConflict(leave({ "2026-08-25": "FULL" }), EMP, "2026-08-25");
    expect(v.reason).toMatch(/discarded by a manager or branch WFM/i);
  });

  it("allows a normal day", () => {
    expect(checkLeaveConflict(leave({ "2026-08-25": "FULL" }), EMP, "2026-08-26").blocked).toBe(false);
  });

  it("does not block an employee with no leave at all", () => {
    expect(checkLeaveConflict(new Map(), EMP, "2026-08-25").blocked).toBe(false);
  });
});

describe("half-day leave is rosterable", () => {
  // Owner ruling: "yes half day can be rostered".
  it("warns but does not block", () => {
    const v = checkLeaveConflict(leave({ "2026-08-25": "HALF" }), EMP, "2026-08-25");
    expect(v.blocked).toBe(false);
    expect(v.warning).toBe(true);
    expect(v.reason).toMatch(/HALF-day/i);
  });
});

describe("night shift is judged by the day it ENDS", () => {
  // Owner ruling: "Tuesday's leave means next day off Monday" — a shift starting Monday night and
  // finishing Tuesday morning is worked mostly on Tuesday, so Tuesday's leave blocks it.
  const MON = "2026-08-24";
  const TUE = "2026-08-25";

  it("blocks a Monday-night shift when Tuesday is leave", () => {
    const v = checkLeaveConflict(leave({ [TUE]: "FULL" }), EMP, MON, { isNightShift: true });
    expect(v.blocked).toBe(true);
    expect(v.reason).toMatch(/finishes on 2026-08-25/);
  });

  it("does NOT block a day shift on Monday when only Tuesday is leave", () => {
    // The whole point of the night-shift rule is that it is specific to shifts crossing midnight.
    const v = checkLeaveConflict(leave({ [TUE]: "FULL" }), EMP, MON, { isNightShift: false });
    expect(v.blocked).toBe(false);
  });

  it("a night shift on a half-day-leave next morning is not blocked", () => {
    const v = checkLeaveConflict(leave({ [TUE]: "HALF" }), EMP, MON, { isNightShift: true });
    expect(v.blocked).toBe(false);
  });
});

describe("non-working assignments are never blocked", () => {
  // Marking a leave day as Leave or WO is correct. Blocking it would make the roster impossible
  // to represent honestly.
  for (const type of ["WEEK_OFF", "LEAVE", "HOLIDAY", "UNASSIGNED"]) {
    it(`allows ${type} on a leave day`, () => {
      const v = checkLeaveConflict(leave({ "2026-08-25": "FULL" }), EMP, "2026-08-25", { assignmentType: type });
      expect(v.blocked).toBe(false);
    });
  }
});

describe("the guard applies to every write path", () => {
  it("is used by grid assign, import preview and import commit", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { resolve } = require("node:path") as typeof import("node:path");
    const files = [
      "../roster-builder.routes.ts",
      "../roster-import.service.ts",
    ];
    for (const f of files) {
      const src = readFileSync(resolve(__dirname, f), "utf8");
      expect(src, `${f} must use the shared leave guard`).toContain("checkLeaveConflict");
    }
    // import.service must use it twice: once at preview, once at commit.
    const importSrc = readFileSync(resolve(__dirname, "../roster-import.service.ts"), "utf8");
    expect(importSrc.match(/checkLeaveConflict\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
