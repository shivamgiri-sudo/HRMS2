import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DetailDrawer, DrawerSection, FieldGrid } from "@/components/wfm/console/DetailDrawer";
import { StatusPill } from "@/components/wfm/console/StatusPill";
import { ChevronLeft } from "lucide-react";
import { DataTable, type Column } from "./DataTable";
import { NoneNote, QueryBody, ShrinkPill, TICK, TIP, chartColor, Caveat } from "./shared";
import { useTrends, withParam } from "./useTrendsQuery";
import { fmtDate, fmtDateTime, fmtDayMonth, fmtNum, fmtPct, stageLabel, stageTone } from "./trendsCalc";
import type { CountsRates, DayPoint, MemberRow, ProcessRow } from "./trendsTypes";

/* ── shared mini pieces ────────────────────────────────────────────────────── */

function CountsGrid({ c }: { c: CountsRates }) {
  return (
    <FieldGrid
      fields={[
        ["Scheduled (excl. week-off/holiday)", fmtNum(c.scheduled)],
        ["Present", fmtNum(c.present)],
        ["Absent (unplanned)", fmtNum(c.absent)],
        ["On approved leave (planned)", fmtNum(c.onLeave)],
        ["Late arrivals", fmtNum(c.late)],
        ["Shrinkage", <ShrinkPill key="s" pct={c.shrinkagePct} />],
        ["Unplanned %", fmtPct(c.unplannedPct)],
        ["Attendance %", fmtPct(c.attendancePct)],
        ["Late rate (of present)", fmtPct(c.lateRatePct)],
      ]}
    />
  );
}

function MiniTrend({ days, label }: { days: DayPoint[]; label: string }) {
  const data = days.map((d) => ({ date: d.date, shrinkage: d.hasData ? d.shrinkagePct : null, unplanned: d.hasData ? d.unplannedPct : null }));
  if (data.every((d) => d.shrinkage == null)) return <NoneNote>No roster/attendance data in this window</NoneNote>;
  return (
    <div style={{ height: 160 }} role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false} tickFormatter={fmtDayMonth} />
          <YAxis tick={TICK} tickLine={false} axisLine={false} width={40} tickFormatter={(v) => `${v}%`} />
          <Tooltip contentStyle={TIP} labelFormatter={fmtDate} formatter={(v: number) => fmtPct(v)} />
          <Line type="monotone" dataKey="shrinkage" name="Shrinkage" stroke={chartColor(8)} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="unplanned" name="Unplanned" stroke={chartColor(4)} strokeWidth={2} strokeDasharray="4 3" dot={false} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── Day drawer ────────────────────────────────────────────────────────────── */

interface DayDetail {
  date: string; summary: CountsRates;
  byProcess: Array<CountsRates & { id: string; name: string }>;
  byBranch: Array<CountsRates & { id: string; name: string }>;
  absentees: Array<{ employeeId: string; employeeCode: string; employeeName: string; processName: string | null; branchName: string | null }>;
  absenteesTruncated: boolean;
  publishStates: Array<{ status: string; count: number }>;
  trend7: DayPoint[];
}

const groupCols: Column<CountsRates & { id: string; name: string }>[] = [
  { key: "name", header: "Name", sortValue: (r) => r.name, render: (r) => <span className="font-medium">{r.name}</span> },
  { key: "sched", header: "Scheduled", align: "right", sortValue: (r) => r.scheduled, render: (r) => fmtNum(r.scheduled) },
  { key: "absent", header: "Absent", align: "right", sortValue: (r) => r.absent, render: (r) => fmtNum(r.absent) },
  { key: "leave", header: "Leave", align: "right", sortValue: (r) => r.onLeave, render: (r) => fmtNum(r.onLeave) },
  { key: "shrink", header: "Shrinkage", align: "right", sortValue: (r) => r.shrinkagePct, render: (r) => <ShrinkPill pct={r.shrinkagePct} /> },
];

export function DayDrawer({ date, qs, onClose, onOpenMember }: { date: string | null; qs: string; onClose: () => void; onOpenMember: (id: string) => void }) {
  const q = useTrends<DayDetail>("day", "shrinkage/day", withParam(qs, "date", date ?? ""), !!date);
  return (
    <DetailDrawer open={!!date} onOpenChange={(o) => !o && onClose()} title={`Shrinkage on ${fmtDate(date)}`} subtitle="Roster x attendance for the selected scope">
      {date && (
        <QueryBody query={q}>
          {(d) => (
            <>
              <DrawerSection label="Full record"><CountsGrid c={d.summary} /></DrawerSection>
              <DrawerSection label="Trend — 7 days to this date"><MiniTrend days={d.trend7} label="Shrinkage trend for the 7 days to this date" /></DrawerSection>
              <DrawerSection label="By process">
                {d.byProcess.length ? <DataTable rows={d.byProcess} columns={groupCols} rowKey={(r) => r.id} ariaLabel="Shrinkage by process" maxHeight={260} defaultSort={{ key: "shrink", dir: "desc" }} /> : undefined}
              </DrawerSection>
              <DrawerSection label="By branch">
                {d.byBranch.length ? <DataTable rows={d.byBranch} columns={groupCols} rowKey={(r) => r.id} ariaLabel="Shrinkage by branch" maxHeight={220} defaultSort={{ key: "shrink", dir: "desc" }} /> : undefined}
              </DrawerSection>
              <DrawerSection label="Absent employees (no punch, no approved leave)">
                {d.absentees.length ? (
                  <>
                    <ul className="divide-y divide-border rounded-md border border-border">
                      {d.absentees.map((a) => (
                        <li key={a.employeeId}>
                          <button type="button" onClick={() => onOpenMember(a.employeeId)} className="flex min-h-[44px] w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:min-h-[36px]">
                            <span className="font-medium">{a.employeeName} <span className="font-normal text-slate-500">({a.employeeCode})</span></span>
                            <span className="text-xs text-slate-600">{a.processName ?? "Unassigned"}{a.branchName ? ` · ${a.branchName}` : ""}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    {d.absenteesTruncated && <Caveat>Showing the first 50 absent employees. Narrow the filters for the rest.</Caveat>}
                  </>
                ) : undefined}
              </DrawerSection>
              <DrawerSection label="Roster publish state on this date (timeline)">
                {d.publishStates.length ? (
                  <ul className="flex flex-wrap gap-2">
                    {d.publishStates.map((s) => <li key={s.status}><StatusPill tone={stageTone(s.status)}>{stageLabel(s.status)}: {fmtNum(s.count)}</StatusPill></li>)}
                  </ul>
                ) : undefined}
              </DrawerSection>
              <DrawerSection label="Audit trail"><NoneNote>None recorded at day level. Roster edits are logged under the Audit Trail tab.</NoneNote></DrawerSection>
            </>
          )}
        </QueryBody>
      )}
    </DetailDrawer>
  );
}

/* ── Process drawer ────────────────────────────────────────────────────────── */

interface ProcessDetail {
  processId: string; process: ProcessRow | null; days: DayPoint[]; previous: DayPoint | null; members: MemberRow[];
  publish: { funnel: { total: number; published: number; unpublished: number; awaitingAck: number; acknowledged: number; disputed: number; publishedPct: number; ackPctOfPublished: number }; cycles: Array<{ id: string; status: string; weekStart: string; weekEnd: string; publishedAt: string | null; publishedBy: string | null }> };
}

const memberCols: Column<MemberRow>[] = [
  { key: "name", header: "Analyst", sortValue: (r) => r.employeeName, render: (r) => <span className="font-medium">{r.employeeName} <span className="font-normal text-slate-500">({r.employeeCode})</span></span> },
  { key: "sched", header: "Sched.", align: "right", sortValue: (r) => r.scheduled, render: (r) => fmtNum(r.scheduled) },
  { key: "present", header: "Present", align: "right", sortValue: (r) => r.present, render: (r) => fmtNum(r.present) },
  { key: "late", header: "Late", align: "right", sortValue: (r) => r.late, render: (r) => fmtNum(r.late) },
  { key: "absent", header: "Absent", align: "right", sortValue: (r) => r.absent, render: (r) => fmtNum(r.absent) },
  { key: "leave", header: "Leave", align: "right", sortValue: (r) => r.onLeave, render: (r) => fmtNum(r.onLeave) },
  { key: "shrink", header: "Shrinkage", align: "right", sortValue: (r) => r.shrinkagePct, render: (r) => <ShrinkPill pct={r.shrinkagePct} /> },
  { key: "avgLate", header: "Avg late", align: "right", sortValue: (r) => r.avgLateMinutes, render: (r) => (r.avgLateMinutes > 0 ? `${r.avgLateMinutes} min` : "—") },
];

export function ProcessDrawer({ process, qs, onClose, onOpenMember }: { process: ProcessRow | null; qs: string; onClose: () => void; onOpenMember: (id: string) => void }) {
  const q = useTrends<ProcessDetail>("process", "process-detail", withParam(qs, "processId", process?.processId ?? ""), !!process);
  return (
    <DetailDrawer open={!!process} onOpenChange={(o) => !o && onClose()} title={process?.processName ?? "Process"} subtitle="Process shrinkage for the selected range" badge={process ? <ShrinkPill pct={process.shrinkagePct} /> : undefined}>
      {process && (
        <QueryBody query={q}>
          {(d) => (
            <>
              <DrawerSection label="Full record"><CountsGrid c={d.process ?? process} /></DrawerSection>
              <DrawerSection label="Trend"><MiniTrend days={d.days} label={`Shrinkage trend for ${process.processName}`} /></DrawerSection>
              <DrawerSection label="Analysts — open a row for day-by-day attendance">
                {d.members.length ? <DataTable rows={d.members} columns={memberCols} rowKey={(r) => r.employeeId} rowLabel={(r) => r.employeeName} onRowClick={(r) => onOpenMember(r.employeeId)} ariaLabel="Analysts in process" defaultSort={{ key: "shrink", dir: "desc" }} maxHeight={360} /> : undefined}
              </DrawerSection>
              <DrawerSection label="Roster publish status (timeline)">
                <FieldGrid fields={[
                  ["Assignments", fmtNum(d.publish.funnel.total)], ["Published", fmtPct(d.publish.funnel.publishedPct)],
                  ["Awaiting acknowledgement", fmtNum(d.publish.funnel.awaitingAck)], ["Acknowledged of published", fmtPct(d.publish.funnel.ackPctOfPublished)],
                ]} />
                {d.publish.cycles.length ? (
                  <ul className="mt-2 divide-y divide-border rounded-md border border-border text-sm">
                    {d.publish.cycles.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                        <span>{fmtDate(c.weekStart)} – {fmtDate(c.weekEnd)}</span>
                        <span className="text-xs text-slate-600">{c.status.replace(/_/g, " ")}{c.publishedAt ? ` · ${fmtDateTime(c.publishedAt)}${c.publishedBy ? ` by ${c.publishedBy}` : ""}` : ""}</span>
                      </li>
                    ))}
                  </ul>
                ) : <NoneNote>No weekly roster cycle recorded for this process in range</NoneNote>}
              </DrawerSection>
              <DrawerSection label="Audit trail"><NoneNote>None at process level. Open a roster cycle in Publish &amp; Acknowledge for its change log and audit entries.</NoneNote></DrawerSection>
            </>
          )}
        </QueryBody>
      )}
    </DetailDrawer>
  );
}

/* ── Member drawer ─────────────────────────────────────────────────────────── */

interface MemberDetail {
  employee: { employeeCode: string; employeeName: string; designation: string; branchName: string | null; processName: string | null; managerName: string | null; dateOfJoining: string | null; active: boolean };
  summary: CountsRates;
  weekly: Array<CountsRates & { week: string }>;
  days: Array<{ date: string; dayOfWeek: string; assignmentType: string; shiftStart: string | null; shiftEnd: string | null; clockIn: string | null; status: string; lateByMinutes: number | null; rosterStatus: string | null }>;
}

const DAY_TONE: Record<string, "green" | "amber" | "red" | "blue" | "neutral"> = { "On Time": "green", Late: "amber", Absent: "red", "On Leave": "blue" };

const dayCols: Column<MemberDetail["days"][number]>[] = [
  { key: "date", header: "Date", sortValue: (r) => r.date, render: (r) => `${fmtDate(r.date)} ${r.dayOfWeek}` },
  { key: "shift", header: "Shift", render: (r) => (r.shiftStart && r.shiftEnd ? `${r.shiftStart}–${r.shiftEnd}` : r.assignmentType.replace(/_/g, " ").toLowerCase()) },
  { key: "in", header: "Clock in", render: (r) => r.clockIn ?? "—" },
  { key: "status", header: "Status", sortValue: (r) => r.status, render: (r) => <StatusPill tone={DAY_TONE[r.status] ?? "neutral"}>{r.status}</StatusPill> },
  { key: "late", header: "Late by", align: "right", sortValue: (r) => r.lateByMinutes ?? 0, render: (r) => (r.lateByMinutes && r.lateByMinutes > 0 && r.status === "Late" ? `${r.lateByMinutes} min` : "—") },
  { key: "roster", header: "Roster", render: (r) => (r.rosterStatus ? stageLabel(r.rosterStatus) : "—") },
];

export function MemberDrawer({ employeeId, qs, onClose, onBack }: { employeeId: string | null; qs: string; onClose: () => void; onBack?: () => void }) {
  const q = useTrends<MemberDetail>("member", "member-detail", withParam(qs, "employeeId", employeeId ?? ""), !!employeeId);
  const name = q.data?.employee.employeeName ?? "Analyst";
  return (
    <DetailDrawer open={!!employeeId} onOpenChange={(o) => !o && onClose()} title={name} subtitle={q.data ? `${q.data.employee.employeeCode} · ${q.data.employee.processName ?? "No process"}` : "Day-by-day attendance"}>
      {onBack && (
        <button type="button" onClick={onBack} className="-mt-1 inline-flex min-h-[32px] cursor-pointer items-center gap-1 rounded-md px-1 text-xs font-medium text-slate-700 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Back
        </button>
      )}
      {employeeId && (
        <QueryBody query={q}>
          {(d) => (
            <>
              <DrawerSection label="Full record">
                <FieldGrid fields={[
                  ["Employee code", d.employee.employeeCode], ["Designation", d.employee.designation], ["Branch", d.employee.branchName], ["Process", d.employee.processName],
                  ["Reporting manager", d.employee.managerName], ["Date of joining", fmtDate(d.employee.dateOfJoining)], ["Status", d.employee.active ? "Active" : "Inactive"],
                ]} />
                <div className="mt-3"><CountsGrid c={d.summary} /></div>
              </DrawerSection>
              <DrawerSection label="Weekly trend">
                {d.weekly.length ? (
                  <DataTable rows={d.weekly} rowKey={(r) => r.week} ariaLabel="Weekly attendance" maxHeight={200}
                    columns={[
                      { key: "w", header: "Week of", render: (r) => fmtDate(r.week) },
                      { key: "s", header: "Scheduled", align: "right", render: (r) => fmtNum(r.scheduled) },
                      { key: "p", header: "Present", align: "right", render: (r) => fmtNum(r.present) },
                      { key: "a", header: "Absent", align: "right", render: (r) => fmtNum(r.absent) },
                      { key: "sh", header: "Shrinkage", align: "right", render: (r) => <ShrinkPill pct={r.shrinkagePct} /> },
                    ]} />
                ) : undefined}
              </DrawerSection>
              <DrawerSection label="Day-by-day timeline">
                {d.days.length ? <DataTable rows={d.days} columns={dayCols} rowKey={(r) => r.date} ariaLabel="Day-by-day attendance" maxHeight={420} defaultSort={{ key: "date", dir: "asc" }} /> : <NoneNote>No roster data for this analyst in range</NoneNote>}
              </DrawerSection>
              <DrawerSection label="Audit trail"><NoneNote>None at this level. Attendance corrections appear under the Audit Trail tab.</NoneNote></DrawerSection>
            </>
          )}
        </QueryBody>
      )}
    </DetailDrawer>
  );
}
