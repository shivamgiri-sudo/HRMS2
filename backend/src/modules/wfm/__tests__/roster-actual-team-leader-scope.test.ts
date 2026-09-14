import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression test, 2026-08-13: same tl-vs-team_leader inconsistency class found
 * repeatedly across this codebase's manager/team-tier scope arrays.
 *
 * roster.actual.secure.routes.ts's ROSTER_SCOPE_ROLES (feeding actualRosterScope(),
 * used by both /actual-process and /actual-assignments) recognized "tl" but not
 * "team_leader" — two distinct, independently assignable roles. buildScopeWhereClause/
 * hasAnyRole (scopeAccess.js) do a literal string match with no ROLE_ALIASES expansion,
 * so a team_leader-only caller fell through to a narrower scope than every other
 * team-leadership-tier role in this array already gets.
 */
describe("roster.actual.secure.routes.ts ROSTER_SCOPE_ROLES includes team_leader", () => {
  it("lists team_leader alongside tl", () => {
    const source = readFileSync(resolve(__dirname, "../roster.actual.secure.routes.ts"), "utf-8");
    const match = source.match(/const ROSTER_SCOPE_ROLES = \[([^\]]*)\];/);
    expect(match, "ROSTER_SCOPE_ROLES declaration not found").not.toBeNull();
    const roles = match![1];
    expect(roles).toContain('"tl"');
    expect(roles).toContain('"team_leader"');
  });
});

/**
 * Regression test, 2026-08-13: wfm.routes.ts's GET /week-off-preference used
 * checkRole(userId, 'manager', 'tl', 'team_lead') — 'team_lead' (missing the trailing
 * 'er') matches no real role_key in workforce_role_catalog, so this branch could never
 * recognize a team_leader caller by any spelling. Corrected to the canonical
 * 'team_leader'.
 */
describe("wfm.routes.ts GET /week-off-preference recognizes team_leader (not the 'team_lead' typo)", () => {
  it("checkRole call uses the canonical spelling", () => {
    const source = readFileSync(resolve(__dirname, "../wfm.routes.ts"), "utf-8");
    expect(source).toContain("checkRole(req.authUser.id, 'manager', 'tl', 'team_leader')");
    expect(source).not.toContain("checkRole(req.authUser.id, 'manager', 'tl', 'team_lead')");
  });
});
