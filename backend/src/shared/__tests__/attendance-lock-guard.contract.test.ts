/**
 * Every writer of a locked attendance day must have DECIDED what a lock means for it.
 *
 * THE CLASS OF BUG THIS CLOSES. `IF(is_locked = 0, VALUES(x), x)` is a write that succeeds and
 * changes nothing on a locked day. Nothing errors, and no affected-row count distinguishes
 * "wrote" from "silently declined". Two callers got this wrong at once and it cost 514.5 days of
 * pay across 879 rows (BATCH-1788287542227, BATCH-1788525513744, plus 185 further victims the
 * reconciliation script then found) — every requester having been told their change was applied.
 *
 * Fixing those two callers does not close the class: seven production files use this pattern, and
 * the next one added would fail exactly the same way. So this test enumerates them and forces
 * each into one of two buckets:
 *
 *   REFUSES  — applies a human-approved decision. A lock MUST raise, because a person is waiting
 *              on an outcome and silence reads as success.
 *   SKIPS    — an automated re-grade or machine feed (biometric sync, dialler import, nightly
 *              engine). Declining to overwrite a locked day is the lock working as designed, and
 *              raising on every locked row would make routine syncs fail noisily for no reason.
 *
 * A file using the pattern that appears in NEITHER list fails this test. That is the point: the
 * failure is not "you did it wrong", it is "you have not said which of these you meant".
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PATTERN = /IF\(is_locked = 0/;

/** Applies a human-approved decision — a lock must refuse, loudly, having written nothing. */
const REFUSES: Record<string, RegExp> = {
  // Leave approval. Silently dropped 70 approved leave days before the guard was added.
  "modules/leave/leave.service.ts": /assertDaysWritable/,
  // Regularization review. Silently dropped 809. Its own refusal predates the shared guard and is
  // pinned in detail by regularization-locked-day-refusal.contract.test.ts.
  "modules/wfm/wfm.service.ts": /lockedDay && !ownsExistingLock/,
};

/**
 * Automated feeds. Skipping a locked day is correct here — but the day is then STALE, and the
 * only reason that is acceptable is that verify-attendance-corrections-applied.cjs reconciles
 * outcomes independently of the writer. If that detector is ever dropped, these become silent
 * again and this list must be revisited.
 */
const SKIPS: Record<string, string> = {
  "modules/wfm/attendance-engine.service.ts":
    "nightly re-grade from punches; a locked day is deliberately left alone",
  "modules/wfm/cosec-sync.service.ts":
    "biometric punch sync; machine feed, must not overwrite a human correction",
  "modules/wfm/apr-payroll-reconciliation.service.ts":
    "APR reconciliation; reports differences rather than forcing them",
  "modules/payroll/payroll-attendance-control.service.ts":
    "dialler/APR import; additionally refuses to overwrite any owned row",
  "shared/attendanceRestore.ts":
    "restore helper; a locked day is out of scope for an automatic restore",
};

function filesUsingPattern(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      filesUsingPattern(full, found);
    } else if (entry.name.endsWith(".ts")) {
      if (PATTERN.test(fs.readFileSync(full, "utf8"))) {
        found.push(path.relative(SRC, full).split(path.sep).join("/"));
      }
    }
  }
  return found;
}

describe("every locked-day writer has declared what a lock means for it", () => {
  const users = filesUsingPattern(SRC).filter((f) => f !== "shared/attendanceLockGuard.ts");

  it("finds the writers at all (guards against the scan silently matching nothing)", () => {
    // A regex that stops matching would turn every assertion below into a vacuous pass.
    expect(users.length).toBeGreaterThan(0);
  });

  it("classifies every one of them as either refusing or skipping", () => {
    const unclassified = users.filter((f) => !(f in REFUSES) && !(f in SKIPS));
    expect(
      unclassified,
      `These files write a locked attendance day but have not declared what that means.\n` +
        `A locked write SUCCEEDS and CHANGES NOTHING, so doing nothing here is not neutral — it\n` +
        `discards the change and reports success. Decide:\n` +
        `  - applying a human-approved decision? call assertDaysWritable() and add it to REFUSES\n` +
        `  - an automated re-grade or feed?      add it to SKIPS with the reason\n` +
        `Unclassified: ${unclassified.join(", ")}`,
    ).toEqual([]);
  });

  it("every writer that must refuse actually does", () => {
    for (const [file, marker] of Object.entries(REFUSES)) {
      const src = fs.readFileSync(path.join(SRC, file), "utf8");
      expect(marker.test(src), `${file} must refuse a locked day, not write past it`).toBe(true);
    }
  });

  it("keeps the refusing writers honest about having written nothing", () => {
    // A refusal that does not say the change was NOT saved leaves the reader assuming it was,
    // which is the failure this whole exercise is about.
    for (const file of Object.keys(REFUSES)) {
      const src = fs.readFileSync(path.join(SRC, file), "utf8");
      const saysSo = /NOT been saved|NOT saved|assertDaysWritable/.test(src);
      expect(saysSo, `${file}'s refusal must state that nothing was saved`).toBe(true);
    }
  });

  it("does not list a file that no longer uses the pattern", () => {
    // Otherwise the lists rot into fiction and stop meaning anything.
    const stale = [...Object.keys(REFUSES), ...Object.keys(SKIPS)].filter((f) => !users.includes(f));
    expect(stale, `listed but no longer writing locked days: ${stale.join(", ")}`).toEqual([]);
  });
});

describe("the shared guard says what a refusal must say", () => {
  const guard = fs.readFileSync(path.join(SRC, "shared/attendanceLockGuard.ts"), "utf8");

  it("carries the statusCode errorHandler actually reads", () => {
    // errorHandler.ts reads `statusCode`; a `status` field is masked as a 500 and the caller
    // learns nothing about why the write was refused.
    expect(guard).toMatch(/readonly statusCode = 409/);
  });

  it("states plainly that nothing was saved", () => {
    expect(guard).toMatch(/was NOT saved/);
  });

  it("names the payroll freeze rather than a generic lock, and points at the remedy", () => {
    expect(guard).toMatch(/payroll for that month is frozen/);
    expect(guard).toMatch(/governance path/);
    expect(guard).toMatch(/arrears/);
  });

  it("still distinguishes a day locked by another correction", () => {
    // Two causes, two remedies; collapsing them sent people looking for a conflicting
    // correction that did not exist.
    expect(guard).toMatch(/already locked by another correction/);
  });

  it("exempts a correction from its own lock", () => {
    // Otherwise a second look at your own correction becomes impossible.
    expect(guard).toMatch(/ownsIt/);
  });
});
