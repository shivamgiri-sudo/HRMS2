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
 * request; it does not filter anything. A block that never calls addScopedEmployeeFilters
 * returns every branch's rows to whoever can reach the report.
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
  // None of these are listed in src/lib/report-catalog.ts, so none can be opened from the
  // report library — they are reachable only by hand-typed URL. That is the only reason they
  // are tolerated here rather than fixed; it is not an argument that they are safe.
  "cosec-unmapped", "payroll-audit-trail", "offer-to-joining-tracker",
  "onboarding-doc-checklist", "notice-period-adherence", "exit-interview-summary",
  "roster-change-audit", "asset-inventory-report", "asset-assignment-register",
  "payroll-readiness-status", "esic-challan-data", "cheque-name-mismatch-report",
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
    if (/addScopedEmployeeFilters\s*\(/.test(body)) continue;
    found.add(m[1]);
  }
  return found;
})();

describe("report row scope", () => {
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
