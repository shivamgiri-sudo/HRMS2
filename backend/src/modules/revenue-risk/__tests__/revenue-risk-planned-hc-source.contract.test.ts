/**
 * getAllPlannedHc() previously preferred `roster_assignment` unconditionally
 * whenever the table existed (`tableExists("roster_assignment")` only checks
 * the table is present, not that it has rows). That table held 0 live rows —
 * confirmed live 2026-08-19 — while the actual WFM/roster engine wrote to a
 * DIFFERENT table, `wfm_roster_assignment` (417k rows), which this function
 * never read. Planned headcount silently came back 0 for every process,
 * feeding directly into revenueRiskService.calculate()'s required/available
 * headcount and therefore its revenue-at-risk scoring.
 *
 * UPDATED 2026-08-28. The original fix ordered the two lookups so the
 * populated table won. There is now only one table to order: the owner
 * confirmed `wfm_roster_assignment` is the single roster source whether a
 * roster is uploaded or created in the UI, and roster-master.service.ts —
 * the ONLY writer of `roster_assignment` anywhere in the backend — was
 * repointed to it. Nothing writes `roster_assignment`, so the secondary
 * branch here could only ever read an empty table and fall through; it was
 * removed rather than repointed, because the primary already queries
 * wfm_roster_assignment and repointing would merely re-query it without the
 * publish_status filter, counting drafts as committed plan.
 *
 * These guards therefore change shape but not intent. The risk being held
 * off is unchanged and is the whole reason this file exists: planned
 * headcount must never quietly resolve to 0 because the function read
 * somewhere nothing writes. What used to be asserted as "try the populated
 * table first" is now asserted as "do not consult the dead table at all".
 *
 * Guard style follows lms-sync-wiring.contract.test.ts: source-text
 * inspection, not a runtime spy, because the goal is to catch an empty
 * source silently winning again, not to exercise the query itself.
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

/** The wfm_roster_assignment branch: from its tableExists guard to the employees fallback. */
function wfmBranch(): string {
  const body = fnBody("getAllPlannedHc");
  const start = body.indexOf('tableExists("wfm_roster_assignment")');
  const end = body.indexOf('tableExists("employees")');
  expect(start, "getAllPlannedHc no longer checks wfm_roster_assignment at all").toBeGreaterThan(-1);
  expect(end, "the employees-headcount fallback has gone missing").toBeGreaterThan(start);
  return body.slice(start, end);
}

describe("revenue-risk getAllPlannedHc reads the table that actually has data", () => {
  it("reads wfm_roster_assignment, the single roster source", () => {
    const body = fnBody("getAllPlannedHc");
    expect(body.indexOf('tableExists("wfm_roster_assignment")')).toBeGreaterThan(-1);
  });

  it("does not consult roster_assignment, which nothing writes", () => {
    const body = fnBody("getAllPlannedHc");
    // Deliberately matched with a boundary so it cannot be satisfied by the
    // "wfm_roster_assignment" substring, which of course contains it.
    expect(
      /(?<!wfm_)roster_assignment/.test(body.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")),
      "getAllPlannedHc queries roster_assignment again. It has no writer since " +
        "roster-master.service.ts was repointed on 2026-08-28, so any branch reading it can " +
        "only return an empty map — the exact failure that made planned headcount 0 for " +
        "every process and skewed revenue-at-risk scoring.",
    ).toBe(false);
  });

  it("falls through instead of returning an empty map from the wfm_roster_assignment branch", () => {
    expect(
      wfmBranch(),
      "must not return an empty map from the wfm_roster_assignment branch — an empty " +
        "result (e.g. no rows for the resolved date) needs to fall through to the next " +
        "source instead of silently returning 0 planned HC",
    ).toMatch(/if\s*\(\s*map\.size\s*>\s*0\s*\)\s*return\s+map;/);
  });

  it("joins wfm_roster_assignment through employees for process_id (the table itself has no process_id column)", () => {
    expect(fnBody("getAllPlannedHc")).toMatch(
      /FROM\s+wfm_roster_assignment\s+ra\s+JOIN\s+employees\s+e\s+ON\s+e\.id\s*=\s*ra\.employee_id/i,
    );
  });

  it("only counts published wfm_roster_assignment rows as committed plan, not drafts", () => {
    expect(wfmBranch()).toMatch(/publish_status\s*=\s*'published'/);
  });

  it("still keeps the employees-active-headcount fallback for when the roster has no data", () => {
    expect(fnBody("getAllPlannedHc")).toMatch(/tableExists\("employees"\)/);
  });
});
