import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ClipboardCheck, TrendingDown, UserX, Users } from "lucide-react";
import { KpiTile } from "@/components/wfm/console/KpiTile";
import { ChartCard } from "@/components/wfm/console/ChartCard";
import { DataTable, type Column } from "./DataTable";
import { MemberDrawer, ProcessDrawer } from "./ShrinkageDrawers";
import { ShrinkPill, TICK, TIP, chartColor } from "./shared";
import { useTrends } from "./useTrendsQuery";
import { fmtNum, fmtPct, fmtDate, shrinkTone, SHRINK_CRIT, SHRINK_WARN } from "./trendsCalc";
import type { ProcessRow, ProcessShrinkage } from "./trendsTypes";

const cols: Column<ProcessRow>[] = [
  { key: "name", header: "Process", sortValue: (r) => r.processName, render: (r) => <span className="font-medium">{r.processName}</span> },
  { key: "sched", header: "Scheduled", align: "right", sortValue: (r) => r.scheduled, render: (r) => fmtNum(r.scheduled) },
  { key: "present", header: "Present", align: "right", sortValue: (r) => r.present, render: (r) => fmtNum(r.present) },
  { key: "late", header: "Late", align: "right", sortValue: (r) => r.late, render: (r) => fmtNum(r.late) },
  { key: "absent", header: "Absent", align: "right", sortValue: (r) => r.absent, render: (r) => fmtNum(r.absent) },
  { key: "leave", header: "On leave", align: "right", sortValue: (r) => r.onLeave, render: (r) => fmtNum(r.onLeave) },
  { key: "unpl", header: "Unplanned", align: "right", sortValue: (r) => r.unplannedPct, render: (r) => fmtPct(r.unplannedPct) },
  { key: "late%", header: "Late rate", align: "right", sortValue: (r) => r.lateRatePct, render: (r) => fmtPct(r.lateRatePct) },
  { key: "shrink", header: "Shrinkage", align: "right", sortValue: (r) => r.shrinkagePct, render: (r) => <ShrinkPill pct={r.shrinkagePct} /> },
];

const BAR_COLOR = { green: 2, amber: 4, red: 8, neutral: 1 } as const;

export default function TeamShrinkageSection({ qs }: { qs: string }) {
  const q = useTrends<ProcessShrinkage>("process-shrinkage", "process-shrinkage", qs);
  const [proc, setProc] = useState<ProcessRow | null>(null);
  const [member, setMember] = useState<{ id: string; from: "process" | null } | null>(null);
  const rows = q.data?.processes ?? [];

  const total = useMemo(() => {
    const t = rows.reduce((a, r) => ({ scheduled: a.scheduled + r.scheduled, present: a.present + r.present, absent: a.absent + r.absent, onLeave: a.onLeave + r.onLeave, late: a.late + r.late }), { scheduled: 0, present: 0, absent: 0, onLeave: 0, late: 0 });
    const pc = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
    return { ...t, shrinkagePct: pc(t.absent + t.onLeave, t.scheduled), unplannedPct: pc(t.absent, t.scheduled), attendancePct: pc(t.present, t.scheduled), lateRatePct: pc(t.late, t.present) };
  }, [rows]);
  const worst = useMemo(() => [...rows].sort((a, b) => b.shrinkagePct - a.shrinkagePct).slice(0, 12), [rows]);
  const hasData = rows.length > 0 && total.scheduled > 0;
  const openWorst = () => worst[0] && setProc(worst[0]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Scheduled shifts" icon={Users} value={hasData ? fmtNum(total.scheduled) : "—"} sub={`${fmtDate(q.data?.from)} to ${fmtDate(q.data?.effectiveTo)}`} onClick={hasData ? openWorst : undefined} />
        <KpiTile label="Attendance" icon={ClipboardCheck} value={hasData ? fmtPct(total.attendancePct) : "—"} tone="green" progress={hasData ? total.attendancePct : undefined} sub={hasData ? `${fmtNum(total.present)} present` : undefined} onClick={hasData ? openWorst : undefined} />
        <KpiTile label="Shrinkage" icon={TrendingDown} value={hasData ? fmtPct(total.shrinkagePct) : "—"} tone={shrinkTone(total.shrinkagePct) === "neutral" ? "neutral" : shrinkTone(total.shrinkagePct)} sub={`Warning ${SHRINK_WARN}% · critical ${SHRINK_CRIT}%`} onClick={hasData ? openWorst : undefined} />
        <KpiTile label="Unplanned absences" icon={UserX} value={hasData ? fmtNum(total.absent) : "—"} tone="red" sub={hasData ? `${fmtPct(total.unplannedPct)} of scheduled` : undefined} onClick={hasData ? openWorst : undefined} />
      </div>

      <ChartCard title="Highest-shrinkage processes" loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={!q.isLoading && !hasData} height={Math.max(200, worst.length * 30 + 20)}
        subtitle="Top 12 by shrinkage %. Select a bar to open the process.">
        <div role="img" aria-label="Bar chart of shrinkage percent by process" className="h-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={worst} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={TICK} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
              <YAxis type="category" dataKey="processName" tick={TICK} tickLine={false} axisLine={false} width={150} />
              <Tooltip contentStyle={TIP} formatter={(v: number) => fmtPct(v)} />
              <Bar dataKey="shrinkagePct" name="Shrinkage" radius={[0, 4, 4, 0]} isAnimationActive={false} className="cursor-pointer" onClick={(e: unknown) => setProc(e as ProcessRow)}>
                {worst.map((r) => <Cell key={r.processId} fill={chartColor(BAR_COLOR[shrinkTone(r.shrinkagePct)])} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>

      <ChartCard title="Process-wise shrinkage" loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={!q.isLoading && rows.length === 0} height={400}
        emptyLabel="No rostered data in this range/scope — try a wider range or clear filters"
        subtitle="Future days are excluded. Shrinkage = (absent + approved leave) / scheduled. Open a row for analysts and day-by-day attendance.">
        <DataTable rows={rows} columns={cols} rowKey={(r) => r.processId} rowLabel={(r) => r.processName} onRowClick={(r) => setProc(r)} ariaLabel="Process-wise shrinkage" maxHeight={370} defaultSort={{ key: "shrink", dir: "desc" }} />
      </ChartCard>

      <ProcessDrawer process={member ? null : proc} qs={qs} onClose={() => setProc(null)} onOpenMember={(id) => setMember({ id, from: "process" })} />
      <MemberDrawer employeeId={member?.id ?? null} qs={qs} onClose={() => { setMember(null); setProc(null); }} onBack={member?.from ? () => setMember(null) : undefined} />
    </div>
  );
}
