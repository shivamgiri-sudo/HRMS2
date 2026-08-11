import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { candidateFiltersSchema } from "../ats.validation.js";

/**
 * The candidate grid and the dashboard tile above it are built from the same table and used
 * to disagree by roughly 5x.
 *
 * getDashboardStats excluded the 29,926 legacy employee records in ats_candidate;
 * listCandidates did not, so the grid showed 37,686 rows under a tile reading ~7,760. Both
 * now exclude by default.
 *
 * Removal was the wrong fix: those rows are the only way to find an ex-employee when checking
 * a rehire, and the duplicate-identity guard deliberately searches them. So it is a filter,
 * defaulting to off.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("candidate grid excludes legacy employee records by default", () => {
  it("listCandidates applies the exclusion unless explicitly opted out", () => {
    const src = read("src/modules/ats/ats.service.ts");
    const fn = /async listCandidates\([\s\S]*?\n {2}\},/.exec(src)?.[0] ?? "";
    expect(fn, "listCandidates not found").toBeTruthy();
    expect(fn).toContain("excludeEmployeeShapedCandidatesSql");
    expect(fn).toMatch(/if \(!filters\.includeFormerEmployees\)/);
  });
});

describe("includeFormerEmployees parsing", () => {
  const parse = (q: Record<string, unknown>) => candidateFiltersSchema.parse(q);

  it("defaults to false when absent — the safe direction", () => {
    expect(parse({}).includeFormerEmployees).toBe(false);
  });

  it.each([["true"], ["1"]])("opts in for %s", (v) => {
    expect(parse({ includeFormerEmployees: v }).includeFormerEmployees).toBe(true);
  });

  it("treats the string 'false' as false", () => {
    // This is the trap: query params arrive as strings and the string "false" is truthy in
    // JavaScript. Boolean(req.query.x) would have opted every caller IN while the URL said
    // the opposite — the same bug shape as LEGACY_SYNC_ENABLED elsewhere in this repo.
    expect(parse({ includeFormerEmployees: "false" }).includeFormerEmployees).toBe(false);
    expect(parse({ includeFormerEmployees: "0" }).includeFormerEmployees).toBe(false);
    expect(parse({ includeFormerEmployees: "" }).includeFormerEmployees).toBe(false);
  });

  it("accepts a real boolean too, for non-HTTP callers", () => {
    expect(parse({ includeFormerEmployees: true }).includeFormerEmployees).toBe(true);
    expect(parse({ includeFormerEmployees: false }).includeFormerEmployees).toBe(false);
  });

  it("does not disturb the other filters", () => {
    const out = parse({ page: "2", limit: "25", stage: "Applied" });
    expect(out.page).toBe(2);
    expect(out.limit).toBe(25);
    expect(out.stage).toBe("Applied");
  });
});
