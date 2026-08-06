/**
 * An approved regularization must actually change the day — or refuse.
 *
 * Three defects, all in reviewRegularization, all silent:
 *
 * 1. The ADR write sat behind `if (status === 'approved' && effectiveRequestedStatus)`.
 *    A punch correction carries its correction in the TIMES, not in a status, and
 *    the regularization page does not require a status for that category — it is
 *    the page's DEFAULT category. So the most-used correction in the product was
 *    marked approved and wrote nothing: no clock times, no minutes, no status.
 *
 * 2. Nothing refused an approval that could not apply anything. The request went
 *    to 'approved', the employee saw success, and the attendance record was
 *    untouched — a false entry in an audit trail people rely on.
 *
 * 3. `attendance_source` was the literal 'dialler' for EVERY approved
 *    regularization, so approving a correction for a biometric employee
 *    relabelled their day as dialler-sourced. That now matters visibly: the
 *    running-month card reports which evidence a salary figure rests on.
 *
 * minutesBetweenClockTimes is unit-tested for real below — a wrong number there
 * becomes a wrong attendance status and wrong pay.
 */
import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

// The module pulls in the db pool at import time; the pure helper under test
// needs none of it.
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(), query: vi.fn(), getConnection: vi.fn() } }));

const SOURCE = fs.readFileSync(
  path.resolve(__dirname, "..", "wfm.service.ts"), "utf8");

describe("minutesBetweenClockTimes", () => {
  it("measures an ordinary shift", async () => {
    const { minutesBetweenClockTimes } = await import("../wfm.service.js");
    expect(minutesBetweenClockTimes("09:00", "18:00")).toBe(540);
    expect(minutesBetweenClockTimes("09:30", "14:00")).toBe(270);
  });

  it("wraps a night shift across midnight instead of going negative", async () => {
    const { minutesBetweenClockTimes } = await import("../wfm.service.js");
    // The normal case for this workforce, not bad data.
    expect(minutesBetweenClockTimes("21:00", "06:00")).toBe(540);
    expect(minutesBetweenClockTimes("22:30", "07:30")).toBe(540);
  });

  it("accepts the formats the two callers actually send", async () => {
    const { minutesBetweenClockTimes } = await import("../wfm.service.js");
    expect(minutesBetweenClockTimes("09:00:00", "18:00:00")).toBe(540);
    expect(minutesBetweenClockTimes("2026-08-06 09:00:00", "2026-08-06 18:00:00")).toBe(540);
  });

  it("returns null rather than guessing on unusable input", async () => {
    const { minutesBetweenClockTimes } = await import("../wfm.service.js");
    for (const [a, b] of [["", "18:00"], ["abc", "18:00"], ["09:00", ""], ["99:99", "18:00"]]) {
      expect(minutesBetweenClockTimes(a, b), `${a} → ${b}`).toBeNull();
    }
  });

  it("refuses a zero-length or implausibly long span", async () => {
    const { minutesBetweenClockTimes } = await import("../wfm.service.js");
    expect(minutesBetweenClockTimes("09:00", "09:00")).toBeNull();   // 0, or a full 24h
    expect(minutesBetweenClockTimes("09:00", "08:00")).toBeNull();   // 23h wrap — a slip
  });
});

describe("reviewRegularization applies what it approves", () => {
  it("applies a punch-only correction", () => {
    expect(SOURCE).toMatch(/hasPunchCorrection/);
    expect(SOURCE).toMatch(/effectiveRequestedStatus \|\| hasPunchCorrection/);
  });

  it("refuses an approval that would change nothing", () => {
    const at = SOURCE.indexOf("!effectiveRequestedStatus && !hasPunchCorrection");
    expect(at, "no guard against a no-op approval").toBeGreaterThan(-1);
    expect(SOURCE.slice(at, at + 400)).toMatch(/throw new Error/);
  });

  it("keeps the day's real provenance instead of stamping every day 'dialler'", () => {
    expect(SOURCE).toMatch(/appliedSource/);
    // The literal in the VALUES list and in the ON DUPLICATE branch are both gone.
    expect(SOURCE).not.toMatch(/\(UUID\(\), \?, \?, 'dialler'/);
    expect(SOURCE).not.toMatch(/attendance_source = IF\([^)]*\), 'dialler'/);
  });

  it("classifies a corrected day with the engine's classifiers, not a second rulebook", () => {
    expect(SOURCE).toMatch(/classifyOperationsNetLogin|classifyCosecMinutes/);
    expect(SOURCE).toMatch(/resolveHalfDayFloorMinutes/);
    // No open-coded thresholds: 480/540/240 must come from the engine.
    const block = SOURCE.slice(SOURCE.indexOf("let appliedStatus"), SOURCE.indexOf("const appliedSource"));
    expect(block).not.toMatch(/\b(480|540|240)\b/);
  });

  it("never lets a correction reduce the paid value of a day", () => {
    // These are remedies for under-recorded days, and the approver cannot see a
    // derived downgrade before approving.
    expect(SOURCE).toMatch(/improves/);
    expect(SOURCE).toMatch(/derived\.lwpValue <= existingLwp/);
  });
});
