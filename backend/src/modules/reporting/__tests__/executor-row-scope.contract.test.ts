/**
 * Every employee-level report must apply the FULL row scope, not just branch.
 *
 * The charter is explicit — "Sensitive operations must enforce role and row scope
 * at API/query level" and payroll data must not reach management surfaces
 * unscoped. 99 of the 109 exported report functions do this by calling
 * appendScopeConditions, which applies branch AND process AND department AND
 * cost centre, and handles the no-access and sentinel cases.
 *
 * Two hand-rolled a branch-only version and silently dropped the other three
 * dimensions:
 *
 *   incrementPromotionHistory — exposes current_ctc / proposed_ctc over 14,467
 *                               salary_increment_request rows
 *   lifecycleEvents           — per-employee lifecycle history
 *
 * That is reachable, not theoretical. reporting.scope.ts resolves processScope to
 * `restricted` for any user whose employee row carries a process_id — 983 active
 * employees — and 26 users hold an explicit scope_type='process' assignment.
 * NOIDA runs 20 processes across 351 employees, NOIDA-2 eight across 305, so a
 * process-restricted viewer was seeing the whole branch.
 *
 * Deliberately NOT flagged by this test:
 *   - master-data reports (holiday list, cost-centre master, process master)
 *     return no employee rows, so row scope does not apply;
 *   - assetMovementLog LEFT JOINs employees because an asset can move with no
 *     holder, and its branch clause is intentionally `a.branch_id OR
 *     e.branch_id`. Forcing e.process_id there would hide unassigned-asset
 *     movements — a correctness regression dressed as a security fix.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(__dirname, "../executors");

/** Reports that legitimately return no employee-level rows, or scope specially. */
const EXEMPT = new Set([
  "holidayMasterList",
  "costCentreMasterReport",
  "processMasterReport",
  "costCentreVsBillingReconciliation",
  "recruiterProductivity",
  "assetMovementLog",
]);

interface Fn { file: string; name: string; body: string }

function exportedFunctions(): Fn[] {
  const out: Fn[] = [];
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".executor.ts"))) {
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    const marks = [...src.matchAll(/^export (?:async )?function (\w+)/gm)];
    marks.forEach((m, i) => {
      const start = m.index!;
      const end = i + 1 < marks.length ? marks[i + 1].index! : src.length;
      out.push({ file, name: m[1], body: src.slice(start, end) });
    });
  }
  return out;
}

const fns = exportedFunctions();

describe("report executor row scope", () => {
  it("finds the executor functions at all", () => {
    expect(fns.length).toBeGreaterThan(100);
  });

  it("every employee-level report applies BOTH branch and process scope", () => {
    // The invariant, not the implementation. A few reports scope inline rather
    // than via the helper because they join employees under a different alias
    // (shiftSwapRegister uses e_req) — that is correct code and this must not
    // flag it. What matters is that both restricting dimensions are applied:
    // branch alone is what leaked salary data across 20 processes in NOIDA.
    //
    // Department and cost centre are not required here because no
    // user_assignment_scope row of those types exists in this deployment
    // (all=36, branch=34, process=26, self=1), so those dimensions resolve to
    // `all` for everyone. The canonical helper applies them anyway, which is why
    // it remains the preferred route.
    const offenders = fns
      .filter(f => !EXEMPT.has(f.name))
      .filter(f => /FROM\s+employees|JOIN\s+employees|FROM\s+salary_prep|FROM\s+attendance_|FROM\s+leave_/i.test(f.body))
      .filter(f => {
        const canonical = f.body.includes("appendScopeConditions");
        const inlineBoth = /scope\.branchScope\./.test(f.body) && /scope\.processScope\./.test(f.body);
        return !canonical && !inlineBoth;
      })
      .map(f => `${f.file}:${f.name}`);

    expect(
      offenders,
      "these query employee data with at most a branch restriction, so a " +
        "process-restricted viewer sees every process in their branch",
    ).toEqual([]);
  });

  it("a report that scopes inline must still deny the no-access case", () => {
    // appendScopeConditions throws ReportScopeAccessDeniedError on mode 'none'.
    // An inline implementation that only handles 'restricted' silently returns
    // everything instead — the fail-open shape.
    const offenders = fns
      .filter(f => !EXEMPT.has(f.name))
      .filter(f => !f.body.includes("appendScopeConditions"))
      .filter(f => /scope\.branchScope\./.test(f.body))
      .filter(f => !f.body.includes("ReportScopeAccessDeniedError"))
      .map(f => `${f.file}:${f.name}`);

    expect(offenders, "inline scope that ignores mode 'none' fails open").toEqual([]);
  });

  it("the two repaired reports now take the full scope", () => {
    for (const name of ["incrementPromotionHistory", "lifecycleEvents"]) {
      const fn = fns.find(f => f.name === name);
      expect(fn, `${name} missing`).toBeTruthy();
      expect(fn!.body).toContain('appendScopeConditions(scope, clauses, params, "e")');
      expect(fn!.body, "the hand-rolled branch clause is back").not.toMatch(/scope\.branchScope\.ids\.map/);
    }
  });
});
