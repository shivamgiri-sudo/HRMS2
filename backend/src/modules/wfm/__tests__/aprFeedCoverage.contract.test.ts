/**
 * An Operations Executive is judged on APR alone — if the feed actually carries them.
 *
 * Ruling of 2026-08-07: no biometric fallback for Operations-department Executives.
 * A short or missing dialler login IS the attendance answer for that role, so the
 * day becomes half_day or absent per classifyOperationsNetLogin.
 *
 * The qualifier is what keeps it safe. The dialler feed held 203 of 829 active
 * Operations Executives in 2026-08; the other 626 have no agent code in it at all.
 * Applying APR-only judgement to those would dock a full day's pay for a system
 * they are not enrolled in — measured against live data as 1,577.5 paid days
 * removed and 461 employees taken to zero paid days in six days of one month.
 *
 * Scoped to the covered population the same measurement gives 359 changed days
 * across 181 employees and a NET GAIN of 31 paid days, because applying APR
 * properly also credits days that were sitting at missing_punch while the feed
 * showed real login time. 16 employees lose paid days; the largest loss is 5.
 *
 * Coverage is deliberately enrolment, not activity: "does the feed know this agent
 * code", not "did they log in today". Asking about the day itself would answer the
 * very question being judged and route every quiet day into absence.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ENGINE = fs.readFileSync(
  path.resolve(__dirname, "..", "attendance-engine.service.ts"), "utf8");

describe("APR-only judgement is scoped to the covered population", () => {
  it("exposes an enrolment check", () => {
    expect(ENGINE).toMatch(/async isEnrolledInAprFeed\(/);
  });

  it("asks about enrolment over a look-back, not activity on the day", () => {
    const at = ENGINE.indexOf("async isEnrolledInAprFeed(");
    const body = ENGINE.slice(at, at + 700);
    expect(body).toMatch(/FROM apr/);
    expect(body).toMatch(/DATE_SUB\(\?, INTERVAL 30 DAY\)/);
    // A bare equality on the processed date would make coverage mean "worked today".
    expect(body).not.toMatch(/ReportDate\s*=\s*\?/);
  });

  it("gates the biometric fallback on NOT being covered", () => {
    const at = ENGINE.indexOf("if (rawMinutes === 0 && biometricMinutes > 0");
    expect(at, "the fallback condition has moved").toBeGreaterThan(-1);
    expect(ENGINE.slice(at, at + 120)).toMatch(/!aprFeedCoversEmployee/);
  });

  it("sends a covered employee's empty day to the classifier, not the review queue", () => {
    // classifyOperationsNetLogin(0) is 'absent' with lwp 1.00 — the ruling. An
    // uncovered employee still takes the missing_punch path.
    const at = ENGINE.indexOf("if (rawMinutes === 0 && !(");
    expect(at, "the missing_punch guard is not scoped to coverage").toBeGreaterThan(-1);
    expect(ENGINE.slice(at, at + 90)).toMatch(/isAprEmployee && aprFeedCoversEmployee/);
  });

  it("leaves the uncovered population on the fallback", () => {
    // The fallback block must still exist — removing it outright is the change
    // that takes 461 people to zero paid days.
    expect(ENGINE).toMatch(/classifyAsApr = false;/);
    expect(ENGINE).toMatch(/attendance_source: 'biometric', full_day_minutes: 540/);
  });

  it("does not invent thresholds — 480/240 stay with the engine's classifiers", () => {
    const at = ENGINE.indexOf("async isEnrolledInAprFeed(");
    const body = ENGINE.slice(at, at + 700);
    expect(body).not.toMatch(/\b(480|540|240)\b/);
  });
});
