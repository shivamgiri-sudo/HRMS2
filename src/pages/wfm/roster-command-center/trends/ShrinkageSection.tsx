import { useMemo, useState } from "react";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarClock, ClipboardCheck, TrendingDown, UserX, Users } from "lucide-react";
import { KpiTile } from "@/components/wfm/console/KpiTile";
import { ChartCard } from "@/components/wfm/console/ChartCard";
import { FilterNote } from "@/components/wfm/console/FilterNote";
import { DataTable, type Column } from "./DataTable";
import { DayDrawer, MemberDrawer } from "./ShrinkageDrawers";
import { ShrinkPill, TICK, TIP, chartColor } from "./shared";
import { useTrends } from "./useTrendsQuery";
import { deltaOf, fmtDate, fmtDayMonth, fmtNum, fmtPct, shrinkTone, type Tone } from "./trendsCalc";
import type { DayPoint, ShrinkageTrend } from "./trendsTypes";

const KPI_TONE: Record<Tone, "green" | "amber" | "red" | "neutral"> = { green: "green", amber: "amber", red: "red", neutral: "neutral" };

const cols: Column<DayPoint>[] = [
  { key: "date", header: "Date", sortValue: (r) => r.date, render: (r) => fmtDate(r.date) },
  { key: "sched", header: "Scheduled", align: "right", sortValue: (r) => r.scheduled, render: (r) => (r.hasData ? fmtNum(r.scheduled) : "—") },
  { key: "present", header: "Present", align: "right", sortValue: (r) => r.present, render: (r) => (r.hasData ? fmtNum(r.present) : "—") },
  { key: "absent", header: "Absent", align: "right", sortValue: (r) => r.absent, render: (r) => (r.hasData ? fmtNum(r.absent) : "—") },
  { key: "leave", header: "On leave", align: "right", sortValue: (r) => r.onLeave, render: (r) => (r.hasData ? fmtNum(r.onLeave) : "—") },
  { key: "late", header: "Late", align: "right", sortValue: (r) => r.late, render: (r) => (r.hasData ? fmtNum(r.late) : "—") },
  { key: "att", header: "Attendance", align: "right", sortValue: (r) => (r.hasData ? r.attendancePct : null), render: (r) => (r.hasData ? fmtPct(r.attendancePct) : "No data") },
  { key: "unpl", header: "Unplanned", align: "right", sortValue: (r) => (r.hasData ? r.unplannedPct : null), render: (r) => (r.hasData ? fmtPct(r.unplannedPct) : "—") },
  { key: "shrink", header: "Shrinkage", align: "right", sortValue: (r) => (r.hasData ? r.shrinkagePct : null), render: (r) => (r.hasData ? <ShrinkPill pct={r.shrinkagePct} /> : "—") },
];

export default function ShrinkageSection({ qs }: { qs: string }) {
  const q = useTrends<ShrinkageTrend>("shrinkage", "shrinkage", qs);
  const [day, setDay] = useState<string | null>(null);
  const [member, setMember] = useState<string | null>(null);
  const d = q.data;

  const withData = useMemo(() => (d?.days ?? []).filter((x) => x.hasData), [d]);
  const latest = withData[withData.length - 1];
  const spark = (pick: (x: DayPoint) => number) => withData.map(pick);
  const s = d?.summary;
  const p = d?.previous ?? null;
  const chartData = useMemo(
    () => (d?.days ?? []).map((x) => ({
      date: x.date, scheduled: x.hasData ? x.scheduled : null, present: x.hasData ? x.present : null,
      shrinkage: x.hasData ? x.shrinkagePct : null, planned: x.hasData ? x.plannedPct : null, unplanned: x.hasData ? x.unplannedPct : null,
    })),
    [d],
  );
  const openLatest = () => latest && setDay(latest.date);
  const empty = !q.isLoading && (!d || withData.length === 0);

  return (
    <div className="space-y-4">
      {d?.clamped && <FilterNote>Range capped to the most recent 92 days</FilterNote>}
      {d?.futureOnly && <FilterNote>Selected range is in the future — no attendance yet</FilterNote>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiTile label="Shrinkage" icon={TrendingDown} value={s?.scheduled ? fmtPct(s.shrinkagePct) : "—"} tone={KPI_TONE[shrinkTone(s?.shrinkagePct)]}
          delta={s?.scheduled && p ? deltaOf(s.shrinkagePct, p.shrinkagePct) : undefined} deltaBad="up" spark={spark((x) => x.shrinkagePct)}
          progress={s?.scheduled ? Math.min(100, (s.shrinkagePct / 40) * 100) : undefined} sub="(absent + leave) / scheduled, vs previous period (pts)" onClick={latest ? openLatest : undefined} />
        <KpiTile label="Unplanned" icon={UserX} value={s?.scheduled ? fmtPct(s.unplannedPct) : "—"} tone="red"
          delta={s?.scheduled && p ? deltaOf(s.unplannedPct, p.unplannedPct) : undefined} deltaBad="up" spark={spark((x) => x.unplannedPct)} sub="No punch, no approved leave" onClick={latest ? openLatest : undefined} />
        <KpiTile label="Planned (leave)" icon={CalendarClock} value={s?.scheduled ? fmtPct(s.plannedPct) : "—"} tone="blue"
          delta={s?.scheduled && p ? deltaOf(s.plannedPct, p.plannedPct) : undefined} spark={spark((x) => x.plannedPct)} sub="Approved leave / scheduled" onClick={latest ? openLatest : undefined} />
        <KpiTile label="Attendance" icon={Users} value={s?.scheduled ? fmtPct(s.attendancePct) : "—"} tone="green"
          delta={s?.scheduled && p ? deltaOf(s.attendancePct, p.attendancePct) : undefined} deltaBad="down" spark={spark((x) => x.attendancePct)} progress={s?.scheduled ? s.attendancePct : undefined}
          sub={s?.scheduled ? `${fmtNum(s.present)} of ${fmtNum(s.scheduled)} shifts` : "No data"} onClick={latest ? openLatest : undefined} />
        <KpiTile label="Late arrivals" icon={ClipboardCheck} value={s?.scheduled ? fmtNum(s.late) : "—"} tone={s && s.late > 0 ? "amber" : "neutral"}
          spark={spark((x) => x.late)} sub={s?.scheduled ? `${fmtPct(s.lateRatePct)} of present` : "No data"} onClick={latest ? openLatest : undefined} />
      </div>

      <ChartCard title="Scheduled vs present and shrinkage" loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={empty} height={300}
        emptyLabel="No roster and attendance data in this range/scope — try a wider range"
        subtitle={`Headcount-days (left) against shrinkage % (right), ${fmtDate(d?.from)} to ${fmtDate(d?.effectiveTo)}. Days with no data are gaps, not 0%. Select a point to open that day.`}>
        <div role="img" aria-label="Line chart of scheduled, present and shrinkage percent by day" className="h-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
              onClick={(e) => { const lbl = (e as { activeLabel?: string } | null)?.activeLabel; if (lbl) setDay(String(lbl)); }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false} tickFormatter={fmtDayMonth} minTickGap={16} />
              <YAxis yAxisId="hc" tick={TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => fmtNum(Number(v))} />
              <YAxis yAxisId="pct" orientation="right" tick={TICK} tickLine={false} axisLine={false} width={40} tickFormatter={(v) => `${v}%`} />
              <Tooltip contentStyle={TIP} labelFormatter={fmtDate} formatter={(v: number, n: string) => (n === "Shrinkage %" ? fmtPct(v) : fmtNum(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area yAxisId="hc" type="monotone" dataKey="scheduled" name="Scheduled" stroke={chartColor(1)} fill={chartColor(1)} fillOpacity={0.1} strokeWidth={2} connectNulls={false} isAnimationActive={false} />
              <Area yAxisId="hc" type="monotone" dataKey="present" name="Present" stroke={chartColor(2)} fill={chartColor(2)} fillOpacity={0.12} strokeWidth={2} connectNulls={false} isAnimationActive={false} />
              <Line yAxisId="pct" type="monotone" dataKey="shrinkage" name="Shrinkage %" stroke={chartColor(8)} strokeWidth={2} strokeDasharray="4 3" dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard title="Planned vs unplanned shrinkage by day" loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={empty} height={220}
        subtitle="Approved leave (planned) and no-shows (unplanned) as a share of scheduled shifts. A day with approved leave in attendance but no roster LEAVE row counts as planned.">
        <div role="img" aria-label="Stacked bar chart of planned and unplanned shrinkage percent by day" className="h-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
              onClick={(e) => { const lbl = (e as { activeLabel?: string } | null)?.activeLabel; if (lbl) setDay(String(lbl)); }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false} tickFormatter={fmtDayMonth} minTickGap={16} />
              <YAxis tick={TICK} tickLine={false} axisLine={false} width={40} tickFormatter={(v) => `${v}%`} />
              <Tooltip contentStyle={TIP} labelFormatter={fmtDate} formatter={(v: number) => fmtPct(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="unplanned" name="Unplanned" stackId="s" fill={chartColor(8)} isAnimationActive={false} className="cursor-pointer" />
              <Bar dataKey="planned" name="Planned (leave)" stackId="s" fill={chartColor(5)} isAnimationActive={false} className="cursor-pointer" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard title="Daily breakdown" loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={empty} height={360}
        subtitle="Sortable. Open a row for the day's process/branch split, absent employees and publish state.">
        <DataTable rows={[...(d?.days ?? [])].reverse()} columns={cols} rowKey={(r) => r.date} rowLabel={(r) => fmtDate(r.date)}
          onRowClick={(r) => r.hasData && setDay(r.date)} ariaLabel="Daily shrinkage" maxHeight={330} defaultSort={{ key: "date", dir: "desc" }} />
      </ChartCard>

      <DayDrawer date={day} qs={qs} onClose={() => setDay(null)} onOpenMember={(id) => { setMember(id); setDay(null); }} />
      <MemberDrawer employeeId={member} qs={qs} onClose={() => setMember(null)} />
    </div>
  );
}
