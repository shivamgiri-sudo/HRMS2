import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * /adherence-summary ran six independent aggregates over the same tables as six
 * sequential awaits, so their latencies simply summed. Measured directly against the
 * live DB in a quiet moment (2026-08-28): 2118ms + 922ms + 1023ms + 896ms for four of
 * them alone before the remaining two, and the route as a whole measured 6.9-9.4s end
 * to end depending on load — which is what made this endpoint look structurally broken
 * when it was first flagged (it had also been observed hanging past 120s under heavy
 * concurrent DB load from unrelated sessions, a separate, transient cause). Neither
 * query is individually slow; running six of them one after another is.
 *
 * None of the six reads another's result — todayParams and the shared where/params are
 * built once, up front, before any of them run — so this is a source-shape assertion
 * that they are collected into one Promise.all rather than six sequential
 * `await db.execute(...)`, matching the same fix already applied for the identical
 * shape of problem in dashboard-metric.service.ts, work-inbox.service.ts and
 * management.service.ts elsewhere in this codebase.
 */
describe("adherence-summary runs its six aggregates concurrently, not sequentially", () => {
  const source = readFileSync(
    resolve(__dirname, "../biometric-summary.routes.ts"),
    "utf-8",
  );

  /** The body of the /adherence-summary handler specifically. */
  const handler = (() => {
    const start = source.indexOf('biometricSummaryRouter.get("/adherence-summary"');
    expect(start, "/adherence-summary handler not found").toBeGreaterThan(-1);
    const next = source.indexOf('biometricSummaryRouter.get(', start + 10);
    return source.slice(start, next === -1 ? source.length : next);
  })();

  it("collects the six aggregates into a single Promise.all", () => {
    const promiseAllAt = handler.indexOf("await Promise.all([");
    expect(promiseAllAt, "Promise.all([...]) not found in the handler").toBeGreaterThan(-1);
  });

  it("destructures all six result variables from that one Promise.all call", () => {
    expect(handler).toMatch(
      /const \[rows, liveRows, regRows, shiftRows, lateArrivalRows, rosterCoverageRows\] = await Promise\.all/,
    );
  });

  it("does not sequentially await any of the six queries outside the Promise.all", () => {
    // Six independent `await db.execute` statements (one per query, each its own round
    // trip) is exactly the shape that regressed to sequential before. Inside the
    // Promise.all array, none of the six start with `await` — each is a bare promise
    // chain (`db.execute(...).then(...)`) that Promise.all itself awaits collectively.
    const sequentialAwaits = handler.match(/const \[\w+Rows?\] = await db\.execute/g) ?? [];
    expect(sequentialAwaits, `found sequential awaits: ${sequentialAwaits.join(", ")}`).toHaveLength(0);
  });

  it("preserves every existing .catch() fallback — same failure semantics, different ordering", () => {
    // Each of these strings must survive the refactor verbatim; a missing one means a
    // fallback was dropped, not just reordered.
    expect(handler).toContain("live on-leave/remote counts failed");
    expect(handler).toContain("on_leave: null, working_remotely: null");
    expect(handler).toContain("fully_covered: null, partially_covered: null, understaffed: null");
  });
});
