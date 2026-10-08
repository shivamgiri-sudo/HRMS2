/** Daily arrivals stacked by drive type (textured areas, marker shape per type, end labels) with the dashed daily target on the same axis. */
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Symbols, Tooltip, XAxis, YAxis } from "recharts";
import type { DriveAnalytics, SourceType } from "../driveCommandTypes";
import { SOURCE_TYPES, TYPE_LABEL } from "../driveCommandModel";
import { TARGET_COLOR, TYPE_SHAPE, seriesColor, useIsDark, usePrefersReducedMotion } from "../chartTheme";
import type { YieldPoint } from "../driveChartModel";
import ChartFrame, { TOOLTIP_CURSOR, TooltipCard, axisTick, gridProps } from "./ChartFrame";
import { SeriesLegend, patternFill, typePatternDefs, usePatternPrefix } from "./TypePatterns";
import { presentTypes, yieldView } from "./summaryView";

interface DotProps { cx?: number; cy?: number; index?: number; key?: string }
interface LabelProps { x?: number; y?: number; index?: number }

export default function YieldChart({ analytics }: { analytics: DriveAnalytics }) {
  const dark = useIsDark();
  const reduced = usePrefersReducedMotion();
  const prefix = usePatternPrefix();
  const v = yieldView(analytics, { prefersReducedMotion: reduced });
  const last = v.points.length - 1;
  const ink = dark ? "#e2e8f0" : "#1e293b";
  const target = dark ? TARGET_COLOR.dark : TARGET_COLOR.light;
  const endLabel = (text: string, show: boolean) => (p: LabelProps) => (show && p.index === last && Number.isFinite(p.x) && Number.isFinite(p.y)
    ? <text x={(p.x ?? 0) + 6} y={(p.y ?? 0) + 4} fontSize={11} fontWeight={600} fill={ink}>{text}</text> : <g />);
  const dot = (t: SourceType) => (p: DotProps) => (Number.isFinite(p.cx) && Number.isFinite(p.cy)
    ? <Symbols key={p.key ?? `${t}-${p.index}`} cx={p.cx} cy={p.cy} type={TYPE_SHAPE[t]} size={36} fill={seriesColor(t, dark)} stroke={dark ? "#0f172a" : "#ffffff"} strokeWidth={1} />
    : <g key={p.key ?? `${t}-${p.index}`} />);
  return (
    <ChartFrame
      title="Daily arrivals against target"
      subtitle="People who arrived each drive day, stacked by drive type; the dashed line is the daily target. Sundays left out."
      table={v.table} empty={v.empty} aria={v.aria}
      note={<SeriesLegend dark={dark} present={presentTypes(analytics)} extra={[{ label: "Target", dashed: true }]} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={v.points} margin={{ top: 8, right: 96, bottom: 4, left: 0 }}>
          {typePatternDefs(prefix, dark)}
          <CartesianGrid {...gridProps(dark)} />
          <XAxis dataKey="label" tick={axisTick(dark)} axisLine={false} tickLine={false} minTickGap={12} />
          <YAxis tick={axisTick(dark)} axisLine={false} tickLine={false} allowDecimals={false} width={32} />
          <Tooltip
            cursor={TOOLTIP_CURSOR}
            isAnimationActive={v.motion.animate}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as YieldPoint | undefined;
              if (!active || !p) return null;
              const total = p.meta_live + p.meta_old + p.he;
              return <TooltipCard title={p.label} lines={[...SOURCE_TYPES.map((t) => ({ label: TYPE_LABEL[t], value: String(p[t]) })), { label: "Total", value: String(total) }, { label: "Target", value: String(p.target) }]} />;
            }}
          />
          {SOURCE_TYPES.map((t) => (
            <Area key={t} type="monotone" dataKey={t} name={TYPE_LABEL[t]} stackId="arrived" stroke={seriesColor(t, dark)} strokeWidth={2}
              fill={patternFill(prefix, t)} fillOpacity={0.85} dot={dot(t)} activeDot={false}
              label={endLabel(TYPE_LABEL[t], v.labelled.includes(t))}
              isAnimationActive={v.motion.animate} animationDuration={v.motion.durationMs} />
          ))}
          <Line type="linear" dataKey="target" name="Target" stroke={target} strokeWidth={2} strokeDasharray="6 4" dot={false} activeDot={false}
            label={endLabel("Target", true)} isAnimationActive={v.motion.animate} animationDuration={v.motion.durationMs} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
