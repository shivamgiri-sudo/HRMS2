import { Bar, BarChart, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMetric, toneFor, type OpsMetricDef, type OpsRow } from "./opsTypes";

const TONE_FILL = { good: "#059669", warn: "#d97706", bad: "#e11d48", neutral: "#2563eb" } as const;

interface Props {
  rows: OpsRow[];
  def: OpsMetricDef | undefined;
  orgValue: number | null | undefined;
  noun: string;
  onPick: (row: OpsRow) => void;
}

/** Ranked bars of the sorted metric across the current groups; click a bar to drill in. The dashed line is the scope total. */
export function OpsRankChart({ rows, def, orgValue, noun, onPick }: Props) {
  if (!def) return null;
  const data = rows
    .filter((r) => r.m[def.id] !== null && r.m[def.id] !== undefined)
    .slice(0, 12)
    .map((r) => ({ row: r, name: r.name.length > 26 ? `${r.name.slice(0, 25)}…` : r.name, value: r.m[def.id] as number }));
  if (data.length < 2) return null;
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="flex flex-wrap items-baseline justify-between gap-2 text-sm font-semibold text-foreground">
          <span>{def.label} by {noun.toLowerCase()}</span>
          <span className="text-xs font-normal text-muted-foreground">click a bar to drill in{orgValue !== null && orgValue !== undefined ? ` · dashed line = scope total ${formatMetric(orgValue, def.unit)}` : ""}</span>
        </CardTitle>
      </CardHeader>
      <CardContent style={{ height: Math.max(180, data.length * 30 + 30) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 56, top: 4, bottom: 4 }}>
            <XAxis type="number" hide domain={[0, "dataMax"]} />
            <YAxis type="category" dataKey="name" width={150} fontSize={11} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: "hsl(var(--muted) / 0.5)" }} formatter={(v: number) => formatMetric(v, def.unit)} labelFormatter={(l: string) => l} />
            {orgValue !== null && orgValue !== undefined && <ReferenceLine x={orgValue} stroke="hsl(var(--foreground) / 0.5)" strokeDasharray="4 3" />}
            <Bar dataKey="value" radius={[0, 4, 4, 0]} cursor="pointer" onClick={(d: { row: OpsRow }) => onPick(d.row)} maxBarSize={20}>
              {data.map((d) => <Cell key={d.row.id} fill={TONE_FILL[toneFor(def, d.value)]} />)}
              <LabelList dataKey="value" position="right" fontSize={11} formatter={(v: number) => formatMetric(v, def.unit)} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
