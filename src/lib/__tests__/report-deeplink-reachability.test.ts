import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REPORT_CATALOG } from "@/lib/report-catalog";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/**
 * The WFM → Break Reports menu item pointed at /break-reports, which redirects to
 * /reports?view=library&report=break-daily-summary — but break-daily-summary was
 * never added to this frontend catalog. The Report Library builds its list from
 * REPORT_CATALOG, so it could neither list the report nor honour the pre-selection,
 * and the menu item led to a library that did not contain the thing it named.
 *
 * The backend catalog had the entry all along. Nothing compares the two, and nothing
 * checked that a deep link resolves, so the gap was invisible from either side: the
 * backend looked complete, the menu looked wired, and only clicking it revealed
 * that the report was not there.
 *
 * This walks the actual redirect table rather than a hand-maintained list, so a new
 * module report route cannot be added without its catalog entry.
 */
const ROUTE_FILES = [
  "src/config/routes/platform.routes.tsx",
  "src/config/routes/workforce.routes.tsx",
];

/** Report codes that route redirects deep-link into the library. */
function deepLinkedReportCodes(): Array<{ code: string; path: string; file: string }> {
  const found: Array<{ code: string; path: string; file: string }> = [];
  for (const file of ROUTE_FILES) {
    const source = read(file);
    const pattern = /path="([^"]+)"[^>]*?to="\/reports\?view=library&report=([a-z0-9-]+)"/g;
    for (const match of source.matchAll(pattern)) {
      found.push({ path: match[1], code: match[2], file });
    }
  }
  return found;
}

describe("report deep links", () => {
  const links = deepLinkedReportCodes();

  it("finds the module report redirects it is meant to be checking", () => {
    // If the redirect syntax changes, this test would otherwise pass by matching
    // nothing at all — the exact failure mode it exists to prevent.
    expect(links.length).toBeGreaterThanOrEqual(3);
    expect(links.map(l => l.code)).toContain("break-daily-summary");
    expect(links.map(l => l.code)).toContain("break-session-log");
  });

  /**
   * Known-broken, deliberately not fixed here.
   *
   * Payroll → Cost Summary (/payroll/cost-summary) has a working backend executor
   * registered as "payroll-cost-summary", but the code is missing from the frontend
   * catalog AND from the backend one, so the menu item is a dead link for the
   * super_admin / payroll_head / finance roles that can see it — the same defect as
   * the break report, found by this test on the day it was written.
   *
   * Left recorded rather than corrected because payroll changes need explicit
   * sign-off, and writing a catalog entry means choosing the columns users will be
   * shown. Removing this entry is the fix; it must not be extended to excuse a new
   * break.
   */
  const KNOWN_UNREGISTERED = new Set(["payroll-cost-summary"]);

  it("only deep-links to reports the library can actually list", () => {
    const known = new Set(REPORT_CATALOG.map(r => r.code));
    const broken = links.filter(l => !known.has(l.code) && !KNOWN_UNREGISTERED.has(l.code));
    expect(
      broken,
      `these routes deep-link to report codes missing from REPORT_CATALOG: ${
        broken.map(b => `${b.path} → ${b.code}`).join(", ")
      }`,
    ).toEqual([]);
  });

  it("still reports every known-unregistered code as genuinely unregistered", () => {
    // If one of these is fixed, this fails and the exemption gets deleted, so the
    // allowlist cannot quietly outlive the bug it documents.
    const known = new Set(REPORT_CATALOG.map(r => r.code));
    for (const code of KNOWN_UNREGISTERED) {
      expect(
        known.has(code),
        `${code} is now in REPORT_CATALOG — remove it from KNOWN_UNREGISTERED`,
      ).toBe(false);
    }
  });

  it("gives every nav item that points at a report route a resolving destination", () => {
    // A menu entry whose href has no matching route renders as a dead link. Checked
    // here rather than in the router because navConfig is the surface users click.
    const nav = read("src/components/layout/navConfig.tsx");
    const routedPaths = new Set(links.map(l => l.path));

    const navHrefs = [...nav.matchAll(/href:\s*"(\/[a-z0-9/-]*report[a-z0-9/-]*)"/gi)]
      .map(m => m[1]);

    const moduleReportHrefs = navHrefs.filter(h => routedPaths.has(h));
    expect(moduleReportHrefs.length, "expected nav to link at least one module report").toBeGreaterThan(0);
  });

  it("keeps every catalog entry's declared columns non-empty and uniquely keyed", () => {
    // A report with duplicate column keys renders one column and drops the other;
    // an empty column list renders a grid with no headers and no visible rows.
    for (const report of REPORT_CATALOG) {
      const keys = report.columns.map(c => c.key);
      expect(keys.length, `${report.code} declares no columns`).toBeGreaterThan(0);
      expect(new Set(keys).size, `${report.code} has duplicate column keys`).toBe(keys.length);
    }
  });

  it("keeps report codes unique", () => {
    const codes = REPORT_CATALOG.map(r => r.code);
    const dupes = codes.filter((c, i) => codes.indexOf(c) !== i);
    expect(dupes, `duplicate report codes: ${dupes.join(", ")}`).toEqual([]);
  });
});
