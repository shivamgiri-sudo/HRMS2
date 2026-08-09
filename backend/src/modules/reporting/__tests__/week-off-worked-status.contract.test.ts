import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_ATTENDANCE_STATUSES, PRESENT_STATUSES } from "../../../shared/attendanceStatus.js";

/**
 * `week_off_worked` — an employee who came in on their rostered day off — is a day WORKED.
 * Thirty-four report SQL blocks hand-wrote the worked-day set as IN ('present','half_day'),
 * omitting it, so every present count, attendance %, shrinkage %, occupancy % and headcount-gap
 * in the suite would under-report the moment such a row appeared.
 *
 * Measured on 2026-08-09 the table holds ZERO week_off_worked rows, so this change moves no
 * number today. That is precisely why it needed a test rather than a code review: an omission
 * that is currently invisible is one that silently comes true later. The engine DOES produce
 * the status (attendance-engine.service.ts G12) — it is unreachable only because the week-off
 * lookup reads `roster_status = 'Week Off'`, a literal that matches none of the 413,386 roster
 * rows, while the real marker is the `is_week_off` tinyint (170 rows set). Fix that upstream
 * bug and 16 genuinely-worked week-offs land immediately.
 *
 * ROSTER ADHERENCE IS THE ONE DELIBERATE EXCEPTION. Working on a day the roster told you to
 * take off is not adherence to that roster — counting it as adherent would be wrong in the
 * opposite direction. wfm.executor.ts documents this in prose; the exemption is pinned here so
 * a future sweep cannot "consistency-fix" it away.
 */

const ROOT = process.cwd();
const R = "src/modules/reporting";
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/** Files whose SQL decides worked-day membership. */
function reportingSources(): string[] {
  const files = [`${R}/report-suite.routes.ts`, `${R}/report-suite-highrisk.routes.ts`];
  for (const f of readdirSync(resolve(ROOT, `${R}/executors`)).filter(f => f.endsWith(".executor.ts"))) {
    files.push(`${R}/executors/${f}`);
  }
  return files;
}

/**
 * The narrow list, matched only where it is real SQL. Comments are stripped first so the
 * explanatory prose in wfm.executor.ts does not read as an offence.
 */
const NARROW = /attendance_status\s+IN\s*\(\s*'present'\s*,\s*'half_day'\s*\)/g;
const stripComments = (s: string) =>
  s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

/** roster-adherence, and only roster-adherence, may use the narrow list. */
const ADHERENCE_EXEMPT = "executors/wfm.executor.ts";

describe("week_off_worked is counted as a day worked", () => {
  it("no report SQL defines the worked-day set without week_off_worked", () => {
    const offenders: string[] = [];
    for (const file of reportingSources()) {
      if (file.endsWith(ADHERENCE_EXEMPT)) continue;
      const src = stripComments(read(file));
      const hits = src.match(NARROW);
      if (hits) offenders.push(`${file} (${hits.length} occurrence${hits.length > 1 ? "s" : ""})`);
    }
    expect(
      offenders,
      "these count only present+half_day as worked, so a worked week-off would vanish from " +
        "present counts, attendance %, shrinkage and occupancy:\n" + offenders.join("\n"),
    ).toEqual([]);
  });

  it("roster-adherence keeps excluding it, deliberately and visibly", () => {
    const src = read(`${R}/executors/wfm.executor.ts`);
    // The exclusion is only defensible while it is explained. An undocumented narrow list
    // here is indistinguishable from the bug this test exists to prevent.
    expect(stripComments(src).match(NARROW)?.length ?? 0).toBeGreaterThan(0);
    expect(src).toMatch(/week_off_worked/);
    expect(src).toMatch(/adheren/i);
  });

  it("week_off_worked is a real member of the status vocabulary", () => {
    // Guards the reverse mistake: dropping it from the shared lists because it has no rows yet.
    expect(ALL_ATTENDANCE_STATUSES).toContain("week_off_worked");
    expect(PRESENT_STATUSES).toContain("week_off_worked");
  });
});
