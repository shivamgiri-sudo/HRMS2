import { AlertTriangle, ArrowDown, ArrowUp, CalendarCheck, CalendarClock, Clock3, Minus, UserCheck, UserX, Users } from "lucide-react";
import type { LeaderboardRow, SectionResult } from "../../../../../../backend/src/modules/branch-head-health/types";
import { barListTable, donutTable, stackedBarTable, type BarListProps, type DonutProps, type StackedBarProps } from "../viz";
import type { AttendanceData } from "../panelTypes";
import { formatCount, formatPct } from "../format";
import { KPI_TONES, toneFor } from "../kpiModel";
import { SectionError } from "../SectionPanels";
import { BarsChart, ChartCard, DonutChart, EmptyLine, GradientKpi, KpiCell, KpiGrid, PAL, SectionGate } from "../look";
import { LateTable, SlotTable } from "./attendanceParts";
import { nn, selectByName, type VisualProps } from "./shared";

/** Signed change in shrinkage vs the previous day, in words; zero scheduled yesterday counts as no data. */
export function shrinkageChange(now: number, prev: AttendanceData["previousDay"]): string {
  if (!prev || !(prev.scheduled > 0)) return "No data for yesterday";
  const delta = Math.round((now - prev.shrinkagePct) * 10) / 10;
  if (delta === 0) return `0.0 pts, no change vs yesterday (${formatPct(prev.shrinkagePct)})`;
  const up = delta > 0;
  return `${up ? "+" : "-"}${Math.abs(delta).toFixed(1)} pts, ${up ? "up" : "down"} vs yesterday (${formatPct(prev.shrinkagePct)})`;
}

/** Managers are ranked "Team n" labels only; names stay behind the process drill-down. */
export function teamBars(teams: LeaderboardRow[]): BarListProps {
  return {
    label: "Late arrivals by team",
    format: formatCount,
    items: teams.slice(0, 10).map((r, i) => ({ id: `team-${i + 1}`, label: `Team ${i + 1}`, value: nn(r.late) })),
  };
}

/** Chart props and table twins. Per process: shift slots summed, sorted by absent (most first). */
export function buildAttendance(d: AttendanceData, teams: LeaderboardRow[]) {
  const donut: DonutProps = {
    centerLabel: "Shrinkage",
    centerValue: formatPct(d.shrinkagePct),
    slices: [
      // Slots match the by-process bars (present 0, absent 1) so a status keeps its colour across both charts.
      { key: "present", label: "Present", value: nn(d.present), slot: 0 },
      { key: "absent", label: "Absent", value: nn(d.absent), slot: 1 },
      { key: "onLeave", label: "On leave", value: nn(d.onLeave), slot: 3 },
    ],
  };
  const byName = new Map<string, { planned: number; present: number; absent: number }>();
  for (const s of d.bySlot ?? []) {
    const cur = byName.get(s.process) ?? { planned: 0, present: 0, absent: 0 };
    cur.planned += nn(s.planned); cur.present += nn(s.present); cur.absent += nn(s.absent);
    byName.set(s.process, cur);
  }
  const procs = [...byName.entries()].sort((a, b) => b[1].absent - a[1].absent);
  const byProcess: StackedBarProps = {
    label: "Planned headcount by process: present, absent and not marked",
    series: [{ key: "present", label: "Present" }, { key: "absent", label: "Absent" }, { key: "open", label: "Not marked" }],
    rows: procs.map(([name, v], i) => ({
      id: `r${i}`,
      label: name,
      segments: [
        { key: "present", value: v.present },
        { key: "absent", value: v.absent },
        { key: "open", value: Math.max(0, v.planned - v.present - v.absent) },
      ],
    })),
  };
  const late: BarListProps = {
    label: "Late arrivals by process",
    format: formatCount,
    items: (d.processWise ?? []).map((r, i) => ({ id: `r${i}`, label: r.process, value: nn(r.late) })),
  };
  const team = teamBars(teams);
  return {
    donut, donutTable: donutTable(donut, "Attendance today"),
    byProcess, byProcessTable: stackedBarTable(byProcess),
    late, lateTable: barListTable(late),
    team, teamTable: barListTable(team),
  };
}

export function Change({ text }: { text: string }) {
  const Icon = text.includes(" up ") ? ArrowUp : text.includes(" down ") ? ArrowDown : Minus;
  return <span className="inline-flex items-center gap-1"><Icon className="h-3.5 w-3.5" aria-hidden="true" />{text}</span>;
}

/** Nobody marked present out of a real roster almost always means attendance has not synced yet, not 100% absence. */
export function noPresentNote(d: Pick<AttendanceData, "present" | "scheduled">): string | null {
  if (nn(d.scheduled) >= 10 && nn(d.present) === 0) {
    return "No one is marked present yet for this date. Attendance may not have synced, so the shrinkage shown could be overstated.";
  }
  return null;
}

/** Late arrivals by team, from the leaderboard section (its own "As of"); independent of attendance. */
export function TeamLate({ lb }: { lb: SectionResult<LeaderboardRow[]> }) {
  const team = teamBars(lb.status === "ok" && Array.isArray(lb.data) ? lb.data : []);
  return (
    <ChartCard title="Late arrivals by team" accent="orange" table={barListTable(team)}
      chip={`Teams are ranked; names are in the process drill-down${lb.status === "ok" ? ` · As of ${lb.asOf}` : ""}`}>
      {lb.status === "error" ? <SectionError name="Late arrivals by team" message={lb.message} />
        : team.items.length ? (
          <BarsChart label="Late arrivals by team" xKey="team" horizontal height={Math.max(150, team.items.length * 32 + 50)} format={formatCount}
            data={team.items.map((t) => ({ team: t.label, late: t.value }))} series={[{ key: "late", label: "Late", color: PAL.s4 }]} />
        ) : <EmptyLine text="No late arrivals by team" />}
    </ChartCard>
  );
}

export function AttendanceVisual(props: VisualProps) {
  const { overview } = props;
  const lb = overview.leaderboard;
  const att = overview.attendance;
  const attendanceOk = att?.status === "ok" && att.data != null;
  return (
    <div className="space-y-4">
      <SectionGate<AttendanceData> title="Attendance today" section={att} emptyText="No attendance data for this date" errorName="Attendance" accent="cyan">
        {(d, asOf) => {
          const b = buildAttendance(d, []);
          const shrink = toneFor(d.shrinkagePct, KPI_TONES.shrinkagePct);
          const pick = selectByName(props, "attendance");
          return (
            <div className="space-y-4">
              {noPresentNote(d) ? (
                <p role="note" className="flex items-start gap-2 rounded-lg border border-amber-400 bg-amber-50 p-3 text-[13px] text-amber-950">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{noPresentNote(d)}
                </p>
              ) : null}
              <KpiGrid label="Attendance counts">
                <KpiCell><GradientKpi icon={Users} hue="navy" label="Scheduled" value={formatCount(d.scheduled)} sub={`As of ${asOf}`} /></KpiCell>
                <KpiCell><GradientKpi icon={UserCheck} hue="emerald" label="Present" value={formatCount(d.present)} sub={`${formatCount(d.yetToStart)} yet to start`} /></KpiCell>
                <KpiCell><GradientKpi icon={UserX} hue="violet" label="Absent / on leave" value={`${formatCount(d.absent)} / ${formatCount(d.onLeave)}`} sub={d.previousDay ? `Yesterday ${formatCount(d.previousDay.absent)} absent` : "No data for yesterday"} /></KpiCell>
                <KpiCell><GradientKpi icon={CalendarCheck} hue="cyan" label="Shrinkage" value={formatPct(d.shrinkagePct)} sub={<Change text={shrinkageChange(d.shrinkagePct, d.previousDay)} />}
                  status={shrink === "warning" ? "warning" : shrink === "critical" ? "critical" : null} /></KpiCell>
                <KpiCell><GradientKpi icon={Clock3} hue="orange" label="Late today" value={formatCount(d.totalLate)} sub={`${formatCount(d.lateNotOnRoster)} not on today's roster`} /></KpiCell>
                <KpiCell><GradientKpi icon={CalendarClock} hue="teal" label="Yet to start" value={formatCount(d.yetToStart)} sub="Shift not begun" /></KpiCell>
                <KpiCell><GradientKpi icon={CalendarCheck} hue="indigo" label="Week-off worked" value={formatCount(d.weekOffWorked)} sub="Came in on a week off" /></KpiCell>
                <KpiCell><GradientKpi icon={CalendarClock} hue="slate" label="Shrinkage yesterday" value={d.previousDay && d.previousDay.scheduled > 0 ? formatPct(d.previousDay.shrinkagePct) : "—"}
                  sub={d.previousDay ? `${formatCount(d.previousDay.absent)} absent of ${formatCount(d.previousDay.scheduled)}` : "No data for yesterday"} /></KpiCell>
              </KpiGrid>
              <div className="bhl-grid bhl-grid-3">
                <ChartCard title="Present, absent and on leave" chip={`${formatCount(d.scheduled)} scheduled`} accent="cyan" table={b.donutTable}>
                  <DonutChart label="Attendance today" center={formatPct(d.shrinkagePct)} centerLabel="Shrinkage" height={240}
                    slices={[{ key: "p", label: "Present", value: nn(d.present), color: PAL.s1 }, { key: "a", label: "Absent", value: nn(d.absent), color: PAL.s2 },
                      { key: "l", label: "On leave", value: nn(d.onLeave), color: PAL.s4 }]} />
                  <p className="bhl-note"><Change text={shrinkageChange(d.shrinkagePct, d.previousDay)} /></p>
                </ChartCard>
                <ChartCard title="Shift bands: planned, absent, late" chip="4 bands" accent="violet" className="bhl-span-2"
                  table={{ caption: "Attendance by shift band", columns: ["Band", "Planned", "Absent", "Late"], rows: (d.bands ?? []).map((x) => [x.band, formatCount(x.planned), formatCount(x.absent), formatCount(x.late)]) }}>
                  <BarsChart label="Planned, absent and late by shift band" xKey="band" height={270} data={(d.bands ?? []).map((x) => ({ ...x }))}
                    series={[{ key: "planned", label: "Planned", color: PAL.s1 }, { key: "absent", label: "Absent", color: PAL.s2 }, { key: "late", label: "Late", color: PAL.s4 }]} />
                </ChartCard>
              </div>
              <ChartCard title="By process" chip={`${b.byProcess.rows.length} processes · most absent first`} accent="blue" table={b.byProcessTable}>
                {b.byProcess.rows.length ? (
                  <BarsChart label={b.byProcess.label} xKey="process" horizontal height={Math.max(180, b.byProcess.rows.length * 36 + 50)}
                    data={b.byProcess.rows.map((r) => ({ process: r.label, ...Object.fromEntries(r.segments.map((s) => [s.key, s.value])) }))}
                    series={[{ key: "present", label: "Present", color: PAL.s1, stack: "a" }, { key: "absent", label: "Absent", color: PAL.s2, stack: "a" }, { key: "open", label: "Not marked", color: PAL.other, stack: "a" }]} />
                ) : <EmptyLine text="No shift slots for this date" />}
              </ChartCard>
              <SlotTable d={d} onProcess={pick} />
              <div className="bhl-grid bhl-grid-2">
                <LateTable d={d} late={b.late} onProcess={pick} />
                {lb ? <TeamLate lb={lb} /> : null}
              </div>
            </div>
          );
        }}
      </SectionGate>
      {!attendanceOk && lb && lb.status !== "empty" ? (
        <TeamLate lb={lb} />
      ) : null}
    </div>
  );
}
