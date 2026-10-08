import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { THEMES, seriesColors } from "../palettes";
import type { Cell, QueryResult, ResultColumn, Theme, VizStyle } from "../types";
import type { VizDef } from "../viz/def";
import { CONTENT_VIZ } from "../viz/ContentViz";
import { DIAGRAM_VIZ, flowElements } from "../viz/DiagramViz";
import { MATRIX_VIZ } from "../viz/MatrixViz";
import { TABLE_VIZ } from "../viz/TableViz";
import { TILE_VIZ } from "../viz/TileViz";

/**
 * Render checks for the tile, matrix, diagram, table and content visualisations.
 *
 * The suite runs under environment "node" with no DOM, so these assert on server-rendered markup. The `flow` type is
 * NOT rendered here: @xyflow/react needs a DOM to measure its pane. Its data preparation lives in the pure
 * `flowElements` function, which is what is tested instead. recharts charts (radar, sankey) only emit their responsive
 * wrapper without a DOM, so for those this proves "does not throw", not what is drawn.
 */
const ALL: VizDef[] = [...TILE_VIZ, ...MATRIX_VIZ, ...DIAGRAM_VIZ, ...TABLE_VIZ, ...CONTENT_VIZ];
const LIGHT = THEMES[0];
const DARK = THEMES.find((t) => t.dark)!;
const byType = (type: string) => ALL.find((d) => d.type === type)!;

const dim = (key: string, label: string, extra: Partial<ResultColumn> = {}): ResultColumn => ({ key, label, kind: "dimension", format: "text", dataType: "string", ...extra });
const mea = (key: string, label: string, extra: Partial<ResultColumn> = {}): ResultColumn => ({ key, label, kind: "measure", format: "integer", dataType: "number", ...extra });
function res(columns: ResultColumn[], rows: Array<Record<string, Cell>>, extra: Partial<QueryResult> = {}): QueryResult {
  const totals: Record<string, number | null> = {};
  for (const c of columns) if (c.kind === "measure") totals[c.key] = rows.some((r) => typeof r[c.key] === "number") ? rows.reduce((a, r) => a + (typeof r[c.key] === "number" ? (r[c.key] as number) : 0), 0) : null;
  return { columns, rows, truncated: false, range: { from: "2026-09-01", to: "2026-09-30" }, totals, generatedAt: "2026-09-30T10:00:00Z", ...extra };
}

const BRANCHES = ["Pune", "Mumbai", "Delhi"], STATUSES = ["Open", "Closed"];
/** A realistic result with the most dimensions / measures (capped at 2 each) the definition accepts. */
function sample(def: VizDef, mode: "full" | "empty" | "nulls" = "full"): QueryResult {
  const nd = Math.min(def.needs.dims[1], 2), nm = Math.min(def.needs.measures[1], 2);
  const date = def.type === "calendar_heatmap";
  const columns: ResultColumn[] = [
    ...(nd >= 1 ? [date ? dim("d0", "Day", { format: "date", dataType: "date", grain: "day" }) : dim("d0", "Branch")] : []),
    ...(nd >= 2 ? [dim("d1", "Status")] : []),
    ...(nm >= 1 ? [mea("m0", "Tickets")] : []),
    ...(nm >= 2 ? [mea("m1", "Revenue", { format: "currency" })] : []),
  ];
  const rows: Array<Record<string, Cell>> = [];
  const firsts = nd === 0 ? [null] : date ? ["2026-08-28", "2026-08-31", "2026-09-01", "2026-09-14"] : BRANCHES;
  firsts.forEach((a, i) => (nd >= 2 ? STATUSES : [null]).forEach((b, j) => {
    const n = mode === "nulls" ? null : (i + 1) * 100 + j * 35;
    rows.push({ ...(nd >= 1 ? { d0: a } : {}), ...(nd >= 2 ? { d1: b } : {}), ...(nm >= 1 ? { m0: n } : {}), ...(nm >= 2 ? { m1: n === null ? null : n * 12.5 } : {}) });
  }));
  return res(columns, mode === "empty" ? [] : rows);
}
function render(def: VizDef, result: QueryResult, style: VizStyle = {}, theme: Theme = LIGHT): string {
  const full = { ...def.defaults, ...style };
  return renderToStaticMarkup(<def.Component result={result} style={full} theme={theme} colors={seriesColors(full, 8)} onSelect={() => undefined} />);
}
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("definitions", () => {
  it("has unique types and a complete contract", () => {
    expect(new Set(ALL.map((d) => d.type)).size).toBe(ALL.length);
    expect(ALL.map((d) => d.type).sort()).toEqual(["box_plot", "bullet", "calendar_heatmap", "flow", "gauge", "header", "heatmap", "kpi", "leaderboard", "pivot", "progress", "radar", "sankey", "table", "text"]);
    for (const d of ALL) {
      expect(d.description.length).toBeGreaterThan(10);
      expect(d.icon).toBeTruthy();
      expect(d.needs.dims[0]).toBeLessThanOrEqual(d.needs.dims[1]);
      expect(Boolean(d.noQuery)).toBe(d.category === "Content");
    }
  });
});

describe.each([["light", LIGHT], ["dark", DARK]] as const)("renders on the %s theme", (_name, theme) => {
  const rendered = ALL.filter((d) => d.type !== "flow");
  const styled: VizStyle = { target: 500, thresholds: [{ value: 0, color: "#DC2626" }, { value: 200, color: "#059669" }], showTotals: true, text: "# Title\nSome **bold** text" };
  it.each(rendered.map((d) => [d.type, d] as const))("%s with realistic data", (_t, def) => {
    expect(render(def, sample(def), {}, theme).length).toBeGreaterThan(0);
    expect(render(def, sample(def), styled, theme).length).toBeGreaterThan(0);
  });
  it.each(rendered.map((d) => [d.type, d] as const))("%s with no rows", (_t, def) => {
    expect(render(def, sample(def, "empty"), {}, theme).length).toBeGreaterThan(0);
    expect(render(def, sample(def, "empty"), styled, theme).length).toBeGreaterThan(0);
  });
  it.each(rendered.map((d) => [d.type, d] as const))("%s with null measure values", (_t, def) => {
    expect(render(def, sample(def, "nulls"), {}, theme).length).toBeGreaterThan(0);
    expect(render(def, sample(def, "nulls"), styled, theme).length).toBeGreaterThan(0);
  });
  it.each(rendered.map((d) => [d.type, d] as const))("%s with a single row", (_t, def) => {
    const s = sample(def);
    expect(render(def, { ...s, rows: s.rows.slice(0, 1) }, styled, theme).length).toBeGreaterThan(0);
  });
  it("uses the theme's text colour, not a fixed one", () => {
    expect(render(byType("kpi"), sample(byType("kpi")), {}, theme)).toContain(theme.text);
    expect(render(byType("table"), sample(byType("table")), {}, theme)).toContain(theme.text);
  });
});

describe("content", () => {
  it("kpi shows the formatted total, the delta, the target and a sparkline", () => {
    const r = res([dim("d0", "Day"), mea("m0", "Tickets")], [{ d0: "a", m0: 400 }, { d0: "b", m0: 834 }], { compare: { range: { from: "2026-08-01", to: "2026-08-31" }, totals: { m0: 1000 } } });
    const m = render(byType("kpi"), r, { target: 2000 });
    expect(text(m)).toContain("1,234");
    expect(text(m)).toContain("+23.4%");
    expect(m).toContain("#059669");
    expect(text(m)).toContain("Target 2,000");
    expect(m).toContain("<polyline");
    const worse = render(byType("kpi"), r, { higherIsBetter: false, sparkline: false });
    expect(worse).toContain("#DC2626");
    expect(worse).not.toContain("<polyline");
    expect(text(render(byType("kpi"), { ...r, compare: undefined }))).not.toContain("vs previous period");
  });

  it("kpi falls back to the only row when there is no total", () => {
    const r = res([mea("m0", "Tickets")], [{ m0: 77 }], { totals: {} });
    expect(text(render(byType("kpi"), r))).toContain("77");
  });

  it("progress reports the percentage of the target", () => {
    const r = res([mea("m0", "Tickets")], [{ m0: 250 }]);
    expect(text(render(byType("progress"), r, { target: 1000 }))).toContain("25% of target");
  });

  it("leaderboard lists labels in descending order and honours topN", () => {
    const r = res([dim("d0", "Agent"), mea("m0", "Calls")], [{ d0: "Low", m0: 5 }, { d0: "High", m0: 90 }, { d0: "Blank", m0: null }, { d0: "Mid", m0: 40 }]);
    const m = render(byType("leaderboard"), r);
    const at = ["High", "Mid", "Low", "Blank"].map((l) => m.indexOf(`>${l}<`));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    const top2 = render(byType("leaderboard"), r, { topN: 2 });
    expect(top2).toContain(">Mid<");
    expect(top2).not.toContain(">Low<");
  });

  it("table renders header labels, paginates and adds a totals row", () => {
    const def = byType("table");
    const m = render(def, sample(def), { showTotals: true });
    for (const label of ["Branch", "Status", "Tickets", "Revenue"]) expect(m).toContain(`<span>${label}</span>`);
    expect(m).toContain("<tfoot>");
    expect(text(m)).toContain("Total");
    expect(text(m)).toContain("1,305");
    expect(m).toContain('aria-sort="none"');
    expect(render(def, sample(def))).not.toContain("<tfoot>");
    const paged = render(def, sample(def), { pageSize: 4 });
    expect(text(paged)).toContain("1–4 of 6");
    expect(paged).toContain('aria-label="Next page"');
  });

  it("pivot shows row and column totals", () => {
    const def = byType("pivot");
    const t = text(render(def, sample(def)));
    // rows: Pune 100+135, Mumbai 200+235, Delhi 300+335; columns: Open 600, Closed 705; grand 1,305
    for (const v of ["235", "435", "635", "600", "705", "1,305"]) expect(t).toContain(` ${v} `);
    expect(text(render(def, sample(def), { showTotals: false }))).not.toContain("1,305");
  });

  it("heatmap shows row and column labels and cell values", () => {
    const def = byType("heatmap");
    const m = render(def, sample(def));
    for (const label of [...BRANCHES, ...STATUSES]) expect(m).toContain(`>${label}<`);
    expect(m).toContain('title="Delhi / Closed: 335"');
    expect(render(def, sample(def), { dataLabels: false })).not.toContain(">335<");
  });

  it("calendar heatmap draws one square per day, or explains what it needs", () => {
    const def = byType("calendar_heatmap");
    const m = render(def, sample(def));
    expect(m.match(/<rect/g)?.length).toBe(18); // 28 Aug .. 14 Sep inclusive
    expect(m).toContain("1 Sep 2026: 300");
    expect(m).toContain(">Aug<");
    expect(m).toContain(">Sep<");
    const notDates = res([dim("d0", "Branch"), mea("m0", "Tickets")], [{ d0: "Pune", m0: 1 }]);
    expect(render(def, notDates)).toContain("Needs a date field grouped by day.");
  });

  it("box plot labels each series with its five numbers", () => {
    const def = byType("box_plot");
    const m = render(def, sample(def));
    expect(m).toContain("Open: min 100, Q1 150, median 200, Q3 250, max 300");
  });

  it("sankey explains what it needs when there are no links", () => {
    const def = byType("sankey");
    expect(render(def, sample(def, "nulls"))).toContain("Needs two dimensions and a positive measure.");
  });

  it("text widget renders bold text and drops a javascript: link", () => {
    const m = render(byType("text"), sample(byType("text")), { text: "Hello **world**\n\n[bad](javascript:alert(1)) [good](https://ok.test) <script>x</script>" });
    expect(m).toMatch(/<strong[^>]*>.*world.*<\/strong>/);
    expect(m).not.toContain("javascript:");
    expect(m.match(/<a /g)?.length).toBe(1);
    expect(m).toContain('href="https://ok.test"');
    expect(m).toContain('rel="noopener noreferrer"');
    expect(m).not.toContain("<script>");
    expect(m).toContain("&lt;script&gt;");
  });

  it("header renders its text", () => {
    expect(render(byType("header"), sample(byType("header")), { text: "Attendance" })).toContain("Attendance");
  });
});

describe("flowElements (the flow diagram's data, tested without rendering ReactFlow)", () => {
  const def = byType("flow");
  it("puts left values in a left column and right values in a right column", () => {
    const { nodes, edges } = flowElements(sample(def), {}, ["#111111", "#222222"]);
    expect(nodes).toHaveLength(5);
    expect(edges).toHaveLength(6);
    const left = nodes.filter((n) => n.position.x === 0), right = nodes.filter((n) => n.position.x > 0);
    expect(left.map((n) => n.data.label)).toEqual(BRANCHES);
    expect(right.map((n) => n.data.label)).toEqual(STATUSES);
    expect(new Set(left.map((n) => n.position.y)).size).toBe(3);
    expect(nodes.every((n) => n.draggable === false && n.connectable === false)).toBe(true);
    expect(new Set([...nodes.map((n) => n.id), ...edges.map((e) => e.id)]).size).toBe(11);
  });
  it("labels edges with the formatted value and scales stroke width 1..8", () => {
    const { edges } = flowElements(sample(def), { suffix: " t" }, ["#111111"]);
    const widths = edges.map((e) => Number(e.style?.strokeWidth));
    expect(Math.min(...widths)).toBe(1);
    expect(Math.max(...widths)).toBe(8);
    expect(edges[0].label).toBe("100 t");
    expect(edges.every((e) => e.source.startsWith("n") && e.target.startsWith("n"))).toBe(true);
  });
  it("returns nothing for empty, null or one-dimension input", () => {
    expect(flowElements(sample(def, "empty"), {}, ["#111111"])).toEqual({ nodes: [], edges: [] });
    expect(flowElements(sample(def, "nulls"), {}, ["#111111"])).toEqual({ nodes: [], edges: [] });
    expect(flowElements(sample(byType("kpi")), {}, ["#111111"])).toEqual({ nodes: [], edges: [] });
  });
});
