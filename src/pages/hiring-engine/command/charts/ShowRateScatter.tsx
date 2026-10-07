/** Requisitions by show rate (x) and lead-to-join rate (y); marker shape per drive type, dot size = leads, the 5 largest by leads labelled. */
import { CartesianGrid, LabelList, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import type { DriveAnalytics } from "../driveCommandTypes";
import { SOURCE_TYPES, TYPE_LABEL, countText, pctText } from "../driveCommandModel";
import { TYPE_SHAPE, seriesColor, useIsDark, usePrefersReducedMotion } from "../chartTheme";
import type { ScatterDot } from "../driveChartModel";
import ChartFrame, { TooltipCard, axisTick, gridProps } from "./ChartFrame";
import { SeriesLegend } from "./TypePatterns";
import { presentTypes, scatterView } from "./summaryView";

type Dot = ScatterDot & { tag: string };

export default function ShowRateScatter({ analytics }: { analytics: DriveAnalytics }) {
  const dark = useIsDark();
  const reduced = usePrefersReducedMotion();
  const v = scatterView(analytics, { prefersReducedMotion: reduced });
  const ink = dark ? "#e2e8f0" : "#1e293b";
  const axisLabel = { fill: dark ? "#cbd5e1" : "#475569", fontSize: 11 };
  return (
    <ChartFrame
      title="Show rate against lead to join"
      subtitle="Each mark is a requisition and drive type; bigger marks had more leads. The five with the most leads are named."
      table={v.table} empty={v.empty} aria={v.aria}
      note={<SeriesLegend dark={dark} present={presentTypes(analytics)} />}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 16, right: 16, bottom: 20, left: 4 }}>
          <CartesianGrid {...gridProps(dark)} vertical />
          <XAxis type="number" dataKey="x" name="Show rate %" domain={[0, 100]} tick={axisTick(dark)} axisLine={false} tickLine={false}
            label={{ value: "Show rate %", position: "insideBottom", offset: -12, ...axisLabel }} />
          <YAxis type="number" dataKey="y" name="Lead to join %" tick={axisTick(dark)} axisLine={false} tickLine={false} width={40} allowDecimals={false}
            label={{ value: "Lead to join %", angle: -90, position: "insideLeft", offset: 12, ...axisLabel }} />
          <ZAxis type="number" dataKey="z" range={[40, 400]} name="Leads" />
          <Tooltip
            isAnimationActive={v.motion.animate}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as Dot | undefined;
              if (!active || !p) return null;
              return (
                <TooltipCard title={p.code} lines={[
                  { label: "Branch", value: p.branch }, { label: "Drive type", value: TYPE_LABEL[p.sourceType] }, { label: "Leads", value: countText(p.leads) },
                  { label: "Show rate", value: pctText(p.x / 100) }, { label: "Lead to join", value: pctText(p.y / 100) },
                ]} />
              );
            }}
          />
          {SOURCE_TYPES.map((t) => (
            <Scatter key={t} name={TYPE_LABEL[t]} data={v.points.filter((p) => p.sourceType === t)} shape={TYPE_SHAPE[t]} fill={seriesColor(t, dark)}
              fillOpacity={0.85} stroke={dark ? "#0f172a" : "#ffffff"} isAnimationActive={v.motion.animate} animationDuration={v.motion.durationMs}>
              <LabelList dataKey="tag" position="top" fill={ink} fontSize={11} />
            </Scatter>
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
