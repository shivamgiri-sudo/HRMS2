import { cloneElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Render checks for the cartesian and part-to-whole charts.
 *
 * The suite runs under environment: "node" with no DOM, so a real ResponsiveContainer measures nothing and
 * renders no chart at all. It is replaced here with one that hands its child a fixed size, so the recharts
 * drawing code (axes, bars, labels, custom cells) actually runs against each data shape.
 */
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return { ...actual, ResponsiveContainer: ({ children }: { children: ReactElement }) => cloneElement(children, { width: 640, height: 320 }) };
});

import { CARTESIAN_VIZ } from "../viz/CartesianViz";
import { PART_VIZ } from "../viz/PartViz";
import { THEMES } from "../palettes";
import type { VizDef } from "../viz/def";
import type { Cell, QueryResult, ResultColumn, Theme, VizStyle } from "../types";

const ALL: VizDef[] = [...CARTESIAN_VIZ, ...PART_VIZ];
const LIGHT = THEMES[0];
const DARK = THEMES.find((t) => t.dark)!;
const COLORS = ["#1E40AF", "#B45309", "#047857", "#7C3AED"];
const STAGES = ["Applied", "Screened", "Interviewed", "Offered", "Joined"];
const TEAMS = ["Voice", "Chat"];
const FORMATS = ["integer", "percent", "currency", "number", "duration", "integer"] as const;

function columns(nDims: number, nMeasures: number): ResultColumn[] {
  const d: ResultColumn[] = [
    { key: "stage", label: "Stage", kind: "dimension", format: "text", dataType: "string" },
    { key: "team", label: "Team", kind: "dimension", format: "text", dataType: "string" },
  ];
  const m: ResultColumn[] = Array.from({ length: nMeasures }, (_, i) => ({ key: `m${i}`, label: `Measure ${i + 1}`, kind: "measure", format: FORMATS[i % FORMATS.length], dataType: "number" }));
  return [...d.slice(0, nDims), ...m];
}

/** Rows shaped like a declining funnel so every chart, including waterfall and funnel, gets plausible numbers. */
function result(nDims: number, nMeasures: number, value: (stage: number, measure: number, team: number) => Cell): QueryResult {
  const rows: Array<Record<string, Cell>> = [];
  STAGES.forEach((stage, si) => {
    (nDims > 1 ? TEAMS : [null]).forEach((team, ti) => {
      const row: Record<string, Cell> = { stage };
      if (team) row.team = team;
      for (let m = 0; m < nMeasures; m++) row[`m${m}`] = value(si, m, ti);
      rows.push(row);
    });
  });
  return { columns: columns(nDims, nMeasures), rows, truncated: false, range: null, totals: {}, generatedAt: "2026-09-30T00:00:00Z" };
}
const realistic = (d: number, m: number) => result(d, m, (s, mi, t) => Math.round(1000 / (s + 1)) + mi * 37 + t * 11);
const withNulls = (d: number, m: number) => result(d, m, (s, mi) => (s % 2 === 0 ? null : 120 - s * 10 + mi));
const allNull = (d: number, m: number) => result(d, m, () => null);
const empty = (d: number, m: number): QueryResult => ({ ...realistic(d, m), rows: [] });
const oneRow = (d: number, m: number): QueryResult => { const r = realistic(d, m); return { ...r, rows: r.rows.slice(0, 1) }; };

function render(def: VizDef, r: QueryResult, theme: Theme = LIGHT, style: VizStyle = {}): string {
  const C = def.Component;
  return renderToStaticMarkup(<C result={r} style={{ ...def.defaults, ...style }} theme={theme} colors={COLORS} onSelect={() => undefined} />);
}
const BUSY: VizStyle = {
  dataLabels: true, legend: "right", xTitle: "Stage", yTitle: "Value", curve: "smooth", dots: true, topN: 3,
  thresholds: [{ value: 300, color: "#047857" }], compact: true, decimals: 1,
};

describe("viz definitions", () => {
  it("delivers every cartesian and part-to-whole type exactly once", () => {
    const types = ALL.map((d) => d.type);
    expect(new Set(types).size).toBe(types.length);
    expect(CARTESIAN_VIZ.map((d) => d.type)).toEqual([
      "column", "bar", "stacked_column", "stacked_bar", "stacked_100", "waterfall", "line", "step_line", "area", "stacked_area", "combo",
      "histogram", "scatter", "bubble",
    ]);
    expect(PART_VIZ.map((d) => d.type)).toEqual(["pie", "donut", "nested_donut", "treemap", "funnel", "radial_bar"]);
  });

  it.each(ALL.map((d) => [d.type, d] as const))("%s has a label, a description, an icon and sane needs", (_type, def) => {
    expect(def.label.trim()).not.toBe("");
    expect(def.description.trim()).not.toBe("");
    expect(def.icon).toBeTruthy();
    expect(def.needs.dims[0]).toBeLessThanOrEqual(def.needs.dims[1]);
    expect(def.needs.measures[0]).toBeLessThanOrEqual(def.needs.measures[1]);
    expect(def.defaultSize.w).toBeGreaterThan(0);
    expect(def.defaultSize.h).toBeGreaterThan(0);
    expect(new Set(def.styleOptions).size).toBe(def.styleOptions.length);
  });
});

describe.each(ALL.map((d) => [d.type, d] as const))("%s", (_type, def) => {
  const [dMin, dMax] = def.needs.dims;
  const [mMin, mMax] = def.needs.measures;

  it("renders realistic data on a light and a dark theme", () => {
    for (const theme of [LIGHT, DARK]) {
      const markup = render(def, realistic(dMin, mMax), theme);
      expect(markup).toContain('role="img"');
      expect(markup).toContain("aria-label=");
      expect(markup).toContain("Measure 1");
    }
    expect(() => render(def, realistic(dMax, mMin), DARK)).not.toThrow();
  });

  it("actually draws marks for realistic data", () => {
    const markup = render(def, realistic(dMin, mMax));
    if (def.type === "funnel") expect(markup).toContain("Applied");
    else expect(markup).toMatch(/<(path|rect|circle)\b/);
  });

  it("renders with every style option switched on", () => {
    for (const theme of [LIGHT, DARK]) {
      expect(() => render(def, realistic(dMin, mMax), theme, BUSY)).not.toThrow();
      expect(() => render(def, realistic(dMax, mMin), theme, { ...BUSY, legend: "top", curve: "step", grid: false })).not.toThrow();
    }
  });

  it("does not throw on an empty result", () => {
    expect(() => render(def, empty(dMin, mMax))).not.toThrow();
    expect(() => render(def, empty(dMax, mMin), DARK, BUSY)).not.toThrow();
    expect(() => render(def, { ...empty(dMin, mMin), columns: [] })).not.toThrow();
    expect(render(def, empty(dMin, mMax))).toContain('role="img"');
  });

  it("does not throw on null measure values", () => {
    expect(() => render(def, withNulls(dMin, mMax))).not.toThrow();
    expect(() => render(def, withNulls(dMax, mMin), DARK, BUSY)).not.toThrow();
    expect(() => render(def, allNull(dMin, mMax))).not.toThrow();
    expect(() => render(def, allNull(dMax, mMin), DARK, BUSY)).not.toThrow();
  });

  it("does not throw on a single row", () => {
    expect(() => render(def, oneRow(dMin, mMax))).not.toThrow();
    expect(() => render(def, oneRow(dMax, mMin), DARK, BUSY)).not.toThrow();
  });
});

describe("funnel", () => {
  const funnel = PART_VIZ.find((d) => d.type === "funnel")!;
  it("shows each stage, its value and the step-to-step conversion", () => {
    const markup = render(funnel, realistic(1, 1));
    for (const stage of STAGES) expect(markup).toContain(stage);
    expect(markup).toContain("1,000");
    // Screened 500 of Applied 1000.
    expect(markup).toContain("50.0%");
    expect(markup).toMatch(/\d+(\.\d+)?%/);
  });
  it("sizes each stage against the first one", () => {
    const markup = render(funnel, realistic(1, 1));
    expect(markup).toContain("width:100%");
    expect(markup).toContain("width:50%");
  });
});
