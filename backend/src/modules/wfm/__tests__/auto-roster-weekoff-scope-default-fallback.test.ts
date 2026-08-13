import { describe, expect, it } from "vitest";

/**
 * Round 2 engine-convergence (2026-08-13): generateDraft() previously
 * treated any employee getWeekOffPreferences() couldn't resolve (neither
 * week_off_preference nor its employee_roster_preference fallback) as
 * having no week-off at all — the same "no policy -> 7-day week" failure
 * mode Part A.1 closed for the governance engine's tier 3-5
 * (process/branch/org default), just never converged onto this engine.
 *
 * Tier 2 (roster_template) is NOT included here — it's indexed by cycle
 * date-position, while this engine's whole date-iteration is keyed by
 * day-of-week; porting it would mean restructuring the engine's shape, not
 * adding a lookup, and is explicitly flagged as a residual gap in the code
 * comment rather than worked around with a guess. Tier 3-5 IS a single
 * day-of-week value, so it drops in directly.
 *
 * The fallback is inline in generateDraft(), not inside the not-exported
 * getWeekOffPreferences() — same source-shape testing style this file's
 * sibling (auto-roster-weekoff-preference-fallback.test.ts) already
 * established for exactly this "large enclosing function" situation.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const SOURCE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../auto-roster-synced.service.ts"),
  "utf-8"
);

describe("generateDraft — week-off scope-default fallback (round 2 convergence)", () => {
  it("imports the shared governance-engine resolver, not a private copy", () => {
    expect(SOURCE).toMatch(/import\s*\{\s*resolveWeekOffScopeDefault\s*\}\s*from\s*["']\.\.\/roster\/weekoff-policy\.service\.js["']/);
  });

  it("resolves the scope default once per plan (not per employee, per date, or per slot)", () => {
    const idx = SOURCE.indexOf("const scopeDefault = await resolveWeekOffScopeDefault(");
    expect(idx).toBeGreaterThan(-1);
    // Must appear exactly once — a per-loop call would be a real behavioral
    // regression (redundant queries per date/employee instead of one per plan).
    const occurrences = SOURCE.split("const scopeDefault = await resolveWeekOffScopeDefault(").length - 1;
    expect(occurrences).toBe(1);
  });

  it("degrades to null (not a thrown error) if the lookup fails — generation must still produce a roster", () => {
    const idx = SOURCE.indexOf("const scopeDefault = await resolveWeekOffScopeDefault(");
    const body = SOURCE.slice(idx, idx + 400);
    expect(body).toMatch(/\.catch\(\(error\)/);
    expect(body).toMatch(/week_off_policy_default lookup unavailable/);
  });

  it("preferredDayFor lets an explicit preference (including day 0/Sunday) win over the scope default", () => {
    const idx = SOURCE.indexOf("const preferredDayFor = (empId: string)");
    expect(idx).toBeGreaterThan(-1);
    const body = SOURCE.slice(idx, idx + 300);
    // Must check `!== undefined`, not truthiness — day 0 (Sunday) is a valid
    // explicit preference and must not fall through to the scope default.
    expect(body).toMatch(/explicit !== undefined/);
  });

  it("every prefs.get(...) === dow comparison in the assignment logic was converted to preferredDayFor(...)", () => {
    // Only the helper's own internal read and an explanatory comment should
    // still say `prefs.get` directly — the three real decision sites (senior-
    // priority sort x2, week-off grant loop) must go through the fallback-
    // aware helper instead, or scope-default employees would still never
    // dow-match to anything.
    // 2 occurrences of the literal text: the one real call inside
    // preferredDayFor itself, plus one explanatory comment elsewhere in the
    // file that mentions "prefs.get()" in prose. Neither is a live decision
    // site outside the helper.
    const directPrefsGetCount = (SOURCE.match(/prefs\.get\(/g) ?? []).length;
    expect(directPrefsGetCount).toBe(2);
    expect(SOURCE).not.toMatch(/prefs\.get\([^)]*\)\)?\s*===\s*dow/);
    // preferredDayFor(...) calls may themselves contain nested parens
    // (e.g. String(a.id)), so match on the call opening + eventual === dow
    // rather than a single non-nested capture.
    expect((SOURCE.match(/preferredDayFor\(String\([^)]*\)\)\s*===\s*dow/g) ?? []).length).toBe(3);
  });
});
