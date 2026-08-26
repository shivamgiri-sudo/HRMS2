import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The AON executor must not carry its own population rule. It defined ACTIVE as
 * `e.active_status = 1` alone and reported 1,121 active employees where every other page
 * reported 1,091 — the 30 difference being people who left in June/July 2026 whose
 * active_status flag was never cleared.
 */
const SRC = readFileSync(
  resolve(process.cwd(), "src/modules/reporting/executors/aon.executor.ts"), "utf8");
const live = () => SRC.split("\n")
  .filter(l => !l.trim().startsWith("*") && !l.trim().startsWith("//")).join("\n");

describe("aon.executor population rule", () => {
  it("imports the shared definition", () => {
    expect(SRC).toContain("workforce-population.js");
    expect(SRC).toContain("ACTIVE_EMPLOYEE_SQL");
  });

  it("no longer hard-codes active_status = 1 as the whole test", () => {
    expect(live()).not.toMatch(/const ACTIVE\s*=\s*["']e\.active_status = 1["']/);
  });

  // Scoped to aonBucketSql/aonBucketOrderSql specifically, not the whole file: the file
  // also defines atRiskBucketSql, a distinct helper used only by aonBucketShrinkage's
  // at-risk-population CTE (which carries a pre-COALESCE'd join_date column, not the raw
  // date_of_joining/salary_start_date pair AON_BUCKET_SQL needs for its In Training check).
  // Task 2's brief names only aonBucketSql/aonBucketOrderSql and the ACTIVE constant as in
  // scope; aonBucketShrinkage's own population rule is untouched here.
  it("aonBucketSql/aonBucketOrderSql no longer inline the bucket CASE", () => {
    const bucketFn = live().match(/function aonBucketSql\([\s\S]*?\n}/)?.[0];
    const orderFn = live().match(/function aonBucketOrderSql\([\s\S]*?\n}/)?.[0];
    expect(bucketFn).toBeTruthy();
    expect(orderFn).toBeTruthy();
    expect(bucketFn).not.toMatch(/WHEN DATEDIFF/);
    expect(orderFn).not.toMatch(/WHEN DATEDIFF/);
  });

  it("uses the shared bucket helpers", () => {
    expect(SRC).toContain("AON_BUCKET_SQL");
    expect(SRC).toContain("AON_BUCKET_ORDER_SQL");
  });
});
