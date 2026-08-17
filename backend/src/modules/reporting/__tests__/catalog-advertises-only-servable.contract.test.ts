import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REPORT_CATALOG } from "../report-catalog.js";

/**
 * GET /api/reports/suite/catalog must not advertise a report that 404s when clicked.
 *
 * The endpoint serves a hand-curated "featured reports" list. Access is decided elsewhere, by
 * reportCatalogAccessMiddleware against REPORT_CATALOG, which rejects an unknown code with a
 * 404 BEFORE the handler runs. Nothing kept the two in step.
 *
 * Measured 2026-08-17: three of the eighteen curated codes had no REPORT_CATALOG entry —
 * statutory-missing, cosec-unmapped, identity-mapping-exceptions — so the report list offered
 * three reports that could not be opened. A user clicking one gets a 404 and reasonably
 * concludes the reporting module is broken.
 *
 * This test reads the curated list out of the source rather than importing it, because it is a
 * module-private const. The point is the invariant, not the mechanism: whatever /catalog serves
 * must be openable.
 */
describe("report suite catalog", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/modules/reporting/report-suite.routes.ts"),
    "utf8",
  );

  /** Codes in the hand-curated CATALOG const. */
  const curatedCodes = [...source.matchAll(/\{ code: "([a-z0-9-]+)", module:/g)].map((m) => m[1]!);

  it("has a curated list to check", () => {
    expect(curatedCodes.length).toBeGreaterThan(0);
  });

  it("serves a filtered list rather than the raw curated one", () => {
    // The handler must not hand back CATALOG directly — that is what allowed the drift.
    expect(source).toMatch(/reportSuiteRouter\.get\("\/catalog"[\s\S]{0,200}SERVED_CATALOG/);
    expect(source).not.toMatch(/reportSuiteRouter\.get\("\/catalog"[\s\S]{0,120}data: CATALOG \}/);
  });

  it("filters on REPORT_CATALOG membership, which is what the access middleware checks", () => {
    expect(source).toMatch(/SERVED_CATALOG\s*=\s*CATALOG\.filter\([\s\S]{0,120}REPORT_CATALOG\.some/);
  });

  it("reports what it omitted instead of quietly serving a shorter list", () => {
    expect(source).toMatch(/UNSERVABLE/);
    expect(source).toMatch(/console\.warn/);
  });

  it("every curated code that IS in REPORT_CATALOG stays servable", () => {
    // Guards the other direction: the filter must not be so aggressive it empties the list.
    const servable = curatedCodes.filter((c) => REPORT_CATALOG.some((r) => r.code === c));
    expect(servable.length).toBeGreaterThan(0);
    expect(servable.length).toBeLessThanOrEqual(curatedCodes.length);
  });

  it("documents the three codes that were being advertised broken", () => {
    // If someone later adds these to REPORT_CATALOG they must also give them row scope; the
    // comment is the only place that warning lives next to the decision.
    expect(source).toMatch(/statutory-missing/);
    expect(source).toMatch(/row scope/i);
  });
});
