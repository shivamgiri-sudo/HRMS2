/** Recharts bundle for the Interventions panel — loaded lazily (default export). */
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";
import { OWNER_LABEL, TIERS, TIER_LABEL, type Owner, type Summary, type Tier } from "./calc";

const TIER_FILL: Record<Tier, string> = {
  CRITICAL: "hsl(var(--chart-5))", HIGH: "hsl(var(--chart-3))", MEDIUM: "hsl(var(--chart-1))", LOW: "hsl(var(--chart-2))",
};
const axis = { fontSize: 11, fill: "hsl(var(--muted-foreground))" } as const;

export interface ChartsProps {
  summary: Summary;
  onWeek: (weekStart: string) => void;
  onTier: (t: Tier) => void;
  onOwner: (o: Owner) => void;
  part: "trend" | "tier" | "owner";
}

export default function InterventionCharts({ summary, onWeek, onTier, onOwner, part }: ChartsProps) {
  if (part === "trend") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={summary.trend} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="label" tick={axis} tickLine={false} />
          <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
          <Tooltip formatter={(v: number, n: string) => [v, n]} labelFormatter={(l) => `Week of ${l}`} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="generated" name="Generated" fill="hsl(var(--chart-1))" radius={[3, 3, 0, 0]} cursor="pointer"
            onClick={(d: { week?: string }) => d?.week && onWeek(d.week)} isAnimationActive={false} />
          <Bar dataKey="actioned" name="Actioned" fill="hsl(var(--chart-2))" radius={[3, 3, 0, 0]} cursor="pointer"
            onClick={(d: { week?: string }) => d?.week && onWeek(d.week)} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    );
  }
  if (part === "tier") {
    const data = TIERS.map((t) => ({ tier: t, label: TIER_LABEL[t], count: summary.byTier[t] }));
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={axis} tickLine={false} />
          <YAxis type="category" dataKey="label" tick={axis} tickLine={false} width={64} />
          <Tooltip />
          <Bar dataKey="count" name="Open cases" radius={[0, 3, 3, 0]} cursor="pointer" isAnimationActive={false}
            label={{ position: "right", fontSize: 11 }} onClick={(d: { tier?: Tier }) => d?.tier && onTier(d.tier)}>
            {data.map((d) => <Cell key={d.tier} fill={TIER_FILL[d.tier]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }
  const owners = (Object.keys(OWNER_LABEL) as Owner[]).map((o) => ({ owner: o, label: OWNER_LABEL[o], count: summary.byOwner[o] }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={owners} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={axis} tickLine={false} />
        <YAxis type="category" dataKey="label" tick={axis} tickLine={false} width={84} />
        <Tooltip />
        <Bar dataKey="count" name="Open cases involving owner" fill="hsl(var(--chart-4))" radius={[0, 3, 3, 0]} cursor="pointer"
          isAnimationActive={false} label={{ position: "right", fontSize: 11 }} onClick={(d: { owner?: Owner }) => d?.owner && onOwner(d.owner)} />
      </BarChart>
    </ResponsiveContainer>
  );
}
