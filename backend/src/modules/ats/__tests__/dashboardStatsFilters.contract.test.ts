import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * getDashboardStats rendered filtered and unfiltered figures side by side.
 *
 * Its main query honours the caller's branch / process / date. Four sub-queries did not: each
 * hardcoded its own WHERE and passed an empty params array, so a branch-filtered dashboard
 * showed a GLOBAL time-to-hire and a GLOBAL open-positions count next to branch-filtered stage
 * counts — on one screen, with nothing marking which was which.
 *
 * The date windows in those sub-queries are deliberate (30/60-day trends), so only the scope
 * filters carry across. That is why the fix is a scope-only fragment rather than reusing the
 * main `where`.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

function dashboardStatsBody(): string {
  const src = read("src/modules/ats/ats.service.ts");
  const start = src.indexOf("async getDashboardStats(");
  expect(start, "getDashboardStats not found").toBeGreaterThan(-1);
  // Ends at the next top-level method in the exported service object.
  const end = src.indexOf("\n  async ", start + 1);
  return src.slice(start, end === -1 ? src.length : end);
}

describe("getDashboardStats applies the caller's scope to its sub-queries", () => {
  const body = dashboardStatsBody();

  it("builds a scope-only fragment carrying branch and process", () => {
    expect(body).toMatch(/const scopeSql = /);
    expect(body).toContain("applied_for_branch = ?");
    expect(body).toContain("applied_for_process = ?");
  });

  it("the scope fragment deliberately excludes the date window", () => {
    // Reusing the main `where` here would clobber each trend's own 30/60-day range.
    const frag = /const scopeConds[\s\S]*?const scopeSql[^\n]*\n/.exec(body)?.[0] ?? "";
    expect(frag).toBeTruthy();
    expect(frag).not.toContain("walk_in_date");
    expect(frag).not.toContain("fromDate");
  });

  it("no sub-query still passes an empty params array while filtering ats_candidate", () => {
    // The tell for the old bug: a hardcoded WHERE over ats_candidate with `[]` for params.
    const offenders = body.match(/FROM ats_candidate[\s\S]{0,600}?`,\s*\[\]/g) ?? [];
    expect(
      offenders.length,
      "A sub-query reading ats_candidate with no params ignores the caller's branch/process, " +
        "which is how a global number ended up beside filtered ones.",
    ).toBe(0);
  });

  it("open positions and the selected trend both receive the scope", () => {
    const withScope = body.match(/\$\{scopeSql\}/g) ?? [];
    expect(withScope.length).toBeGreaterThanOrEqual(2);
    const withParams = body.match(/scopeParams/g) ?? [];
    // declaration + push x2 + at least two call sites
    expect(withParams.length).toBeGreaterThanOrEqual(5);
  });
});

describe("getDashboardStats never reports a failed query as a measured zero", () => {
  const body = dashboardStatsBody();

  it("no catch handler returns a confident 0", () => {
    // previous_submitted returned `cnt: 0` on failure while its two siblings returned null —
    // so a broken lookup rendered as "0 submitted in the prior 30 days", indistinguishable
    // from a genuine standstill.
    expect(body).not.toMatch(/return \[\[\{ cnt: 0 \}\]\]/);
  });

  it("every trend fallback yields null", () => {
    // Two shapes exist: `return [[{ cnt: null }]]` and the arrow shorthand
    // `.catch(() => [[{ cnt: null }]] as any)`. Match both.
    const fallbacks = body.match(/\[\[\{ cnt: [^}]*\}\]\]/g) ?? [];
    expect(fallbacks.length).toBeGreaterThanOrEqual(3);
    for (const f of fallbacks) {
      expect(f, `fallback must be null, got: ${f}`).toContain("null");
    }
  });
});
