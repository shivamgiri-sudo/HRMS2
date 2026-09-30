import type { ComponentType } from "react";
import { Area, Bar, CartesianGrid, Cell, ComposedChart, LabelList, Line, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import {
  AreaChart as AreaIcon, BarChart3, BarChart4, BarChartBig, BarChartHorizontal, BarChartHorizontalBig, ChartNoAxesCombined, Circle,
  Layers, LineChart as LineIcon, Percent, ScatterChart as ScatterIcon, StepForward, TrendingUp,
} from "lucide-react";
import { thresholdColor } from "../palettes";
import { frameRows, toFrame, toPercentOfTotal, topN, type Series } from "../shape";
import type { VizProps } from "../types";
import type { StyleOption, VizDef } from "./def";
import { BubbleViz, ComboViz, HistogramViz, ScatterViz, WaterfallViz } from "./CartesianViz2";
import {
  catAxisProps, chartLabel, chartMargin, ChartRoot, colorAt, DASHES, fmtSeries, legendEl, legendPos, readableOn, selectRow, TipBox,
  toNum, valAxisProps,
} from "./chart-common";

/** Bars, lines and areas on category/value axes. One factory draws all ten plain variants. */

interface XYOpts {
  kind: "bar" | "line" | "area"; name: string;
  /** Horizontal bars (recharts layout="vertical"). */
  horizontal?: boolean; stacked?: boolean; percent?: boolean; step?: boolean;
  /** Ranked charts honour style.topN; time-ordered ones do not. */
  useTopN?: boolean;
}

function makeXY(o: XYOpts): ComponentType<VizProps> {
  function XYChart({ result, style, theme, colors, onSelect }: VizProps) {
    let frame = toFrame(result);
    if (o.useTopN) frame = topN(frame, style.topN);
    if (o.percent) frame = toPercentOfTotal(frame);
    const rows = frameRows(frame);
    const series = frame.series;
    const byKey = new Map<string, Series>(series.map((s) => [s.key, s]));
    const valueFormat = o.percent ? "percent" : series[0]?.format ?? "number";
    const single = series.length === 1;
    const canSelect = Boolean(onSelect && frame.categoryKey);
    const curve = o.step ? "stepAfter" : style.curve === "smooth" ? "monotone" : style.curve === "step" ? "step" : "linear";
    // A single point has no segment to draw, so it needs its dot whatever the setting says.
    const dots = rows.length <= 1 ? true : style.dots ?? false;
    const catAxis = o.horizontal ? "y" : "x";
    const valAxis = o.horizontal ? "x" : "y";
    const cat = catAxisProps(theme, catAxis, o.horizontal ? style.yTitle : style.xTitle, rows.length);
    const val = valAxisProps(theme, valueFormat, valAxis, o.horizontal ? style.xTitle : style.yTitle);
    const domain = o.percent ? ([0, 100] as [number, number]) : undefined;

    const tip = (p: TooltipProps<number, string>) =>
      p.active && p.payload?.length ? (
        <TipBox
          theme={theme} title={String(p.label ?? "")}
          items={p.payload.map((e, i) => {
            const s = byKey.get(String(e.dataKey));
            return { color: String(e.color ?? colorAt(colors, i, theme)), label: s?.label ?? String(e.name ?? ""), value: fmtSeries(e.value, s, o.percent ? { decimals: style.decimals } : style) };
          })}
        />
      ) : null;

    return (
      <ChartRoot label={chartLabel(o.name, series.map((s) => s.label))} clickable={canSelect}>
        <ComposedChart
          data={rows} layout={o.horizontal ? "vertical" : "horizontal"}
          margin={chartMargin(style, o.horizontal && style.dataLabels && !o.stacked ? { top: 8, right: 56 } : {})}
          onClick={canSelect ? (s) => selectRow(frame, onSelect, s?.activePayload?.[0]?.payload) : undefined}
        >
          {style.grid !== false ? <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" vertical={Boolean(o.horizontal)} horizontal={!o.horizontal} /> : null}
          {o.horizontal
            ? <XAxis type="number" domain={domain} height={style.xTitle ? 40 : 24} {...val} />
            : <XAxis type="category" dataKey="name" height={style.xTitle ? 40 : 24} {...cat} />}
          {o.horizontal
            ? <YAxis type="category" dataKey="name" width={style.yTitle ? 116 : 100} {...cat} />
            : <YAxis type="number" domain={domain} width={style.yTitle ? 64 : 48} {...val} />}
          <Tooltip content={tip} cursor={{ fill: theme.grid, fillOpacity: 0.35, stroke: theme.grid }} />
          {legendEl(legendPos(style, series.length), theme)}
          {series.map((s, i) => {
            const c = colorAt(colors, i, theme);
            const labelFmt = (v: unknown) => (toNum(v) === null ? "" : fmtSeries(v, s, o.percent ? { decimals: style.decimals ?? 0 } : style));
            if (o.kind === "bar") {
              const inside = Boolean(o.stacked);
              return (
                <Bar key={s.key} dataKey={s.key} name={s.label} fill={c} stackId={o.stacked ? "stack" : undefined} maxBarSize={56}
                  radius={o.stacked ? 0 : o.horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]}>
                  {single && style.thresholds?.length
                    ? rows.map((r, ri) => <Cell key={ri} fill={thresholdColor(style, toNum(r[s.key])) ?? c} />)
                    : null}
                  {style.dataLabels
                    ? <LabelList dataKey={s.key} position={inside ? "center" : o.horizontal ? "right" : "top"} formatter={labelFmt} fill={inside ? readableOn(c) : theme.text} fontSize={10} />
                    : null}
                </Bar>
              );
            }
            const dash = DASHES[i % DASHES.length];
            const dot = dots ? { r: 3, fill: c, strokeWidth: 0 } : false;
            const labels = style.dataLabels ? <LabelList dataKey={s.key} position="top" formatter={labelFmt} fill={theme.text} fontSize={10} /> : null;
            if (o.kind === "area") {
              return (
                <Area key={s.key} type={curve} dataKey={s.key} name={s.label} stroke={c} strokeWidth={2} strokeDasharray={dash} fill={c}
                  fillOpacity={o.stacked ? 0.55 : 0.2} stackId={o.stacked ? "stack" : undefined} dot={dot} activeDot={{ r: 4 }} connectNulls={Boolean(o.stacked)}>
                  {labels}
                </Area>
              );
            }
            return (
              <Line key={s.key} type={curve} dataKey={s.key} name={s.label} stroke={c} strokeWidth={2} strokeDasharray={dash} dot={dot} activeDot={{ r: 4 }}>
                {labels}
              </Line>
            );
          })}
        </ComposedChart>
      </ChartRoot>
    );
  }
  XYChart.displayName = `XYChart(${o.name})`;
  return XYChart;
}

const SIZE = { w: 6, h: 7 };
const BAR_OPTS: StyleOption[] = ["palette", "legend", "dataLabels", "grid", "axisTitles", "numberFormat", "topN", "thresholds"];
const STACK_OPTS: StyleOption[] = ["palette", "legend", "dataLabels", "grid", "axisTitles", "numberFormat", "topN"];
const LINE_OPTS: StyleOption[] = ["palette", "legend", "dataLabels", "grid", "axisTitles", "curve", "dots", "numberFormat"];
const STEP_OPTS: StyleOption[] = ["palette", "legend", "dataLabels", "grid", "axisTitles", "dots", "numberFormat"];
const POINT_OPTS: StyleOption[] = ["palette", "dataLabels", "grid", "axisTitles", "numberFormat"];

export const CARTESIAN_VIZ: VizDef[] = [
  {
    type: "column", label: "Column", category: "Comparison", icon: BarChart3, defaultSize: SIZE, styleOptions: BAR_OPTS,
    description: "Compare a value across a handful of categories, or a few measures side by side.",
    needs: { dims: [1, 2], measures: [1, 4] }, Component: makeXY({ kind: "bar", name: "Column chart", useTopN: true }),
  },
  {
    type: "bar", label: "Bar", category: "Comparison", icon: BarChartHorizontal, defaultSize: SIZE, styleOptions: BAR_OPTS, defaults: { topN: 15 },
    description: "Rank categories with long names from largest to smallest.",
    needs: { dims: [1, 2], measures: [1, 4] }, Component: makeXY({ kind: "bar", name: "Bar chart", horizontal: true, useTopN: true }),
  },
  {
    type: "stacked_column", label: "Stacked column", category: "Comparison", icon: BarChart4, defaultSize: SIZE, styleOptions: STACK_OPTS,
    description: "Show each category's total and how its parts add up to it.",
    needs: { dims: [1, 2], measures: [1, 6] }, Component: makeXY({ kind: "bar", name: "Stacked column chart", stacked: true, useTopN: true }),
  },
  {
    type: "stacked_bar", label: "Stacked bar", category: "Comparison", icon: BarChartHorizontalBig, defaultSize: SIZE, styleOptions: STACK_OPTS,
    description: "Show totals and their parts for categories with long names.",
    needs: { dims: [1, 2], measures: [1, 6] }, Component: makeXY({ kind: "bar", name: "Stacked bar chart", horizontal: true, stacked: true, useTopN: true }),
  },
  {
    type: "stacked_100", label: "100% stacked", category: "Comparison", icon: Percent, defaultSize: SIZE,
    styleOptions: ["palette", "legend", "dataLabels", "grid", "axisTitles", "topN"],
    description: "Compare the mix of parts between categories when the totals themselves do not matter.",
    needs: { dims: [1, 2], measures: [1, 6] }, Component: makeXY({ kind: "bar", name: "100% stacked column chart", stacked: true, percent: true, useTopN: true }),
  },
  {
    type: "waterfall", label: "Waterfall", category: "Comparison", icon: BarChartBig, defaultSize: SIZE,
    styleOptions: ["palette", "dataLabels", "grid", "axisTitles", "numberFormat"],
    description: "Explain how a series of gains and losses builds up to a final total.",
    needs: { dims: [1, 1], measures: [1, 1] }, Component: WaterfallViz,
  },
  {
    type: "line", label: "Line", category: "Trend", icon: LineIcon, defaultSize: SIZE, styleOptions: LINE_OPTS,
    description: "Follow how one or more values change over time.",
    needs: { dims: [1, 2], measures: [1, 6] }, Component: makeXY({ kind: "line", name: "Line chart" }),
  },
  {
    type: "step_line", label: "Step line", category: "Trend", icon: StepForward, defaultSize: SIZE, styleOptions: STEP_OPTS,
    description: "Track a value that holds steady and then jumps, such as headcount or a rate card.",
    needs: { dims: [1, 2], measures: [1, 6] }, Component: makeXY({ kind: "line", name: "Step line chart", step: true }),
  },
  {
    type: "area", label: "Area", category: "Trend", icon: AreaIcon, defaultSize: SIZE, styleOptions: LINE_OPTS,
    description: "Follow a trend over time while giving a sense of its volume.",
    needs: { dims: [1, 2], measures: [1, 6] }, Component: makeXY({ kind: "area", name: "Area chart" }),
  },
  {
    type: "stacked_area", label: "Stacked area", category: "Trend", icon: Layers, defaultSize: SIZE, styleOptions: LINE_OPTS,
    description: "Show how a total and the parts that make it up change over time.",
    needs: { dims: [1, 2], measures: [1, 6] }, Component: makeXY({ kind: "area", name: "Stacked area chart", stacked: true }),
  },
  {
    type: "combo", label: "Combo (bars + line)", category: "Trend", icon: ChartNoAxesCombined, defaultSize: SIZE, styleOptions: LINE_OPTS,
    description: "Set a volume against a rate or ratio that needs its own scale.",
    needs: { dims: [1, 1], measures: [2, 4] }, Component: ComboViz,
  },
  {
    type: "histogram", label: "Histogram", category: "Distribution", icon: TrendingUp, defaultSize: SIZE,
    styleOptions: ["palette", "dataLabels", "grid", "axisTitles"],
    description: "See how the values of a measure are spread across ranges.",
    needs: { dims: [1, 1], measures: [1, 1] }, Component: HistogramViz,
  },
  {
    type: "scatter", label: "Scatter", category: "Distribution", icon: ScatterIcon, defaultSize: SIZE, styleOptions: POINT_OPTS,
    description: "Look for a relationship between two measures across categories.",
    needs: { dims: [1, 1], measures: [2, 2] }, Component: ScatterViz,
  },
  {
    type: "bubble", label: "Bubble", category: "Distribution", icon: Circle, defaultSize: SIZE, styleOptions: POINT_OPTS,
    description: "Compare categories on two measures, with a third shown as the size of each bubble.",
    needs: { dims: [1, 1], measures: [3, 3] }, Component: BubbleViz,
  },
];
