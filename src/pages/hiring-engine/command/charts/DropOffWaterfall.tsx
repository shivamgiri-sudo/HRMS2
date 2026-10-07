/** Drop-off waterfall for one drive type: an invisible "continued" base with the textured "lost" segment after it; reasons in tooltip and table. */
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DriveAnalytics, SourceType } from "../driveCommandTypes";
import { SOURCE_TYPES, TYPE_LABEL } from "../driveCommandModel";
import { seriesColor, useIsDark, usePrefersReducedMotion } from "../chartTheme";
import ChartFrame, { Note, Segmented, TOOLTIP_CURSOR, TooltipCard, axisTick, gridProps } from "./ChartFrame";
import { patternFill, typePatternDefs, usePatternPrefix } from "./TypePatterns";
import { UNTRACKED_NOTE, defaultType, waterfallView } from "./summaryView";

const TYPES = SOURCE_TYPES.map((t) => ({ id: t, label: TYPE_LABEL[t] }));
type Datum = { label: string; base: number; lost: number; reasons: string; lostText: string };

export default function DropOffWaterfall({ analytics, initialType }: { analytics: DriveAnalytics; initialType?: SourceType }) {
  const dark = useIsDark();
  const reduced = usePrefersReducedMotion();
  const prefix = usePatternPrefix();
  const [type, setType] = useState<SourceType>(() => initialType ?? defaultType(analytics));
  const v = waterfallView(analytics, type, { prefersReducedMotion: reduced });
  const data: Datum[] = v.bars.map((b) => ({ ...b, lostText: b.lost > 0 ? `${b.lost} lost` : "" }));
  const allEmpty = SOURCE_TYPES.every((t) => waterfallView(analytics, t).empty);
  return (
    <ChartFrame
      title="Where people drop off"
      subtitle={`${TYPE_LABEL[type]}: for each step, the people who continued (left, unfilled) and the people lost (textured).`}
      table={v.table} empty={v.empty} aria={v.aria}
      controls={!allEmpty && <Segmented<SourceType> label="Drive type" options={TYPES} value={type} onChange={setType} />}
      note={v.untracked ? <Note>{UNTRACKED_NOTE}</Note> : null}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 4 }} barCategoryGap="22%">
          {typePatternDefs(prefix, dark, [type])}
          <CartesianGrid {...gridProps(dark)} horizontal={false} vertical />
          <XAxis type="number" tick={axisTick(dark)} axisLine={false} tickLine={false} allowDecimals={false} />
          <YAxis type="category" dataKey="label" width={128} interval={0} tick={axisTick(dark)} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={TOOLTIP_CURSOR}
            isAnimationActive={v.motion.animate}
            content={({ active, payload }) => {
              const b = payload?.[0]?.payload as Datum | undefined;
              if (!active || !b) return null;
              return <TooltipCard title={b.label} lines={[
                { label: "Started", value: String(b.base + b.lost) }, { label: "Continued", value: String(b.base) },
                { label: "Lost", value: String(b.lost) }, { label: "Reasons", value: b.reasons || "–" },
              ]} />;
            }}
          />
          <Bar dataKey="base" stackId="w" name="Continued" fill="transparent" stroke={dark ? "#475569" : "#cbd5e1"} strokeDasharray="3 3"
            isAnimationActive={v.motion.animate} animationDuration={v.motion.durationMs} />
          <Bar dataKey="lost" stackId="w" name="Lost" fill={patternFill(prefix, type)} stroke={seriesColor(type, dark)}
            isAnimationActive={v.motion.animate} animationDuration={v.motion.durationMs}>
            <LabelList dataKey="lostText" position="right" fill={dark ? "#e2e8f0" : "#1e293b"} fontSize={11} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
