/**
 * A bulk approval must do the per-employee work once, not once per row.
 *
 * reviewRegularization carries three side effects that are per-EMPLOYEE-MONTH concerns, not
 * per-row ones: closing the work-inbox alerts, the SMS, and a payroll recalculation. Run inline
 * they dominate the approval loop, and the recalculation is the expensive one — it re-costs an
 * employee's entire open month. An employee with ten corrections in a file had their month
 * re-costed ten times for the same final answer. On a 3,653-row batch that is thousands of
 * redundant recalculations on a box that shares one connection pool across 45 workers.
 *
 * The fix defers all three and runs them once per distinct employee-month after the loop.
 * Recalculation is idempotent, so the end state is identical — only the number of times each
 * happens changes.
 *
 * Asserted against the shipped source: what is being pinned is the SHAPE of the wiring (the flag
 * is passed, the side effects are guarded on it, the recalculation is keyed by employee-month).
 * A behavioural test here would have to stand up the payroll engine, and would still pass if the
 * dedupe key silently widened back to per-row.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const bulk = fs.readFileSync(path.resolve(DIR, "..", "attendance-regularization-bulk.service.ts"), "utf8");
const wfm = fs.readFileSync(path.resolve(DIR, "../../wfm/wfm.service.ts"), "utf8");

/**
 * The reviewRegularization body — bounded by the next method rather than a character count.
 * The three side effects sit far apart in a long function, and a fixed window silently stopped
 * short of the payroll recalculation, which would let this file pass while the expensive part
 * went unguarded.
 */
function reviewBody(): string {
  const start = wfm.indexOf("async reviewRegularization(");
  expect(start, "reviewRegularization not found").toBeGreaterThan(-1);
  const next = wfm.indexOf("\n  async ", start + 10);
  return wfm.slice(start, next > start ? next : undefined);
}

describe("the flag cannot be set by an API caller", () => {
  it("is a separate options argument, not part of the validated request body", () => {
    /*
     * ReviewRegularizationInput is the zod-validated HTTP body. If the flag lived there, any
     * caller could silence a notification or skip a payroll recalculation by adding a field —
     * turning an internal performance concession into a way to quietly not pay someone.
     */
    const validation = fs.readFileSync(path.resolve(DIR, "../../wfm/wfm.validation.ts"), "utf8");
    const schemaStart = validation.indexOf("export const reviewRegularizationSchema");
    const schema = validation.slice(schemaStart, validation.indexOf("})", schemaStart));
    expect(schema).not.toMatch(/deferSideEffects/);
    expect(reviewBody()).toMatch(/options\?:\s*\{\s*deferSideEffects\?:\s*boolean\s*\}/);
  });

  it("defaults to doing the work, so an unaware caller loses nothing", () => {
    // Strict === true: an omitted options object, or any truthy-ish value, must not silently
    // disable notifications for the single-approval path.
    expect(reviewBody()).toMatch(/deferSideEffects = options\?\.deferSideEffects === true/);
  });
});

describe("all three side effects are actually deferred", () => {
  const body = reviewBody();

  it("skips the work-inbox clear", () => {
    expect(body).toMatch(/!== 'manager_approved' && !deferSideEffects/);
  });

  it("skips the per-row SMS", () => {
    expect(body).toMatch(/if \(!deferSideEffects\) try \{/);
  });

  it("skips the payroll recalculation — the expensive one", () => {
    expect(body).toMatch(/input\.status === 'approved' && !deferSideEffects/);
  });
});

describe("the bulk path defers, then does the work itself", () => {
  it("passes the flag from the approval loop", () => {
    expect(bulk).toMatch(/\{ deferSideEffects: true \}/);
  });

  it("runs the deferred work after the loop", () => {
    // Nothing may be dropped: deferring without running them would silently stop notifying
    // people and stop recalculating pay, which is far worse than being slow.
    expect(bulk).toMatch(/await runDeferredSideEffects\(appliedRows, approverUserId\)/);
  });

  it("keys the payroll recalculation by employee AND month", () => {
    /*
     * The whole saving is here. Keyed by row it would do the same number of recalculations as
     * before; keyed by employee alone it would under-recalculate a file spanning two months and
     * leave one of them stale.
     */
    const idx = bulk.indexOf("const byEmpMonth");
    expect(idx, "byEmpMonth map not found").toBeGreaterThan(-1);
    const region = bulk.slice(idx, idx + 600);
    expect(region).toContain("a.sessionDate.slice(0, 7)");
    expect(region).toMatch(/\$\{a\.employeeId\}\|\$\{month\}/);
  });

  it("only collects rows that actually applied", () => {
    // A row that threw must not trigger a notification or a recalculation of its own.
    const idx = bulk.indexOf("grpApplied_.push");
    expect(idx).toBeGreaterThan(-1);
    expect(bulk.slice(idx - 400, idx)).toContain("grpLocked.push");
  });

  it("bounds the recalculations like the row loop does", () => {
    // A recalculation is heavier than a row; unbounded these would starve the shared pool.
    const idx = bulk.indexOf("const byEmpMonth");
    expect(bulk.slice(idx, idx + 1400)).toContain("mapWithConcurrency");
    expect(bulk.slice(idx, idx + 1400)).toContain("BULK_ROW_CONCURRENCY");
  });
});

describe("a failed side effect cannot fail the batch", () => {
  it("catches each part independently", () => {
    /*
     * The approvals are already committed by this point. A failed SMS turning a successful
     * 3,653-row approval into a reported failure would send someone re-running a batch that
     * had in fact worked.
     */
    const idx = bulk.indexOf("async function runDeferredSideEffects");
    const fn = bulk.slice(idx, bulk.indexOf("export async function applyRegularizationBatch", idx));
    // Three independent try blocks: inbox, SMS, recalculation.
    expect(fn.match(/\btry \{/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(fn).toContain("if (applied.length === 0) return;");
  });

  it("still queues a recalculation that failed, rather than losing it", () => {
    const idx = bulk.indexOf("async function runDeferredSideEffects");
    const fn = bulk.slice(idx, bulk.indexOf("export async function applyRegularizationBatch", idx));
    expect(fn).toContain("queuePayrollRecalculation");
  });
});
