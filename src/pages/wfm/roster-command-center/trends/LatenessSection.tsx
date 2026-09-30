import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlarmClock, CalendarClock, Repeat, Timer, Users } from "lucide-react";
import { KpiTile } from "@/components/wfm/console/KpiTile";
import { ChartCard } from "@/components/wfm/console/ChartCard";
import { DataTable, type Column } from "./DataTable";
import { LateDayDrawer, LateEmployeeDrawer } from "./LatenessDrawers";
import { ProcessDrawer } from "./ShrinkageDrawers";
import { Caveat, TICK, TIP, chartColor } from "./shared";
import { useTrends } from "./useTrendsQuery";
import { fmtDate, fmtDayMonth, fmtNum, fmtPct } from "./trendsCalc";
import type { LatenessOverview, ProcessRow } from "./trendsTypes";

type H = LatenessOverview["habitual"][number];

const cols: Column<H>[] = [
  { key: "e", header: "Employee", sortValue: (r) => r.employeeName, render: (r) => <span className="font-medium">{r.employeeName} <span className="font-normal text-slate-500">({r.employeeCode})</span></span> },
  { key: "b", header: "Branch", sortValue: (r) => r.branchName ?? "", render: (r) => r.branchName ?? "—" },
  { key: "p", header: "Process", sortValue: (r) => r.processName ?? "", render: (r) => r.processName ?? "—" },
  { key: "c", header: "Late arrivals", align: "right", sortValue: (r) => r.events, render: (r) => <span className="font-semibold">{fmtNum(r.events)}</span> },
  { key: "a", header: "Avg beyond grace", align: "right", sortValue: (r) => r.avgNetMinutes, render: (r) => `${r.avgNetMinutes} min` },
  { key: "m", header: "Worst", align: "right", sortValue: (r) => r.maxMinutes, render: (r) => `${r.maxMinutes} min` },
];

export default function LatenessSection({ qs }: { qs: string }) {
  const q = useTrends<LatenessOverview>("lateness", "lateness", qs);
  const [day, setDay] = useState<string | null>(null);
  const [emp, setEmp] = useState<string | null>(null);
  const [proc, setProc] = useState<ProcessRow | null>(null);
  const d = q.data;
  const t = d?.totals;
  const empty = !q.isLoading && (!d || d.totals.events === 0);
  const peakDay = useMemo(() => (d?.daily ?? []).reduce<{ date: string; events: number } | null>((a, r) => (!a || r.events > a.events ? r : a), null), [d]);
  const spark = (d?.daily ?? []).map((x) => x.events);
  const openPeak = () => peakDay && setDay(peakDay.date);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiTile label="Late arrivals" icon={AlarmClock} value={t ? fmtNum(t.events) : "—"} tone={t && t.events > 0 ? "amber" : "green"} spark={spark} sub="Later than the grace window" onClick={peakDay ? openPeak : undefined} />
        <KpiTile label="Employees late" icon={Users} value={t ? fmtNum(t.employees) : "—"} spark={(d?.daily ?? []).map((x) => x.employees)} sub="Distinct, at least once" onClick={peakDay ? openPeak : undefined} />
        <KpiTile label={`Habitual (${d?.threshold ?? 3}+)`} icon={Repeat} value={t ? fmtNum(t.habitualEmployees) : "—"} tone={t && t.habitualEmployees > 0 ? "red" : "green"} sub="Repeat latecomers in range" onClick={d?.habitual[0] ? () => setEmp(d.habitual[0].employeeId) : undefined} />
        <KpiTile label="Avg beyond grace" icon={Timer} value={t ? `${t.avgNetMinutes} min` : "—"} sub="Per late arrival" onClick={peakDay ? openPeak : undefined} />
        <KpiTile label="Severe (over 60 min)" icon={CalendarClock} value={t ? fmtNum(t.severe) : "—"} tone={t && t.severe > 0 ? "red" : "green"} progress={t ? t.severePct : undefined}
          sub={t ? `${fmtPct(t.severePct)} of late · mild ${fmtNum(t.mild)} · moderate ${fmtNum(t.moderate)}` : undefined} onClick={peakDay ? openPeak : undefined} />
      </div>

      <ChartCard title="Late arrivals by day" loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={empty} height={240}
        emptyLabel="No late arrivals beyond grace in this range/scope"
        subtitle={`${fmtDate(d?.from)} to ${fmtDate(d?.to)}. Counted only when the punch is later than shift start and later than the grace window. Select a bar to open that day.`}>
        <div role="img" aria-label="Bar chart of late arrivals per day" className="h-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={d?.daily ?? []} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false} tickFormatter={fmtDayMonth} minTickGap={16} />
              <YAxis tick={TICK} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
              <Tooltip contentStyle={TIP} labelFormatter={fmtDate} />
              <Bar dataKey="events" name="Late arrivals" fill={chartColor(4)} radius={[3, 3, 0, 0]} isAnimationActive={false} className="cursor-pointer" onClick={(e: unknown) => setDay((e as { date: string }).date)} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard title="Late arrivals by process" loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={empty} height={Math.max(180, (d?.byProcess.length ?? 0) * 30 + 20)}
        subtitle="Top 15 processes. Select a bar to open the process.">
        <div role="img" aria-label="Bar chart of late arrivals by process" className="h-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={d?.byProcess ?? []} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={TICK} tickLine={false} axisLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={TICK} tickLine={false} axisLine={false} width={150} />
              <Tooltip contentStyle={TIP} formatter={(v: number) => fmtNum(v)} />
              <Bar dataKey="events" name="Late arrivals" fill={chartColor(1)} radius={[0, 4, 4, 0]} isAnimationActive={false} className="cursor-pointer"
                onClick={(e: unknown) => { const r = e as { processId: string | null; name: string }; if (r.processId) setProc({ processId: r.processId, processName: r.name } as ProcessRow); }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard title={`Habitual latecomers (${d?.threshold ?? 3}+ late arrivals in range)`} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={!q.isLoading && (d?.habitual.length ?? 0) === 0} height={380}
        emptyLabel={empty ? "No late arrivals in this range/scope" : "No employee crossed the habitual threshold"} subtitle="Sortable. Open a row for the employee's late-arrival timeline.">
        <DataTable rows={d?.habitual ?? []} columns={cols} rowKey={(r) => r.employeeId} rowLabel={(r) => r.employeeName} onRowClick={(r) => setEmp(r.employeeId)} ariaLabel="Habitual latecomers" maxHeight={350} defaultSort={{ key: "c", dir: "desc" }} />
      </ChartCard>
      {d?.habitualTruncated && <Caveat>Showing the top 200 habitual latecomers of {fmtNum(t?.habitualEmployees ?? 0)}.</Caveat>}

      <LateDayDrawer date={day} qs={qs} onClose={() => setDay(null)} onOpenEmployee={(id) => { setEmp(id); setDay(null); }} />
      <LateEmployeeDrawer employeeId={emp} qs={qs} onClose={() => setEmp(null)} />
      <ProcessDrawer process={proc} qs={qs} onClose={() => setProc(null)} onOpenMember={(id) => { setEmp(id); setProc(null); }} />
    </div>
  );
}
