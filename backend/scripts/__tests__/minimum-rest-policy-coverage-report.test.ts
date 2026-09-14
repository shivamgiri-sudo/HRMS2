import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

/**
 * Closure #3 (2026-08-13): the read-only minimum-rest policy coverage
 * report couldn't be exercised live this round — the private-LAN DB
 * connection was unreachable (ETIMEDOUT), the same connectivity gap a
 * concurrent session hit earlier in this round. Source-level assertions
 * here at least prove the script's structure and SQL shape are sound
 * before someone runs it for real once connectivity is restored.
 */

const SOURCE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../minimum-rest-policy-coverage-report.ts"),
  "utf-8"
);

describe("minimum-rest-policy-coverage-report.ts", () => {
  it("is strictly read-only — no SQL write statement anywhere in the file", () => {
    // Matches the SQL statement shape (verb + its usual following keyword),
    // not bare English usage of the same word in a comment (e.g. "replace it").
    const writeVerbs = /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|ALTER\s+TABLE|DROP\s+TABLE|CREATE\s+TABLE|TRUNCATE\s+TABLE|REPLACE\s+INTO)\b/gi;
    const matches = SOURCE.match(writeVerbs) ?? [];
    expect(matches, `Found a SQL write statement: ${matches.join(", ")}`).toEqual([]);
  });

  it("degrades to an informational message, not an error, when wfm_rest_policy doesn't exist yet", () => {
    expect(SOURCE).toMatch(/if \(tableRows\.length === 0\)/);
    expect(SOURCE).toMatch(/migration 1210_minimum_rest_policy\.sql has not been applied/);
    expect(SOURCE).toMatch(/return;/);
  });

  it("resolves scope tiers via EXISTS subqueries, not LEFT JOINs (avoids fan-out double-counting)", () => {
    expect(SOURCE).toMatch(/EXISTS \(\s*SELECT 1 FROM wfm_rest_policy/);
    expect(SOURCE).not.toMatch(/LEFT JOIN wfm_rest_policy/);
  });

  it("checks scope tiers in the documented precedence order: employee > process > branch > organization", () => {
    const empIdx = SOURCE.indexOf('scopeExists("ep", "employee"');
    const procIdx = SOURCE.indexOf('scopeExists("pp", "process"');
    const branchIdx = SOURCE.indexOf('scopeExists("bp", "branch"');
    const orgIdx = SOURCE.indexOf('scopeExists("op", "organization"');
    expect(empIdx).toBeGreaterThan(-1);
    expect(procIdx).toBeGreaterThan(empIdx);
    expect(branchIdx).toBeGreaterThan(procIdx);
    expect(orgIdx).toBeGreaterThan(branchIdx);
  });

  it("scopes every tier check to active, currently-effective policy rows (active_status=1, effective_from/to window)", () => {
    expect(SOURCE).toMatch(/active_status = 1/);
    expect(SOURCE).toMatch(/effective_from <= CURDATE\(\)/);
    expect(SOURCE).toMatch(/effective_to IS NULL OR .*effective_to >= CURDATE\(\)/);
  });

  it("reports a distinct warning for the expired-policy case, not just the never-configured case", () => {
    expect(SOURCE).toMatch(/effective_to IS NOT NULL AND p\.effective_to < CURDATE\(\)/);
    expect(SOURCE).toMatch(/already expired/);
  });

  it("only scopes to active employees throughout (active_status = 1 on the employees table)", () => {
    const empQueries = SOURCE.match(/FROM employees e[\s\S]{0,400}/g) ?? [];
    expect(empQueries.length).toBeGreaterThan(0);
    for (const q of empQueries) {
      expect(q).toMatch(/active_status = 1/);
    }
  });

  it("always closes the connection, including on failure (try/finally)", () => {
    expect(SOURCE).toMatch(/finally \{\s*await conn\.end\(\);/);
  });
});
