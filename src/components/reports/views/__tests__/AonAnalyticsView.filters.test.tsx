import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * appendFilterConditions has always supported branchId, processId, departmentId and
 * costCentreId. The page exposed Branch only, so four working filters were unreachable.
 *
 * Separately, From/To were never passed to aon-bucket-headcount — the default metric — so on
 * first load changing the dates did nothing at all. Headcount is an as-of-today snapshot, so
 * the honest fix is to disable those inputs for that metric, not to fake the filtering.
 */
const SRC = readFileSync(
  resolve(process.cwd(), "src/components/reports/views/AonAnalyticsView.tsx"), "utf8");

describe("AON filters", () => {
  it("has state for all four dimension filters", () => {
    for (const s of ["branchId", "processId", "departmentId", "costCentreId"]) {
      expect(SRC, `${s} filter state missing`).toContain(`${s}, set`);
    }
  });

  it("loads each dropdown from a real endpoint", () => {
    for (const url of ["/api/org/branches", "/api/org/processes",
                       "/api/org/departments", "/api/finance/cost-centres"]) {
      expect(SRC, `${url} not called`).toContain(url);
    }
  });

  it("passes every filter into the report params", () => {
    // A filter absent from `base` is one the user can set and the server never sees.
    const base = /const base\s*=\s*\{[\s\S]{0,500}?\n  \}/.exec(SRC)?.[0] ?? "";
    for (const p of ["branchId", "processId", "departmentId", "costCentreId"]) {
      expect(base, `${p} never reaches the query`).toContain(p);
    }
  });

  it("does not pretend the date range filters headcount", () => {
    expect(SRC).toMatch(/as of today/i);
  });
});
