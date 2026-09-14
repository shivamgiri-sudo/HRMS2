import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

/**
 * A tile's trend arrow must show movement, not distance from target.
 *
 * enrichMetric produces two different percentages:
 *   changePct    (current - previous) / |previous|   movement since the last snapshot
 *   variancePct  (current - target)   / |target|     shortfall against the target
 *
 * Layouts were passing variancePct into `trend`, whose arrow sits beside labels like
 * "vs previous period" and "in active pipeline". That showed nothing at all while
 * dashboard_metric_target was empty — variancePct is null without a target — so the bug was
 * invisible. Seeding targets makes it visible and wrong: a metric exactly on target but
 * down 40% on the month would render as a flat 0%, and one 12% under target with no
 * movement would render as a 12% fall.
 *
 * Static because it is a semantic mix-up between two same-shaped numbers; no runtime
 * assertion would catch it, and both render perfectly plausible output.
 */

const here = dirname(fileURLToPath(import.meta.url));
const referenceDir = resolve(here, "../reference");

function layoutSources(): Array<{ file: string; source: string }> {
  return readdirSync(referenceDir)
    .filter((name) => name.endsWith("ReferenceLayout.tsx"))
    .map((name) => ({ file: name, source: readFileSync(join(referenceDir, name), "utf8") }));
}

describe("metric trend semantics", () => {
  it("finds the layouts it is meant to police", () => {
    // Guards the glob: a rename must fail loudly rather than silently policing nothing.
    expect(layoutSources().length).toBeGreaterThanOrEqual(12);
  });

  it("never feeds variancePct into a trend arrow", () => {
    const offenders: string[] = [];

    for (const { file, source } of layoutSources()) {
      // `trend:` followed by variancePct before the next property boundary.
      for (const match of source.matchAll(/trend:\s*([^,\n]*variancePct[^,\n]*)/g)) {
        offenders.push(`${file}: trend: ${match[1].trim()}`);
      }
    }

    expect(
      offenders,
      "trend must be fed changePct (movement). variancePct is distance from target and " +
        `renders a target shortfall as if it were period movement:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("keeps the two percentages distinct in the shared contract", () => {
    // Both must survive to the client. If changePct were dropped from the contract again,
    // layouts would have nothing correct to bind a trend arrow to and would drift back.
    const contract = readFileSync(
      resolve(here, "../../../../backend/src/shared/dashboardMetricContract.ts"),
      "utf8",
    );
    expect(contract).toMatch(/changePct:\s*z\.number\(\)\.nullable\(\)/);
    expect(contract).toMatch(/variancePct:\s*z\.number\(\)\.nullable\(\)/);
  });
});
