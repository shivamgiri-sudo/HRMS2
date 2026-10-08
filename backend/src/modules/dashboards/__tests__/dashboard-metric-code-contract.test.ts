import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { getAllMetricCodes, getMetricCatalogEntries } from "../dashboard-definition.service.js";

/**
 * The metric code a metric enriches under must equal the code the catalog publishes.
 *
 * Two codes existed for one metric: METRICS.dpdp declares "DPDP" (which is what
 * getAllMetricCodes, the API payload and the SQL manifest expose), while the metric's own
 * wrapEnriched call passed "DPDP_WITHDRAWAL". Targets and snapshots are keyed on the code
 * handed to enrichMetric, so a DPDP target could never match and a DPDP snapshot could
 * never be read back.
 *
 * That was invisible for as long as dashboard_metric_target and dashboard_metric_snapshot
 * were empty — the lookup returned nothing either way. Seeding the catalog turns it into a
 * permanent silent no-op for that metric, which is exactly the class of defect that does
 * not announce itself. Hence a static check rather than a runtime one.
 */

const here = dirname(fileURLToPath(import.meta.url));
const serviceSource = readFileSync(
  resolve(here, "../dashboard-metric.service.ts"),
  "utf8",
);

/** Every string literal handed to wrapEnriched as its metric code. */
function enrichmentCodes(): string[] {
  return [...serviceSource.matchAll(/wrapEnriched\(\s*(?:\/\/[^\n]*\n\s*)*"([A-Z_]+)"/g)]
    .map((match) => match[1]);
}

describe("metric code contract", () => {
  it("finds the enrichment call sites it is meant to police", () => {
    // Guards the regex itself: if wrapEnriched is renamed or reformatted, this test must
    // fail loudly rather than silently policing an empty list and passing forever.
    expect(enrichmentCodes().length).toBeGreaterThanOrEqual(19);
  });

  it("enriches only under codes the catalog publishes", () => {
    const published = new Set(getAllMetricCodes());
    const unknown = [...new Set(enrichmentCodes())].filter((code) => !published.has(code));

    expect(
      unknown,
      `These codes reach enrichMetric but are not in getAllMetricCodes(), so any target or ` +
        `snapshot stored against them can never be read back: ${unknown.join(", ")}`,
    ).toEqual([]);
  });

  it("keeps catalog codes unique", () => {
    // A duplicate code would make dashboard_metric_catalog.metric_code (UNIQUE) reject the
    // seed, and would make two metrics share one target.
    const codes = getAllMetricCodes();
    expect(new Set(codes).size, `duplicate metric codes: ${codes.join(", ")}`).toBe(codes.length);
  });

  it("declares the same direction of goodness the metric enriches with", () => {
    // higher_is_better decides whether a value above target reads as good or critical. The
    // catalog field and the wrapEnriched argument are two expressions of one fact; if they
    // drift, a rising backlog renders green. Parsed from source because the flag is an
    // inline argument, not something the module exports.
    const declared = new Map(
      getMetricCatalogEntries().map((entry) => [entry.metricCode, entry.higherIsBetter]),
    );

    const callSites = [
      ...serviceSource.matchAll(
        /wrapEnriched\(\s*(?:\/\/[^\n]*\n\s*)*"([A-Z_]+)"([\s\S]*?)\n\s*\);/g,
      ),
    ];
    expect(callSites.length, "no wrapEnriched call sites parsed").toBeGreaterThanOrEqual(19);

    const drifted: string[] = [];
    for (const [, code, body] of callSites) {
      const literal = body.match(/(?<![A-Za-z_])(true|false)(?![A-Za-z_])/);
      if (!literal) continue;
      const passed = literal[1] === "true";
      if (declared.has(code) && declared.get(code) !== passed) {
        drifted.push(`${code}: catalog=${declared.get(code)} enrich=${passed}`);
      }
    }
    expect(drifted, `higher_is_better drifted from the enrichment call: ${drifted.join("; ")}`)
      .toEqual([]);
  });

  it("uses codes that are safe as a stored key", () => {
    // metric_code is varchar(100) and joined on across three tables; whitespace or case
    // drift there is unrecoverable once rows exist.
    for (const code of getAllMetricCodes()) {
      expect(code, `${code} must be upper snake case`).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(code.length, `${code} exceeds metric_code varchar(100)`).toBeLessThanOrEqual(100);
    }
  });
});
