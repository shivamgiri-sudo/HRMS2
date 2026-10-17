import type { BarListProps } from "../viz";
import type { AttendanceData } from "../panelTypes";
import { formatCount, formatPct } from "../format";
import { AccentCard, BarCell, NavyTable, PAL } from "../look";
import { nn } from "./shared";

type Slot = AttendanceData["bySlot"][number];

/** Absent share of planned for one slot, null when nothing was planned. */
export const slotShrink = (r: Pick<Slot, "planned" | "absent">): number | null => (nn(r.planned) > 0 ? (nn(r.absent) / nn(r.planned)) * 100 : null);

/** Email section 5 table: every process and shift slot with planned, present, absent, late and absent %. */
export function SlotTable({ d, onProcess }: { d: AttendanceData; onProcess: (name: string) => void }) {
  const slots = [...(d.bySlot ?? [])].sort((a, b) => a.process.localeCompare(b.process) || a.shift.localeCompare(b.shift));
  return (
      <AccentCard title="By process and shift slot" chip={`${slots.length} slots`} accent="blue">
        <NavyTable caption="Attendance by process and shift slot" rows={slots} limit={10} empty="No shift slots for this date"
          onRowClick={(r) => onProcess(r.process)} rowLabel={(r) => r.process}
          columns={[
            { key: "p", label: "Process", render: (r) => <span className="font-semibold">{r.process}</span> },
            { key: "s", label: "Shift", render: (r) => <span className="tabular-nums">{r.shift}</span> },
            { key: "pl", label: "Planned", num: true, render: (r) => formatCount(r.planned) },
            { key: "pr", label: "Present", num: true, render: (r) => formatCount(r.present) },
            { key: "ab", label: "Absent", num: true, render: (r) => formatCount(r.absent) },
            { key: "la", label: "Late", num: true, render: (r) => formatCount(r.late) },
            { key: "sh", label: "Absent %", num: true, render: (r) => <BarCell pct={slotShrink(r)} text={formatPct(slotShrink(r))} color={PAL.s2} /> },
          ]} />
      </AccentCard>
  );
}

/** Late arrivals by process, plus late people not on today's roster so the rows add up to the headline. */
export function LateTable({ d, late, onProcess }: { d: AttendanceData; late: BarListProps; onProcess: (name: string) => void }) {
  const maxLate = Math.max(1, ...late.items.map((i) => (Number.isFinite(i.value) ? i.value : 0)), nn(d.lateNotOnRoster));
  const lateRows: Array<{ label: string; value: number; process: boolean }> = [
    ...late.items.map((i) => ({ label: i.label, value: i.value, process: true })),
    ...(nn(d.lateNotOnRoster) > 0 ? [{ label: "Not on today's roster", value: nn(d.lateNotOnRoster), process: false }] : []),
  ];
  return (
      <AccentCard title="Late arrivals by process" chip={`${formatCount(d.totalLate)} late`} accent="orange">
        <NavyTable caption="Late arrivals by process, including late people not on today's roster" rows={lateRows} limit={10} empty="Nobody was late today"
          onRowClick={(r) => { if (r.process) onProcess(r.label); }} rowLabel={(r) => r.label}
          columns={[
            { key: "p", label: "Process", render: (r) => (r.process ? <span className="font-semibold">{r.label}</span> : <em>{r.label}</em>) },
            { key: "l", label: "Late", num: true, render: (r) => <BarCell pct={(r.value / maxLate) * 100} text={formatCount(r.value)} color={PAL.s4} /> },
          ]} />
        <p className="bhl-note">Late arrivals add up to the headline {formatCount(d.totalLate)}, including {formatCount(d.lateNotOnRoster)} people with no planned shift today.</p>
      </AccentCard>
  );
}
