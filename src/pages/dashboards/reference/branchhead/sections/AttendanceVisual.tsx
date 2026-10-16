import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import type { LeaderboardRow, SectionResult } from "../../../../../../backend/src/modules/branch-head-health/types";
import { BarList, ChartFrame, DataTable, Donut, StackedBar, StatTile, barListTable, donutTable, stackedBarTable, type BarListProps, type DonutProps, type StackedBarProps } from "../viz";
import type { AttendanceData } from "../panelTypes";
import { formatCount, formatPct } from "../format";
import { SectionShell } from "../ui";
import { SectionError } from "../SectionPanels";
import { byLabel, Fold, Grid, nn, selectByName, TileItem, Tiles, type VisualProps } from "./shared";

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
      { key: "present", label: "Present", value: nn(d.present) },
      { key: "absent", label: "Absent", value: nn(d.absent) },
      { key: "onLeave", label: "On leave", value: nn(d.onLeave) },
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

function Change({ text }: { text: string }) {
  const Icon = text.includes(" up ") ? ArrowUp : text.includes(" down ") ? ArrowDown : Minus;
  return <span className="inline-flex items-center gap-1"><Icon className="h-3.5 w-3.5" aria-hidden="true" />{text}</span>;
}

const SLOT_COLUMNS = ["Process", "Shift", "Planned", "Present", "Absent", "Late"];

/** Late arrivals by team, from the leaderboard section (its own "As of"); independent of attendance. */
function TeamLate({ lb }: { lb: SectionResult<LeaderboardRow[]> }) {
  const team = teamBars(lb.status === "ok" && Array.isArray(lb.data) ? lb.data : []);
  return (
    <ChartFrame title="Late arrivals by team" table={barListTable(team)} height={96}
      subtitle={`Teams are ranked; names are in the process drill-down${lb.status === "ok" ? ` · As of ${lb.asOf}` : ""}`}>
      {lb.status === "error" ? <SectionError name="Late arrivals by team" message={lb.message} /> : <BarList {...team} />}
    </ChartFrame>
  );
}

export function AttendanceVisual(props: VisualProps) {
  const { overview } = props;
  const lb = overview.leaderboard;
  const att = overview.attendance;
  const attendanceOk = att?.status === "ok" && att.data != null;
  return (
    <div className="space-y-3">
      <SectionShell<AttendanceData> title="Attendance today" section={att} emptyText="No attendance data for this date" errorName="Attendance">
        {(d) => {
          const b = buildAttendance(d, []);
          const slots = d.bySlot ?? [];
          return (
            <div className="space-y-3">
              <Tiles label="Attendance counts">
                <TileItem><StatTile label="Scheduled" value={formatCount(d.scheduled)} /></TileItem>
                <TileItem><StatTile label="Yet to start" value={formatCount(d.yetToStart)} /></TileItem>
                <TileItem><StatTile label="Late today" value={formatCount(d.totalLate)} /></TileItem>
                <TileItem><StatTile label="Week-off worked" value={formatCount(d.weekOffWorked)} /></TileItem>
              </Tiles>
              <Grid>
                <ChartFrame title="Present, absent and on leave" subtitle="Centre: shrinkage today" table={b.donutTable} height={180}>
                  <Donut {...b.donut} />
                  <p className="mt-2 text-[12px] text-slate-700"><Change text={shrinkageChange(d.shrinkagePct, d.previousDay)} /></p>
                </ChartFrame>
                <ChartFrame title="By process" subtitle="Shift slots summed, most absent first" table={b.byProcessTable} height={120}>
                  <StackedBar {...b.byProcess} onSelect={byLabel(b.byProcess.rows, selectByName(props, "attendance"))} />
                  <div className="mt-3">
                    {slots.length === 0 ? <p className="text-[12px] text-slate-700">No shift slots for this date.</p> : (
                      <Fold title="Shift-slot detail">
                        <DataTable table={{ caption: "Attendance by process and shift slot", columns: SLOT_COLUMNS,
                          rows: slots.map((r) => [r.process, r.shift, formatCount(r.planned), formatCount(r.present), formatCount(r.absent), formatCount(r.late)]) }} />
                      </Fold>
                    )}
                  </div>
                </ChartFrame>
                <ChartFrame title="Late arrivals by process" table={b.lateTable} height={96}>
                  <BarList {...b.late} onSelect={byLabel(b.late.items, selectByName(props, "late"))} />
                </ChartFrame>
                {lb ? <TeamLate lb={lb} /> : null}
              </Grid>
            </div>
          );
        }}
      </SectionShell>
      {!attendanceOk && lb && lb.status !== "empty" ? (
        <SectionShell<LeaderboardRow[]> title="Late arrivals by team" section={lb} emptyText="No late arrivals by team">
          {() => <TeamLate lb={lb} />}
        </SectionShell>
      ) : null}
    </div>
  );
}
