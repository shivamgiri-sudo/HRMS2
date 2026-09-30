import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertOctagon, CalendarClock, CheckCheck, Send, UserCheck } from "lucide-react";
import { KpiTile } from "@/components/wfm/console/KpiTile";
import { ChartCard } from "@/components/wfm/console/ChartCard";
import { StatusPill } from "@/components/wfm/console/StatusPill";
import { FilterNote } from "@/components/wfm/console/FilterNote";
import { DataTable, type Column } from "./DataTable";
import { CycleDrawer, StageDrawer, type StageTarget } from "./PublishDrawers";
import { TICK, TIP, chartColor } from "./shared";
import { useTrends } from "./useTrendsQuery";
import { cycleTone, deltaOf, fmtDate, fmtDateTime, fmtNum, fmtPct, stageLabel, titleCase } from "./trendsCalc";
import type { CycleRow, Funnel, PublishOverview } from "./trendsTypes";

type Week = Funnel & { week: string };
const DISPUTED = ["rejected_by_employee", "pending_manager_action", "escalated_to_hr", "manager_rejected_employee_request"];

const weekCols: Column<Week>[] = [
  { key: "week", header: "Week of", sortValue: (r) => r.week, render: (r) => fmtDate(r.week) },
  { key: "total", header: "Assignments", align: "right", sortValue: (r) => r.total, render: (r) => fmtNum(r.total) },
  { key: "pub", header: "Published", align: "right", sortValue: (r) => r.publishedPct, render: (r) => fmtPct(r.publishedPct) },
  { key: "await", header: "Awaiting ack", align: "right", sortValue: (r) => r.awaitingAck, render: (r) => fmtNum(r.awaitingAck) },
  { key: "ack", header: "Ack. of published", align: "right", sortValue: (r) => (r.published ? r.ackPctOfPublished : null), render: (r) => (r.published ? fmtPct(r.ackPctOfPublished) : "—") },
  { key: "disp", header: "Disputed", align: "right", sortValue: (r) => r.disputed, render: (r) => fmtNum(r.disputed) },
];

const cycleCols: Column<CycleRow>[] = [
  { key: "proc", header: "Process", sortValue: (r) => r.processName ?? "", render: (r) => <span className="font-medium">{r.processName ?? "—"}</span> },
  { key: "week", header: "Week of", sortValue: (r) => r.weekStart, render: (r) => fmtDate(r.weekStart) },
  { key: "status", header: "Cycle status", sortValue: (r) => r.status, render: (r) => <StatusPill tone={cycleTone(r.status)}>{titleCase(r.status)}</StatusPill> },
  { key: "pubAt", header: "Published", sortValue: (r) => r.publishedAt ?? "", render: (r) => (r.publishedAt ? fmtDateTime(r.publishedAt) : "Not published") },
  { key: "by", header: "Published by", render: (r) => r.publishedBy ?? "—" },
  { key: "dl", header: "Ack. deadline", render: (r) => fmtDateTime(r.ackDeadline) },
];

export default function PublishSection({ qs }: { qs: string }) {
  const q = useTrends<PublishOverview>("publish", "publish", qs);
  const [stage, setStage] = useState<StageTarget | null>(null);
  const [cycle, setCycle] = useState<string | null>(null);
  const d = q.data;
  const f = d?.funnel;
  const empty = !q.isLoading && (!d || d.funnel.total === 0);
  const weeks = d?.byWeek ?? [];
  const topDisputed = useMemo(() => d?.byStage.find((s) => DISPUTED.includes(s.status))?.status ?? "rejected_by_employee", [d]);

  const weekChart = useMemo(() => weeks.map((w) => ({ week: w.week, unpublished: w.unpublished, awaiting: w.awaitingAck, acknowledged: w.acknowledged, disputed: w.disputed })), [weeks]);
  const stageChart = useMemo(() => (d?.byStage ?? []).map((s) => ({ ...s, label: stageLabel(s.status) })), [d]);
  const stageColor = (s: string) => (s === "generated" ? chartColor(1) : s === "pending_employee_ack" ? chartColor(4) : DISPUTED.includes(s) ? chartColor(8) : chartColor(2));

  return (
    <div className="space-y-4">
      {d?.cyclesIgnoreLob && <FilterNote>LOB filter does not apply to roster cycles (assignments are LOB-filtered)</FilterNote>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiTile label="Published" icon={Send} value={f ? fmtPct(f.publishedPct) : "—"} tone={f && f.publishedPct >= 90 ? "green" : f && f.publishedPct > 0 ? "amber" : "red"}
          delta={d && f ? deltaOf(f.publishedPct, d.previous?.publishedPct) : undefined} deltaBad="down" progress={f?.publishedPct}
          spark={weeks.map((w) => w.publishedPct)} sub={f ? `${fmtNum(f.published)} of ${fmtNum(f.total)} assignments` : undefined} onClick={f ? () => setStage({ status: "generated", title: "Not yet published" }) : undefined} />
        <KpiTile label="Upcoming unpublished" icon={CalendarClock} value={d ? fmtNum(d.upcomingUnpublished) : "—"} tone={d && d.upcomingUnpublished > 0 ? "amber" : "green"}
          sub="Working shifts in the next 7 days" onClick={d ? () => setStage({ status: "generated", title: "Not yet published" }) : undefined} />
        <KpiTile label="Awaiting acknowledgement" icon={UserCheck} value={f ? fmtNum(f.awaitingAck) : "—"} tone={f && f.awaitingAck > 0 ? "amber" : "neutral"}
          spark={weeks.map((w) => w.awaitingAck)} sub="Published, employee has not responded" onClick={f ? () => setStage({ status: "pending_employee_ack" }) : undefined} />
        <KpiTile label="Acknowledged" icon={CheckCheck} value={f && f.published ? fmtPct(f.ackPctOfPublished) : "—"} tone="green"
          delta={d && f && f.published ? deltaOf(f.ackPctOfPublished, d.previous?.ackPctOfPublished) : undefined} deltaBad="down" progress={f?.published ? f.ackPctOfPublished : undefined}
          spark={weeks.filter((w) => w.published > 0).map((w) => w.ackPctOfPublished)} sub="Share of published assignments" onClick={f ? () => setStage({ status: "acknowledged" }) : undefined} />
        <KpiTile label="Disputed" icon={AlertOctagon} value={f ? fmtNum(f.disputed) : "—"} tone={f && f.disputed > 0 ? "red" : "green"}
          sub={f && f.published ? `${fmtPct(f.disputedPctOfPublished)} of published` : undefined} onClick={f ? () => setStage({ status: topDisputed }) : undefined} />
      </div>

      <ChartCard title="Publish and acknowledge by week" loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={empty} height={260}
        emptyLabel="No roster assignments in this range/scope — try a wider range or clear filters"
        subtitle="Assignments per roster week (Mon-Sun) by state, counted from final_roster_status. Select a segment to open it.">
        <div role="img" aria-label="Stacked bar chart of roster assignment states by week" className="h-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weekChart} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="week" tick={TICK} tickLine={false} axisLine={false} tickFormatter={(v) => fmtDate(String(v)).slice(0, 5)} />
              <YAxis tick={TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => fmtNum(Number(v))} />
              <Tooltip contentStyle={TIP} labelFormatter={(v) => `Week of ${fmtDate(String(v))}`} formatter={(v: number) => fmtNum(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="acknowledged" name="Acknowledged" stackId="a" fill={chartColor(2)} isAnimationActive={false} className="cursor-pointer" onClick={(e: unknown) => setStage({ status: "all", week: (e as { week: string }).week, title: `Week of ${fmtDate((e as { week: string }).week)}` })} />
              <Bar dataKey="awaiting" name="Awaiting acknowledgement" stackId="a" fill={chartColor(4)} isAnimationActive={false} className="cursor-pointer" onClick={(e: unknown) => setStage({ status: "pending_employee_ack", week: (e as { week: string }).week })} />
              <Bar dataKey="disputed" name="Disputed" stackId="a" fill={chartColor(8)} isAnimationActive={false} className="cursor-pointer" onClick={(e: unknown) => setStage({ status: topDisputed, week: (e as { week: string }).week })} />
              <Bar dataKey="unpublished" name="Not yet published" stackId="a" fill={chartColor(1)} fillOpacity={0.35} isAnimationActive={false} className="cursor-pointer" onClick={(e: unknown) => setStage({ status: "generated", week: (e as { week: string }).week, title: "Not yet published" })} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard title="Stage breakdown" loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={empty} height={Math.max(180, stageChart.length * 32 + 20)}
        subtitle="Every assignment in scope by final_roster_status. Select a bar to open the stage.">
        <div role="img" aria-label="Bar chart of roster assignments by publish stage" className="h-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stageChart} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={TICK} tickLine={false} axisLine={false} tickFormatter={(v) => fmtNum(Number(v))} />
              <YAxis type="category" dataKey="label" tick={TICK} tickLine={false} axisLine={false} width={210} />
              <Tooltip contentStyle={TIP} formatter={(v: number) => fmtNum(v)} />
              <Bar dataKey="count" name="Assignments" radius={[0, 4, 4, 0]} isAnimationActive={false} className="cursor-pointer" onClick={(e: unknown) => setStage({ status: (e as { status: string }).status })}>
                {stageChart.map((s) => <Cell key={s.status} fill={stageColor(s.status)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard title="Weekly publish table" loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={empty} height={300} subtitle="Open a week for its stage mix, processes and decision timeline.">
        <DataTable rows={weeks} columns={weekCols} rowKey={(r) => r.week} rowLabel={(r) => `week of ${fmtDate(r.week)}`}
          onRowClick={(r) => setStage({ status: "all", week: r.week, title: `Week of ${fmtDate(r.week)}` })} ariaLabel="Weekly publish status" maxHeight={270} defaultSort={{ key: "week", dir: "desc" }} />
      </ChartCard>

      <ChartCard title="Roster cycles (publish authority: process manager)" loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={!q.isLoading && (d?.cycles.length ?? 0) === 0} height={340}
        emptyLabel="No weekly roster cycle overlaps this range/scope"
        subtitle={d ? `${d.cycleCounts.map((c) => `${titleCase(c.status)}: ${c.count}`).join(" · ") || "No cycles"}${d.cyclesTruncated ? " (first 200 shown)" : ""}. Open a cycle for its change log and audit entries.` : undefined}>
        <DataTable rows={d?.cycles ?? []} columns={cycleCols} rowKey={(r) => r.id} rowLabel={(r) => `${r.processName ?? "cycle"} week of ${fmtDate(r.weekStart)}`}
          onRowClick={(r) => setCycle(r.id)} ariaLabel="Roster cycles" maxHeight={310} defaultSort={{ key: "week", dir: "desc" }} />
      </ChartCard>

      <StageDrawer target={stage} qs={qs} onClose={() => setStage(null)} />
      <CycleDrawer cycleId={cycle} onClose={() => setCycle(null)} />
    </div>
  );
}
