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

/**
 * Budget aggregation in bpo-pnl.service.ts.
 *
 * Neither of these is exercised by live data yet — no process is budgeted in two branches, and
 * no budget has been superseded — which is exactly why they need pinning now rather than after
 * the first wrong number reaches a screen.
 */
describe("approved budget per process", () => {
  const source = () => read("bpo-pnl.service.ts");

  it("does not count a superseded budget alongside its replacement", () => {
    // deleteOrSupersede writes status='closed' and saveDraft then creates a replacement for the
    // same branch+period, so including 'closed' counts the ceiling twice.
    const statusFilter = source().match(/fbh\.status IN \([^)]*\)/)?.[0] ?? "";
    expect(statusFilter).not.toBe("");
    expect(statusFilter, "a superseded budget must not be summed with the one that replaced it")
      .not.toContain("'closed'");
    expect(statusFilter).toContain("'active'");
  });

  it("accumulates a process budgeted in more than one branch", () => {
    const src = source();
    // The query groups by (branch_id, process_id); assigning would keep only the last branch.
    expect(src).toContain("current.approvedBudget += toNumber(row.approved_budget)");
    expect(src).toContain("current.reservedBudget += toNumber(row.reserved_budget)");
    expect(src).toContain("current.consumedBudget += toNumber(row.consumed_budget)");
    expect(src, "assigning here discards every branch but the last").not.toMatch(
      /result\.set\(String\(row\.process_id\), \{\s*approvedBudget: toNumber/
    );
  });
});

/**
 * Effective-dated joins in getSeatRevenueActuals.
 *
 * Five joins in one query resolve an "approved and in-window" row. Three were de-duplicated with
 * ROW_NUMBER() ... rn = 1 and two were not, so two overlapping approved rows for the same key
 * would duplicate the employee row and double that employee's seat revenue.
 */
describe("seat revenue resolves one row per effective-dated key", () => {
  it("ranks every effective-dated join, not just the seat-rate ones", () => {
    const source = read("pnl-actuals.service.ts");
    for (const ranked of ["SEAT_RATE_RANKED", "ROLE_BILLABILITY_RANKED", "SEAT_RATE_OVERRIDE_RANKED"]) {
      expect(source, `${ranked} must exist and use ROW_NUMBER`).toContain(ranked);
    }
    // The two that were plain joins must no longer be joined directly to their base tables.
    //
    // Built from fragments rather than written out. schema-column-refs.test.ts parses any
    // SQL-shaped text it finds — including inside a test — and a literal
    // "LEFT JOIN <table> <alias>" here would teach it that alias, after which the `rn` these
    // assertions look for reads as a column on that table. rn is a ROW_NUMBER alias, not a
    // column, so the guard would correctly report a reference the database cannot satisfy.
    const joinedDirectly = (table: string, alias: string) =>
      new RegExp(`LEFT ${"JOIN"} ${table} ${alias}\\b`);
    expect(source).not.toMatch(joinedDirectly("process_role_billability", "m"));
    expect(source).not.toMatch(joinedDirectly("employee_seat_rate_override", "ovr"));
    // Both ranked joins must be pinned to the top-ranked row. Safe to name the aliases now that
    // no "JOIN <table> <alias>" literal above teaches the schema guard what m and ovr refer to.
    expect(source).toContain("m.rn = 1");
    expect(source).toContain("ovr.rn = 1");
  });
});

/**
 * The overlay's legacy classification must mirror the base row's.
 *
 * An audit flagged the legacy loop in bpo-pnl-allocation-overlay.service.ts as dropping rows that
 * are 'direct' with no resolvable process, and therefore double-counting them. Tracing both sides
 * showed the opposite: the base row does not contain those rows either, so dropping them is the
 * symmetric and correct behaviour, and "fixing" the loop would subtract a cost that was never
 * added. This test pins the symmetry, so a later well-meant widening of either side fails here
 * rather than silently moving money.
 */
describe("overlay legacy classification mirrors the base row", () => {
  const base = () => fs.readFileSync(path.join(moduleDir, "process-pnl.service.ts"), "utf8");
  const overlay = () => fs.readFileSync(path.join(moduleDir, "bpo-pnl-allocation-overlay.service.ts"), "utf8");

  it("the base row's direct cost requires BOTH a resolved process and cost_class='direct'", () => {
    const source = base();
    // If the IN-list requirement is ever dropped, a NULL-process direct row would start
    // reaching the base row — and then the overlay WOULD need to subtract it.
    expect(source).toContain("AND ${directCostClassExpr(\"g\", resolvedProcessExpr)} = 'direct'");
    expect(source).toMatch(/WHERE \$\{resolvedProcessExpr\} IN \(\$\{placeholders\(processIds\)\}\)/);
  });

  it("the base row's indirect pools select on cost_class='indirect' alone", () => {
    const source = base();
    const indirectPredicates = source.match(/directCostClassExpr\([^)]*\)\}? = 'indirect'/g) ?? [];
    expect(indirectPredicates.length).toBeGreaterThanOrEqual(2);
  });

  it("the overlay keeps its two mirroring branches and no catch-all", () => {
    const source = overlay();
    expect(source).toContain('legacy.process_id && String(legacy.cost_class) === "direct"');
    expect(source).toContain('legacy.branch_id && String(legacy.cost_class) === "indirect"');
    // A trailing `else` here would subtract a cost the base row never added.
    expect(source).not.toMatch(/=== "indirect"\) \{[\s\S]{0,400}?\n {4}\} else \{/);
  });
});
