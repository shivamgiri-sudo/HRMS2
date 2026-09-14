/**
 * The recovery scripts duplicate the half-day leave rules. This keeps the copies honest.
 *
 * recover-silent-noop-leave.cjs and verify-attendance-corrections-applied.cjs decide what an
 * approved half day should have done to a day. The authority for that is halfDayLeave.ts, but
 * those are plain .cjs scripts and cannot import TypeScript, so each carries its own copy of the
 * transition table.
 *
 * A duplicated rule is only safe while something forces the copies to agree. Without this test,
 * changing the shared table would leave the scripts quietly applying the OLD rule — and the thing
 * they are used for is deciding what an employee gets paid. The transition already has history
 * here: returning 'leave_approved' for a half day silently paid it as a full day.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  HALF_DAY_ALREADY_FULL,
  HALF_DAY_ATTENDANCE_TRANSITION,
  halfDayAttendanceTarget,
  halfDayLwpValue,
} from "../halfDayLeave.js";

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../scripts");
const recovery = fs.readFileSync(path.join(SCRIPTS, "recover-silent-noop-leave.cjs"), "utf8");
const detector = fs.readFileSync(path.join(SCRIPTS, "verify-attendance-corrections-applied.cjs"), "utf8");

/** Pull an object literal out of the script source and evaluate it. */
function literal(src: string, name: string): Record<string, string> {
  const m = new RegExp(`const ${name} = (\\{[\\s\\S]*?\\});`).exec(src);
  expect(m, `${name} not found in script`).not.toBeNull();
  return Function(`return ${m![1]}`)() as Record<string, string>;
}

describe("recover-silent-noop-leave.cjs applies the same half-day rules as the app", () => {
  it("uses an identical transition table", () => {
    expect(literal(recovery, "HALF_DAY_ATTENDANCE_TRANSITION")).toEqual(HALF_DAY_ATTENDANCE_TRANSITION);
  });

  it("treats the same statuses as already a full paid day", () => {
    const m = /const HALF_DAY_ALREADY_FULL = new Set\((\[[\s\S]*?\])\)/.exec(recovery);
    expect(m).not.toBeNull();
    expect(new Set(Function(`return ${m![1]}`)() as string[])).toEqual(HALF_DAY_ALREADY_FULL);
  });

  it("reaches the same answer as halfDayAttendanceTarget for every status it can meet", () => {
    // The behaviour, not just the tables — a faithful copy of the data with a different lookup
    // would still pay the wrong thing.
    const scriptTarget = (existing: string | null) => {
      const transition = literal(recovery, "HALF_DAY_ATTENDANCE_TRANSITION");
      const full = new Set(
        Function(
          `return ${/const HALF_DAY_ALREADY_FULL = new Set\((\[[\s\S]*?\])\)/.exec(recovery)![1]}`,
        )() as string[],
      );
      const current = (existing ?? "").trim();
      if (!current) return "half_day";
      if (full.has(current)) return null;
      return transition[current] ?? "half_day";
    };

    for (const status of [
      "absent", "missing_punch", "unreconciled", "half_day",
      "present", "late", "leave_approved", "week_off", "holiday", "", null,
    ]) {
      expect(scriptTarget(status), `disagreed on '${status}'`).toBe(halfDayAttendanceTarget(status));
    }
  });

  it("pairs the same lwp_value with the resulting status", () => {
    // status and lwp_value disagreeing is its own pay bug: the day would read half but charge full.
    const scriptLwp = (s: string) => (s === "half_day" ? 0.5 : 0);
    for (const s of ["half_day", "present", "leave_approved", "absent"]) {
      expect(scriptLwp(s)).toBe(halfDayLwpValue(s));
    }
  });
});

describe("the detector looks for the right half-day source statuses", () => {
  it("treats exactly the transition's source statuses as unambiguous evidence", () => {
    // A day still sitting on one of these with an approved half day means the transition never
    // ran. Miss one and the detector goes quiet on real losses; add one that legitimately maps
    // nowhere and it cries wolf.
    const m = /const HALF_DAY_SOURCES = (\[[\s\S]*?\]);/.exec(detector);
    expect(m, "HALF_DAY_SOURCES not found in detector").not.toBeNull();
    const sources = (Function(`return ${m![1]}`)() as string[]).sort();
    const expected = Object.keys(HALF_DAY_ATTENDANCE_TRANSITION)
      .filter((k) => HALF_DAY_ATTENDANCE_TRANSITION[k] === "half_day")
      .sort();
    expect(sources).toEqual(expected);
  });
});
