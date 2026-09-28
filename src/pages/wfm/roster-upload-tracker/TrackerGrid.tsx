import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cellCaption, coverageLabel, formatShortDate, formatDateTime, STATUS_META } from "./trackerFormat";
import {
  STATUS_ORDER,
  type PersonRef,
  type TrackerBranch,
  type TrackerCell,
  type TrackerFilters,
  type TrackerResponse,
  type UploadStatus,
} from "./trackerTypes";

export interface SelectedCell {
  branchId: string;
  processId: string;
  weekStart: string;
}

interface TrackerGridProps {
  data: TrackerResponse;
  statusFilter: TrackerFilters["status"];
  selected: SelectedCell | null;
  onSelect: (cell: SelectedCell) => void;
}

const names = (people: PersonRef[], fallback: string): string => {
  if (people.length === 0) return fallback;
  return people.length === 1 ? people[0].name : `${people[0].name} +${people.length - 1}`;
};

function countStatuses(cells: TrackerCell[]): Record<UploadStatus, number> {
  const counts: Record<UploadStatus, number> = { uploaded: 0, delayed: 0, partial: 0, missing: 0, due: 0 };
  cells.forEach((c) => { counts[c.status] += 1; });
  return counts;
}

function BranchRollup({ branch, weekIndex }: { branch: TrackerBranch; weekIndex: number }) {
  const counts = countStatuses(branch.processes.map((p) => p.cells[weekIndex]).filter(Boolean));
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-2 py-2 font-mono text-[11.5px]">
      {STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => (
        <span key={s} className={STATUS_META[s].pill.split(" ").find((c) => c.startsWith("text-"))}>
          {STATUS_META[s].glyph}{counts[s]}
        </span>
      ))}
    </div>
  );
}

export function TrackerGrid({ data, statusFilter, selected, onSelect }: TrackerGridProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (branchId: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(branchId)) next.delete(branchId); else next.add(branchId);
      return next;
    });

  if (data.branches.length === 0) {
    return (
      <div className="rounded-lg border bg-white p-10 text-center text-sm text-slate-500">
        No branch or process matches these filters.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="w-full min-w-[900px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-20 w-[250px] min-w-[250px] border-b border-r border-slate-400 bg-white px-3 py-2.5 text-left align-bottom">
              <div className="text-xs font-semibold text-slate-900">Branch / process</div>
              <div className="text-[11.5px] font-normal text-slate-500">WFM · reporting manager</div>
            </th>
            {data.weeks.map((week) => {
              const missing = week.counts.missing;
              return (
                <th key={week.weekStart} className="sticky top-0 z-10 min-w-[128px] border-b border-slate-400 bg-white px-2 py-2.5 text-left align-bottom">
                  <div className="font-mono text-[12.5px] font-semibold text-slate-900">
                    W/C {formatShortDate(week.weekStart)}
                    {week.isCurrent && (
                      <span className="ml-2 rounded border border-blue-600 px-1 py-px align-[1px] font-sans text-[9.5px] font-medium tracking-wider text-blue-700">
                        THIS WEEK
                      </span>
                    )}
                  </div>
                  <div className="text-[11.5px] font-normal text-slate-500">Deadline {formatDateTime(week.deadlineAtMs)}</div>
                  <div className={`mt-0.5 text-[11px] ${missing ? "font-medium text-red-700" : "text-slate-400"}`}>
                    {missing ? `${missing} missing` : "—"}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {data.branches.map((branch) => {
            const isOpen = !collapsed.has(branch.branchId);
            return (
              <BranchRows
                key={branch.branchId}
                branch={branch}
                isOpen={isOpen}
                onToggle={() => toggle(branch.branchId)}
                statusFilter={statusFilter}
                selected={selected}
                onSelect={onSelect}
                weekCount={data.weeks.length}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface BranchRowsProps {
  branch: TrackerBranch;
  isOpen: boolean;
  onToggle: () => void;
  statusFilter: TrackerFilters["status"];
  selected: SelectedCell | null;
  onSelect: (cell: SelectedCell) => void;
  weekCount: number;
}

function BranchRows({ branch, isOpen, onToggle, statusFilter, selected, onSelect, weekCount }: BranchRowsProps) {
  return (
    <>
      <tr>
        <td className="sticky left-0 z-[5] border-b border-r bg-slate-100 px-2 py-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={isOpen}
              aria-label={`${isOpen ? "Collapse" : "Expand"} ${branch.branchName}`}
              className="grid h-5 w-5 place-items-center rounded text-slate-600 hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
            >
              {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
            <div>
              <div className="font-semibold text-slate-900">{branch.branchName}</div>
              <div className={`text-[11.5px] ${branch.wfm.length ? "text-slate-500" : "text-red-600"}`}>
                WFM · {names(branch.wfm, "not mapped — nobody will be alerted")}
              </div>
            </div>
          </div>
        </td>
        {Array.from({ length: weekCount }, (_, i) => (
          <td key={i} className="border-b bg-slate-100"><BranchRollup branch={branch} weekIndex={i} /></td>
        ))}
      </tr>
      {isOpen && branch.processes.map((proc) => (
        <tr key={proc.processId}>
          <td className="sticky left-0 z-[5] border-b border-r bg-white py-2 pl-9 pr-2">
            <div className="font-medium text-slate-900">{proc.processName}</div>
            <div className={`text-[11.5px] ${proc.managers.length ? "text-slate-500" : "text-red-600"}`}>
              Mgr · {names(proc.managers, "not mapped")}
            </div>
          </td>
          {proc.cells.map((cell) => {
            const meta = STATUS_META[cell.status];
            const isSelected = selected?.branchId === proc.branchId && selected.processId === proc.processId && selected.weekStart === cell.weekStart;
            const dimmed = statusFilter !== "all" && cell.status !== statusFilter;
            return (
              <td key={cell.weekStart} className="border-b p-1">
                <button
                  type="button"
                  onClick={() => onSelect({ branchId: proc.branchId, processId: proc.processId, weekStart: cell.weekStart })}
                  aria-label={`${proc.branchName} ${proc.processName}, week of ${cell.weekStart}: ${meta.label}`}
                  className={`flex min-h-[44px] w-full flex-col justify-center rounded-md border px-2.5 py-1.5 text-left transition hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${meta.cell} ${isSelected ? "ring-2 ring-blue-600" : ""} ${dimmed ? "opacity-30" : ""}`}
                >
                  <span className="flex items-center gap-1.5 text-xs font-semibold">
                    <span aria-hidden="true">{meta.glyph}</span>
                    {meta.label}
                    {cell.status === "partial" && <span className="font-mono font-normal">· {coverageLabel(cell)}</span>}
                  </span>
                  <span className="font-mono text-[11px] opacity-90">{cellCaption(cell)}</span>
                </button>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
