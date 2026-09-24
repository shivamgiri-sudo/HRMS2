import { LobBadge } from "@/components/wfm/LobBadge";
import { Lock, Pencil } from "lucide-react";
import ShiftChoiceOptions from "./ShiftChoiceOptions";
import type { GridResponse, GridRow } from "@/hooks/useTeamRoster";
import {
  cellKey, choiceLabel, choiceValue, formatDmy, parseChoice, shiftKeyOf, storedLabel, weekdayShort,
  type CellChoice, type ShiftOption, type TemplateProcess,
} from "./teamRosterFormat";

/** A local, not-yet-saved edit. choice = null means "remove the proposed value for this cell". */
export interface StagedEdit { choice: CellChoice | null; reason: string | null }

export interface TeamRosterGridProps {
  data: GridResponse;
  today: string;
  templates: TemplateProcess[];
  staged: Record<string, StagedEdit>;
  onChoose: (row: GridRow, date: string, choice: CellChoice | null) => void;
  onProposeChange: (row: GridRow, date: string) => void;
}

export const stagedKey = cellKey;

export function shiftOptionsFor(processes: TemplateProcess[], processId: string | null): ShiftOption[] {
  return processes.find((p) => p.processId === processId)?.options ?? [];
}

function ChoiceSelect({ row, date, value, options, onChange }: {
  row: GridRow; date: string; value: string; options: ShiftOption[]; onChange: (v: string) => void;
}) {
  return (
    <select
      aria-label={`Roster for ${row.name} on ${formatDmy(date)}`}
      className="h-8 w-full min-w-[96px] rounded-md border border-slate-200 bg-white px-1 text-xs"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">-</option>
      <ShiftChoiceOptions options={options} />
    </select>
  );
}

function GridCellView({ row, date, props }: { row: GridRow; date: string; props: TeamRosterGridProps }) {
  const { today, staged, templates, onChoose, onProposeChange } = props;
  const cell = row.cells[date] ?? {};
  const options = shiftOptionsFor(templates, row.processId);
  const edit = staged[stagedKey(row.employeeId, date)];
  const draft: CellChoice | null = cell.draft ? { type: cell.draft.type, shiftKey: shiftKeyOf(cell.draft.shiftStart, cell.draft.shiftEnd) } : null;
  const proposed: CellChoice | null = edit !== undefined ? edit.choice : draft;
  const past = date < today;
  const locked = cell.lockedBy;
  const stored = cell.assignment ? storedLabel(cell.assignment) : null;
  const leaveBadge = cell.leave ? (
    <span title={cell.leave === "FULL" ? "Approved leave" : "Approved half-day leave"} className="ml-1 rounded bg-rose-100 px-1 text-[10px] font-semibold text-rose-700">
      {cell.leave === "FULL" ? "L" : "1/2 L"}
    </span>
  ) : null;
  const lockBadge = locked ? (
    <span title={`Pending with ${locked.submitter}${locked.submissionNo ? ` (${locked.submissionNo})` : ""}`} className="inline-flex items-center gap-0.5 rounded bg-slate-200 px-1 text-[10px] font-semibold text-slate-700">
      <Lock className="h-3 w-3" aria-hidden /> Pending
    </span>
  ) : null;

  if (locked) {
    return <div className="flex flex-wrap items-center gap-1">{stored && <span title={stored.long}>{stored.short}</span>}{lockBadge}{leaveBadge}</div>;
  }
  if (stored) {
    const label = proposed ? choiceLabel(proposed, options) : null;
    return (
      <div className={`flex flex-wrap items-center gap-1 rounded px-1 py-0.5 ${proposed ? "bg-amber-50 ring-1 ring-amber-300" : ""}`}>
        {proposed ? (
          <>
            <span className="text-slate-400 line-through" title={`Currently ${stored.long}`}>{stored.short}</span>
            <span className="font-semibold text-amber-800" title={label?.long}>{label?.short}</span>
          </>
        ) : (
          <span title={stored.long}>{stored.short}</span>
        )}
        {leaveBadge}
        {!past && (
          <button
            type="button"
            aria-label={`Propose change for ${row.name} on ${formatDmy(date)}`}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            onClick={() => onProposeChange(row, date)}
          >
            <Pencil className="h-3 w-3" aria-hidden />
          </button>
        )}
      </div>
    );
  }
  if (past) return <span className="text-slate-300">-</span>;
  return (
    <div className={`flex items-center gap-1 ${proposed ? "rounded ring-2 ring-amber-300" : ""}`}>
      <ChoiceSelect row={row} date={date} value={choiceValue(proposed)} options={options} onChange={(v) => onChoose(row, date, parseChoice(v))} />
      {leaveBadge}
    </div>
  );
}

export default function TeamRosterGrid(props: TeamRosterGridProps) {
  const { data, today } = props;
  if (data.rows.length === 0) {
    return <p className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">No team members match your search.</p>;
  }
  return (
    <div className="max-h-[68vh] overflow-auto rounded-xl border border-slate-200 bg-white">
      <table className="min-w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 min-w-[190px] border-b border-r bg-slate-50 px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400">Employee</th>
            {data.dates.map((d) => (
              <th key={d} className={`sticky top-0 z-20 min-w-[112px] border-b bg-slate-50 px-2 py-2 text-center ${d === today ? "text-blue-700" : "text-slate-600"}`}>
                <div className="font-semibold">{formatDmy(d)}</div>
                <div className="text-[10px] font-normal text-slate-400">{weekdayShort(d)}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.employeeId} className="hover:bg-slate-50/60">
              <th scope="row" className="sticky left-0 z-10 border-b border-r bg-white px-3 py-2 text-left font-normal">
                <div className="font-semibold text-slate-800">{row.name}</div>
                <div className="text-[11px] text-slate-500">{[row.code, row.processName].filter(Boolean).join(" - ")}</div>
                <LobBadge name={row.lobName} />
              </th>
              {data.dates.map((d) => (
                <td key={d} className="border-b px-1.5 py-1.5 align-middle"><GridCellView row={row} date={d} props={props} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
