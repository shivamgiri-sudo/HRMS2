import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { KpiExplanationPanel, KpiInsightBoard } from "../KpiInsightBoard";
import type { KpiLike } from "../kpiInsights";

/**
 * Render checks for the KPI insight board.
 *
 * The suite runs under environment: "node" with no DOM (see vitest.config.ts), so these assert on
 * server-rendered markup rather than driving interactions. That is enough to catch what actually
 * breaks in practice: a component that throws on a shape the API really returns, and a message that
 * says the wrong thing about missing data.
 *
 * KpiInsightBoard takes its data as props with no data-fetching of its own, which is what makes it
 * testable this way — and is why the query hooks live in the page rather than in the component.
 */

function kpi(overrides: Partial<KpiLike> = {}): KpiLike {
  return {
    metric_id: "m1",
    metric_code: "AHT",
    metric_name: "Handle time",
    unit: "seconds",
    direction: "lower_is_better",
    target_value: 240,
    min_threshold: 360,
    actual_value: 250,
    score_pct: 96,
    trend_data: [
      { date: "2026-08-20", value: 300 },
      { date: "2026-08-21", value: 250 },
    ],
    ...overrides,
  };
}

describe("KpiInsightBoard", () => {
  it("renders the three panels", () => {
    const markup = renderToStaticMarkup(<KpiInsightBoard kpis={[kpi()]} />);
    expect(markup).toContain("Moved the right way");
    expect(markup).toContain("Moved the wrong way");
    expect(markup).toContain("Needs attention");
  });

  it("places an improving lower-is-better KPI under the positive panel", () => {
    const markup = renderToStaticMarkup(<KpiInsightBoard kpis={[kpi()]} />);
    const positiveIndex = markup.indexOf("Moved the right way");
    const negativeIndex = markup.indexOf("Moved the wrong way");
    const metricIndex = markup.indexOf("Handle time");
    // Appears after the positive heading and before the negative one, i.e. inside the positive panel.
    expect(metricIndex).toBeGreaterThan(positiveIndex);
    expect(metricIndex).toBeLessThan(negativeIndex);
  });

  it("shows the dates being compared, so a gap in the data is visible", () => {
    const markup = renderToStaticMarkup(<KpiInsightBoard kpis={[kpi()]} />);
    expect(markup).toContain("2026-08-20");
    expect(markup).toContain("2026-08-21");
  });

  it("survives an empty KPI list and says nothing is wrong", () => {
    const markup = renderToStaticMarkup(<KpiInsightBoard kpis={[]} />);
    expect(markup).toContain("Nothing improved");
    expect(markup).toContain("Nothing is past a limit");
  });

  it("survives a KPI with no trend data at all", () => {
    // The shape a newly configured KPI genuinely has before anything has been calculated.
    const markup = renderToStaticMarkup(
      <KpiInsightBoard kpis={[kpi({ actual_value: null, score_pct: 0, trend_data: [] })]} />,
    );
    expect(markup).toContain("No data has arrived");
  });

  it("survives a null min_threshold", () => {
    expect(() =>
      renderToStaticMarkup(<KpiInsightBoard kpis={[kpi({ min_threshold: null })]} />),
    ).not.toThrow();
  });

  it("survives values arriving as strings, as mysql2 returns DECIMAL columns", () => {
    const withStrings = {
      ...kpi(),
      trend_data: [
        { date: "2026-08-20", value: "300.0000" as unknown as number },
        { date: "2026-08-21", value: "250.0000" as unknown as number },
      ],
    };
    expect(() => renderToStaticMarkup(<KpiInsightBoard kpis={[withStrings]} />)).not.toThrow();
  });
});

describe("KpiExplanationPanel", () => {
  it("shows a loading state", () => {
    const markup = renderToStaticMarkup(<KpiExplanationPanel loading explanation={null} />);
    expect(markup).toContain("Looking up how this was calculated");
  });

  it("explains that a sync-fed KPI has no per-day working, rather than looking broken", () => {
    // Most KPIs in this system are fed by existing sync workers and have no Studio formula. If that
    // rendered as an error, every pre-existing metric would look broken.
    const markup = renderToStaticMarkup(<KpiExplanationPanel loading={false} explanation={null} />);
    expect(markup).toContain("existing sync");
  });

  it("prefers a server-supplied message when there is one", () => {
    const markup = renderToStaticMarkup(
      <KpiExplanationPanel loading={false} explanation={null} message="Nothing recorded for this KPI." />,
    );
    expect(markup).toContain("Nothing recorded for this KPI.");
  });

  it("renders the formula, the day rows and the values each day read", () => {
    const markup = renderToStaticMarkup(
      <KpiExplanationPanel
        loading={false}
        explanation={{
          metric_code: "AHT",
          metric_name: "Handle time",
          reason_summary: [{ reason: "Division by zero — the denominator has no value", days: 3 }],
          days: [
            {
              date: "2026-08-21",
              value: 250,
              status: "computed",
              reason: null,
              formula: "SAFE_DIV(talk_seconds, calls)",
              inputs: { talk_seconds: 1250, calls: 5 },
            },
            {
              date: "2026-08-20",
              value: null,
              status: "no_data",
              reason: "calls has no value for this period",
              formula: "SAFE_DIV(talk_seconds, calls)",
              inputs: { talk_seconds: 900, calls: null },
            },
          ],
        }}
      />,
    );

    expect(markup).toContain("SAFE_DIV(talk_seconds, calls)");
    expect(markup).toContain("2026-08-21");
    expect(markup).toContain("talk_seconds=1250");
    // A missing input renders as a dash, never as 0 — the distinction the whole feature rests on.
    expect(markup).toContain("calls=—");
    expect(markup).toContain("no value");
    // The summary count is what makes a pattern legible without counting rows.
    expect(markup).toContain("3d");
  });

  it("survives a day with no recorded inputs", () => {
    expect(() =>
      renderToStaticMarkup(
        <KpiExplanationPanel
          loading={false}
          explanation={{
            metric_code: "AHT",
            metric_name: "Handle time",
            reason_summary: [],
            days: [{ date: "2026-08-21", value: null, status: "error", reason: "Bad formula", formula: null, inputs: null }],
          }}
        />,
      ),
    ).not.toThrow();
  });
});
