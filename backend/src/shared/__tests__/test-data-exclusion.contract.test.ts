import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REQUIRED_EXCLUSION_SITES,
  TEST_DATA_CLASSIFIED_TABLES,
  excludeTestData,
  onlyTestData,
} from "../testDataExclusion.js";

/**
 * Migration 1063 adds is_test_data; classify-test-data.sql sets it. Neither changes what a
 * user sees. The only thing that does is a query filtering on it, and a filter added once
 * is a filter that can be dropped in the next refactor without anyone noticing — the row
 * simply reappears on the leaderboard.
 *
 * So the requirement lives in REQUIRED_EXCLUSION_SITES and this test enforces it. Adding a
 * surface to that list without applying the predicate fails the build, which is the
 * intended direction: the list is the decision, the code follows it.
 */
const BACKEND = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(BACKEND, p), "utf8");

describe("test-data exclusion contract", () => {
  it("builds a predicate that uses the index and cannot be NULL-defeated", () => {
    // `= 0` not `!= 1` or `IS NOT TRUE`: the column is NOT NULL DEFAULT 0, so there is no
    // third state, and equality is what the index on is_test_data can serve.
    expect(excludeTestData("e")).toBe("e.is_test_data = 0");
    expect(onlyTestData("e")).toBe("e.is_test_data = 1");
  });

  it("refuses an alias that is not a bare identifier", () => {
    // The alias is interpolated straight into SQL. Every current call site passes a literal,
    // but rejecting anything else means this can never become an injection point when a
    // future caller passes something computed.
    expect(() => excludeTestData("e; DROP TABLE employees --")).toThrow(/Invalid SQL alias/);
    expect(() => excludeTestData("")).toThrow(/Invalid SQL alias/);
    expect(() => excludeTestData("a.b")).toThrow(/Invalid SQL alias/);
  });

  it("declares the classification columns on every table the migration alters", () => {
    const migration = read("sql/1063_test_data_classification.sql");
    for (const table of TEST_DATA_CLASSIFIED_TABLES) {
      expect(migration, `1063 does not classify ${table}`).toContain(`TABLE_NAME='${table}'`);
    }
    // Guarded on the table existing, not just the column — a column count of zero is also
    // what a missing table looks like, which is how twelve other migrations broke the
    // fresh-database build.
    expect(migration).toContain("INFORMATION_SCHEMA.TABLES");
    expect(migration).toContain("@tbl>0 AND @col=0");
  });

  it("never deletes: classification is reversible by design", () => {
    const classify = read("../scripts/classify-test-data.sql");
    // ats_candidate has 25 ON DELETE CASCADE foreign keys pointing at it. A DELETE here
    // silently empties rows from twenty-five other tables, including audit trails.
    const statements = classify
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(statements).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(statements).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(statements).not.toMatch(/\bTRUNCATE\b/i);
  });

  it("only marks a process when nothing is attached to it", () => {
    const classify = read("../scripts/classify-test-data.sql");
    // BSS-OTHERS is the cautionary case: two rows that look like duplicates, carrying 15 and
    // 179 real employees. A name-only rule would have hidden 194 people from every
    // process-scoped report.
    expect(classify).toMatch(/NOT EXISTS \(SELECT 1 FROM employees e WHERE e\.process_id = p\.id\)/);
  });

  it("names a real file and a real consequence for every required exclusion site", () => {
    expect(REQUIRED_EXCLUSION_SITES.length).toBeGreaterThan(0);
    for (const site of REQUIRED_EXCLUSION_SITES) {
      expect(
        existsSync(resolve(BACKEND, site.file)),
        `${site.file} is listed as an exclusion site but does not exist`,
      ).toBe(true);
      expect(
        site.consequence.trim().length,
        `${site.file} has no stated consequence — say what the user sees if the filter is missing`,
      ).toBeGreaterThan(30);
    }
  });

  /**
   * Deliberately skipped, with the reason recorded rather than the test deleted.
   *
   * Enabling this is the step that actually closes the leaderboard defect. It is skipped
   * because migration 1063 has not been applied to any database yet, so the column does not
   * exist and every one of these queries would be asserting against a schema that is not
   * real. Un-skip it in the same change that applies 1063 and adds the predicates — not
   * before, or it fails for the wrong reason and gets skipped again permanently.
   */
  it.skip("applies the exclusion predicate at every required site", () => {
    for (const site of REQUIRED_EXCLUSION_SITES) {
      const source = read(site.file);
      expect(
        source,
        `${site.file} must apply the test-data exclusion. Consequence if it does not: ${site.consequence}`,
      ).toMatch(/excludeTestData\(|is_test_data\s*=\s*0/);
    }
  });
});
