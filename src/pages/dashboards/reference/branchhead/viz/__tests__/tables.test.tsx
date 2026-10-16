import { describe, expect, it } from "vitest";
import {
  barListLayout, barListTable, stackLayout, stackedBarTable, divergingLayout, divergingBarsTable, lineLayout, lineAreaTable,
  funnelLayout, funnelTable, waterfallLayout, waterfallTable, donutLayout, donutTable, meterLayout, meterTable,
} from "../index";

/* The table twin of each chart is derived from the SAME props object, so its figures must equal the layout's. */
const fmt = (n: number) => `${n}`;
const col = (t: { columns: string[] }, name: string) => t.columns.indexOf(name);

describe("table builders match chart layouts", () => {
  it("BarList: value, marker and over-marker note", () => {
    const props = { items: [{ id: "a", label: "Onfido", value: 280, marker: 181 }, { id: "b", label: "Beta", value: 50, marker: 60 }], format: fmt, markerLabel: "Mandate", label: "Headcount versus mandate" };
    const t = barListTable(props);
    const l = barListLayout(props.items);
    expect(t.caption).toBe("Headcount versus mandate");
    expect(t.columns).toEqual(["Item", "Value", "Mandate", "Note"]);
    t.rows.forEach((r, i) => {
      expect(r[1]).toBe(fmt(l.rows[i].value));
      expect(r[2]).toBe(fmt(l.rows[i].marker as number));
    });
    expect(t.rows[0][3]).toBe("Over Mandate");
    expect(t.rows[1][3]).toBeNull();
  });
  it("StackedBar: one column per series and the row total", () => {
    const series = [{ key: "p", label: "Present" }, { key: "l", label: "Leave" }];
    const props = { rows: [{ id: "r", label: "Alpha", segments: [{ key: "p", value: 6 }, { key: "l", value: 2 }, { key: "x", value: 3 }] }], series, format: fmt };
    const t = stackedBarTable(props);
    const l = stackLayout(props.rows, series);
    expect(t.columns).toEqual(["Item", "Present", "Leave", "Other", "Total"]);
    expect(t.rows[0]).toEqual(["Alpha", "6", "2", "3", fmt(l.rows[0].total)]);
    expect(l.rows[0].total).toBe(11);
  });
  it("DivergingBars: value and side", () => {
    const props = { items: [{ id: "a", label: "A", value: 5 }, { id: "b", label: "B", value: -3 }], format: fmt, positiveLabel: "Profit", negativeLabel: "Loss" };
    const l = divergingLayout(props.items);
    const t = divergingBarsTable(props);
    expect(t.rows).toEqual([["A", "5", "Profit"], ["B", "-3", "Loss"]]);
    expect(l.rows.map((r) => r.sign)).toEqual(["pos", "neg"]);
  });
  it("LineArea: one row per period, gaps as the em dash", () => {
    const props = { series: [{ key: "a", label: "Actual", points: [{ x: "D1", y: 1 }, { x: "D2", y: null }, { x: "D3", y: 4 }] }], format: fmt };
    const l = lineLayout(props.series, 600, 180);
    const t = lineAreaTable(props);
    expect(t.columns).toEqual(["Period", "Actual"]);
    expect(t.rows).toEqual([["D1", "1"], ["D2", "—"], ["D3", "4"]]);
    expect(l.series[0].dots.map((d) => fmt(d.v))).toEqual(["1", "4"]);
  });
  it("Funnel: counts and step conversion", () => {
    const props = { stages: [{ id: "a", label: "Applied", value: 200 }, { id: "b", label: "Screened", value: 120 }], format: fmt };
    const l = funnelLayout(props.stages);
    const t = funnelTable(props);
    expect(t.rows[1][1]).toBe(fmt(l.values[1]));
    expect(t.rows[1][2]).toBe(`${l.rows[1].convPct}%`);
    expect(t.rows[0][2]).toBeNull();
  });
  it("Waterfall: values and running totals, including a negative total", () => {
    const props = { steps: [{ id: "r", label: "Revenue", value: 50, kind: "total" as const }, { id: "c", label: "Cost", value: -80, kind: "delta" as const }, { id: "n", label: "Net", value: -30, kind: "total" as const }], format: fmt };
    const l = waterfallLayout(props.steps);
    const t = waterfallTable(props);
    t.rows.forEach((r, i) => {
      expect(r[col(t, "Value")]).toBe(fmt(l.bars[i].value));
      expect(r[col(t, "Running total")]).toBe(fmt(l.bars[i].running));
    });
    expect(t.rows[1][col(t, "Kind")]).toBe("Decrease");
  });
  it("Donut: the drawn (folded) slices and shares", () => {
    const slices = ["a", "b", "c", "d", "e"].map((k, i) => ({ key: k, label: k.toUpperCase(), value: 50 - i * 10 }));
    const props = { slices, centerLabel: "Exits", centerValue: "150", format: fmt };
    const l = donutLayout(slices);
    const t = donutTable(props);
    expect(t.rows).toHaveLength(l.slices.length + 1);
    l.slices.forEach((s, i) => expect(t.rows[i]).toEqual([s.label, fmt(s.value), `${s.pct}%`]));
    expect(t.rows[3][0]).toBe("Other");
    expect(t.rows[4]).toEqual(["Total", fmt(l.total), "100%"]);
  });
  it("Meter: value, limit, share and status", () => {
    const props = { value: 150, limit: 100, label: "Budget used", format: fmt };
    const l = meterLayout(props.value, props.limit);
    expect(meterTable(props).rows[0]).toEqual(["Budget used", "150", "100", `${l.pct}%`, "Over limit"]);
    expect(meterTable({ ...props, value: Number.NaN }).rows[0][1]).toBe("—");
    expect(meterTable({ ...props, limit: 0 }).rows[0][3]).toBeNull();
  });
});
