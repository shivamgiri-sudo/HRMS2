import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * POST /assignments/:id/resolve-dispute was the one assignment-mutating path in
 * roster.governance.routes.ts that never checked the owning cycle's lifecycle status —
 * every other path (bulkUpsertAssignments) refuses once a cycle is past
 * draft/submitted/reviewed. A shift could be silently changed on an assignment whose
 * cycle was already attendance-locked or payroll-closed.
 *
 * The fix deliberately does NOT reuse EDITABLE_ASSIGNMENT_STATUSES verbatim — a dispute
 * is normally raised against an already-published/acknowledged assignment, so that
 * narrower set would block the route's entire legitimate purpose. Instead it excludes
 * only the genuinely late-stage statuses (attendance_locked/payroll_input_ready/closed).
 */
describe("resolve-dispute respects the cycle lifecycle", () => {
  const source = readFileSync(resolve(__dirname, "../roster.governance.routes.ts"), "utf-8");

  it("defines a locked-status set excluding only the late-stage statuses", () => {
    expect(source).toMatch(
      /DISPUTE_LOCKED_STATUSES = new Set\(\["attendance_locked", "payroll_input_ready", "closed"\]\)/,
    );
  });

  function handler(): string {
    const start = source.indexOf('router.post("/assignments/:id/resolve-dispute"');
    expect(start, "resolve-dispute handler not found").toBeGreaterThan(-1);
    const end = source.indexOf("}));", start);
    return source.slice(start, end);
  }

  it("selects the cycle's status alongside the assignment", () => {
    expect(handler()).toMatch(/wrc\.status AS cycle_status/);
  });

  it("checks the locked-status set and refuses with 409 before the UPDATE", () => {
    const body = handler();
    const checkIdx = body.indexOf("DISPUTE_LOCKED_STATUSES.has");
    const updateIdx = body.indexOf("UPDATE roster_daily_assignment");
    expect(checkIdx, "lifecycle check not found").toBeGreaterThan(-1);
    expect(updateIdx, "UPDATE statement not found").toBeGreaterThan(-1);
    expect(checkIdx).toBeLessThan(updateIdx);
    expect(body.slice(checkIdx, checkIdx + 200)).toMatch(/status\(409\)/);
  });

  it("does not gate on the narrower draft/submitted/reviewed set that would block the route's own purpose", () => {
    // The actual check must be DISPUTE_LOCKED_STATUSES, not a re-use of
    // EDITABLE_ASSIGNMENT_STATUSES (draft/submitted/reviewed) — a dispute is normally
    // raised against an already-published/acknowledged assignment, so gating on that
    // narrower set would reject the exact case this route exists for.
    const body = handler();
    expect(body).toMatch(/if \(DISPUTE_LOCKED_STATUSES\.has\(assignment\.cycle_status\)\)/);
    expect(body).not.toMatch(/if \(!?EDITABLE_ASSIGNMENT_STATUSES\.has/);
  });
});
