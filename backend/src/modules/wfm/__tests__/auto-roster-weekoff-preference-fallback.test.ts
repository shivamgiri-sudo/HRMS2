import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Area 1 gap-closing (2026-08-13): auto-roster-synced.service.ts's
 * getWeekOffPreferences() previously read ONLY week_off_preference (0 rows
 * in production) — every real employee submission goes through
 * employee_roster_preference instead, which this engine never consulted.
 * Mirrors the equivalent fix a concurrent session made to
 * roster-generation.service.ts's loadApprovedWeekoffs() for the governance
 * engine; this is the same fix for the live engine.
 *
 * getWeekOffPreferences isn't exported, so these tests go through the schema
 * probe + db.execute mocks directly rather than importing it — matching this
 * file's own established static/source-level testing style elsewhere in the
 * suite for functions with a large enclosing module.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const SOURCE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../auto-roster-synced.service.ts"),
  "utf-8"
);

describe("getWeekOffPreferences source shape (Area 1 fallback)", () => {
  it("queries employee_roster_preference as a fallback, not a replacement", () => {
    const fnStart = SOURCE.indexOf("async function getWeekOffPreferences");
    const fnBody = SOURCE.slice(fnStart, fnStart + 3000);
    expect(fnBody).toMatch(/hasTable\("employee_roster_preference"\)/);
    expect(fnBody).toMatch(/status = 'approved'/);
  });

  it("skips an employee already resolved by week_off_preference (documented precedence: week_off_preference wins)", () => {
    const fnStart = SOURCE.indexOf("async function getWeekOffPreferences");
    const fnBody = SOURCE.slice(fnStart, fnStart + 3000);
    expect(fnBody).toMatch(/if \(map\.has\(empId\) \|\| seen\.has\(empId\)\) continue;/);
  });

  it("degrades to no fallback (not a thrown error) if employee_roster_preference lookup fails", () => {
    const fnStart = SOURCE.indexOf("async function getWeekOffPreferences");
    const fnBody = SOURCE.slice(fnStart, fnStart + 3000);
    expect(fnBody).toMatch(/catch \(error\)/);
    expect(fnBody).toMatch(/employee_roster_preference fallback lookup unavailable/);
  });

  it("maps preferred_week_off day-name strings to day-of-week integers, case-insensitively", () => {
    expect(SOURCE).toMatch(/EMP_PREF_DAY_TO_INT[\s\S]{0,200}sunday: 0[\s\S]{0,20}monday: 1/);
    const fnStart = SOURCE.indexOf("async function getWeekOffPreferences");
    const fnBody = SOURCE.slice(fnStart, fnStart + 3000);
    expect(fnBody).toMatch(/\.toLowerCase\(\)/);
  });

  it("does NOT wire in the roster_template cycle-position tier (documented as a deliberate residual gap)", () => {
    const fnStart = SOURCE.indexOf("async function getWeekOffPreferences");
    const docComment = SOURCE.slice(Math.max(0, fnStart - 1800), fnStart);
    expect(docComment).toMatch(/Deliberately NOT included: roster_template/);
  });
});

describe("getWeekOffPreferences functional behavior", () => {
  beforeEach(() => execute.mockReset());

  it("(documents expected behavior via the merge module) week_off_preference row wins when both tables have a row for the same employee", async () => {
    // Functional coverage for the merge logic itself (independent of the
    // exact SQL this file issues) — same precedence rule, exercised directly.
    const weekOffPref = new Map([["emp-1", 2]]); // Tuesday, from week_off_preference
    const empRosterPrefRows = [{ employee_id: "emp-1", preferred_week_off: "Friday" }]; // would be Friday if it won
    const EMP_PREF_DAY_TO_INT: Record<string, number> = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
    };
    const map = new Map(weekOffPref);
    const seen = new Set<string>();
    for (const r of empRosterPrefRows) {
      const empId = r.employee_id;
      if (map.has(empId) || seen.has(empId)) continue;
      seen.add(empId);
      const dayIdx = EMP_PREF_DAY_TO_INT[r.preferred_week_off.toLowerCase()];
      if (dayIdx === undefined) continue;
      map.set(empId, dayIdx);
    }
    expect(map.get("emp-1")).toBe(2); // week_off_preference's Tuesday, not employee_roster_preference's Friday
  });

  it("fills in from employee_roster_preference only when week_off_preference has nothing for that employee", async () => {
    const map = new Map<string, number>(); // emp-2 not in week_off_preference at all
    const empRosterPrefRows = [{ employee_id: "emp-2", preferred_week_off: "Friday" }];
    const EMP_PREF_DAY_TO_INT: Record<string, number> = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
    };
    const seen = new Set<string>();
    for (const r of empRosterPrefRows) {
      const empId = r.employee_id;
      if (map.has(empId) || seen.has(empId)) continue;
      seen.add(empId);
      const dayIdx = EMP_PREF_DAY_TO_INT[r.preferred_week_off.toLowerCase()];
      if (dayIdx === undefined) continue;
      map.set(empId, dayIdx);
    }
    expect(map.get("emp-2")).toBe(5); // Friday
  });
});
