import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  resolve(process.cwd(), "src/modules/reporting/report-suite-highrisk.routes.ts"), "utf8");

/**
 * The four reports on this router were unpageable, and the failure was invisible.
 *
 * sendRows appended `LIMIT n` and nothing else — no OFFSET, so every page returned the same
 * rows — and returned no totalCount, so ReportLibraryView fell back to
 * `res.totalCount ?? res.meta?.totalCount ?? data.length` and computed one page.
 *
 * Measured on live 2026-08-08 at the UI's own limit=100: payroll-register displayed 100 rows
 * and "100 total" against 1,464 real lines, and employee-movement 100 against 2,196. A payroll
 * register that shows 7% of a run and labels it complete is the worst failure mode in this
 * suite, and no error appears anywhere.
 *
 * This router mounts ahead of report-suite.routes.ts, so it — not the inline case block and not
 * the executor — is what serves these codes. Fixing pagination in the sibling router would not
 * have touched them.
 */
describe("high-risk router pagination", () => {
  const sendRows = (() => {
    const start = src.indexOf("async function sendRows");
    expect(start, "sendRows not found").toBeGreaterThan(-1);
    const end = src.indexOf("reportSuiteHighRiskRouter.get", start);
    return src.slice(start, end === -1 ? src.length : end);
  })();

  it("applies OFFSET, not LIMIT alone", () => {
    // Without this, page 2 is page 1 and the rest of the report is unreachable.
    expect(sendRows).toMatch(/LIMIT\s*\$\{limit\}\s*OFFSET\s*\$\{offset\}/);
  });

  it("returns a totalCount the grid can page on", () => {
    // Must be top-level: the UI reads res.totalCount first and only then res.meta.totalCount.
    expect(sendRows).toMatch(/\btotalCount\b/);
    expect(sendRows).toMatch(/data:\s*rows,\s*\n?\s*totalCount/);
  });

  it("derives the total on a short page instead of counting again", () => {
    // Same rule as queryRowsWithCount in the sibling router: the COUNT is only worth paying
    // for when the page is full, because otherwise the total is already known.
    expect(sendRows).toMatch(/rows\.length\s*<\s*limit/);
    expect(sendRows).toMatch(/offset\s*\+\s*rows\.length/);
  });

  it("passes an offset at every call site", () => {
    // A helper that accepts an offset nobody supplies is the same bug with more steps.
    const calls = [...src.matchAll(/return sendRows\(([^;]*?)\);/gs)];
    expect(calls.length, "expected the four high-risk reports").toBeGreaterThanOrEqual(4);
    const missing = calls
      .filter(m => !/offsetParam\(req\.query\.offset\)/.test(m[1]))
      .map(m => (/"([a-z-]+)"/.exec(m[1]) ?? [])[1] ?? "?");
    expect(missing, `these call sendRows without an offset: ${missing.join(", ")}`).toEqual([]);
  });
});
