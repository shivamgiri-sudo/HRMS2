/**
 * "A run exists for this month" is not the same as "this month is taken".
 *
 * A cancelled run releases its month. Four separate places read the mere EXISTENCE of a row in
 * salary_prep_run as proof the month was handled, and each failed differently on 2026-09-05,
 * when an empty August run — status FINALIZED, total_employees 0, three lines against July's
 * 1,371, no payslips, no transfers — was cancelled:
 *
 *   1. createRun's duplicate check      refused to create a real August run, forever.
 *   2. useGeneratePayroll's fallback    ADOPTED the cancelled run and called /calculate on it,
 *                                       flipping it back to 'processing' and silently undoing a
 *                                       deliberate cancellation.
 *   3. the Payroll page's active run    displayed the voided stub as "ACTIVE PAYROLL RUN" at
 *                                       Rs 1,75,193, under a "Step 1 of 7" progress strip.
 *   4. resolveRunForMonth               evaluated the whole readiness-category gate against it,
 *                                       reporting readiness for a run nobody is paying.
 *
 * Four symptoms, one assumption. The frontend two are pinned in their own files; these are the
 * backend two, plus the shared vocabulary they must agree on.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VOID_RUN_STATUSES, VOID_RUN_STATUSES_SQL, CLOSED_RUN_STATUSES } from "../run-status.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(DIR, "..", rel), "utf8");

/** Every backend site that picks "the run for this month" and must ignore voided ones. */
const SITES: Array<{ file: string; anchor: string; what: string }> = [
  {
    file: "payroll.service.ts",
    anchor: "Payroll run already exists for this month",
    what: "createRun's one-company-run-per-month duplicate check",
  },
  {
    file: "payroll-readiness-categories.routes.ts",
    anchor: "async function resolveRunForMonth",
    what: "the readiness-category gate's month -> run lookup",
  },
];

describe("every backend site that resolves a month's run ignores voided runs", () => {
  for (const site of SITES) {
    it(`${site.what} excludes them`, () => {
      const src = read(site.file);
      const idx = src.indexOf(site.anchor);
      expect(idx, `anchor not found in ${site.file}`).toBeGreaterThan(-1);
      // The SQL sits within a few hundred characters of the anchor in both files.
      const region = src.slice(Math.max(0, idx - 1200), idx + 1200);
      expect(region, `${site.file} must filter on status`).toContain("VOID_RUN_STATUSES_SQL");
    });

    it(`${site.what} compares case- and whitespace-insensitively`, () => {
      /*
       * This column holds 'FINALIZED' from the payroll UI and lowercase values from older code —
       * the split isRunClosed() exists to paper over. A status guard matching one casing is a
       * guard that does not hold.
       */
      const src = read(site.file);
      const idx = src.indexOf(site.anchor);
      const region = src.slice(Math.max(0, idx - 1200), idx + 1200);
      expect(region).toMatch(/LOWER\(TRIM\(COALESCE\(\s*status\s*,\s*''\)\)\)/);
    });

    it(`${site.what} excludes rather than includes`, () => {
      // NOT IN (void) means an unrecognised status still counts as occupying the month. Inverting
      // this would let a status typo silently permit two live runs for one month.
      const src = read(site.file);
      const idx = src.indexOf(site.anchor);
      const region = src.slice(Math.max(0, idx - 1200), idx + 1200);
      expect(region).toMatch(/NOT IN \(\$\{VOID_RUN_STATUSES_SQL\}\)/);
    });
  }
});

describe("the vocabulary the sites share", () => {
  it("is cancelled and rejected, and nothing else", () => {
    expect([...VOID_RUN_STATUSES].sort()).toEqual(["cancelled", "rejected"]);
  });

  it("keeps its SQL form in step", () => {
    const fromSql = VOID_RUN_STATUSES_SQL.split(",").map((s) => s.trim().replace(/'/g, "")).sort();
    expect(fromSql).toEqual([...VOID_RUN_STATUSES].sort());
  });

  it("never overlaps the closed statuses", () => {
    // Closed means finished and must not be recomputed. Void means it never happened. An overlap
    // would either let a real finalized run be replaced, or leave a cancelled one blocking.
    for (const s of VOID_RUN_STATUSES) expect(CLOSED_RUN_STATUSES.has(s)).toBe(false);
  });
});
