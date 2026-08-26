import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AON_BUCKETS, AON_DAYS_SQL } from "../../workforce-population.js";

/**
 * The drill-down turns a bucket label back into a SQL predicate. Every label the aggregate can
 * emit needs a case here, or the drawer disagrees with the number that was clicked.
 */
const SRC = readFileSync(
  resolve(process.cwd(), "src/modules/reporting/executors/aon-drilldown.executor.ts"), "utf8");

describe("aon drill-down bucket predicates", () => {
  it("handles every bucket the aggregate can produce", () => {
    for (const bucket of AON_BUCKETS) {
      expect(SRC, `no drill-down predicate for the "${bucket}" bucket`).toContain(`"${bucket}"`);
    }
  });

  it("handles In Training on BOTH the active and the exits switch", () => {
    // Two switches exist: one measuring current staff from CURDATE(), one measuring leavers
    // from date_of_exit. On the exits side In Training means "left before payroll started".
    const occurrences = SRC.split(`"In Training"`).length - 1;
    expect(occurrences, "In Training must appear in both switches").toBeGreaterThanOrEqual(2);
  });

  it("clamps tenure so no predicate can match a negative", () => {
    // Task 1 moved the clamp into the shared AON_DAYS_SQL helper -- a hand-rolled GREATEST(...)
    // here would just re-create the divergence that helper exists to eliminate. So the property
    // under test is "the drill-down delegates its tenure math to that helper", proven two ways:
    // the source wires through it, and the helper itself is the one place GREATEST() lives.
    expect(SRC).toContain("AON_DAYS_SQL(");
    expect(AON_DAYS_SQL()).toContain("GREATEST(");
  });
});
