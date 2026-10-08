/**
 * WFM could WRITE branch readiness but not READ it.
 *
 * payroll-branch-readiness.routes.ts has always allowed "wfm" on
 * POST /:branchId/checklist and POST /:branchId/request-freeze — those are the
 * two actions a branch WFM owns — but the two GETs that render the very screen
 * those buttons live on (GET /:branchId and GET /:branchId/processes) omitted
 * "wfm" from their allowlists. Any branch readiness UI built for WFM therefore
 * 403'd on load and could never show them what they were meant to tick.
 *
 * This locks the read/write allowlists together: if someone can post a
 * checklist item for a branch, they can also fetch that branch's record.
 * requireScopedRole still pins every one of these to the caller's own
 * assignment scope, so this widens the role list, never the row visibility —
 * payroll-readiness-idor.behaviour.test.ts covers that side.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "payroll-branch-readiness.routes.ts"), "utf8");

/** Grab the requireRole(...) allowlist attached to a given route path. */
function rolesForRoute(routePath: string): string[] {
  const escaped = routePath.replace(/[/:]/g, (c) => `\\${c}`);
  const re = new RegExp(`"${escaped}",\\s*requireAuth,\\s*requireRole\\(([^)]*)\\)`);
  const match = source.match(re);
  expect(match, `could not find the route registration for ${routePath}`).not.toBeNull();
  return match![1]
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

describe("branch readiness — WFM read access matches its write access", () => {
  const writeRoutes = ["/:branchId/checklist", "/:branchId/request-freeze"];
  const readRoutes = ["/:branchId", "/:branchId/processes"];

  it.each(writeRoutes)("wfm can write via %s (the pre-existing grant)", (route) => {
    expect(rolesForRoute(route)).toContain("wfm");
  });

  it.each(readRoutes)("wfm can read via %s", (route) => {
    expect(rolesForRoute(route)).toContain("wfm");
  });

  it("the read routes still scope-check wfm rather than letting it read any branch", () => {
    const re = /"\/:branchId(?:\/processes)?",\s*requireAuth,\s*requireRole\([^)]*\),\s*requireScopedRole\(\s*\[([^\]]*)\]/g;
    const scopedLists = [...source.matchAll(re)].map((m) => m[1]);
    expect(scopedLists.length, "expected both branch readiness GETs to use requireScopedRole").toBe(2);
    for (const list of scopedLists) {
      expect(list).toContain("wfm");
    }
  });

  it("sign-off stays branch_head only — WFM is the maker, not the checker", () => {
    expect(rolesForRoute("/:branchId/signoff")).toEqual(["branch_head"]);
  });
});
