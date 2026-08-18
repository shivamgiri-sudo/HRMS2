import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every reachable employee-grain INLINE report block must apply row scope.
 *
 * executor-row-scope.contract.test.ts enforces this for executors/*.executor.ts. It reads
 * that directory and nothing else — so the inline `case` blocks in report-suite.routes.ts,
 * which WIN at runtime wherever they shadow an executor (the switch returns before the
 * default branch that calls executeReport), were never covered by any scope guard.
 *
 * That is the gap this closes. Measured 2026-08-11 against the current file: 98 inline case
 * blocks, 67 of them employee-grain, and 51 of those already call addScopedEmployeeFilters.
 * Of the 16 that do not, 14 have no REPORT_CATALOG entry and so 404 before their SQL can
 * run. Two are reachable, and both are listed below with the reason.
 *
 * The rule mirrors the executor guard's: scope is enforced at the query, not in the UI, so
 * an unscoped employee-grain report is a data leak rather than an untidy omission.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * Reachable inline blocks that do not scope, each with the reason it is not a simple fix.
 * This list may only shrink, and an entry may only be removed by adding real scope — not by
 * deleting the block, which for most inline reports is the better implementation.
 */
const UNSCOPED_REACHABLE = new Map<string, string>([
  [
    "offer-to-joining-tracker",
    // Driven by ats_onboarding_bridge -> ats_candidate with employees LEFT JOINed, because a
    // candidate is not yet an employee. Only 2 of its 361 rows have an employee at all, so
    // employee-based scope would blank the report. The candidate-side key does not resolve
    // either: ats_candidate.applied_for_branch holds branch NAMES, not ids — over those 361
    // rows 347 match branch_master.branch_name and only 8 match an id (verified 2026-08-11).
    // Scoping therefore needs a name-mapped join plus a ruling on whether recruiters are
    // branch-limited for pre-joining candidates, which is a business decision.
    "candidate-grain; applied_for_branch holds names not ids, needs a name-mapped join and a scoping ruling",
  ],
]);

const inlineBlocks = (): Array<{ code: string; body: string }> => {
  const src = read("src/modules/reporting/report-suite.routes.ts");
  const marks = [...src.matchAll(/^\s{4}case "([a-z0-9-]+)"/gm)];
  return marks.map((m, i) => ({
    code: m[1],
    body: src.slice(m.index!, i + 1 < marks.length ? marks[i + 1].index! : src.length),
  }));
};

const cataloguedCodes = (): Set<string> => {
  const src = read("src/modules/reporting/report-catalog.ts");
  return new Set([...src.matchAll(/code:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]));
};

/** Reads the employees table (or an employee_* table) — i.e. returns employee-level rows. */
const EMPLOYEE_GRAIN = /\b(FROM|JOIN)\s+`?employees`?\b|\bFROM\s+`?employee_[a-z_]+`?/i;

/**
 * Any recognised row-scoping mechanism. addScopedEmployeeFilters is the inline one and
 * applies branch AND department AND process AND cost centre, including the
 * no-branch-scope sentinel that fails closed.
 */
const SCOPED =
  /addScopedEmployeeFilters|appendScopeConditions|scopeFilter|scope\.branchIds|scope\.processIds/;

describe("inline report blocks apply row scope", () => {
  const blocks = inlineBlocks();
  const catalogued = cataloguedCodes();

  it("finds the inline blocks at all — a silent 0 here would make this suite vacuous", () => {
    expect(blocks.length).toBeGreaterThan(50);
    expect(catalogued.size).toBeGreaterThan(50);
  });

  it("no reachable employee-grain inline block is unscoped except the documented two", () => {
    const offenders = blocks
      .filter((b) => EMPLOYEE_GRAIN.test(b.body))
      .filter((b) => !SCOPED.test(b.body))
      .filter((b) => catalogued.has(b.code))
      .map((b) => b.code)
      .filter((code) => !UNSCOPED_REACHABLE.has(code));

    expect(
      offenders,
      `These inline report blocks return employee-level rows, have a REPORT_CATALOG entry ` +
        `(so they are reachable), and apply no row scope. A branch-scoped user reading one ` +
        `receives the whole organisation. Call addScopedEmployeeFilters(req, clauses, params) ` +
        `before building the SQL, or add the code to UNSCOPED_REACHABLE with the reason it ` +
        `cannot be scoped.`,
    ).toEqual([]);
  });

  it("the exemption list stays honest — every entry is still reachable and still unscoped", () => {
    // An exemption that no longer describes reality is worse than none: it silently stops
    // guarding a live report. This is what let a stale entry hide a real gap before.
    for (const [code, reason] of UNSCOPED_REACHABLE) {
      const block = blocks.find((b) => b.code === code);
      expect(block, `${code} is exempted but has no inline block — remove the entry`).toBeDefined();
      expect(
        SCOPED.test(block!.body),
        `${code} now applies row scope — remove it from UNSCOPED_REACHABLE`,
      ).toBe(false);
      expect(reason.length, `${code} needs a real reason, not a placeholder`).toBeGreaterThan(30);
    }
  });

  it("an unreachable unscoped block must not gain a catalogue entry without scope", () => {
    // Adding a REPORT_CATALOG entry is how an unreachable block goes live. 14 currently sit
    // in that state; catalogueing one without scoping it first is the regression to catch.
    const unreachableUnscoped = blocks
      .filter((b) => EMPLOYEE_GRAIN.test(b.body))
      .filter((b) => !SCOPED.test(b.body))
      .filter((b) => !catalogued.has(b.code));

    for (const b of unreachableUnscoped) {
      expect(
        catalogued.has(b.code),
        `${b.code} is unscoped and must not be catalogued until it scopes`,
      ).toBe(false);
    }
  });
});
