import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const routes = read("src/modules/reporting/report-suite.routes.ts");
const frontendCatalog = read("../src/lib/report-catalog.ts");

/**
 * Row scope is enforced in the query and nowhere else.
 *
 * reportScopeMiddleware resolves which branches the caller may see and hangs it off the
 * request; it does not filter anything. A block that never calls addScopedEmployeeFilters (or,
 * for a table that has branch_id but is not employee-shaped, addScopedBranchOnlyFilters —
 * added 2026-08-18 for asset_master) returns every branch's rows to whoever can reach the
 * report.
 *
 * This is invisible in review and in testing, because for an all-scope user the helper adds
 * no predicate at all — a scoped and an unscoped block produce byte-identical output for
 * super_admin. It only diverges for the branch users who are the reason scope exists.
 *
 * So this is a ratchet, not a pass/fail on the current state: the set of unscoped blocks may
 * only shrink, and nothing reachable from the report library may be in it.
 */

/** Blocks that read employee data without a scope predicate, and are not yet fixed. */
const UNSCOPED_BACKLOG = new Set<string>([
  // Reachability, measured 2026-08-10 — and the distinction that matters is which catalogue.
  // The route gate is the BACKEND catalogue: report-suite.routes.ts looks the code up in
  // REPORT_CATALOG and answers 404 REPORT_NOT_FOUND when it is absent. Fourteen of the entries
  // below are absent from it, so they are genuinely unreachable dead code — not merely unlisted.
  //
  // One is present in the backend catalogue and therefore IS reachable by URL, with a reason
  // recorded at its catalogue entry rather than here:
  //   - offer-to-joining-tracker declares branchScoped: false and cannot be scoped at all; its
  //     grain is a pre-joining candidate, ats_onboarding_bridge has no branch column, and only
  //     2 of 351 rows link to an employee. The employees LEFT JOIN that trips this scan supplies
  //     nothing but the actual date of joining.
  //
  // payroll-readiness-status was removed from this list on 2026-08-10: it declared
  // branchScoped: true while applying no predicate, which is the one shape that is genuinely a
  // broken promise, and it now scopes through its lines' employees.
  //
  // asset-inventory-report was removed 2026-08-18: asset_master has its own branch_id (the scan
  // flags this block only because of its LEFT JOIN employees for assignment lookup), and now
  // calls addScopedBranchOnlyFilters. See reporting-access.ts for why that's a distinct helper
  // from addScopedEmployeeFilters rather than reusing it.
  "cosec-unmapped", "payroll-audit-trail", "offer-to-joining-tracker",
  "onboarding-doc-checklist", "notice-period-adherence", "exit-interview-summary",
  "roster-change-audit", "asset-assignment-register",
  "esic-challan-data", "cheque-name-mismatch-report",
  "rehire-eligibility-register", "feedback-360-summary", "goal-completion-summary",
  "training-needs-summary", "it-ad-account-audit",
]);

/** Every `case "<code>"` block that builds SQL over employee data with no scope call. */
const unscoped = (() => {
  const found = new Set<string>();
  for (const part of routes.split(/(?=\n {4}case ")/)) {
    const m = /^\n {4}case "([a-z0-9-]+)"/.exec(part);
    if (!m) continue;
    // Comments are stripped: several blocks explain at length that scope was once absent,
    // and that prose must not read as either the call or its absence.
    const body = part.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    if (!/sql\s*=\s*`/.test(body)) continue;
    if (!/\bemployees\s+e\b|\bFROM employees\b|JOIN employees\b/i.test(body)) continue;
    if (/addScopedEmployeeFilters\s*\(|addScopedBranchOnlyFilters\s*\(/.test(body)) continue;
    found.add(m[1]);
  }
  return found;
})();

/**
 * What the scan CAN see, used only to prove it is not blind.
 *
 * Every assertion below is of the form "this set is empty", and an empty set is also what a
 * scan that matched nothing produces. The block splitter keys on `\n    case "` — exactly four
 * spaces — so reindenting the switch, wrapping it in a helper, or moving these blocks to
 * another file would make `unscoped` empty and turn all three tests green while enforcing
 * nothing at all. This counts the blocks the scan positively identified, so that failure mode
 * announces itself instead of reading as success.
 */
const scanned = (() => {
  let cases = 0;
  let scoped = 0;
  for (const part of routes.split(/(?=\n {4}case ")/)) {
    if (!/^\n {4}case "([a-z0-9-]+)"/.test(part)) continue;
    cases++;
    if (/addScopedEmployeeFilters\s*\(/.test(part)) scoped++;
  }
  return { cases, scoped };
})();

describe("report row scope", () => {
  it("the scan can still see the switch — otherwise every assertion below passes vacuously", () => {
    // Floors, not counts. Measured on this file at the time of writing: 98 case blocks, 53 of
    // them scoped. The thresholds sit far below that so ordinary churn never trips them — they
    // only fire when the scan has stopped seeing the switch at all.
    expect(
      scanned.cases,
      "no `case` blocks matched in report-suite.routes.ts. The splitter expects exactly four " +
        "spaces of indentation; if the switch was reindented, wrapped, or moved to another " +
        "file, this suite now enforces nothing. Fix the parser before trusting a green run.",
    ).toBeGreaterThan(50);
    expect(
      scanned.scoped,
      "almost no block appears to call addScopedEmployeeFilters. Either the helper was renamed " +
        "or the scan is reading the wrong file — in both cases the assertions below are hollow.",
    ).toBeGreaterThan(20);
  });

  it("no report reachable from the report library is unscoped", () => {
    // Reachable means listed in the frontend catalogue — that is what puts a tile on the
    // page. ff-settlement-register was the last one: it read full_final_calculation (notice
    // recovery, gratuity, salary hold, net payable) and built its WHERE inline, so it carried
    // no branch predicate at all.
    const reachable = [...unscoped].filter(code => frontendCatalog.includes(`code: "${code}"`)).sort();
    expect(
      reachable,
      "these are listed in src/lib/report-catalog.ts and read employee data with no branch " +
        "predicate — every branch's rows go to anyone who can open the tile:\n" +
        reachable.join("\n"),
    ).toEqual([]);
  });

  it("no new unscoped block is introduced", () => {
    const added = [...unscoped].filter(code => !UNSCOPED_BACKLOG.has(code)).sort();
    expect(
      added,
      "new report blocks read employee data without calling addScopedEmployeeFilters. " +
        "Call it FIRST in the block, so its clauses and parameters lead the bind list:\n" +
        added.join("\n"),
    ).toEqual([]);
  });

  it("the backlog only shrinks", () => {
    const fixed = [...UNSCOPED_BACKLOG].filter(code => !unscoped.has(code)).sort();
    expect(
      fixed,
      `these now apply row scope — remove them from UNSCOPED_BACKLOG:\n${fixed.join("\n")}`,
    ).toEqual([]);
  });
});
