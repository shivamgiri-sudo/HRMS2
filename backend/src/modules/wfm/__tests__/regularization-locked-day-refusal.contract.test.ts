/**
 * A correction to a locked attendance day must be refused, never silently discarded.
 *
 * WHAT HAPPENED. upsertDailyRecord writes every column as `IF(is_locked = 0, VALUES(x), x)`. On a
 * locked day that statement succeeds and changes nothing — no error, no affected-row count anyone
 * checks — so reviewRegularization ran to completion, stamped the regularization `approved`, and
 * the correction evaporated.
 *
 * The guard that was supposed to catch this only fired when the lock belonged to ANOTHER
 * correction. A day locked by the payroll freeze carries neither `regularization_id` nor
 * `override_by`, so it fell through the guard into the silent no-op.
 *
 * Measured on production 2026-09-05, batch BATCH-1788287542227: 916 regularizations approved for
 * August, 809 of which changed nothing — 660 days still `half_day`, 149 still `absent`, every one
 * locked by the freeze with no owner. Attendance status IS the pay in this system (half_day pays
 * half, absent pays zero), so that is roughly 479 days of pay not credited, and nobody was told.
 *
 * Asserted against the shipped source because the defect is the SHAPE of the condition — a
 * behavioural test would have to reproduce a locked row, and every variant of this bug still
 * "passes" by reporting success. What must hold is that being locked is itself disqualifying,
 * regardless of who holds the lock.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const wfm = fs.readFileSync(path.resolve(DIR, "..", "wfm.service.ts"), "utf8");
const engine = fs.readFileSync(path.resolve(DIR, "..", "attendance-engine.service.ts"), "utf8");

/** The reviewRegularization body. */
function reviewBody(): string {
  const start = wfm.indexOf("async reviewRegularization(");
  expect(start, "reviewRegularization not found").toBeGreaterThan(-1);
  return wfm.slice(start, start + 9000);
}

describe("the write it depends on really is a silent no-op", () => {
  it("guards every column on is_locked, so a locked write changes nothing and raises nothing", () => {
    /*
     * This is the premise of the whole test file. If this ever stops being true — if the upsert
     * starts erroring or reporting on a locked day — the refusal below could be relaxed.
     */
    expect(engine).toContain("attendance_status  = IF(is_locked = 0, VALUES(attendance_status),  attendance_status)");
  });
});

describe("a locked day is refused, whoever locked it", () => {
  it("treats being locked as disqualifying, not just being locked by someone else", () => {
    const body = reviewBody();
    // The condition must turn on the lock itself, with ownership as the only exemption.
    expect(body).toContain("const lockedDay =");
    expect(body).toContain("if (lockedDay && !ownsExistingLock)");
  });

  it("no longer passes through a day whose lock has no owner", () => {
    /*
     * The old shape was `is_locked === 1 && (regularization_id !== id || override_by !== reviewerId)`.
     * With both columns NULL — the payroll-freeze case — that whole expression is false and the
     * correction proceeds into the no-op. Nothing may reintroduce that.
     */
    const body = reviewBody();
    expect(body).not.toMatch(/is_locked[^\n]*===\s*1\s*&&\s*\(\s*\n?\s*\(existing\.regularization_id &&/);
  });

  it("still lets a correction re-review the day it already owns", () => {
    // Otherwise a second look at your own correction becomes impossible.
    const body = reviewBody();
    expect(body).toContain("existing.regularization_id === id");
    expect(body).toContain("existing.override_by === reviewerId");
  });
});

describe("the refusal tells the user what to do about it", () => {
  it("names the payroll freeze as the cause rather than a generic lock", () => {
    // "Attendance record is already locked" sent people looking for a conflicting correction that
    // does not exist. The month being frozen is a different problem with a different remedy.
    expect(reviewBody()).toContain("payroll for that month is frozen");
  });

  it("says plainly that nothing was saved", () => {
    /*
     * The failure this replaces reported success. An error that does not state the correction was
     * NOT applied leaves the reader assuming it was, which is exactly how 809 days went unnoticed.
     */
    expect(reviewBody()).toContain("has NOT been saved");
  });

  it("points at the unlock path instead of leaving the user stuck", () => {
    const body = reviewBody();
    expect(body).toContain("attendance-correction governance path");
    expect(body).toContain("arrears");
  });

  it("keeps the distinct message for a day locked by another correction", () => {
    // Two different causes, two different remedies; collapsing them would lose information.
    expect(reviewBody()).toContain("already locked by another correction");
  });
});
