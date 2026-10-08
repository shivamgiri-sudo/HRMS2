/**
 * Regression tests for the hiring analytics accuracy fixes.
 *
 * Each test states the defect it locks down. Every one of these fails against the
 * pre-fix implementation — that is the point of them.
 */
import { describe, expect, it } from "vitest";
import { funnelPredicates } from "../recruiter-hiring.service";

/**
 * Minimal SQL-predicate evaluator.
 *
 * The funnel predicates are SQL strings, so to test their *semantics* without a
 * database we translate the small grammar they use (=, OR, LOWER/COALESCE IN)
 * into a JS expression and evaluate it against a row. This keeps the assertions
 * about behaviour rather than about string shape, so a rewrite that preserves
 * meaning still passes.
 */
function evaluatePredicate(sql: string, row: Record<string, unknown>): boolean {
  const js = sql
    // LOWER(COALESCE(col,'')) IN ('a','b')  →  ['a','b'].includes(String(col ?? '').toLowerCase())
    .replace(
      /LOWER\(COALESCE\((\w+),''\)\)\s+IN\s+\(([^)]*)\)/gi,
      (_m, col, list) => `[${list}].includes(String(row[${JSON.stringify(col)}] ?? '').toLowerCase())`
    )
    // col = 1  →  Number(row.col) === 1
    .replace(/(\w+)\s*=\s*1\b/g, (_m, col) => `Number(row[${JSON.stringify(col)}] ?? 0) === 1`)
    .replace(/\bOR\b/gi, "||")
    .replace(/\bAND\b/gi, "&&");

  // eslint-disable-next-line no-new-func
  return Boolean(new Function("row", `return (${js});`)(row));
}

const F = funnelPredicates("");

const evalStages = (row: Record<string, unknown>) => ({
  contacted: evaluatePredicate(F.IS_CONTACTED, row),
  shortlisted: evaluatePredicate(F.IS_SHORTLISTED, row),
  walkin: evaluatePredicate(F.IS_WALKIN, row),
  selected: evaluatePredicate(F.IS_SELECTED, row),
  joined: evaluatePredicate(F.IS_JOINED, row),
});

describe("hiring funnel predicates", () => {
  it("makes every later stage imply all earlier stages", () => {
    // A backfilled record: joined, but none of the intermediate flags were set.
    // Counting raw flags here produced "more joined than walked in", an
    // impossible funnel that appeared on the Hiring Dashboard.
    const backfilled = {
      joined_flag: 1,
      final_selection_flag: 0,
      walkin_flag: 0,
      contacted_flag: 0,
      recruiter_remarks: "",
    };

    const stages = evalStages(backfilled);

    expect(stages.joined).toBe(true);
    expect(stages.selected).toBe(true);
    expect(stages.walkin).toBe(true);
    expect(stages.shortlisted).toBe(true);
    expect(stages.contacted).toBe(true);
  });

  it("keeps the funnel monotonically non-increasing for every flag combination", () => {
    // Exhaustive over the four flags — no combination may invert the funnel.
    for (const joined of [0, 1]) {
      for (const selected of [0, 1]) {
        for (const walkin of [0, 1]) {
          for (const contacted of [0, 1]) {
            const row = {
              joined_flag: joined,
              final_selection_flag: selected,
              walkin_flag: walkin,
              contacted_flag: contacted,
              recruiter_remarks: "",
            };
            const s = evalStages(row);
            const ordered = [s.contacted, s.shortlisted, s.walkin, s.selected, s.joined].map(Number);

            for (let i = 1; i < ordered.length; i += 1) {
              expect(
                ordered[i] <= ordered[i - 1],
                `funnel inverted at index ${i} for ${JSON.stringify(row)}`
              ).toBe(true);
            }
          }
        }
      }
    }
  });

  it("treats recruiter intent remarks as shortlisted", () => {
    const interested = {
      joined_flag: 0,
      final_selection_flag: 0,
      walkin_flag: 0,
      contacted_flag: 0,
      recruiter_remarks: "Interested",
    };
    const stages = evalStages(interested);

    expect(stages.shortlisted).toBe(true);
    expect(stages.contacted).toBe(true);
    // …but intent alone must not manufacture a walk-in.
    expect(stages.walkin).toBe(false);
  });

  it("classifies an untouched record as no stage at all", () => {
    const untouched = {
      joined_flag: 0,
      final_selection_flag: 0,
      walkin_flag: 0,
      contacted_flag: 0,
      recruiter_remarks: "",
    };
    expect(evalStages(untouched)).toEqual({
      contacted: false,
      shortlisted: false,
      walkin: false,
      selected: false,
      joined: false,
    });
  });

  it("demonstrates the raw-flag logic it replaced was broken", () => {
    // The pre-fix Hiring Dashboard counted each stage from its own flag alone.
    // This reproduces that and shows it inverts the funnel on the same row the
    // shared predicates handle correctly — the reason the Dashboard and the
    // Analytics tab disagreed for identical filters.
    const backfilled = {
      joined_flag: 1,
      final_selection_flag: 0,
      walkin_flag: 0,
      contacted_flag: 0,
      recruiter_remarks: "",
    };

    const rawFlags = {
      contacted: Number(backfilled.contacted_flag) === 1,
      walkin: Number(backfilled.walkin_flag) === 1,
      selected: Number(backfilled.final_selection_flag) === 1,
      joined: Number(backfilled.joined_flag) === 1,
    };

    // Old behaviour: joined without ever having walked in — impossible.
    expect(rawFlags.joined).toBe(true);
    expect(rawFlags.walkin).toBe(false);

    // New behaviour on the identical row: consistent.
    const fixed = evalStages(backfilled);
    expect(fixed.joined).toBe(true);
    expect(fixed.walkin).toBe(true);
  });

  it("emits identical predicates regardless of table alias", () => {
    // The Analytics tab aliases the table; the Hiring Dashboard does not. If the
    // two ever diverge, the same rows report different totals on the two pages.
    const aliased = funnelPredicates("arha");
    const bare = funnelPredicates("");

    expect(aliased.IS_JOINED).toBe(bare.IS_JOINED.replace(/\bjoined_flag/, "arha.joined_flag"));
    for (const key of ["IS_CONTACTED", "IS_SHORTLISTED", "IS_WALKIN", "IS_SELECTED"] as const) {
      // Same structure, only the column qualifier differs.
      expect(aliased[key].replace(/arha\./g, "")).toBe(bare[key]);
    }
  });
});

describe("analytics SQL shape", () => {
  it("orders the trend subquery newest-first before capping", () => {
    // Locking down the fix for the stale-trend defect: capping an ascending
    // order returned the OLDEST 90 days and presented them as the current trend.
    const source = readServiceSource();
    const trendBlock = extractBlock(source, "safe(\"trend\"", 1400);

    expect(trendBlock).toMatch(/ORDER BY arha\.activity_date DESC/);
    expect(trendBlock).toMatch(/ORDER BY t\.date ASC/);
  });

  it("applies the month and education filters it accepts", () => {
    // Both were accepted by the route and silently dropped by the service, so a
    // filtered heading sat above unfiltered totals.
    const source = readServiceSource();
    expect(source).toMatch(/DATE_FORMAT\(arha\.activity_date, '%Y-%m'\) = \?/);
    expect(source).toMatch(/arha\.education_qualification LIKE \?/);
  });

  it("excludes follow-up attempts from grouped breakdowns", () => {
    // aggregateBy omitted the exclusion the headline summary applied, so the
    // group rows summed to more than the total displayed above them.
    const source = readServiceSource();
    const aggregateBlock = extractBlock(source, "async function aggregateBy", 1200);
    expect(aggregateBlock).toMatch(/COALESCE\(is_followup_attempt, 0\) = 0/);
  });
});

function readServiceSource(): string {
  // Read at call time so the test reflects the file on disk.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require("node:path") as typeof import("node:path");
  return fs.readFileSync(path.resolve(__dirname, "../recruiter-hiring.service.ts"), "utf8");
}

function extractBlock(source: string, marker: string, length: number): string {
  const index = source.indexOf(marker);
  expect(index, `marker not found: ${marker}`).toBeGreaterThan(-1);
  return source.slice(index, index + length);
}
