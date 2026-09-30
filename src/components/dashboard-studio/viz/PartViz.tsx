import type { ReactElement } from "react";
import { Cell, Label, LabelList, Pie, PieChart, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip, Treemap, type TooltipProps } from "recharts";
import { CircleDot, Donut, Filter, LayoutGrid, PieChart as PieIcon, Target } from "lucide-react";
import { formatCategory, formatValue } from "../format";
import { dims, measures, toFrame, topN, type Frame, type Series } from "../shape";
import type { Cell as DataCell, Theme, VizProps, VizStyle } from "../types";
import type { VizDef } from "./def";
import {
  chartLabel, ChartRoot, colorAt, EmptyChart, fmtSeries, legendEl, PlainRoot, pctOf, readableOn, selectRow, TipBox, toNum, truncate, useWidth,
  type LegendPos,
} from "./chart-common";

/** Part-to-whole charts: pie, donut, nested donut, treemap, funnel, radial bar. */

interface Slice { name: string; value: number; fill: string; __raw: DataCell; lbl?: string }

/** Positive slices of the first series, after top-N. Shares of a whole cannot show zero or negative values. */
function slicesOf(result: VizProps["result"], style: VizStyle, colors: string[], theme: Theme): { frame: Frame; s0: Series | undefined; slices: Slice[]; total: number } {
  const frame = topN(toFrame(result), style.topN);
  const s0 = frame.series[0];
  const slices: Slice[] = [];
  frame.categories.forEach((name, i) => {
    const v = s0?.values[i] ?? null;
    if (v !== null && v > 0) slices.push({ name, value: v, fill: colorAt(colors, i, theme), __raw: frame.raw[i] });
  });
  const total = slices.reduce((a, s) => a + s.value, 0);
  for (const s of slices) s.lbl = `${truncate(s.name)}  ${pctOf(s.value, total)}`;
  return { frame, s0, slices, total };
}

/** Legend sits to the right on a wide tile, underneath on a narrow one. */
const sideLegend = (style: VizStyle, width: number | null): LegendPos => style.legend ?? (width !== null && width < 340 ? "bottom" : "right");

const sliceTip = (theme: Theme, s0: Pick<Series, "format" | "label"> | undefined, style: VizStyle, total: number) =>
  function SliceTip(p: TooltipProps<number, string>) {
    const row = p.payload?.[0]?.payload as (Partial<Slice> & { payload?: Partial<Slice> }) | undefined;
    const sl = row && row.value === undefined && row.payload ? row.payload : row;
    const v = toNum(sl?.value);
    if (!p.active || !sl || v === null) return null;
    return <TipBox theme={theme} title={String(sl.name ?? "")} items={[{ color: sl.fill, label: s0?.label ?? "Value", value: `${fmtSeries(v, s0, style)} (${pctOf(v, total)})` }]} />;
  };

interface PieLabelArgs { x?: number; y?: number; textAnchor?: string; index?: number }
/** Outside labels show the share only (names are in the legend); slices under 4% are left unlabelled so labels never collide. */
const pieLabel = (slices: Slice[], theme: Theme) => {
  const total = slices.reduce((a, s) => a + s.value, 0);
  return function renderPieLabel(a: PieLabelArgs): ReactElement {
    const v = slices[a.index ?? 0]?.value ?? 0;
    if (!total || v / total < 0.04) return <g />;
    return (
      <text x={a.x} y={a.y} textAnchor={a.textAnchor as "start" | "middle" | "end" | undefined} dominantBaseline="central" fill={theme.text} fontSize={11} fontWeight={600}>
        {pctOf(v, total)}
      </text>
    );
  };
};

function PieLike({ result, style, theme, colors, onSelect, donut }: VizProps & { donut: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const { frame, s0, slices, total } = slicesOf(result, style, colors, theme);
  const canSelect = Boolean(onSelect && frame.categoryKey);
  const label = chartLabel(donut ? "Donut chart" : "Pie chart", s0 ? [s0.label] : []);
  if (!slices.length) return <EmptyChart label={label} theme={theme} />;
  const outer = style.dataLabels ? "62%" : "82%";
  return (
    <div ref={ref} className="h-full w-full" role="img" aria-label={label} style={canSelect ? { cursor: "pointer" } : undefined}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <Pie data={slices} dataKey="value" nameKey="name" innerRadius={donut ? "55%" : 0} outerRadius={outer} paddingAngle={slices.length > 1 ? 1 : 0}
            stroke={theme.card} strokeWidth={1} startAngle={90} endAngle={-270}
            label={style.dataLabels ? pieLabel(slices, theme) : false} labelLine={false}
            onClick={canSelect ? (d: unknown) => selectRow(frame, onSelect, d) : undefined}>
            {slices.map((s, i) => <Cell key={i} fill={s.fill} />)}
            {donut ? <Label value={formatValue(total, s0?.format ?? "number", style)} position="center" fill={theme.text} fontSize={16} fontWeight={600} /> : null}
          </Pie>
          <Tooltip content={sliceTip(theme, s0, style, total)} />
          {legendEl(sideLegend(style, width), theme)}
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
const PieViz = (p: VizProps) => <PieLike {...p} donut={false} />;
const DonutViz = (p: VizProps) => <PieLike {...p} donut />;

/** Inner ring: totals of dimension 1. Outer ring: dimension 2 slices, grouped under (and tinted from) their parent. */
function NestedDonutViz({ result, style, theme, colors, onSelect }: VizProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [d0, d1] = dims(result);
  const m = measures(result)[0];
  const label = chartLabel("Nested donut chart", m ? [m.label] : []);
  const parents: Array<Slice & { kids: Slice[] }> = [];
  const index = new Map<string, number>();
  if (d0 && m) {
    for (const row of result.rows) {
      const v = toNum(row[m.key]);
      if (v === null || v <= 0) continue;
      const pName = formatCategory(row[d0.key], d0);
      if (!index.has(pName)) {
        index.set(pName, parents.length);
        parents.push({ name: pName, value: 0, fill: colorAt(colors, parents.length, theme), __raw: row[d0.key] ?? null, kids: [] });
      }
      const p = parents[index.get(pName)!];
      p.value += v;
      const kName = d1 ? formatCategory(row[d1.key], d1) : pName;
      const kid = p.kids.find((k) => k.name === kName);
      if (kid) kid.value += v;
      else p.kids.push({ name: kName, value: v, fill: p.fill, __raw: d1 ? row[d1.key] ?? null : null });
    }
  }
  if (!parents.length) return <EmptyChart label={label} theme={theme} />;
  const total = parents.reduce((a, p) => a + p.value, 0);
  // Same order and same total as the inner ring, so each parent's children sit exactly outside it.
  const kids = parents.flatMap((p) => p.kids.map((k, i) => ({ ...k, parent: p.name, opacity: Math.max(0.35, 0.95 - (i * 0.6) / Math.max(p.kids.length, 1)) })));
  const tip = sliceTip(theme, m, style, total);
  const select = (key: string | undefined) => (onSelect && key ? (d: unknown) => selectRow({ categoryKey: key }, onSelect, d) : undefined);
  return (
    <div ref={ref} className="h-full w-full" role="img" aria-label={label} style={onSelect ? { cursor: "pointer" } : undefined}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <Pie data={parents} dataKey="value" nameKey="name" innerRadius="28%" outerRadius="52%" stroke={theme.card} strokeWidth={1}
            startAngle={90} endAngle={-270} onClick={select(d0?.key)}>
            {parents.map((p, i) => <Cell key={i} fill={p.fill} />)}
          </Pie>
          <Pie data={kids} dataKey="value" nameKey="name" innerRadius="56%" outerRadius={style.dataLabels ? "72%" : "84%"} stroke={theme.card} strokeWidth={1}
            startAngle={90} endAngle={-270} legendType="none" onClick={select(d1?.key)}
            label={style.dataLabels ? (a: PieLabelArgs) => (
              <text x={a.x} y={a.y} textAnchor={a.textAnchor as "start" | "middle" | "end" | undefined} dominantBaseline="central" fill={theme.text} fontSize={10}>
                {`${truncate(kids[a.index ?? 0]?.name)}  ${pctOf(kids[a.index ?? 0]?.value ?? 0, total)}`}
              </text>
            ) : false}
            labelLine={style.dataLabels ? { stroke: theme.muted } : false}>
            {kids.map((k, i) => <Cell key={i} fill={k.fill} fillOpacity={k.opacity} />)}
          </Pie>
          <Tooltip content={tip} />
          {legendEl(sideLegend(style, width), theme)}
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

interface TreeCellArgs { x?: number; y?: number; width?: number; height?: number; depth?: number; name?: string; value?: number; fill?: string }
function TreemapViz({ result, style, theme, colors, onSelect }: VizProps) {
  const { frame, s0, slices, total } = slicesOf(result, style, colors, theme);
  const label = chartLabel("Treemap", s0 ? [s0.label] : []);
  if (!slices.length) return <EmptyChart label={label} theme={theme} />;
  const canSelect = Boolean(onSelect && frame.categoryKey);
  const cell = (a: TreeCellArgs): ReactElement => {
    const { x = 0, y = 0, width = 0, height = 0 } = a;
    if (a.depth !== 1 || width <= 0 || height <= 0) return <g />;
    const fill = a.fill ?? theme.accent;
    const ink = readableOn(fill);
    const chars = Math.max(3, Math.floor((width - 12) / 6.5));
    return (
      <g>
        <rect x={x} y={y} width={width} height={height} fill={fill} stroke={theme.card} strokeWidth={2} rx={2} />
        {width > 56 && height > 22 ? <text x={x + 6} y={y + 15} fill={ink} fontSize={11} fontWeight={600}>{truncate(a.name, chars)}</text> : null}
        {width > 56 && height > 40 && style.dataLabels !== false
          ? <text x={x + 6} y={y + 30} fill={ink} fontSize={10} fillOpacity={0.9}>{fmtSeries(a.value, s0, style)}</text>
          : null}
      </g>
    );
  };
  return (
    <ChartRoot label={label} clickable={canSelect}>
      <Treemap data={slices} dataKey="value" nameKey="name" aspectRatio={4 / 3} isAnimationActive={false} content={cell as never}
        onClick={canSelect ? (d: unknown) => selectRow(frame, onSelect, d) : undefined}>
        <Tooltip content={sliceTip(theme, s0, style, total)} />
      </Treemap>
    </ChartRoot>
  );
}

/** Centred bars, each as wide as its share of the first stage, with the step-to-step conversion beside it. */
function FunnelViz({ result, style, theme, colors, onSelect }: VizProps) {
  const frame = toFrame(result);
  const s0 = frame.series[0];
  const label = chartLabel("Funnel chart", s0 ? [s0.label] : []);
  const stages = frame.categories.map((name, i) => ({ name, __raw: frame.raw[i], value: s0?.values[i] ?? null }));
  if (!stages.length || !s0) return <EmptyChart label={label} theme={theme} />;
  const first = Math.abs(stages[0].value ?? 0) || Math.max(0, ...stages.map((s) => Math.abs(s.value ?? 0)));
  const canSelect = Boolean(onSelect && frame.categoryKey);
  return (
    <PlainRoot label={label}>
      <div className="flex h-full w-full flex-col justify-center gap-1 overflow-y-auto px-2 py-1" style={{ color: theme.text }}>
        {stages.map((st, i) => {
          const prev = i > 0 ? stages[i - 1].value : null;
          const step = i > 0 && prev && st.value !== null ? `${((st.value / prev) * 100).toFixed(1)}%` : null;
          const share = first > 0 && st.value !== null ? Math.min(100, Math.max(2, (Math.abs(st.value) / first) * 100)) : 2;
          const fill = colorAt(colors, i, theme);
          return (
            <div key={i} className="flex min-h-[22px] flex-1 items-center gap-2" style={{ maxHeight: 44, cursor: canSelect ? "pointer" : undefined }}
              title={`${st.name}: ${formatValue(st.value, s0.format, style)}`}
              onClick={canSelect ? () => selectRow(frame, onSelect, st) : undefined}>
              <div className="w-[26%] shrink-0 truncate text-right text-[11px]" style={{ color: theme.muted }}>{st.name}</div>
              <div className="flex h-full min-w-0 flex-1 items-center justify-center">
                <div className="h-full rounded-sm" style={{ width: `${share}%`, background: fill }} />
              </div>
              <div className="w-[22%] shrink-0 text-[11px] leading-tight">
                <div className="truncate font-semibold tabular-nums">{formatValue(st.value, s0.format, style)}</div>
                {step ? <div className="truncate tabular-nums" style={{ color: theme.muted }} title={`${step} of the step above`}>{step} of prior</div> : null}
              </div>
            </div>
          );
        })}
      </div>
    </PlainRoot>
  );
}

function RadialBarViz({ result, style, theme, colors, onSelect }: VizProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const { frame, s0, slices, total } = slicesOf(result, style, colors, theme);
  const label = chartLabel("Radial bar chart", s0 ? [s0.label] : []);
  if (!slices.length) return <EmptyChart label={label} theme={theme} />;
  const canSelect = Boolean(onSelect && frame.categoryKey);
  return (
    <div ref={ref} className="h-full w-full" role="img" aria-label={label} style={canSelect ? { cursor: "pointer" } : undefined}>
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart data={slices} innerRadius="18%" outerRadius="100%" startAngle={90} endAngle={-270} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <RadialBar dataKey="value" background={{ fill: theme.grid }} cornerRadius={4}
            onClick={canSelect ? (d: unknown) => selectRow(frame, onSelect, d) : undefined}>
            {slices.map((s, i) => <Cell key={i} fill={s.fill} />)}
            {style.dataLabels ? <LabelList dataKey="lbl" position="insideStart" fill={theme.text} fontSize={10} /> : null}
          </RadialBar>
          <Tooltip content={sliceTip(theme, s0, style, total)} cursor={false} />
          {legendEl(sideLegend(style, width), theme)}
        </RadialBarChart>
      </ResponsiveContainer>
    </div>
  );
}

export const PART_VIZ: VizDef[] = [
  {
    type: "pie", label: "Pie", category: "Part to whole", icon: PieIcon, defaultSize: { w: 4, h: 7 }, defaults: { topN: 6 },
    styleOptions: ["palette", "legend", "dataLabels", "numberFormat", "topN"],
    description: "Show how a total splits across a few categories.",
    needs: { dims: [1, 1], measures: [1, 1] }, Component: PieViz,
  },
  {
    type: "donut", label: "Donut", category: "Part to whole", icon: Donut, defaultSize: { w: 4, h: 7 }, defaults: { topN: 6 },
    styleOptions: ["palette", "legend", "dataLabels", "numberFormat", "topN"],
    description: "Show how a total splits across a few categories, with the total itself in the centre.",
    needs: { dims: [1, 1], measures: [1, 1] }, Component: DonutViz,
  },
  {
    type: "nested_donut", label: "Nested donut", category: "Part to whole", icon: CircleDot, defaultSize: { w: 5, h: 8 },
    styleOptions: ["palette", "legend", "dataLabels", "numberFormat"],
    description: "Break a total down by one category and then by a second category inside each.",
    needs: { dims: [2, 2], measures: [1, 1] }, Component: NestedDonutViz,
  },
  {
    type: "treemap", label: "Treemap", category: "Part to whole", icon: LayoutGrid, defaultSize: { w: 6, h: 7 },
    styleOptions: ["palette", "dataLabels", "numberFormat", "topN"],
    description: "Compare the share of many categories at once, where a pie would have too many slices.",
    needs: { dims: [1, 1], measures: [1, 1] }, Component: TreemapViz,
  },
  {
    type: "funnel", label: "Funnel", category: "Part to whole", icon: Filter, defaultSize: { w: 5, h: 7 },
    styleOptions: ["palette", "numberFormat"],
    description: "Show how many remain at each stage of a process and where the biggest drop-off is.",
    needs: { dims: [1, 1], measures: [1, 1] }, Component: FunnelViz,
  },
  {
    type: "radial_bar", label: "Radial bar", category: "Part to whole", icon: Target, defaultSize: { w: 4, h: 7 }, defaults: { topN: 8 },
    styleOptions: ["palette", "legend", "dataLabels", "numberFormat", "topN"],
    description: "Compare a small number of categories as rings in a compact, square tile.",
    needs: { dims: [1, 1], measures: [1, 1] }, Component: RadialBarViz,
  },
];
