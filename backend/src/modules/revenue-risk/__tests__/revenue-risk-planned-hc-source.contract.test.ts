/**
 * getAllPlannedHc() previously preferred `roster_assignment` unconditionally
 * whenever the table existed (`tableExists("roster_assignment")` only checks
 * the table is present, not that it has rows). That table is a real,
 * reachable feature (own route + NativeRosterMasterBuilder.tsx) but holds 0
 * live rows — confirmed live 2026-08-19. The actual WFM/roster engine
 * (wfm.roster.service.ts / auto-roster-synced.service.ts) writes to a
 * DIFFERENT table, `wfm_roster_assignment` (413k+ rows), which this function
 * never read. Planned headcount silently came back 0 for every process,
 * feeding directly into revenueRiskService.calculate()'s required/available
 * headcount and therefore its revenue-at-risk scoring.
 *
 * Guard style follows lms-sync-wiring.contract.test.ts: source-text
 * inspection of the query order, not a runtime spy, because the goal is to
 * catch the empty table silently winning again, not to exercise the query
 * itself (that's covered by the live before/after check run manually
 * against mas_hrms — see the accompanying fix report).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/modules/revenue-risk/revenue-risk.service.ts"),
  "utf8",
);

function fnBody(name: string): string {
  const match = source.match(new RegExp(`async function ${name}\\([\\s\\S]*?\\n\\}`));
  expect(match, `${name} function body not found`).toBeTruthy();
  return match![0];
}

describe("revenue-risk getAllPlannedHc reads the table that actually has data", () => {
  it("checks wfm_roster_assignment (the live WFM engine's table) before roster_assignment", () => {
    const body = fnBody("getAllPlannedHc");
    const wfmIdx = body.indexOf('tableExists("wfm_roster_assignment")');
    const legacyIdx = body.indexOf('tableExists("roster_assignment")');
    expect(wfmIdx, "getAllPlannedHc no longer checks wfm_roster_assignment at all").toBeGreaterThan(-1);
    expect(legacyIdx, "getAllPlannedHc no longer checks roster_assignment at all").toBeGreaterThan(-1);
    expect(
      wfmIdx,
      "wfm_roster_assignment (413k+ live rows) must be tried BEFORE roster_assignment " +
        "(0 live rows) — otherwise an empty-but-existing table silently wins again and " +
        "planned headcount goes back to 0 for every process",
    ).toBeLessThan(legacyIdx);
  });

  it("only counts wfm_roster_assignment rows once tableExists AND a row was actually found (map.size > 0) before falling through", () => {
    const body = fnBody("getAllPlannedHc");
    const wfmBranch = body.slice(
      body.indexOf('tableExists("wfm_roster_assignment")'),
      body.indexOf('tableExists("roster_assignment")'),
    );
    expect(
      wfmBranch,
      "must not return an empty map from the wfm_roster_assignment branch — an empty " +
        "result (e.g. no rows for the resolved date) needs to fall through to the next " +
        "source instead of silently returning 0 planned HC",
    ).toMatch(/if\s*\(\s*map\.size\s*>\s*0\s*\)\s*return\s+map;/);
  });

  it("joins wfm_roster_assignment through employees for process_id (the table itself has no process_id column)", () => {
    const body = fnBody("getAllPlannedHc");
    expect(body).toMatch(/FROM\s+wfm_roster_assignment\s+ra\s+JOIN\s+employees\s+e\s+ON\s+e\.id\s*=\s*ra\.employee_id/i);
  });

  it("only counts published wfm_roster_assignment rows as committed plan, not drafts", () => {
    const body = fnBody("getAllPlannedHc");
    const wfmBranch = body.slice(
      body.indexOf('tableExists("wfm_roster_assignment")'),
      body.indexOf('tableExists("roster_assignment")'),
    );
    expect(wfmBranch).toMatch(/publish_status\s*=\s*'published'/);
  });

  it("still keeps the employees-active-headcount fallback for when neither roster table has data", () => {
    const body = fnBody("getAllPlannedHc");
    expect(body).toMatch(/tableExists\("employees"\)/);
  });
});
