import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * UnifiedPerformanceCommandCenter draws from seven feeds, four of which do not exist on the
 * backend: ATS submissions, roster, quality scores and operations performance.
 *
 * Each fetch is wrapped so one failure cannot empty the page, but the wrapper returned [] and
 * an empty array is indistinguishable from a genuine zero once it reaches the maths. The page
 * therefore reported a quality score of 0%, shrinkage of 0% and ops volume of 0 as measured
 * results; every alert is threshold-driven, so none fired; and the panel settled on a green
 * "Stable control — no major alert generated". A manager reading it was told operations were
 * healthy on the strength of data that never arrived.
 *
 * The endpoints are a separate question. What is asserted here is narrower and must hold
 * regardless: the page may not present a figure it did not receive.
 */
const ROOT = resolve(__dirname, "../..");
const page = readFileSync(join(ROOT, "src/pages/UnifiedPerformanceCommandCenter.tsx"), "utf8");

describe("UnifiedPerformanceCommandCenter — missing sources must not read as zero", () => {
  it("records which sources failed instead of discarding the error", () => {
    expect(page).toContain("failed.push(label)");
    expect(page).toContain("setUnavailable(failed)");
  });

  it("labels every fetch, so a failure can be named to the user", () => {
    for (const label of [
      "ATS candidates",
      "ATS submissions",
      "Learning progress",
      "Roster",
      "Live sessions",
      "Quality scores",
      "Operations performance",
    ]) {
      expect(page).toContain(`safe("${label}"`);
    }
  });

  it("never reports 'Stable control' when a source did not load", () => {
    // The specific defect: zeros cross no threshold, so silence was being read as health.
    // Scoped to the alerts block: the surrounding file mentions both phrases in comments,
    // and an index search across the whole source would compare against prose.
    const start = page.indexOf("const alerts = useMemo");
    const alerts = page.slice(start, page.indexOf("}, [metrics, unavailable]);", start));
    expect(alerts.length).toBeGreaterThan(0);

    const guard = alerts.indexOf("Assessment incomplete");
    const stable = alerts.indexOf("Stable control");
    expect(guard).toBeGreaterThan(-1);
    expect(stable).toBeGreaterThan(-1);
    // The incomplete-assessment branch must come first and return, so the all-clear is
    // unreachable while any source is missing.
    expect(guard).toBeLessThan(stable);
    expect(alerts).toContain("This is not an all-clear.");
    expect(alerts.slice(guard, stable)).toContain("return arr;");
  });

  it("shows a dash rather than a zero for figures whose source is missing", () => {
    expect(page).toContain('qualityUnavailable ? "—" : `${metrics.avgQuality}%`');
    expect(page).toContain('opsUnavailable ? "—" : metrics.opsVolume');
    expect(page).toContain('opsUnavailable ? "—" : `${metrics.shrinkagePct}%`');
  });

  it("distinguishes the two feeds, so one outage does not blank the other's tiles", () => {
    expect(page).toContain('const qualityUnavailable = unavailable.includes("Quality scores")');
    expect(page).toContain('const opsUnavailable = unavailable.includes("Operations performance")');
  });

  it("sends null, not zero, to the AI brief for figures that were never received", () => {
    // The one place a fabricated zero becomes confident prose: a model handed
    // shrinkage_pct: 0 will report that shrinkage is under control.
    expect(page).toContain("avg_quality_score: qualityUnavailable ? null : metrics.avgQuality");
    expect(page).toContain("shrinkage_pct: opsUnavailable ? null : metrics.shrinkagePct");
    expect(page).toContain("ops_achievement_pct: opsUnavailable ? null : metrics.opsAchievement");
    expect(page).toContain("critical_quality_errors: qualityUnavailable ? null : metrics.critical");
    expect(page).toContain("unavailable_sources: unavailable");
  });

  it("does not report a module as Active when its feed did not answer", () => {
    // The status column was hardcoded "Active" for every row, on the table headed
    // "data coverage" — the one place the gap should have been visible.
    expect(page).toContain(">Unavailable<");
    expect(page).not.toMatch(/\['Quality', scopedQuality\.length, `\$\{metrics\.avgQuality\}% avg score`\],/);
  });

  it("names the unavailable sources at the top of the page", () => {
    expect(page).toContain("Some data sources did not load");
    expect(page).toContain("unavailable.join(\", \")");
  });
});
