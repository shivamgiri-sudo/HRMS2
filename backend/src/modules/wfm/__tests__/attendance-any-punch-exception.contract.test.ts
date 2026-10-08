/**
 * "Any punch counts as present" — the broadened COSEC exception (owner ruling 2026-09-03).
 *
 * The rule shipped with migration 1652 fired only when rawMinutes was 0, i.e. only on a day
 * with no matching punch pair. That covered less than the decision behind it, and the gap was
 * invisible until someone looked at a specific day: on 2026-09-02 all four employees carrying
 * the flag punched in AND out, so the exception never ran and they were graded on hours
 * against the standard 9-hour day —
 *
 *     DEEPAK KASHYAP   249 min (4h09)  -> absent    (9 minutes under the 270-min half-day floor)
 *     ASHISH AWASTHI   326 min (5h26)  -> half_day
 *     NIXON SETHI      361 min (6h01)  -> half_day
 *     RATAN SINGH      431 min (7h11)  -> half_day
 *
 * For the named people this covers, being in the building is the whole test. These assertions
 * pin the broadening AND the two guards that keep it from spreading: it must not touch an
 * employee judged on dialler net login, and it must not relabel a day that was already a full
 * day on its own.
 *
 * Source-text inspection: the branch lives inside processEmployeeDay, behind several database
 * reads, and the condition itself is the thing worth pinning.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyCosecMinutes } from "../attendance-engine.service.js";

const ENGINE = readFileSync(
  resolve(process.cwd(), "src/modules/wfm/attendance-engine.service.ts"),
  "utf8",
);

/** The exception branch, from its `if` to the closing brace of its `return`. */
const branch = (() => {
  const at = ENGINE.indexOf("if (bucket?.singlePunchCountsAsPresent");
  expect(at, "the exception branch is gone entirely").toBeGreaterThanOrEqual(0);
  return ENGINE.slice(at, ENGINE.indexOf("\n    }", at));
})();

describe("the exception fires on any punch, not only an unpaired one", () => {
  it("no longer requires zero minutes", () => {
    // `rawMinutes === 0` was the whole defect: it is the condition that made a paired short
    // day skip the exception and fall through to the hours classifier.
    expect(branch).not.toMatch(/rawMinutes === 0\s*$/m);
    expect(branch).toMatch(/&&\s*rawMinutes < cosecFullDayMinutes/);
  });

  it("still requires real punch evidence", () => {
    // A day with no punch at all must never become present — that is an absence, not an
    // exception, and no flag may manufacture attendance out of nothing.
    expect(branch).toMatch(/await this\.hasAnyBiometricPunch\(employeeId, date\)/);
  });

  it("stays off the dialler/APR path", () => {
    // The exception is about what COSEC saw. Someone graded on dialler net login has no
    // COSEC punch to be credited for.
    expect(branch).toMatch(/&&\s*!classifyAsApr/);
  });

  it("leaves an already-full day to the normal classifier", () => {
    // Without the upper bound the branch would answer for every bucketed day, stamping an
    // exception on rows that did not need one and hiding the ordinary reason they passed.
    expect(branch).toMatch(/rawMinutes < cosecFullDayMinutes/);
  });

  it("keeps the two cases distinguishable, so old rows still mean what they meant", () => {
    expect(branch).toMatch(/isUnpairedPunch\s*\?\s*'cosec_single_punch_exception'\s*:\s*'cosec_any_punch_exception'/);
  });

  it("records the minutes actually worked rather than blanking them", () => {
    // The day is present by exception, but what the person really worked has to stay
    // answerable from the row itself.
    expect(branch).toMatch(/biometricMinutes: biometricMinutes > 0 \? biometricMinutes : null/);
    expect(branch).toMatch(/^\s*rawMinutes,\s*$/m);
  });
});

describe("nobody outside the bucket is re-graded", () => {
  it("the hours classifier is untouched for an ordinary employee", () => {
    // 2026-09-02's four readings, run through the rules that still apply to everyone else.
    expect(classifyCosecMinutes(249, 270, 540).status).toBe("absent");
    expect(classifyCosecMinutes(326, 270, 540).status).toBe("half_day");
    expect(classifyCosecMinutes(361, 270, 540).status).toBe("half_day");
    expect(classifyCosecMinutes(431, 270, 540).status).toBe("half_day");
  });

  it("the branch is reached only through the bucket", () => {
    expect(branch.startsWith("if (bucket?.singlePunchCountsAsPresent")).toBe(true);
  });
});
