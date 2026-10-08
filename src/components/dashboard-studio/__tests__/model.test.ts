import { describe, it, expect } from "vitest";
import { applyLayout, defaultQuery, effectiveQuery, fitQuery, initHistory, layoutsFor, nextY, posAt, pushHistory, queryProblems, redo, undo } from "../model";
import type { DatasetDef, Widget } from "../types";

const fld = (fieldKey: string, role: "dimension" | "measure" | "time") => ({ fieldKey, label: fieldKey, role, dataType: role === "measure" ? "number" : role === "time" ? "date" : "string", defaultAgg: "sum", format: "number", description: null }) as DatasetDef["fields"][number];
const SALES: DatasetDef = { code: "sales", name: "Sales", description: null, category: null, timeField: "date", scopeMode: "process", maxRows: 5000, fields: [fld("date", "time"), fld("campaign", "dimension"), fld("agent", "dimension"), fld("amount", "measure"), fld("orders", "measure")] };
const HC: DatasetDef = { code: "hc", name: "Headcount", description: null, category: null, timeField: null, scopeMode: "process_branch", maxRows: 5000, fields: [fld("process", "dimension"), fld("employees", "measure")] };
const w = (id: string, extra: Partial<Widget> = {}): Widget => ({ id, widgetType: "column", title: null, subtitle: null, viz: {}, layout: {}, query: { dataset: "sales", dimensions: [{ field: "campaign" }], measures: [{ field: "amount" }], dateRange: { preset: "last_7" } }, ...extra });
const NONE = { values: {}, cross: [] };

describe("effectiveQuery", () => {
  it("applies the dashboard date range unless the widget pins its own or has no time field", () => {
    const s = { dateRange: { preset: "this_month" as const } };
    expect(effectiveQuery(w("a"), s, NONE, [SALES])?.dateRange).toEqual({ preset: "this_month" });
    expect(effectiveQuery(w("a", { viz: { pinDate: true } }), s, NONE, [SALES])?.dateRange).toEqual({ preset: "last_7" });
    const hc = w("b", { query: { dataset: "hc", dimensions: [{ field: "process" }], measures: [{ field: "employees" }] } });
    expect(effectiveQuery(hc, s, NONE, [SALES, HC])?.dateRange).toBeUndefined();
  });
  it("adds branch/process scope and filter-bar values only where the dataset has the field", () => {
    const q = effectiveQuery(w("a"), { processIds: ["p1"] }, { values: { campaign: ["Cart ABC"], process: ["x"] }, cross: [] }, [SALES]);
    expect(q?.scope).toEqual({ branchIds: undefined, processIds: ["p1"] });
    expect(q?.filters).toEqual([{ field: "campaign", op: "in", value: ["Cart ABC"] }]);
  });
  it("cross-filters other widgets, never the one that was clicked", () => {
    const cross = [{ field: "campaign", value: "Upgrade", label: "Upgrade" }];
    expect(effectiveQuery(w("a"), {}, { values: {}, cross }, [SALES], "a")?.filters).toEqual([]);
    expect(effectiveQuery(w("b"), {}, { values: {}, cross }, [SALES], "a")?.filters).toEqual([{ field: "campaign", op: "eq", value: "Upgrade" }]);
    expect(effectiveQuery(w("b"), {}, { values: {}, cross: [{ field: "campaign", value: null, label: "(blank)" }] }, [SALES])?.filters).toEqual([{ field: "campaign", op: "is_null" }]);
  });
  it("does not mutate the stored query and returns null for content widgets", () => {
    const widget = w("a");
    effectiveQuery(widget, {}, { values: { campaign: ["x"] }, cross: [] }, [SALES]);
    expect(widget.query?.filters).toBeUndefined();
    expect(effectiveQuery(w("t", { query: null }), {}, NONE, [SALES])).toBeNull();
  });
});

describe("queries for chart types", () => {
  it("explains what is missing in plain words", () => {
    expect(queryProblems({ dims: [2, 2], measures: [1, 1] }, w("a").query, "Heatmap")[0]).toMatch(/needs at least 2 dimensions/);
    expect(queryProblems({ dims: [0, 0], measures: [1, 1] }, w("a").query, "Gauge")[0]).toMatch(/at most 0 dimensions/);
    expect(queryProblems({ dims: [1, 2], measures: [1, 4] }, w("a").query, "Column")).toEqual([]);
    expect(queryProblems({ dims: [1, 2], measures: [1, 4] }, null, "Column")).toEqual(["Pick a dataset."]);
  });
  it("defaults: trends start on the time field, comparisons on a dimension", () => {
    expect(defaultQuery(SALES, { dims: [1, 2], measures: [1, 6] }, true).dimensions).toEqual([{ field: "date", grain: "day" }]);
    expect(defaultQuery(SALES, { dims: [1, 2], measures: [1, 4] }, false).dimensions).toEqual([{ field: "campaign" }]);
    expect(defaultQuery(SALES, { dims: [2, 2], measures: [1, 1] }, false).dimensions).toHaveLength(2);
    expect(defaultQuery(SALES, { dims: [0, 0], measures: [1, 1] }, false).dimensions).toEqual([]);
    expect(defaultQuery(HC, { dims: [1, 1], measures: [3, 3] }, false).measures).toEqual([{ field: "employees", agg: "sum" }, { agg: "count" }, { agg: "count" }]);
    expect(defaultQuery(HC, { dims: [1, 1], measures: [1, 1] }, true).dateRange).toBeUndefined();
  });
  it("fitQuery trims to the new type", () => {
    const q = { dataset: "sales", dimensions: [{ field: "a" }, { field: "b" }], measures: [{ field: "x" }, { field: "y" }] };
    expect(fitQuery(q, { dims: [0, 1], measures: [1, 1] })).toMatchObject({ dimensions: [{ field: "a" }], measures: [{ field: "x" }] });
  });
});

describe("layout", () => {
  const a = w("a", { layout: { lg: { x: 6, y: 0, w: 6, h: 7 } } }), b = w("b", { layout: { lg: { x: 0, y: 7, w: 12, h: 4 } } });
  it("derives smaller breakpoints from lg and stacks on phones", () => {
    expect(posAt(a, "md", 0)).toEqual({ x: 4, y: 0, w: 4, h: 7 });
    expect(posAt(a, "sm", 0)).toMatchObject({ x: 0, w: 4 });
    expect(layoutsFor([a, b]).xs.every((l) => l.w === 1 && l.x === 0)).toBe(true);
    expect(nextY([a, b])).toBe(11);
  });
  it("applyLayout stores moves, ignores no-ops and never stores xs", () => {
    const moved = applyLayout([a, b], "lg", [{ i: "a", x: 0, y: 0, w: 4, h: 7 }, { i: "b", x: 0, y: 7, w: 12, h: 4 }]);
    expect(moved[0].layout.lg).toEqual({ x: 0, y: 0, w: 4, h: 7 }); expect(moved[1]).toBe(b);
    const same = [a, b]; expect(applyLayout(same, "lg", [{ i: "a", x: 6, y: 0, w: 6, h: 7 }])).toBe(same);
    expect(applyLayout(same, "xs", [{ i: "a", x: 0, y: 0, w: 1, h: 1 }])).toBe(same);
    // A click on a breakpoint the user never arranged is a zero-distance drag: nothing is stored, nothing becomes unsaved.
    expect(applyLayout(same, "md", [{ i: "a", ...posAt(a, "md", 0) }, { i: "b", ...posAt(b, "md", 1) }])).toBe(same);
  });
});

describe("history", () => {
  it("undo and redo walk the states; a new change clears redo", () => {
    let h = initHistory(1); h = pushHistory(h, 2); h = pushHistory(h, 3);
    h = undo(h); expect(h.present).toBe(2);
    h = redo(h); expect(h.present).toBe(3);
    h = undo(undo(h)); expect(h.present).toBe(1); expect(undo(h)).toBe(h);
    h = pushHistory(h, 9); expect(h.future).toEqual([]); expect(redo(h)).toBe(h);
    expect(pushHistory(h, 9)).toBe(h);
  });
});
