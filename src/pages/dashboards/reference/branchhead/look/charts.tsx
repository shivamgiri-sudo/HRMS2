import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyLine } from "./AccentCard";
import "./look.css";

/** Validated categorical slots from viz.css (light), plus the neutral "other". Status colours stay reserved for status. */
export const PAL = { s1: "#2a78d6", s2: "#eb6834", s3: "#1baf7a", s4: "#eda100", other: "#898781", ink: "#52514e", grid: "#e1e0d9" } as const;

const reduceMotion = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const TIP = {
  contentStyle: { borderRadius: 10, border: "1px solid #dce4ed", boxShadow: "0 8px 20px rgba(15,35,60,.12)", fontSize: 12 },
  labelStyle: { fontWeight: 800, color: "#102f4b" },
  cursor: { fill: "rgba(47,111,237,.06)" },
} as const;
const AXIS = { tick: { fontSize: 11, fill: PAL.ink }, axisLine: { stroke: PAL.grid }, tickLine: false } as const;

export interface ChartSeries { key: string; label: string; color: string; stack?: string; axis?: "left" | "right"; kind?: "bar" | "line"; dashed?: boolean }

type Row = Record<string, string | number | null>;

/** Category tick text capped for narrow screens (the full name is in the tooltip and the table twin). */
const short = (v: unknown) => { const t = String(v ?? ""); return t.length > 13 ? `${t.slice(0, 12)}…` : t; };

/** Grouped (or stacked, via `stack`) bars with an optional line on a right axis: one chart for bars, stacks and combos. */
export function BarsChart({ label, data, xKey, series, height = 260, horizontal = false, format = (v: number) => v.toLocaleString("en-IN"), rightFormat }: {
  label: string; data: Row[]; xKey: string; series: ChartSeries[]; height?: number; horizontal?: boolean;
  format?: (v: number) => string; rightFormat?: (v: number) => string;
}) {
  // A chart with nothing to draw (every value zero or missing) is an empty axis frame: say so instead.
  const drawn = data.some((r) => series.some((s) => Number.isFinite(Number(r[s.key])) && Number(r[s.key]) !== 0));
  if (!drawn) return <EmptyLine text="Nothing to show for this period yet" />;
  const hasRight = series.some((s) => s.axis === "right");
  const narrow = typeof window !== "undefined" && window.innerWidth < 640;
  const fmtOf = (s: ChartSeries) => (s.axis === "right" && rightFormat ? rightFormat : format);
  // Screen readers (and static tests) get the data itself; the "View as table" twin has it too.
  const summary = label.includes(":") ? label : `${label}: ${data.map((r) => `${r[xKey]} (${series.filter((s) => r[s.key] != null)
    .map((s) => `${s.label} ${fmtOf(s)(Number(r[s.key]))}`).join(", ")})`).join("; ")}`;
  const tipFmt = (v: unknown, name: unknown) => {
    const s = series.find((x) => x.label === name);
    return [typeof v === "number" ? (s?.axis === "right" && rightFormat ? rightFormat(v) : format(v)) : String(v ?? "—"), String(name)];
  };
  const marks = series.map((s) => (s.kind === "line" ? (
    <Line key={s.key} yAxisId={s.axis === "right" ? "r" : "l"} type="linear" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2.5}
      strokeDasharray={s.dashed ? "5 4" : undefined} dot={{ r: 3, fill: s.color }} isAnimationActive={!reduceMotion} connectNulls />
  ) : (
    <Bar key={s.key} yAxisId={horizontal ? undefined : s.axis === "right" ? "r" : "l"} dataKey={s.key} name={s.label} fill={s.color} stackId={s.stack}
      radius={s.stack ? 0 : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={horizontal ? 18 : 34} isAnimationActive={!reduceMotion} />
  )));
  return (
    <div className="bhl-chart" role="img" aria-label={summary} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {horizontal ? (
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid horizontal={false} stroke={PAL.grid} />
            <XAxis type="number" {...AXIS} tickFormatter={format} />
            <YAxis type="category" dataKey={xKey} width={narrow ? 86 : 120} {...AXIS} tickFormatter={narrow ? short : undefined} />
            <Tooltip {...TIP} formatter={tipFmt} />
            <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
            {marks}
          </BarChart>
        ) : (
          <ComposedChart data={data} margin={{ top: 8, right: hasRight ? 4 : 12, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={PAL.grid} />
            {narrow && data.length > 3
              ? <XAxis dataKey={xKey} {...AXIS} interval={0} angle={-35} textAnchor="end" height={64} tickFormatter={short} />
              : <XAxis dataKey={xKey} {...AXIS} interval={0} />}
            <YAxis yAxisId="l" {...AXIS} width={52} tickFormatter={format} />
            {hasRight ? <YAxis yAxisId="r" orientation="right" {...AXIS} width={44} tickFormatter={rightFormat ?? format} /> : null}
            <Tooltip {...TIP} formatter={tipFmt} />
            <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
            {marks}
          </ComposedChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/** Donut with the headline in the centre and a legend; slices keep their categorical colour. */
export function DonutChart({ label, slices, center, centerLabel, height = 230, format = (v: number) => v.toLocaleString("en-IN") }: {
  label: string; slices: Array<{ key: string; label: string; value: number; color: string }>; center: string; centerLabel: string; height?: number; format?: (v: number) => string;
}) {
  const data = slices.filter((s) => s.value > 0);
  if (data.length === 0) return <EmptyLine text="Nothing to show for this period yet" />;
  return (
    <div className="bhl-chart relative" role="img" aria-label={`${label}: ${slices.map((s) => `${s.label} ${format(s.value)}`).join(", ")}`} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="label" innerRadius="58%" outerRadius="84%" paddingAngle={2} stroke="#fff" strokeWidth={2} isAnimationActive={!reduceMotion}>
            {data.map((s) => <Cell key={s.key} fill={s.color} />)}
          </Pie>
          <Tooltip {...TIP} formatter={(v: unknown, n: unknown) => [typeof v === "number" ? format(v) : String(v), String(n)]} />
          <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-x-0 flex flex-col items-center" style={{ top: `calc(${(height - 36) / 2}px - 22px)` }}>
        <span className="text-[22px] font-black tabular-nums text-[#102f4b]">{center}</span>
        <span className="text-[11px] font-semibold text-slate-700">{centerLabel}</span>
      </div>
    </div>
  );
}

export interface WaterStep { label: string; value: number; kind: "total" | "delta" }

/** Invisible base + visible bar per step: totals stand on zero, deltas float from the running total. */
export function waterfallData(steps: WaterStep[], format: (v: number) => string = String) {
  let run = 0;
  return steps.map((s) => {
    if (s.kind === "total") { run = s.value; return { step: s.label, base: 0, total: s.value, up: null, down: null, value: s.value, totalLbl: format(s.value), upLbl: null, downLbl: null }; }
    const from = run;
    run += s.value;
    return { step: s.label, base: Math.min(from, run), total: null, up: s.value > 0 ? s.value : null, down: s.value < 0 ? -s.value : null, value: s.value,
      totalLbl: null, upLbl: s.value > 0 ? `+${format(s.value)}` : null, downLbl: s.value < 0 ? format(s.value) : null };
  });
}

/** Waterfall in the Recharts look: totals navy, decreases orange, increases green; values in the tooltip and labels. */
export function WaterfallChart({ label, steps, format, height = 280 }: { label: string; steps: WaterStep[]; format: (v: number) => string; height?: number }) {
  const data = waterfallData(steps, format);
  return (
    <div className="bhl-chart" role="img" aria-label={`${label}: ${steps.map((s) => `${s.label} ${format(s.value)}`).join(", ")}`} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 18, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={PAL.grid} />
          <XAxis dataKey="step" {...AXIS} interval={0} />
          <YAxis {...AXIS} width={52} tickFormatter={(v: number) => format(v).replace("₹", "")} />
          <Tooltip {...TIP} formatter={(_v: unknown, n: unknown, item: { payload?: { value?: number } }) => (n === "base" ? [null, null] : [format(item?.payload?.value ?? 0), String(n)])} />
          <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} payload={[
            { value: "Total", type: "square", color: "#153f69" }, { value: "Decrease", type: "square", color: PAL.s2 }, { value: "Increase", type: "square", color: PAL.s3 },
          ]} />
          <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} legendType="none" />
          <Bar dataKey="total" name="Total" stackId="w" fill="#153f69" radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={!reduceMotion}>
            <LabelList dataKey="totalLbl" position="top" fontSize={11} fill="#102f4b" />
          </Bar>
          <Bar dataKey="down" name="Decrease" stackId="w" fill={PAL.s2} radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={!reduceMotion}>
            <LabelList dataKey="downLbl" position="top" fontSize={11} fill="#102f4b" />
          </Bar>
          <Bar dataKey="up" name="Increase" stackId="w" fill={PAL.s3} radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={!reduceMotion}>
            <LabelList dataKey="upLbl" position="top" fontSize={11} fill="#102f4b" />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
