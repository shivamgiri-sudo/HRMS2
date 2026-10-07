/**
 * Two stacked charts of one drive group (never a dual axis): counts per drive day with the dashed wanted line, and the show rate
 * on its own axis below. Both come from trendView, which also builds their text-alternative tables. Colour is the group's type
 * colour; invited / confirmed / arrived differ by fill (light, textured, solid) and are named in the legend and the tooltip.
 */
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Symbols, Tooltip, XAxis, YAxis } from "recharts";
import { TARGET_COLOR, TYPE_SHAPE, seriesColor, useIsDark, usePrefersReducedMotion } from "./chartTheme";
import { TYPE_LABEL } from "./driveCommandModel";
import { trendView, type CountPoint, type RatePoint } from "./driveGroupModel";
import type { SourceType, TrendPoint } from "./driveCommandTypes";
import ChartFrame, { TOOLTIP_CURSOR, TooltipCard, axisTick, gridProps } from "./charts/ChartFrame";
import { ShapeGlyph, patternFill, typePatternDefs, usePatternPrefix } from "./charts/TypePatterns";

interface DotProps { cx?: number; cy?: number; index?: number; key?: string }

export default function DriveTrendChart({ points, type, today }: { points: TrendPoint[]; type: SourceType; today: string }) {
  const dark = useIsDark();
  const reduced = usePrefersReducedMotion();
  const prefix = usePatternPrefix();
  const v = trendView(points, type, today, { prefersReducedMotion: reduced });
  const color = seriesColor(type, dark);
  const target = dark ? TARGET_COLOR.dark : TARGET_COLOR.light;
  const label = TYPE_LABEL[type];
  const dot = (p: DotProps) => (Number.isFinite(p.cx) && Number.isFinite(p.cy)
    ? <Symbols key={p.key ?? `d-${p.index}`} cx={p.cx} cy={p.cy} type={TYPE_SHAPE[type]} size={36} fill={color} stroke={dark ? "#0f172a" : "#ffffff"} strokeWidth={1} />
    : <g key={p.key ?? `d-${p.index}`} />);
  const legend = (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-700 dark:text-slate-200" aria-label="Legend">
      <li className="flex items-center gap-1.5"><span className="inline-block h-3 w-4 rounded-sm border" style={{ borderColor: color, backgroundColor: color, opacity: 0.35 }} aria-hidden="true" /><span>Invited</span></li>
      <li className="flex items-center gap-1.5">
        <svg width="16" height="12" aria-hidden="true" focusable="false">{typePatternDefs(prefix, dark, [type])}<rect width="16" height="12" rx="2" fill={patternFill(prefix, type)} /></svg><span>Confirmed</span>
      </li>
      <li className="flex items-center gap-1.5"><span className="inline-block h-3 w-4 rounded-sm" style={{ backgroundColor: color }} aria-hidden="true" /><span>Arrived</span></li>
      <li className="flex items-center gap-1.5">
        <svg width="18" height="12" aria-hidden="true" focusable="false"><line x1="0" y1="6" x2="18" y2="6" stroke={target} strokeWidth="2" strokeDasharray="4 3" /></svg><span>Wanted</span>
      </li>
      <li className="flex items-center gap-1.5"><ShapeGlyph type={type} dark={dark} size={10} /><span>{label}</span></li>
    </ul>
  );
  return (
    <div className="space-y-3">
      <ChartFrame
        title="People each drive day" subtitle={`${label}: invited, confirmed and arrived, with the wanted number as a dashed line`}
        table={v.countsTable} empty={v.empty} aria={`${label} counts per drive day: ${v.counts.length} days`} note={legend}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={v.counts} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            {typePatternDefs(prefix, dark, [type])}
            <CartesianGrid {...gridProps(dark)} />
            <XAxis dataKey="label" tick={axisTick(dark)} axisLine={false} tickLine={false} minTickGap={12} />
            <YAxis tick={axisTick(dark)} axisLine={false} tickLine={false} allowDecimals={false} width={32} />
            <Tooltip cursor={TOOLTIP_CURSOR} isAnimationActive={v.motion.animate} content={({ active, payload }) => {
              const p = payload?.[0]?.payload as CountPoint | undefined;
              if (!active || !p) return null;
              return <TooltipCard title={p.label} lines={[{ label: "Invited", value: String(p.invited) }, { label: "Confirmed", value: String(p.confirmed) }, { label: "Arrived", value: String(p.arrived) }, { label: "Wanted", value: String(p.wanted) }]} />;
            }} />
            <Bar dataKey="invited" name="Invited" fill={color} fillOpacity={0.35} stroke={color} isAnimationActive={v.motion.animate} animationDuration={v.motion.durationMs} />
            <Bar dataKey="confirmed" name="Confirmed" fill={patternFill(prefix, type)} stroke={color} isAnimationActive={v.motion.animate} animationDuration={v.motion.durationMs} />
            <Bar dataKey="arrived" name="Arrived" fill={color} isAnimationActive={v.motion.animate} animationDuration={v.motion.durationMs} />
            <Line type="linear" dataKey="wanted" name="Wanted" stroke={target} strokeWidth={2} strokeDasharray="6 4" dot={false} activeDot={false} isAnimationActive={v.motion.animate} animationDuration={v.motion.durationMs} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartFrame>
      <ChartFrame
        title="Show rate each drive day" subtitle={`${label}: arrived as a share of confirmed, days so far`}
        table={v.rateTable} empty={v.showRate.length === 0} aria={`${label} show rate per drive day so far: ${v.showRate.length} days`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={v.showRate} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid {...gridProps(dark)} />
            <XAxis dataKey="label" tick={axisTick(dark)} axisLine={false} tickLine={false} minTickGap={12} />
            <YAxis tick={axisTick(dark)} axisLine={false} tickLine={false} domain={[0, 100]} tickFormatter={(n: number) => `${n}%`} width={40} />
            <Tooltip cursor={TOOLTIP_CURSOR} isAnimationActive={v.motion.animate} content={({ active, payload }) => {
              const p = payload?.[0]?.payload as RatePoint | undefined;
              if (!active || !p) return null;
              return <TooltipCard title={p.label} lines={[{ label: "Show rate", value: `${p.pct}%` }]} />;
            }} />
            <Line type="monotone" dataKey="pct" name="Show rate" stroke={color} strokeWidth={2} dot={dot} activeDot={false} isAnimationActive={v.motion.animate} animationDuration={v.motion.durationMs} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartFrame>
    </div>
  );
}
