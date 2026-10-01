import { useState } from "react";
import { AlertTriangle, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Coverage, CoverageCounts, CoverageKind, CoverageRow } from "@/hooks/useTeamRoster";
import { formatDmy, weekdayShort, type CellType } from "./teamRosterFormat";

export interface CellEdit { employeeId: string; date: string; type: CellType; shiftStart?: string | null; shiftEnd?: string | null; reason?: string }

const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const heat = (p: number) => (p >= 30 ? "bg-red-100 text-red-800" : p >= 20 ? "bg-amber-100 text-amber-800" : "bg-emerald-50 text-emerald-800");
const KIND_CLASS: Record<CoverageKind, string> = {
  SHIFT: "bg-slate-50 text-slate-800", WEEK_OFF: "bg-sky-100 text-sky-800", LEAVE: "bg-rose-100 text-rose-800",
  TRAINING: "bg-violet-100 text-violet-800", UNSCHEDULED: "bg-orange-100 text-orange-800", UNASSIGNED: "bg-white text-slate-300",
};
const COMPOSITION: Array<{ kind: CoverageKind; label: string; bar: string }> = [
  { kind: "SHIFT", label: "Working shift", bar: "bg-emerald-500" }, { kind: "WEEK_OFF", label: "Week off", bar: "bg-sky-500" },
  { kind: "LEAVE", label: "Leave", bar: "bg-rose-500" }, { kind: "TRAINING", label: "Training", bar: "bg-violet-500" },
  { kind: "UNSCHEDULED", label: "Unscheduled", bar: "bg-orange-500" }, { kind: "UNASSIGNED", label: "Not rostered", bar: "bg-slate-300" },
];
const delta = (b: number, a: number) => (a === b ? <span className="text-slate-300">{a}</span> : <span><span className="text-slate-400">{b}</span> <span aria-hidden>{"->"}</span> <span className={`font-semibold ${a > b ? "text-emerald-700" : "text-red-700"}`}>{a}</span></span>);
const th = "whitespace-nowrap px-2 py-1.5 text-center font-medium";
const sticky = "sticky left-0 z-10 bg-white px-2 py-1.5 text-left font-medium";

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${tone ?? "bg-white"}`}>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-lg font-bold leading-tight">{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

function Block({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">{title}</p>{hint && <span className="text-[11px] text-slate-400">{hint}</span>}</div>
      {children}
    </section>
  );
}

function CellEditor({ row, cell, options, busy, onSave, children }: {
  row: CoverageRow; cell: CoverageRow["cells"][number]; options: Coverage["shiftOptions"][string]; busy: boolean;
  onSave: (e: CellEdit) => Promise<unknown>; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState("");
  const [reason, setReason] = useState("");
  const save = async () => {
    if (!choice) return;
    const [type, key] = choice.split(":");
    const [start, end] = (key ?? "").split("-");
    await onSave({ employeeId: row.employeeId, date: cell.date, type: type as CellType, shiftStart: start || null, shiftEnd: end || null, reason: reason.trim() || undefined });
    setOpen(false); setChoice(""); setReason("");
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-72 space-y-2 p-3" align="start">
        <div className="text-sm font-semibold">{row.employeeName} - {formatDmy(cell.date)}</div>
        <div className="text-xs text-slate-500">Now: {cell.label}{cell.changed && cell.was ? ` (was ${cell.was})` : ""}</div>
        <select aria-label="New assignment" className="w-full rounded-md border px-2 py-1.5 text-sm" value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="">Choose new assignment</option>
          {options.length > 0 && <optgroup label="Shifts">{options.map((o) => <option key={o.key} value={`SHIFT:${o.key}`}>{o.label}</option>)}</optgroup>}
          <optgroup label="Other"><option value="WEEK_OFF">Week off</option><option value="TRAINING">Training</option><option value="UNSCHEDULED">Unscheduled</option></optgroup>
        </select>
        <input aria-label="Reason" className="w-full rounded-md border px-2 py-1.5 text-sm" placeholder="Reason (min 8 chars to change a rostered day)" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button size="sm" className="w-full" disabled={busy || !choice} onClick={save}>Save change</Button>
        <p className="text-[11px] text-slate-400">Picking what the roster already has undoes the proposed change for this day.</p>
      </PopoverContent>
    </Popover>
  );
}

export default function SubmissionCoverage({ coverage: c, canEdit, busy, onEdit }: { coverage: Coverage; canEdit: boolean; busy: boolean; onEdit: (e: CellEdit) => Promise<unknown> }) {
  const s = c.summary;
  const shiftKeys = c.shiftTotals.map((t) => t.key);
  const lines: Array<{ key: CoverageKind; label: string }> = [
    { key: "WEEK_OFF", label: "Week off" }, { key: "LEAVE", label: "Leave" }, { key: "TRAINING", label: "Training" }, { key: "UNSCHEDULED", label: "Unscheduled" },
  ];
  const hot = c.perDate.filter((d) => d.shrinkageAfterPct >= 30);
  const worse = c.perDate.filter((d) => d.shrinkageAfterPct > d.shrinkageBeforePct + 5);
  const grand = (x: CoverageCounts) => Object.values(x).reduce((a, b) => a + b, 0) || 1;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
        <Tile label="Team size" value={String(c.teamSize)} sub={c.teamTruncated ? "team list truncated" : `${s.employeesAffected} affected`} />
        <Tile label="Avg shrinkage" value={`${s.avgShrinkageAfterPct}%`} sub={`was ${s.avgShrinkageBeforePct}%`} tone={heat(s.avgShrinkageAfterPct)} />
        <Tile label="Peak shrinkage" value={`${s.peakShrinkagePct}%`} sub={s.peakDate ? formatDmy(s.peakDate) : undefined} tone={heat(s.peakShrinkagePct)} />
        <Tile label="Min on floor" value={String(s.minOnFloorAfter)} sub="lowest daily head count" />
        <Tile label="Leave days" value={String(c.leave.totalLeaveDays)} sub={`${c.leave.employees.length} people`} />
        <Tile label="Streak breaches" value={String(s.streakBreaches)} sub={`> ${s.maxStreakAllowed} days in a row`} tone={s.streakBreaches ? "bg-amber-100 text-amber-800" : undefined} />
      </div>

      {(hot.length > 0 || worse.length > 0 || s.streakBreaches > 0) && (
        <ul className="space-y-1 text-sm">
          {hot.length > 0 && <li className="flex gap-2 rounded-md bg-red-50 px-2 py-1.5 text-red-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Shrinkage at or above 30% on {hot.map((d) => `${dm(d.date)} (${d.shrinkageAfterPct}%)`).join(", ")}.</li>}
          {worse.length > 0 && <li className="flex gap-2 rounded-md bg-amber-50 px-2 py-1.5 text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />This submission raises shrinkage by more than 5 points on {worse.map((d) => dm(d.date)).join(", ")}.</li>}
          {s.streakBreaches > 0 && <li className="flex gap-2 rounded-md bg-amber-50 px-2 py-1.5 text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{s.streakBreaches} employee(s) would work more than {s.maxStreakAllowed} days in a row.</li>}
        </ul>
      )}

      <Block title="Date-wise coverage and shrinkage" hint={`Whole team (${c.teamSize}); old -> new after this submission`}>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500"><tr><th className={`${sticky} bg-slate-50`}>Metric</th>{c.perDate.map((d) => <th key={d.date} className={th}>{dm(d.date)}<div className="text-[10px] font-normal text-slate-400">{weekdayShort(d.date)}</div></th>)}</tr></thead>
            <tbody>
              <tr className="border-t"><td className={sticky}>Team head count</td>{c.perDate.map((d) => <td key={d.date} className="px-2 py-1.5 text-center">{d.headcount}</td>)}</tr>
              <tr className="border-t"><td className={sticky}>On floor (any shift)</td>{c.perDate.map((d) => <td key={d.date} className="px-2 py-1.5 text-center">{delta(d.onFloorBefore, d.onFloorAfter)}</td>)}</tr>
              {shiftKeys.map((k) => (
                <tr key={k} className="border-t text-slate-600"><td className={`${sticky} pl-5 font-normal`}>{k}</td>{c.perDate.map((d) => <td key={d.date} className="px-2 py-1.5 text-center">{delta(d.shifts[k]?.before ?? 0, d.shifts[k]?.after ?? 0)}</td>)}</tr>
              ))}
              {lines.map((l) => (
                <tr key={l.key} className="border-t"><td className={sticky}>{l.label}</td>{c.perDate.map((d) => <td key={d.date} className="px-2 py-1.5 text-center">{delta(d.before[l.key], d.after[l.key])}</td>)}</tr>
              ))}
              <tr className="border-t font-semibold"><td className={sticky}>Shrinkage % (was)</td>{c.perDate.map((d) => <td key={d.date} className={`px-2 py-1.5 text-center ${heat(d.shrinkageBeforePct)}`}>{d.shrinkageBeforePct}%</td>)}</tr>
              <tr className="border-t font-semibold"><td className={sticky}>Shrinkage % (after)</td>{c.perDate.map((d) => <td key={d.date} className={`px-2 py-1.5 text-center ${heat(d.shrinkageAfterPct)}`}>{d.shrinkageAfterPct}%</td>)}</tr>
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[11px] text-slate-400">Shrinkage = week off + leave + training + unscheduled, as a share of the team. Green under 20%, amber 20-30%, red 30% and over.</p>
      </Block>

      <Block title="Proposed roster" hint={canEdit ? "Click a cell to change that person's shift for that date" : "Changed cells are highlighted"}>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500"><tr><th className={`${sticky} bg-slate-50`}>Employee</th>{c.dates.map((d) => <th key={d} className={th}>{dm(d)}<div className="text-[10px] font-normal text-slate-400">{weekdayShort(d)}</div></th>)}<th className={th}>WO</th><th className={th}>Max run</th></tr></thead>
            <tbody>
              {c.rows.map((r) => (
                <tr key={r.employeeId} className="border-t">
                  <td className={sticky}><div className="whitespace-nowrap font-medium">{r.employeeName}</div><div className="text-[10px] font-normal text-slate-400">{[r.employeeCode, r.processName].filter(Boolean).join(" - ")}</div></td>
                  {r.cells.map((cell) => {
                    const body = (
                      <button type="button" disabled={!canEdit} title={cell.changed ? `Was ${cell.was}` : cell.label}
                        className={`group relative block w-full min-w-[68px] rounded px-1.5 py-1 text-center ${KIND_CLASS[cell.kind]} ${cell.changed ? "ring-2 ring-amber-400" : ""} ${canEdit ? "cursor-pointer hover:brightness-95" : "cursor-default"}`}>
                        <span className="font-medium">{cell.label}</span>
                        {cell.changed && cell.was && <span className="block text-[10px] text-slate-500 line-through">{cell.was}</span>}
                        {canEdit && <Pencil className="absolute right-0.5 top-0.5 hidden h-2.5 w-2.5 text-slate-400 group-hover:block" aria-hidden />}
                      </button>
                    );
                    return (
                      <td key={cell.date} className="p-0.5">
                        {canEdit && cell.kind !== "LEAVE"
                          ? <CellEditor row={r} cell={cell} options={c.shiftOptions[r.processId ?? ""] ?? []} busy={busy} onSave={onEdit}>{body}</CellEditor>
                          : body}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5 text-center">{delta(r.weekOffsBefore, r.weekOffs)}</td>
                  <td className={`px-2 py-1.5 text-center ${r.streakBreach ? "font-bold text-amber-700" : ""}`}>{r.maxStreak}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>

      <div className="grid gap-6 lg:grid-cols-2">
        <Block title="Team composition over the window" hint="share of person-days">
          <div className="space-y-2">
            {(["before", "after"] as const).map((w) => (
              <div key={w}>
                <div className="mb-0.5 text-[11px] text-slate-500">{w === "before" ? "Today" : "After this submission"}</div>
                <div className="flex h-4 overflow-hidden rounded">
                  {COMPOSITION.map((x) => <div key={x.kind} className={x.bar} style={{ width: `${(c.composition[w][x.kind] / grand(c.composition[w])) * 100}%` }} title={`${x.label}: ${c.composition[w][x.kind]}`} />)}
                </div>
              </div>
            ))}
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600">
              {COMPOSITION.map((x) => <span key={x.kind} className="flex items-center gap-1"><span className={`inline-block h-2 w-2 rounded-sm ${x.bar}`} />{x.label} {c.composition.before[x.kind]} {"->"} {c.composition.after[x.kind]}</span>)}
            </div>
          </div>
        </Block>
        <Block title="What this submission changes">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded border px-2 py-1.5"><dt className="text-[11px] text-slate-500">To a shift</dt><dd className="font-semibold">{c.changeMix.toShift}</dd></div>
            <div className="rounded border px-2 py-1.5"><dt className="text-[11px] text-slate-500">To week off</dt><dd className="font-semibold">{c.changeMix.toWeekOff}</dd></div>
            <div className="rounded border px-2 py-1.5"><dt className="text-[11px] text-slate-500">To training</dt><dd className="font-semibold">{c.changeMix.toTraining}</dd></div>
            <div className="rounded border px-2 py-1.5"><dt className="text-[11px] text-slate-500">To unscheduled</dt><dd className="font-semibold">{c.changeMix.toUnscheduled}</dd></div>
          </dl>
        </Block>
      </div>

      <Block title="Shift-wise totals" hint="person-days on each shift across the window">
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-2 py-1.5">Shift</th><th className="px-2 py-1.5 text-right">Today</th><th className="px-2 py-1.5 text-right">After</th><th className="px-2 py-1.5 text-right">Change</th></tr></thead>
            <tbody>
              {c.shiftTotals.length === 0 && <tr><td colSpan={4} className="px-2 py-2 text-slate-400">No shifts rostered in this window.</td></tr>}
              {c.shiftTotals.map((t) => <tr key={t.key} className="border-t"><td className="px-2 py-1.5">{t.key}</td><td className="px-2 py-1.5 text-right">{t.before}</td><td className="px-2 py-1.5 text-right">{t.after}</td><td className={`px-2 py-1.5 text-right font-medium ${t.after > t.before ? "text-emerald-700" : t.after < t.before ? "text-red-700" : "text-slate-400"}`}>{t.after - t.before > 0 ? "+" : ""}{t.after - t.before}</td></tr>)}
            </tbody>
          </table>
        </div>
      </Block>

      <Block title="By process" hint="shrinkage averaged over the window">
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-2 py-1.5">Process</th><th className="px-2 py-1.5 text-right">People</th><th className="px-2 py-1.5 text-right">Avg was</th><th className="px-2 py-1.5 text-right">Avg after</th><th className="px-2 py-1.5 text-right">Peak after</th><th className="px-2 py-1.5 text-right">Min on floor</th></tr></thead>
            <tbody>
              {c.byProcess.map((p) => <tr key={p.processId ?? "none"} className="border-t"><td className="px-2 py-1.5">{p.processName}</td><td className="px-2 py-1.5 text-right">{p.headcount}</td><td className="px-2 py-1.5 text-right">{p.avgShrinkageBeforePct}%</td><td className={`px-2 py-1.5 text-right ${heat(p.avgShrinkageAfterPct)}`}>{p.avgShrinkageAfterPct}%</td><td className={`px-2 py-1.5 text-right ${heat(p.peakShrinkageAfterPct)}`}>{p.peakShrinkageAfterPct}%</td><td className="px-2 py-1.5 text-right">{p.minOnFloorAfter}</td></tr>)}
            </tbody>
          </table>
        </div>
      </Block>

      <Block title={`Approved leave in this window (${c.leave.employees.length})`}>
        {c.leave.employees.length === 0 ? <p className="text-sm text-slate-400">None</p> : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-2 py-1.5">Employee</th><th className="px-2 py-1.5">Process</th><th className="px-2 py-1.5 text-right">Days</th><th className="px-2 py-1.5">Dates</th></tr></thead>
              <tbody>
                {c.leave.employees.map((l) => <tr key={l.employeeId} className="border-t align-top"><td className="px-2 py-1.5"><span className="font-medium">{l.employeeName}</span> <span className="text-slate-400">{l.employeeCode}</span></td><td className="px-2 py-1.5">{l.processName ?? "None"}</td><td className="px-2 py-1.5 text-right">{l.dates.length}{l.halfDays ? ` (${l.halfDays} half)` : ""}</td><td className="px-2 py-1.5">{l.dates.map(dm).join(", ")}</td></tr>)}
              </tbody>
            </table>
          </div>
        )}
      </Block>
    </div>
  );
}
