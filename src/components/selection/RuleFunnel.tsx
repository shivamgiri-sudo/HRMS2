/** The rule funnel (S18): people still in after each step and how many left there, as horizontal bars with direct labels and a
 * hatched texture for "left" (never colour alone), plus the same numbers as a table (one adapter). No animation under reduced motion. */
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ChartFrame, { TOOLTIP_CURSOR, TooltipCard, axisTick, gridProps } from "@/pages/hiring-engine/command/charts/ChartFrame";
import { useIsDark, useIsNarrow, usePrefersReducedMotion } from "@/pages/hiring-engine/command/chartTheme";
import { funnelView } from "./ruleFunnelModel";
import type { PreviewResult } from "./selectionTypes";

const STILL = { light: "#2a78d6", dark: "#3987e5" };
const LEFT = { light: "#eb6834", dark: "#d95926" };

export default function RuleFunnel({ preview }: { preview: PreviewResult }) {
  const dark = useIsDark();
  const reduced = usePrefersReducedMotion();
  const narrow = useIsNarrow();
  const v = funnelView(preview);
  const ink = dark ? "#e2e8f0" : "#1e293b";
  return (
    <ChartFrame title="Rule funnel" subtitle="People still in after each rule (solid) and people who left at that rule (hatched). Review people stay in." table={v.table} empty={v.empty}
      emptyText="Nobody in this source yet" aria={v.aria} size="tall">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={v.bars} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 4 }} barCategoryGap="18%">
          <defs>
            <pattern id="rule-funnel-left" patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
              <rect width={6} height={6} fill={dark ? LEFT.dark : LEFT.light} fillOpacity={0.35} /><line x1={0} y1={0} x2={0} y2={6} stroke={dark ? LEFT.dark : LEFT.light} strokeWidth={3} />
            </pattern>
          </defs>
          <CartesianGrid {...gridProps(dark)} horizontal={false} vertical />
          <XAxis type="number" tick={axisTick(dark)} axisLine={false} tickLine={false} allowDecimals={false} />
          <YAxis type="category" dataKey="label" width={narrow ? 110 : 220} interval={0} axisLine={false} tickLine={false} tick={{ ...axisTick(dark), fontSize: 11 }} />
          <Tooltip cursor={TOOLTIP_CURSOR} isAnimationActive={!reduced}
            content={({ active, payload }) => {
              const b = payload?.[0]?.payload as (typeof v.bars)[number] | undefined;
              if (!active || !b) return null;
              return <TooltipCard title={b.label} lines={[{ label: "Still in", value: String(b.still) }, { label: "Left here", value: String(b.left) }, { label: "Sent to review here", value: String(b.review) }]} />;
            }} />
          <Bar dataKey="still" name="Still in" stackId="s" fill={dark ? STILL.dark : STILL.light} isAnimationActive={!reduced}>
            <LabelList dataKey="still" position="insideLeft" fill="#ffffff" fontSize={11} />
          </Bar>
          <Bar dataKey="left" name="Left at this step" stackId="s" fill="url(#rule-funnel-left)" stroke={dark ? LEFT.dark : LEFT.light} isAnimationActive={!reduced}>
            <LabelList dataKey="left" position="right" fill={ink} fontSize={11} formatter={(x: number) => (x ? `-${x}` : "")} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
