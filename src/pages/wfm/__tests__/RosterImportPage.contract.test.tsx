/**
 * Source-level contract for RosterImportPage.
 *
 * Both rules here were live production defects, and neither is visible from the page's own
 * behaviour in a unit test — the first only shows up against a real nginx, the second only
 * at publish time — so they are asserted against the source text.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  resolve(__dirname, "../RosterImportPage.tsx"),
  "utf8",
);

describe("RosterImportPage — API path prefix", () => {
  /**
   * hrmsApi builds `${base}${path}` and STRIPS a leading /api only when the base itself ends
   * in /api; it never adds one. apiBaseUrl() returns "" in production, so a call written as
   * "/processes" is fetched from "/processes" — which nginx answers with the SPA's index.html
   * at HTTP 200. react-query then parses HTML as the payload, the process list comes back
   * undefined, the dropdown renders empty, and the drop zone stays disabled because it is
   * gated on !processId. The page looks broken rather than erroring, which is why this went
   * unnoticed. Verified live: /processes -> 200 text/html, /api/processes -> 401 JSON.
   */
  it("prefixes every hrmsApi call with /api", () => {
    const calls = SOURCE.match(/hrmsApi\.\w+(?:<[^>]*>)?\(\s*[`"']([^`"']+)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);

    const unprefixed = calls.filter((call) => {
      const path = call.match(/[`"']([^`"']+)$/)?.[1] ?? "";
      return path.startsWith("/") && !path.startsWith("/api/");
    });

    expect(unprefixed, `these calls would hit the SPA fallback, not the API:\n${unprefixed.join("\n")}`)
      .toEqual([]);
  });
});

describe("RosterImportPage — cycle linkage", () => {
  /**
   * Roster Builder deep-links here with ?cycleId=…&processId=…. commitImportBatch accepts a
   * cycleId and stamps it on every assignment it creates; publish then selects
   * `WHERE cycle_id = ? AND final_roster_status = 'generated'`. A commit that sends no cycleId
   * produces rows with cycle_id NULL, which publish can never see — they sit as drafts forever
   * and no employee is ever asked to acknowledge them.
   */
  it("reads cycleId from the query string", () => {
    expect(SOURCE).toMatch(/URLSearchParams\(window\.location\.search\)/);
    expect(SOURCE).toMatch(/getcycleId|get\("cycleId"\)/i);
  });

  it("sends cycleId on commit", () => {
    expect(SOURCE).toMatch(/\{\s*overrideWarnings,\s*cycleId\s*\}/);
  });

  it("sends cycleId on upload when present", () => {
    expect(SOURCE).toMatch(/if\s*\(cycleId\)\s*fd\.append\("cycleId",\s*cycleId\)/);
  });
});
