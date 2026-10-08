import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Line, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis, type TooltipProps,
} from "recharts";
import { frameRows, histogram, toFrame, waterfall, type Series } from "../shape";
import type { Cell as DataCell, VizProps } from "../types";
import {
  catAxisProps, chartLabel, chartMargin, ChartRoot, colorAt, DASHES, DOWN_COLOR, fmtSeries, legendEl, legendPos, selectRow, TipBox, toNum,
  truncate, valAxisProps,
} from "./chart-common";

/** The cartesian charts that are not plain bars/lines/areas: waterfall, combo, histogram, scatter, bubble. */

export function WaterfallViz({ result, style, theme, colors, onSelect }: VizProps) {
  const frame = toFrame(result);
  const s0: Series | undefined = frame.series[0];
  const hasData = frame.categories.length > 0 && Boolean(s0);
  const steps = hasData ? waterfall(frame) : [];
  // `delta` is the signed change (what the tooltip and labels show); `value` is the bar's height above `base`.
  const rows = steps.map((st, i) => ({
    ...st, delta: st.kind === "total" ? st.end : st.kind === "down" ? -st.value : st.value,
    ...(i < frame.raw.length ? { __raw: frame.raw[i] as DataCell } : {}),
  }));
  const fill = (kind: string) => (kind === "total" ? theme.muted : kind === "down" ? DOWN_COLOR : colorAt(colors, 0, theme));
  const canSelect = Boolean(onSelect && frame.categoryKey);

  const tip = (p: TooltipProps<number, string>) => {
    const row = p.payload?.[0]?.payload as (typeof rows)[number] | undefined;
    if (!p.active || !row) return null;
    const items = [{ color: fill(row.kind), label: row.kind === "total" ? "Total" : s0?.label ?? "Change", value: fmtSeries(row.delta, s0, style) }];
    if (row.kind !== "total") items.push({ color: theme.muted, label: "Running total", value: fmtSeries(row.end, s0, style) });
    return <TipBox theme={theme} title={row.name} items={items} />;
  };

  return (
    <ChartRoot label={chartLabel("Waterfall chart", s0 ? [s0.label] : [])} clickable={canSelect}>
      <BarChart data={rows} margin={chartMargin(style)}
        onClick={canSelect ? (s) => selectRow(frame, onSelect, s?.activePayload?.[0]?.payload) : undefined}>
        {style.grid !== false ? <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" vertical={false} /> : null}
        <XAxis type="category" dataKey="name" height={style.xTitle ? 40 : 24} {...catAxisProps(theme, "x", style.xTitle)} />
        <YAxis type="number" width={style.yTitle ? 64 : 48} {...valAxisProps(theme, s0?.format ?? "number", "y", style.yTitle)} />
        <Tooltip content={tip} cursor={{ fill: theme.grid, fillOpacity: 0.35 }} />
        <Bar dataKey="base" stackId="wf" fill="transparent" stroke="none" isAnimationActive={false} legendType="none" />
        <Bar dataKey="value" stackId="wf" maxBarSize={56} radius={2} name={s0?.label ?? "Value"}>
          {rows.map((r, i) => <Cell key={i} fill={fill(r.kind)} />)}
          {style.dataLabels
            ? <LabelList dataKey="delta" position="top" formatter={(v: unknown) => fmtSeries(v, s0, style)} fill={theme.text} fontSize={10} />
            : null}
        </Bar>
      </BarChart>
    </ChartRoot>
  );
}

/** First measure as bars on the left axis, the others as lines on a right axis of their own. */
export function ComboViz({ result, style, theme, colors, onSelect }: VizProps) {
  const frame = toFrame(result);
  const rows = frameRows(frame);
  const [barSeries, ...lineSeries] = frame.series;
  const byKey = new Map<string, Series>(frame.series.map((s) => [s.key, s]));
  const canSelect = Boolean(onSelect && frame.categoryKey);
  const curve = style.curve === "smooth" ? "monotone" : style.curve === "step" ? "step" : "linear";
  const dots = rows.length <= 1 ? true : style.dots ?? false;

  const tip = (p: TooltipProps<number, string>) =>
    p.active && p.payload?.length ? (
      <TipBox theme={theme} title={String(p.label ?? "")}
        items={p.payload.map((e) => {
          const s = byKey.get(String(e.dataKey));
          return { color: String(e.color ?? theme.accent), label: s?.label ?? String(e.name ?? ""), value: fmtSeries(e.value, s, style) };
        })} />
    ) : null;
  const labels = (s: Series) =>
    style.dataLabels
      ? <LabelList dataKey={s.key} position="top" formatter={(v: unknown) => (toNum(v) === null ? "" : fmtSeries(v, s, style))} fill={theme.text} fontSize={10} />
      : null;

  return (
    <ChartRoot label={chartLabel("Combined bar and line chart", frame.series.map((s) => s.label))} clickable={canSelect}>
      <ComposedChart data={rows} margin={chartMargin(style, { right: 4 })}
        onClick={canSelect ? (s) => selectRow(frame, onSelect, s?.activePayload?.[0]?.payload) : undefined}>
        {style.grid !== false ? <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" vertical={false} /> : null}
        <XAxis type="category" dataKey="name" height={style.xTitle ? 40 : 24} {...catAxisProps(theme, "x", style.xTitle)} />
        <YAxis yAxisId="left" type="number" width={style.yTitle ? 64 : 48} {...valAxisProps(theme, barSeries?.format ?? "number", "y", style.yTitle)} />
        <YAxis yAxisId="right" orientation="right" type="number" width={48} hide={!lineSeries.length}
          {...valAxisProps(theme, lineSeries[0]?.format ?? "number", "y", undefined, true)} />
        <Tooltip content={tip} cursor={{ fill: theme.grid, fillOpacity: 0.35 }} />
        {legendEl(legendPos(style, frame.series.length), theme)}
        {barSeries
          ? <Bar yAxisId="left" dataKey={barSeries.key} name={barSeries.label} fill={colorAt(colors, 0, theme)} maxBarSize={56} radius={[3, 3, 0, 0]}>{labels(barSeries)}</Bar>
          : null}
        {lineSeries.map((s, i) => {
          const c = colorAt(colors, i + 1, theme);
          return (
            <Line key={s.key} yAxisId="right" type={curve} dataKey={s.key} name={s.label} stroke={c} strokeWidth={2}
              strokeDasharray={DASHES[i % DASHES.length]} dot={dots ? { r: 3, fill: c, strokeWidth: 0 } : false} activeDot={{ r: 4 }}>
              {labels(s)}
            </Line>
          );
        })}
      </ComposedChart>
    </ChartRoot>
  );
}

/** How the first measure's values (one per category) are spread across ten equal ranges. */
export function HistogramViz({ result, style, theme, colors }: VizProps) {
  const frame = toFrame(result);
  const s0: Series | undefined = frame.series[0];
  const bins = histogram(s0?.values ?? []);
  const countLabel = result.columns.find((c) => c.kind === "dimension")?.label ?? "Count";

  const tip = (p: TooltipProps<number, string>) => {
    const bin = p.payload?.[0]?.payload as (typeof bins)[number] | undefined;
    if (!p.active || !bin) return null;
    return <TipBox theme={theme} title={`${s0?.label ?? "Value"}: ${bin.label}`} items={[{ color: colorAt(colors, 0, theme), label: countLabel, value: String(bin.count) }]} />;
  };

  return (
    <ChartRoot label={chartLabel("Histogram", s0 ? [s0.label] : [])}>
      <BarChart data={bins} margin={chartMargin(style)} barCategoryGap={1}>
        {style.grid !== false ? <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" vertical={false} /> : null}
        <XAxis type="category" dataKey="label" height={style.xTitle ? 40 : 24} {...catAxisProps(theme, "x", style.xTitle)} />
        <YAxis type="number" allowDecimals={false} width={style.yTitle ? 56 : 40} {...valAxisProps(theme, "integer", "y", style.yTitle)} />
        <Tooltip content={tip} cursor={{ fill: theme.grid, fillOpacity: 0.35 }} />
        <Bar dataKey="count" name={countLabel} fill={colorAt(colors, 0, theme)} radius={[2, 2, 0, 0]}>
          {style.dataLabels ? <LabelList dataKey="count" position="top" fill={theme.text} fontSize={10} /> : null}
        </Bar>
      </BarChart>
    </ChartRoot>
  );
}

function PointsViz({ result, style, theme, colors, onSelect, bubble }: VizProps & { bubble: boolean }) {
  const frame = toFrame(result);
  const [sx, sy, sz] = frame.series as Array<Series | undefined>;
  const points = frame.categories
    .map((name, i) => ({ name, __raw: frame.raw[i], x: sx?.values[i] ?? null, y: sy?.values[i] ?? null, z: sz?.values[i] ?? null }))
    .filter((p) => p.x !== null && p.y !== null);
  const color = colorAt(colors, 0, theme);
  const canSelect = Boolean(onSelect && frame.categoryKey);
  const used = (bubble ? [sx, sy, sz] : [sx, sy]).filter((s): s is Series => Boolean(s));

  const tip = (p: TooltipProps<number, string>) => {
    const pt = p.payload?.[0]?.payload as (typeof points)[number] | undefined;
    if (!p.active || !pt) return null;
    const vals = [pt.x, pt.y, pt.z];
    return <TipBox theme={theme} title={pt.name} items={used.map((s, i) => ({ color: i === 0 ? color : undefined, label: s.label, value: fmtSeries(vals[i], s, style) }))} />;
  };

  return (
    <ChartRoot label={chartLabel(bubble ? "Bubble chart" : "Scatter chart", used.map((s) => s.label))} clickable={canSelect}>
      <ScatterChart margin={{ ...chartMargin(style), bottom: 18, right: 20 }}>
        {style.grid !== false ? <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" /> : null}
        <XAxis type="number" dataKey="x" name={sx?.label} height={40} {...valAxisProps(theme, sx?.format ?? "number", "x", style.xTitle ?? sx?.label)} />
        <YAxis type="number" dataKey="y" name={sy?.label} width={64} {...valAxisProps(theme, sy?.format ?? "number", "y", style.yTitle ?? sy?.label)} />
        {bubble ? <ZAxis type="number" dataKey="z" name={sz?.label} range={[40, 600]} /> : <ZAxis range={[60, 60]} />}
        <Tooltip content={tip} cursor={{ stroke: theme.muted, strokeDasharray: "3 3" }} />
        <Scatter data={points} fill={color} fillOpacity={bubble ? 0.7 : 0.9} stroke={bubble ? color : theme.card} strokeWidth={1}
          onClick={canSelect ? (d: unknown) => selectRow(frame, onSelect, d) : undefined}>
          {style.dataLabels
            ? <LabelList dataKey="name" position="top" formatter={(v: unknown) => truncate(v)} fill={theme.text} fontSize={10} />
            : null}
        </Scatter>
      </ScatterChart>
    </ChartRoot>
  );
}
export const ScatterViz = (p: VizProps) => <PointsViz {...p} bubble={false} />;
export const BubbleViz = (p: VizProps) => <PointsViz {...p} bubble />;
