/** Three-series funnel: one textured bar per drive type at each stage, value labels, conversions written under each stage name. */
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DriveAnalytics, SourceType } from "../driveCommandTypes";
import { SOURCE_TYPES, TYPE_LABEL, pctText } from "../driveCommandModel";
import { seriesColor, useIsDark, usePrefersReducedMotion } from "../chartTheme";
import ChartFrame, { Note, TOOLTIP_CURSOR, TooltipCard, axisTick, gridProps } from "./ChartFrame";
import { SeriesLegend, patternFill, typePatternDefs, usePatternPrefix } from "./TypePatterns";
import { UNTRACKED_NOTE, funnelView, presentTypes, type FunnelRow } from "./summaryView";

type Datum = { label: string; conv: string; row: FunnelRow } & Partial<Record<SourceType, number | null>> & Record<string, unknown>;

function StageTick({ x, y, payload, rows, dark }: { x?: number; y?: number; payload?: { value: string }; rows: FunnelRow[]; dark: boolean }) {
  const row = rows.find((r) => r.label === payload?.value);
  const first = rows[0]?.label === payload?.value;
  const ink = dark ? "#e2e8f0" : "#1e293b";
  const muted = dark ? "#94a3b8" : "#475569";
  return (
    <g transform={`translate(${x ?? 0},${y ?? 0})`}>
      <text textAnchor="end" fontSize={11}>
        <tspan x={-6} dy={first ? 4 : -2} fill={ink} fontWeight={600}>{payload?.value ?? ""}</tspan>
        {!first && row && <tspan x={-6} dy={13} fill={muted}>{row.convText}</tspan>}
      </text>
    </g>
  );
}

export default function FunnelCompare({ analytics }: { analytics: DriveAnalytics }) {
  const dark = useIsDark();
  const reduced = usePrefersReducedMotion();
  const prefix = usePatternPrefix();
  const v = funnelView(analytics, { prefersReducedMotion: reduced });
  const data: Datum[] = v.rows.map((r, i) => {
    const d: Datum = { label: r.label, conv: r.convText, row: r };
    // Untracked (null) stages draw a zero-length bar (recharts turns null into a NaN width); the label still says "–".
    for (const t of SOURCE_TYPES) { d[t] = r.values[t] ?? 0; d[`lbl_${t}`] = v.labels[i][t]; }
    return d;
  });
  return (
    <ChartFrame
      title="Funnel by drive type"
      subtitle="People at each stage. Under each stage: conversion from the stage before, as Live Meta / Old Meta data / Hiring Engine."
      table={v.table} empty={v.empty} aria={v.aria} size="tall"
      note={<div className="space-y-1"><SeriesLegend dark={dark} present={presentTypes(analytics)} />{v.untracked && <Note>{UNTRACKED_NOTE}</Note>}</div>}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 104, bottom: 4, left: 4 }} barCategoryGap="16%" barGap={1}>
          {typePatternDefs(prefix, dark)}
          <CartesianGrid {...gridProps(dark)} horizontal={false} vertical />
          <XAxis type="number" tick={axisTick(dark)} axisLine={false} tickLine={false} allowDecimals={false} />
          <YAxis type="category" dataKey="label" width={112} interval={0} axisLine={false} tickLine={false} tick={<StageTick rows={v.rows} dark={dark} />} />
          <Tooltip
            cursor={TOOLTIP_CURSOR}
            isAnimationActive={v.motion.animate}
            content={({ active, payload }) => {
              const row = (payload?.[0]?.payload as Datum | undefined)?.row;
              if (!active || !row) return null;
              return <TooltipCard title={row.label} lines={SOURCE_TYPES.map((t) => ({ label: TYPE_LABEL[t], value: row.conversion[t] === null ? row.text[t] : `${row.text[t]} (${pctText(row.conversion[t])})` }))} />;
            }}
          />
          {SOURCE_TYPES.map((t) => (
            <Bar key={t} dataKey={t} name={TYPE_LABEL[t]} fill={patternFill(prefix, t)} stroke={seriesColor(t, dark)} strokeWidth={1}
              isAnimationActive={v.motion.animate} animationDuration={v.motion.durationMs}>
              <LabelList dataKey={`lbl_${t}`} position="right" fill={dark ? "#e2e8f0" : "#1e293b"} fontSize={11} />
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
