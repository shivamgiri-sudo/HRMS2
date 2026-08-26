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
    //
    // A file-wide "AON_DAYS_SQL( appears somewhere" check would stay green even if a single
    // case regressed to a hand-rolled `DATEDIFF(...) > 90` -- the other seven calls would carry
    // it. So extract each switch function's own body and check it in isolation: no bare
    // DATEDIFF anywhere in it, and one AON_DAYS_SQL( call per tenure bucket (the four buckets
    // other than "In Training", which uses IN_TRAINING_SQL instead).
    expect(AON_DAYS_SQL()).toContain("GREATEST(");

    const extractFunctionBody = (fnName: string): string => {
      const start = SRC.indexOf(`function ${fnName}`);
      expect(start, `function ${fnName} not found`).toBeGreaterThanOrEqual(0);
      const braceStart = SRC.indexOf("{", start);
      let depth = 0;
      for (let i = braceStart; i < SRC.length; i++) {
        if (SRC[i] === "{") depth++;
        else if (SRC[i] === "}") {
          depth--;
          if (depth === 0) return SRC.slice(braceStart, i + 1);
        }
      }
      throw new Error(`unterminated function body for ${fnName}`);
    };

    const tenureBucketCount = AON_BUCKETS.length - 1; // all but "In Training"

    for (const fnName of ["aonBucketClause", "aonBucketAtExitClause"]) {
      const body = extractFunctionBody(fnName);
      expect(body, `${fnName} must not hand-roll a raw DATEDIFF`).not.toMatch(/\bDATEDIFF\(/);
      const calls = body.split("AON_DAYS_SQL(").length - 1;
      expect(calls, `${fnName} must call AON_DAYS_SQL once per tenure bucket`).toBe(
        tenureBucketCount
      );
    }
  });

  it("has no raw DATEDIFF in the SELECT column lists (display columns must be clamped too)", () => {
    // tenure_at_exit_days and aon_days are read straight off these SELECTs and (for aon_days)
    // feed the risk_score CASE below them -- a raw DATEDIFF here goes negative for an In
    // Training employee and silently satisfies `aon_days <= 30`, the highest risk tier.
    expect(SRC).not.toMatch(/\bDATEDIFF\(/);
  });
});
