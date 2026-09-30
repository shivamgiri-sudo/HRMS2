import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { LogOut, Percent, Timer, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { KpiTile } from "@/components/wfm/console/KpiTile";
import { ChartCard } from "@/components/wfm/console/ChartCard";
import { FilterNote } from "@/components/wfm/console/FilterNote";
import { DataTable, type Column } from "./DataTable";
import { AttritionBucketDrawer } from "./LatenessDrawers";
import { TICK, TIP, chartColor } from "./shared";
import { HEAVY_QUERY_OPTIONS, HEAVY_QUERY_TIMEOUT_MS } from "../heavyQuery";
import { attritionRate, bucketAonRows, fmtDate, fmtNum, fmtPct } from "./trendsCalc";

type Row = Record<string, unknown>;

/**
 * Attrition by age-on-network. Headcount and exits come from the existing aon-bucket-* reports
 * (their RELIABLE_POPULATION and possible-tenure rules stay in one place). The rate uses that
 * report's own stated denominator — exits / (active headcount + exits) — not exits over today's
 * active headcount, which left the leavers out of their own denominator and overstated the rate.
 */
export default function AttritionSection({ qs, from, to }: { qs: string; from: string; to: string }) {
  const [bucket, setBucket] = useState<string | null>(null);
  // These reports are not LOB-aware; the drawer must count the same population as the chart.
  const scoped = useMemo(() => { const p = new URLSearchParams(qs); p.delete("lobId"); return p; }, [qs]);
  const reportQs = useMemo(() => { const p = new URLSearchParams(scoped); p.set("limit", "5000"); p.set("offset", "0"); return p.toString(); }, [scoped]);
  const drawerQs = scoped.toString();

  const hc = useQuery({ queryKey: ["rcc-trends", "aon-headcount", reportQs], queryFn: async ({ signal }) => (await hrmsApi.get<{ data: Row[] }>(`/api/reports/suite/aon-bucket-headcount?${reportQs}`, HEAVY_QUERY_TIMEOUT_MS, signal)).data ?? [], ...HEAVY_QUERY_OPTIONS });
  const ex = useQuery({ queryKey: ["rcc-trends", "aon-exits", reportQs], queryFn: async ({ signal }) => (await hrmsApi.get<{ data: Row[] }>(`/api/reports/suite/aon-bucket-attrition?${reportQs}`, HEAVY_QUERY_TIMEOUT_MS, signal)).data ?? [], ...HEAVY_QUERY_OPTIONS });

  const buckets = useMemo(() => bucketAonRows(hc.data ?? [], ex.data ?? []), [hc.data, ex.data]);
  const totalHc = buckets.reduce((a, r) => a + r.headcount, 0);
  const totalEx = buckets.reduce((a, r) => a + r.exits, 0);
  const rate = attritionRate(totalEx, totalHc);
  const early = buckets.filter((b) => b.bucket === "0-30" || b.bucket === "31-60" || b.bucket === "61-90").reduce((a, r) => a + r.exits, 0);
  const earlyShare = totalEx > 0 ? Math.round((early / totalEx) * 1000) / 10 : null;
  const loading = hc.isLoading || ex.isLoading;
  const error = hc.error ?? ex.error;
  const empty = !loading && !error && totalHc + totalEx === 0;
  const worst = [...buckets].sort((a, b) => b.exits - a.exits)[0];

  const cols: Column<(typeof buckets)[number]>[] = [
    { key: "b", header: "Age on network (days)", sortValue: (r) => r.bucket, render: (r) => <span className="font-medium">{r.bucket}</span> },
    { key: "h", header: "Active headcount", align: "right", sortValue: (r) => r.headcount, render: (r) => fmtNum(r.headcount) },
    { key: "x", header: "Exits in range", align: "right", sortValue: (r) => r.exits, render: (r) => fmtNum(r.exits) },
    { key: "r", header: "Attrition %", align: "right", sortValue: (r) => r.ratePct, render: (r) => fmtPct(r.ratePct) },
  ];

  return (
    <div className="space-y-4">
      <FilterNote>LOB filter not applied — attrition reports are branch/process only</FilterNote>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Active headcount" icon={Users} value={loading ? "…" : fmtNum(totalHc)} sub="As of today" onClick={worst ? () => setBucket(worst.bucket) : undefined} />
        <KpiTile label="Exits in range" icon={LogOut} value={loading ? "…" : fmtNum(totalEx)} tone={totalEx > 0 ? "amber" : "green"} sub={`${fmtDate(from)} to ${fmtDate(to)}`} onClick={worst ? () => setBucket(worst.bucket) : undefined} />
        <KpiTile label="Attrition rate" icon={Percent} value={loading ? "…" : fmtPct(rate)} tone={rate != null && rate > 10 ? "red" : "neutral"} sub="Exits / (headcount + exits), not annualised" onClick={worst ? () => setBucket(worst.bucket) : undefined} />
        <KpiTile label="Early exits (under 90 days)" icon={Timer} value={loading ? "…" : fmtPct(earlyShare)} tone={earlyShare != null && earlyShare > 50 ? "red" : "neutral"} progress={earlyShare ?? undefined} sub="Share of exits" onClick={() => setBucket("0-30")} />
      </div>

      <ChartCard title="Headcount and exits by age on network" loading={loading} error={error} onRetry={() => { void hc.refetch(); void ex.refetch(); }} empty={empty} height={280}
        subtitle="AON = days since joining. Process is recorded on few exit records, so process-filtered exits are directional. Select a bucket to open it.">
        <div role="img" aria-label="Chart of headcount, exits and attrition rate by age-on-network bucket" className="h-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={buckets} margin={{ top: 8, right: 8, left: -8, bottom: 0 }} onClick={(e) => { const l = (e as { activeLabel?: string } | null)?.activeLabel; if (l) setBucket(String(l)); }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="bucket" tick={TICK} tickLine={false} axisLine={false} />
              <YAxis yAxisId="n" tick={TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => fmtNum(Number(v))} />
              <YAxis yAxisId="p" orientation="right" tick={TICK} tickLine={false} axisLine={false} width={40} tickFormatter={(v) => `${v}%`} />
              <Tooltip contentStyle={TIP} formatter={(v: number, n: string) => (n === "Attrition %" ? fmtPct(v) : fmtNum(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="n" dataKey="headcount" name="Active headcount" fill={chartColor(1)} radius={[3, 3, 0, 0]} isAnimationActive={false} className="cursor-pointer" />
              <Bar yAxisId="n" dataKey="exits" name="Exits" fill={chartColor(8)} radius={[3, 3, 0, 0]} isAnimationActive={false} className="cursor-pointer" />
              <Line yAxisId="p" type="monotone" dataKey="ratePct" name="Attrition %" stroke={chartColor(4)} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard title="Buckets" loading={loading} error={error} empty={empty} height={200} subtitle="Open a bucket for the exited employees and their monthly trend.">
        <DataTable rows={buckets} columns={cols} rowKey={(r) => r.bucket} rowLabel={(r) => `${r.bucket} days`} onRowClick={(r) => setBucket(r.bucket)} ariaLabel="Attrition by age on network" maxHeight={180} />
      </ChartCard>

      <AttritionBucketDrawer bucket={bucket} qs={drawerQs} onClose={() => setBucket(null)} />
    </div>
  );
}
