import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtMonth, fmtPct } from "./format";
import type { BranchScore, RuleId, RuleSummary, TrendPoint } from "./types";

const C1 = "hsl(var(--chart-1))";
const C3 = "hsl(var(--chart-3))";
const C5 = "hsl(var(--chart-5))";
const GRID = "hsl(var(--border))";
const TICK = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };

/** Compliance % line over violation-count bars; clicking a month selects it. */
export function TrendChart({ data, selected, onSelect }: { data: TrendPoint[]; selected: string; onSelect: (month: string) => void }) {
  const rows = data.map((d) => ({ ...d, label: fmtMonth(d.month) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} onClick={(e) => { const m = (e as { activePayload?: Array<{ payload: TrendPoint }> } | null)?.activePayload?.[0]?.payload.month; if (m) onSelect(m); }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={TICK} tickLine={false} />
        <YAxis yAxisId="pct" domain={[0, 100]} tick={TICK} tickLine={false} width={36} tickFormatter={(v) => `${v}%`} />
        <YAxis yAxisId="n" orientation="right" allowDecimals={false} tick={TICK} tickLine={false} width={36} />
        <Tooltip formatter={(v, name) => (name === "Compliance" ? fmtPct(v as number | null) : (v as number))} />
        <Bar yAxisId="n" dataKey="violations" name="Violations" radius={[3, 3, 0, 0]} isAnimationActive={false} className="cursor-pointer">
          {rows.map((r) => <Cell key={r.month} fill={C5} fillOpacity={r.month === selected ? 1 : 0.45} />)}
        </Bar>
        <Line yAxisId="pct" dataKey="compliancePct" name="Compliance" stroke={C1} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function RuleBars({ rules, onSelect }: { rules: RuleSummary[]; onSelect: (id: RuleId) => void }) {
  const rows = rules.map((r) => ({ ...r, label: r.ruleName }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={TICK} tickLine={false} />
        <YAxis type="category" dataKey="label" width={150} tick={TICK} tickLine={false} />
        <Tooltip formatter={(v) => [v as number, "Violations"]} />
        <Bar dataKey="violationCount" radius={[0, 3, 3, 0]} isAnimationActive={false} className="cursor-pointer" onClick={(d) => onSelect((d as unknown as RuleSummary).ruleId)} label={{ position: "right", fontSize: 11 }}>
          {rows.map((r) => <Cell key={r.ruleId} fill={r.severity === "high" ? C5 : C3} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function BranchBars({ branches, onSelect }: { branches: BranchScore[]; onSelect: (id: string) => void }) {
  const rows = branches.slice(0, 10).map((b) => ({ ...b, score: b.score ?? 0, label: b.branchName }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 32, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" domain={[0, 100]} tick={TICK} tickLine={false} tickFormatter={(v) => `${v}%`} />
        <YAxis type="category" dataKey="label" width={110} tick={TICK} tickLine={false} />
        <Tooltip formatter={(v) => [`${v}%`, "Compliance"]} />
        <Bar dataKey="score" radius={[0, 3, 3, 0]} isAnimationActive={false} className="cursor-pointer" onClick={(d) => onSelect((d as unknown as BranchScore).branchId)} label={{ position: "right", fontSize: 11, formatter: (v: number) => `${v}%` }}>
          {rows.map((r) => <Cell key={r.branchId} fill={r.score >= 90 ? C1 : r.score >= 75 ? C3 : C5} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
