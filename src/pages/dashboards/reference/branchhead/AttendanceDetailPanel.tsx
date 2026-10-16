import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import type { SectionResult } from "../../../../../backend/src/modules/branch-head-health/types";
import type { AttendanceData } from "./panelTypes";
import { formatCount, formatPct } from "./format";
import { Note, SectionShell, Stat, Stats, SubHead, Table, Td } from "./ui";

function Change({ now, prev }: { now: number; prev: AttendanceData["previousDay"] }) {
  if (!prev) return <>No data for yesterday</>;
  const delta = Math.round((now - prev.shrinkagePct) * 10) / 10;
  if (delta === 0) return <span className="inline-flex items-center gap-1"><Minus className="h-3.5 w-3.5" aria-hidden="true" />0.0 pts, no change vs yesterday ({formatPct(prev.shrinkagePct)})</span>;
  const up = delta > 0;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {up ? "+" : "-"}{Math.abs(delta).toFixed(1)} pts, {up ? "up" : "down"} vs yesterday ({formatPct(prev.shrinkagePct)})
    </span>
  );
}

export function AttendanceDetailPanel({ section }: { section?: SectionResult<unknown> }) {
  return (
    <SectionShell<AttendanceData> title="Attendance detail" section={section} emptyText="No attendance data for this date">
      {(d) => (
        <>
          <Stats label="Attendance today">
            <Stat label="Scheduled" value={formatCount(d.scheduled)} />
            <Stat label="Present" value={formatCount(d.present)} />
            <Stat label="Absent" value={formatCount(d.absent)} />
            <Stat label="On leave" value={formatCount(d.onLeave)} />
            <Stat label="Shrinkage" value={formatPct(d.shrinkagePct)} hint={<Change now={d.shrinkagePct} prev={d.previousDay} />} />
            <Stat label="Yet to start" value={formatCount(d.yetToStart)} />
            <Stat label="Late today" value={formatCount(d.totalLate)} />
            <Stat label="Week-off worked" value={formatCount(d.weekOffWorked)} />
          </Stats>
          <SubHead>By shift slot</SubHead>
          {d.bySlot.length === 0 ? <Note>No shift slots for this date.</Note> : (
            <Table caption="Attendance by process and shift slot" cols={[{ label: "Process" }, { label: "Shift" }, { label: "Planned", right: true }, { label: "Present", right: true }, { label: "Absent", right: true }, { label: "Late", right: true }]} minWidth={520}>
              {d.bySlot.map((r) => <tr key={`${r.process}|${r.shift}`}><Td strong>{r.process}</Td><Td>{r.shift}</Td><Td right>{r.planned}</Td><Td right>{r.present}</Td><Td right>{r.absent}</Td><Td right>{r.late}</Td></tr>)}
            </Table>
          )}
          <SubHead>Late arrivals by process</SubHead>
          {d.processWise.length === 0 ? <Note>No late arrivals recorded.</Note> : (
            <Table caption="Late arrivals by process" cols={[{ label: "Process" }, { label: "Late", right: true }]} minWidth={240}>
              {d.processWise.map((r) => <tr key={r.process}><Td strong>{r.process}</Td><Td right>{r.late}</Td></tr>)}
            </Table>
          )}
        </>
      )}
    </SectionShell>
  );
}
