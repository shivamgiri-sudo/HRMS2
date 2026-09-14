/**
 * Guards the published -> acknowledged cycle transition.
 *
 * VALID_TRANSITIONS (roster.governance.service.ts) has always allowed published -> acknowledged,
 * and acknowledged -> active is the gateway to the rest of the lifecycle (active,
 * attendance_locked, payroll_input_ready). Nothing ever performed the transition, so a week whose
 * every assignment had been acknowledged still sat at 'published' and the lifecycle stalled one
 * step past publish. Verified end to end against production 2026-08-20: all seven assignments
 * reached 'acknowledged' while the cycle stayed 'published'.
 *
 * Asserted against source text because the behaviour is a conditional UPDATE whose whole point is
 * the SQL predicate — backend/tests/setup.ts mocks src/db/mysql.js globally, so a mocked db
 * reports success regardless of what the WHERE clause says, and the interesting cases (six
 * acknowledgements must NOT advance it, the seventh must) only exist against real rows.
 * Re-verified after the fix: cycle stayed 'published' for acks 1-6 and flipped on ack 7.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(resolve(__dirname, "../wfm.routes.ts"), "utf8");

function advanceHelper(): string {
  const start = SOURCE.indexOf("async function advanceCycleIfFullyAcknowledged");
  expect(start, "advanceCycleIfFullyAcknowledged not found — was it renamed or removed?")
    .toBeGreaterThan(-1);
  return SOURCE.slice(start, start + 1400);
}

describe("roster cycle advances to acknowledged", () => {
  it("is called from the acknowledge route", () => {
    // Without the call site the helper is dead code and the cycle never moves.
    expect(SOURCE).toMatch(/await advanceCycleIfFullyAcknowledged\(dbConn, req\.params\.assignmentId\)/);
  });

  it("only ever performs the published -> acknowledged transition", () => {
    const fn = advanceHelper();
    expect(fn).toMatch(/SET c\.status = 'acknowledged'/);
    // Guarding on the current status is what stops this regressing a cycle that has already
    // advanced to active / attendance_locked / payroll_input_ready.
    expect(fn).toMatch(/c\.status = 'published'/);
  });

  it("waits for every state that is still awaiting a human, not just employee acks", () => {
    const fn = advanceHelper();
    expect(fn).toMatch(/NOT EXISTS/);
    for (const blocking of ["pending_employee_ack", "pending_manager_action", "escalated_to_hr"]) {
      expect(fn, `${blocking} must keep the cycle open`).toContain(blocking);
    }
  });

  it("does not swallow its failure silently", () => {
    // A stuck cycle must be diagnosable. Non-fatal is right — the employee's answer is already
    // committed — but a bare catch {} would make a stalled lifecycle invisible.
    const fn = advanceHelper();
    expect(fn).toMatch(/catch\s*\(\s*err\s*\)/);
    expect(fn).toMatch(/console\.error/);
  });
});
