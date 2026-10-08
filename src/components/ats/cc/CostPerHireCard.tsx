import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { IndianRupee } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, V, fmt, tooltipStyle } from "@/components/ats/overview/viz";
import { useBmi } from "@/hooks/useAtsCommandCenter";
import { Card, ExportButton, HeatTable, downloadCsv } from "./cc-kit";
import { blendedCostPerHire, channelCosts, hasSpend } from "./bmi-helpers";

const tick = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const inr = (n: number | null) => (n == null ? "–" : `₹${Math.round(n).toLocaleString("en-IN")}`);

/** What each sourcing channel costs per candidate, and direct spend per accepted offer. Spend comes from the benchmark board (portal allocation, consultant fees, referral bonuses). */
export function CostPerHireCard({ i = 0, className = "" }: { i?: number; className?: string }) {
  const q = useBmi(6);
  const ch = channelCosts(q.data), blended = blendedCostPerHire(q.data);
  const spent = hasSpend(ch);
  return (
    <Card i={i} className={className} title="Cost per hire by channel" hint="Direct spend over the last six full months; walk-ins carry no direct spend" icon={<IndianRupee className="h-4 w-4" />}
      right={ch.length > 0 && <ExportButton onClick={() => downloadCsv("ats-cost-by-channel.csv", ["Channel", "Spend", "Candidates sourced", "Cost per candidate"], ch.map((c) => [c.label, c.spend, c.sourced, c.costPerSourced]))} />}>
      {q.isLoading ? <Skeleton className="h-64" /> : q.isError ? <Empty text="The benchmark board is not available for your role" /> : !spent ? <Empty text="No direct spend is recorded for these months" /> : (
        <div className="grid gap-4 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <HeatTable rows={ch.map((c) => ({ ...c, name: c.label }))} max={6}
              cols={[
                { key: "spend", label: "Spend", get: (r) => r.spend ?? 0, format: (n) => inr(n), invert: true, hue: "red" },
                { key: "sourced", label: "Sourced", get: (r) => r.sourced },
                { key: "cps", label: "Per candidate", get: (r) => r.costPerSourced ?? 0, format: (n) => (n ? inr(n) : "–"), invert: true, hue: "red" },
              ]} />
          </div>
          <div className="lg:col-span-5">
            <div className="mb-1 text-xs font-medium text-muted-foreground">Direct spend per accepted offer</div>
            {blended.some((b) => b.costPerHire != null) ? (
              <ResponsiveContainer width="100%" height={190}>
                <LineChart data={blended} margin={{ left: -6, right: 8 }}>
                  <CartesianGrid stroke={V.grid} strokeDasharray="3 4" vertical={false} />
                  <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} /><YAxis tick={tick} axisLine={false} tickLine={false} tickFormatter={(v: number) => `₹${fmt(v)}`} />
                  <Tooltip {...tooltipStyle} formatter={(v: number) => [inr(v), "Per accepted offer"]} />
                  <Line type="monotone" dataKey="costPerHire" stroke={V.violet} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            ) : <Empty text="No accepted offers to divide the spend by" />}
          </div>
        </div>
      )}
    </Card>
  );
}
