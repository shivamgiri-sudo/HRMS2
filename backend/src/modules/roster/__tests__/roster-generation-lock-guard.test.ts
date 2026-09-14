import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Round 2 follow-up (2026-08-13): syncGeneratedToLiveAssignments() (the
 * weekly roster-gov engine's bridge into the live wfm_roster_assignment
 * table) previously only checked weekly_roster_cycle.status — a draft/
 * submitted cycle passes that check even when the underlying dates have
 * since had attendance independently locked for payroll. It now calls the
 * same shared roster-lock-guard.ts function every other write path in this
 * program uses (manual assignment, the PM post-publish correction endpoint,
 * manager realignment, shift-swap apply, and auto-roster-synced.service.ts's
 * generateDraft()).
 *
 * syncGeneratedToLiveAssignments is not exported (private to this module,
 * only reachable through generateForCycle's much larger end-to-end flow),
 * so — matching this same test file's own established pattern for
 * loadFrozenShiftAssignments's degrade-on-failure case — the invariant is
 * pinned by inspecting the source directly: the lock check must exist,
 * must be positioned before the row is written to wfm_roster_assignment,
 * and a blocked row must not reach that write.
 */

const source = readFileSync(resolve(__dirname, "../roster-generation.service.ts"), "utf-8");

describe("syncGeneratedToLiveAssignments — attendance/payroll lock guard", () => {
  it("imports the shared roster-lock-guard function, not a private copy of the query", () => {
    expect(source).toMatch(/import\s*\{\s*checkEmployeeDateNotLocked\s*\}\s*from\s*["']\.\/roster-lock-guard\.js["']/);
  });

  it("calls the lock check inside the per-row sync loop, before the INSERT into wfm_roster_assignment", () => {
    const fnStart = source.indexOf("async function syncGeneratedToLiveAssignments");
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = source.slice(fnStart, fnStart + 8000);

    const lockCallIdx = fnBody.indexOf("checkEmployeeDateNotLocked(db,");
    const insertIdx = fnBody.indexOf("INSERT INTO wfm_roster_assignment");
    expect(lockCallIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(-1);
    expect(lockCallIdx).toBeLessThan(insertIdx);
  });

  it("skips (continues past) a locked row rather than writing it", () => {
    const fnStart = source.indexOf("async function syncGeneratedToLiveAssignments");
    const fnBody = source.slice(fnStart, fnStart + 8000);
    const lockBlockIdx = fnBody.indexOf("if (lockResult.blocked)");
    expect(lockBlockIdx).toBeGreaterThan(-1);
    const blockBody = fnBody.slice(lockBlockIdx, lockBlockIdx + 300);
    expect(blockBody).toMatch(/continue;/);
  });

  it("checked before the rest-policy validation (a locked date is a harder stop)", () => {
    const fnStart = source.indexOf("async function syncGeneratedToLiveAssignments");
    const fnBody = source.slice(fnStart, fnStart + 8000);
    const lockIdx = fnBody.indexOf("checkEmployeeDateNotLocked(db,");
    const restIdx = fnBody.indexOf("validateMinimumRest(");
    expect(lockIdx).toBeGreaterThan(-1);
    expect(restIdx).toBeGreaterThan(-1);
    expect(lockIdx).toBeLessThan(restIdx);
  });
});
