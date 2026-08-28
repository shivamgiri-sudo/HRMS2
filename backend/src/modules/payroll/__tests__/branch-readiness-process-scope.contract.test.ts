/**
 * A branch-level checklist tick confirmed every process under that branch.
 *
 * payroll_branch_readiness holds two kinds of row for the same (process_month, branch_id):
 * the branch aggregate, which ensureRecord() writes with process_id = '', and one row per
 * process. POST /:branchId/checklist is the BRANCH-level route, so it must write only the
 * aggregate — but its UPDATE filtered on (process_month, branch_id) alone, so it matched
 * every process-scoped row as well.
 *
 * The effect was silent cross-confirmation: a branch head ticking one item marked it
 * confirmed on behalf of every process manager under that branch. Each of the five
 * checklist items is worth 5-15 of the 100 readiness points and 'ready' is score >= 80,
 * so this pushed processes toward ready that nobody had signed off.
 *
 * Verified live 2026-08-28 against mas_hrms: for NOIDA-2 / 2026-08 the unfiltered
 * predicate matches 7 rows where it should match 1 — the aggregate plus 6 process rows,
 * the largest covering 219 employees. Across the table, 4 (month, branch) groups are
 * affected, 41 rows in total. The sibling POST /:branchId/:processId/checklist already
 * filtered correctly; only the branch-level path was wrong.
 *
 * refreshProjection() had the same defect in its fallback UPDATE — the degraded path taken
 * when the newer projection columns are absent. It wrote one process's projected gross/net
 * and headcount onto every sibling row, and projections are what the HO summary renders.
 *
 * This guard is deliberately an invariant over the whole module rather than an assertion
 * about the two lines that were fixed: any future UPDATE against this table that forgets
 * process_id reintroduces the same class of bug.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(join(here, "..", f), "utf8");

const SOURCES = {
  "payroll-branch-readiness.routes.ts": read("payroll-branch-readiness.routes.ts"),
  "payroll-branch-readiness.service.ts": read("payroll-branch-readiness.service.ts"),
};

/**
 * Every `UPDATE payroll_branch_readiness ... WHERE ...` statement in a source file,
 * returned as the text of its WHERE clause up to the closing backtick.
 */
function updateWhereClauses(source: string): string[] {
  const out: string[] = [];
  const re = /UPDATE\s+payroll_branch_readiness\b([\s\S]*?)`/g;
  for (const m of source.matchAll(re)) {
    const body = m[1];
    const where = body.match(/WHERE([\s\S]*)$/i);
    if (where) out.push(where[1].replace(/\s+/g, " ").trim());
  }
  return out;
}

describe("branch readiness — every UPDATE is scoped to a single process row", () => {
  it.each(Object.keys(SOURCES))("%s has at least one readiness UPDATE to check", (file) => {
    expect(updateWhereClauses(SOURCES[file as keyof typeof SOURCES]).length).toBeGreaterThan(0);
  });

  it.each(Object.keys(SOURCES))(
    "%s: no UPDATE filters on (process_month, branch_id) without process_id",
    (file) => {
      const offenders = updateWhereClauses(SOURCES[file as keyof typeof SOURCES]).filter(
        (w) => !/process_id\s*=/.test(w),
      );
      expect(
        offenders,
        `these UPDATE statements would write every process row for the branch:\n  ${offenders.join("\n  ")}`,
      ).toEqual([]);
    },
  );

  it("the branch-level checklist route targets the aggregate row explicitly", () => {
    const src = SOURCES["payroll-branch-readiness.routes.ts"];
    // The branch-level handler passes "" as the process_id parameter — the aggregate row.
    const stmt = src.match(
      /UPDATE payroll_branch_readiness[\s\S]*?WHERE process_month = \? AND branch_id = \? AND process_id = \?`,\s*\[value, month, branchId, ""\]/,
    );
    expect(
      stmt,
      "branch-level checklist UPDATE must bind process_id to '' (the branch aggregate)",
    ).not.toBeNull();
  });

  it("the process-scoped checklist route still binds the real processId", () => {
    const src = SOURCES["payroll-branch-readiness.routes.ts"];
    const stmt = src.match(
      /WHERE process_month = \? AND branch_id = \? AND process_id = \?`,\s*\[value, month, branchId, processId\]/,
    );
    expect(stmt, "process-scoped checklist UPDATE must bind the route's processId").not.toBeNull();
  });
});
