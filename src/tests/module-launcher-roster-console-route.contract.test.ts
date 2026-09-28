/**
 * Direct regression test for the same gap module-launcher-attendance-exceptions-route.
 * contract.test.ts guards, one console further on: the merged /wfm/roster-command-center
 * console covers 8 page codes (one per tab), none of which get a PAGE_CODE_BY_ROUTE entry
 * (see pageRoutePageCodes.ts's comment on "/wfm/roster-command-center"), so ModuleLauncher's
 * reverse lookup needs its own explicit override for each — left unfixed,
 * resolveLaunchRoute() would silently fall through to "/dashboard" for every role holding
 * one of these grants.
 *
 * Imports the real resolveLaunchRoute() from ModuleLauncher.tsx, not a source-text regex,
 * so it proves the actual resolution logic.
 */
import { describe, expect, it } from "vitest";
import { resolveLaunchRoute } from "@/pages/ModuleLauncher";

const TAB_BY_PAGE_CODE: Record<string, string> = {
  WFM_ROSTER_LIVE_MONITORING: "live",
  WFM_ROSTER_TEAM_ROSTER: "team-roster",
  WFM_ROSTER_ANALYTICS: "analytics",
  WFM_ROSTER_TRENDS: "trends",
  WFM_ROSTER_COMPLIANCE: "compliance",
  WFM_ROSTER_SHIFT_EFFECTIVENESS: "shifts",
  WFM_ROSTER_INTERVENTIONS: "interventions",
  WFM_ROSTER_AUDIT_TRAIL: "audit",
};

describe("ModuleLauncher roster-command-center console resolution", () => {
  for (const [pageCode, tab] of Object.entries(TAB_BY_PAGE_CODE)) {
    it(`resolves ${pageCode} to the console's ${tab} tab, not /dashboard`, () => {
      // page_catalog's row for every one of these 8 codes stores plain
      // "/wfm/roster-command-center" (backend/sql/1757_roster_command_center_console_page_
      // codes.sql) with no ?tab= — the fix must not depend on the db path ever carrying one.
      const resolved = resolveLaunchRoute({
        page_code: pageCode,
        route_path: "/wfm/roster-command-center",
      });

      expect(resolved).toBe(`/wfm/roster-command-center?tab=${tab}`);
      expect(resolved).not.toBe("/dashboard");
    });
  }

  it("still resolves correctly even with a null/absent db path (fallback-catalog case)", () => {
    const resolved = resolveLaunchRoute({
      page_code: "WFM_ROSTER_COMPLIANCE",
      route_path: null,
      page_path: null,
    });

    expect(resolved).toBe("/wfm/roster-command-center?tab=compliance");
  });
});
