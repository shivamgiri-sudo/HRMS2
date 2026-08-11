import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * Every P&L reader of salary_prep_run must cover the whole month.
 *
 * salary_prep_run is keyed (run_month, branch_filter, process_filter), so a month legitimately
 * holds more than one run. Production's 2026-03 holds two, and they share ZERO employees:
 * 1,140 in the FINALIZED run and 226 in the approved one. They are disjoint cohorts, so any
 * reader that takes one and discards the other loses real cost outright.
 *
 * Four services had four different strategies and produced four different March people-costs
 * from the same table:
 *
 *   ceo-overview.service.ts   sums every run   Rs 2,37,71,979.56  (1,366 employees) — correct
 *   process-pnl.service.ts    created_at DESC  Rs 2,17,27,117.00  (1,140) — omitted 226
 *   bpo-pnl.service.ts        FIELD(...) DESC  Rs    20,44,862.56 (  226) — omitted 1,140
 *   process-lob.service.ts    FIELD(...) ASC   the opposite pick from bpo-pnl, same expression
 *
 * The FIELD() rankings were meaningless as well as inconsistent: FIELD() scores 0 for a status
 * not in its list, and the statuses actually in use are FINALIZED, approved, draft and
 * processing — so FINALIZED scored 0 and sorted last under DESC while 'draft' scored 5 and
 * sorted first.
 *
 * This test pins the shape, not the number: no LIMIT 1 on a run lookup, and no FIELD()-based
 * run ranking anywhere in the module.
 */

const moduleDir = path.resolve(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(moduleDir, file), "utf8");

const READERS = [
  "process-pnl.service.ts",
  "bpo-pnl.service.ts",
  "process-lob.service.ts",
  "ceo-overview.service.ts",
];

/**
 * The text of each `FROM salary_prep_run ...` statement, and nothing else.
 *
 * Scoped rather than searched file-wide on purpose: FIELD(status, ...) is also used to rank
 * process_monthly_plan rows, where it is legitimate — that table's statuses really are
 * locked/approved/draft. A file-wide match would flag those and train the next reader to
 * ignore this test.
 */
function runLookups(source: string) {
  return source.match(/FROM salary_prep_run[\s\S]{0,400}?`/g) ?? [];
}

describe("salary_prep_run is read for the whole month, by every service", () => {
  for (const file of READERS) {
    it(`${file} does not rank runs with FIELD(status, ...)`, () => {
      for (const lookup of runLookups(read(file))) {
        expect(
          lookup,
          `FIELD() scores 0 for FINALIZED, which is nearly every run in this table:\n${lookup.slice(0, 200)}`
        ).not.toMatch(/FIELD\(\s*status/);
      }
    });

    it(`${file} does not reduce a month's runs to one`, () => {
      for (const lookup of runLookups(read(file))) {
        expect(
          lookup,
          `a LIMIT 1 here drops whichever cohort loses the sort:\n${lookup.slice(0, 200)}`
        ).not.toMatch(/LIMIT\s+1\b/i);
      }
    });
  }

  it("the readers that aggregate bind every run id, not one", () => {
    // The three that were fixed all now bind an IN (...) list built from the month's runs.
    for (const file of ["process-pnl.service.ts", "bpo-pnl.service.ts", "process-lob.service.ts"]) {
      expect(read(file), `${file} should bind a run id list`).toMatch(/spl\.run_id IN \(/);
    }
  });

  it("ceo-overview keeps joining the run table without narrowing to one run", () => {
    // It was already correct; this guards against someone "fixing" it to match the others.
    const source = read("ceo-overview.service.ts");
    expect(source).toMatch(/JOIN salary_prep_run r ON r\.id = l\.run_id/);
  });
});
