import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Scale } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, V, fmt, tooltipStyle } from "@/components/ats/overview/viz";
import { useBmi } from "@/hooks/useAtsCommandCenter";
import { Card, ExportButton, InsightList, downloadCsv } from "./cc-kit";
import { demandFindings, demandSupply, hasDemand } from "./bmi-helpers";

const tick = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };

/** Hires asked for against offers accepted, by month. Organisation-wide: the benchmark board is keyed by branch id, not the page's branch name. */
export function DemandSupplyCard({ i = 0, className = "" }: { i?: number; className?: string }) {
  const q = useBmi(6);
  const rows = demandSupply(q.data);
  const findings = demandFindings(rows);
  return (
    <Card i={i} className={className} title="Demand vs supply" hint="Hires requested against offers accepted, last six full months" icon={<Scale className="h-4 w-4" />}
      right={rows.length > 0 && <ExportButton onClick={() => downloadCsv("ats-demand-vs-supply.csv", ["Month", "Requested", "Selected by ops", "Offers accepted", "Filled %", "Shortfall"], rows.map((r) => [r.label, r.demand, r.selected, r.accepted, r.fillRate, r.gap]))} />}>
      {q.isLoading ? <Skeleton className="h-64" /> : q.isError ? <Empty text="The benchmark board is not available for your role" /> : !hasDemand(rows) ? <Empty text="No hiring demand has been recorded for these months" /> : (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={rows} margin={{ left: -14, right: 8 }}>
                <CartesianGrid stroke={V.grid} strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
                <YAxis yAxisId="n" tick={tick} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis yAxisId="p" orientation="right" domain={[0, 100]} tick={tick} axisLine={false} tickLine={false} unit="%" />
                <Tooltip {...tooltipStyle} cursor={{ fill: V.track }} formatter={(v: number, n: string) => [n === "Filled %" ? `${v}%` : fmt(v), n]} />
                <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                <Bar yAxisId="n" dataKey="demand" name="Requested" fill={V.violet} fillOpacity={0.35} radius={[5, 5, 0, 0]} />
                <Bar yAxisId="n" dataKey="accepted" name="Offers accepted" fill={V.aqua} radius={[5, 5, 0, 0]} />
                <Line yAxisId="p" type="monotone" dataKey="fillRate" name="Filled %" stroke={V.orange} strokeWidth={2} dot={{ r: 3 }} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="lg:col-span-2"><InsightList items={findings} empty="Not enough accepted offers to compare yet" /></div>
        </div>
      )}
    </Card>
  );
}
