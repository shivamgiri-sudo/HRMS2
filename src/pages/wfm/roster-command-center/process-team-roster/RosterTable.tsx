import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { StatusPill } from "@/components/wfm/console/StatusPill";
import { hhmm, STATUS_LABEL, STATUS_TONE, type Member, type SortDir, type SortKey } from "./rosterModel";

const COLS: Array<{ key: SortKey; label: string; cls?: string }> = [
  { key: "name", label: "Employee" },
  { key: "status", label: "Status" },
  { key: "shift", label: "Shift" },
  { key: "clockIn", label: "Clock in", cls: "text-right" },
  { key: "clockOut", label: "Clock out", cls: "text-right" },
  { key: "branch", label: "Branch" },
  { key: "lob", label: "LOB" },
];
const GRID = "grid grid-cols-[minmax(180px,2fr)_minmax(150px,1.4fr)_minmax(130px,1.2fr)_84px_84px_minmax(110px,1fr)_minmax(90px,0.9fr)] items-center gap-x-3 px-3";
const ROW_H = 52;
const VIRTUALISE_OVER = 100;

function Row({ m, onOpen, style }: { m: Member; onOpen: (id: string) => void; style?: React.CSSProperties }) {
  return (
    <div
      role="row"
      tabIndex={0}
      style={style}
      onClick={() => onOpen(m.employeeId)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(m.employeeId); } }}
      aria-label={`${m.employeeName}, ${STATUS_LABEL[m.status]}. Open details`}
      className={`${GRID} min-h-[44px] cursor-pointer border-b border-border text-sm transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none`}
    >
      <div role="cell" className="min-w-0">
        <div className="truncate font-medium text-slate-900">{m.employeeName}</div>
        <div className="truncate text-xs tabular-nums text-slate-600">{m.employeeCode}</div>
      </div>
      <div role="cell">
        <StatusPill tone={STATUS_TONE[m.status]}>
          {STATUS_LABEL[m.status]}
          {m.status === "LATE" && m.minutesLate ? ` +${m.minutesLate}m` : ""}
          {m.status === "ON_LEAVE" && m.leaveType ? ` · ${m.leaveType}` : ""}
        </StatusPill>
      </div>
      <div role="cell" className="min-w-0">
        <div className="truncate text-slate-800">{m.shiftName ?? "—"}</div>
        <div className="text-xs tabular-nums text-slate-600">{m.shiftTime ?? "—"}</div>
      </div>
      <div role="cell" className="text-right tabular-nums text-slate-800">{hhmm(m.clockInTime)}</div>
      <div role="cell" className="text-right tabular-nums text-slate-800">{hhmm(m.clockOutTime)}</div>
      <div role="cell" className="truncate text-slate-800">{m.branchName ?? "—"}</div>
      <div role="cell" className="truncate text-slate-800">{m.lobName ?? "—"}</div>
    </div>
  );
}

export function RosterTable({ rows, sortKey, sortDir, onSort, onOpen }: {
  rows: Member[]; sortKey: SortKey; sortDir: SortDir; onSort: (k: SortKey) => void; onOpen: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = rows.length > VIRTUALISE_OVER;
  const v = useVirtualizer({ count: virtual ? rows.length : 0, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_H, overscan: 10 });

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <div role="table" aria-label="Team roster" aria-rowcount={rows.length + 1} className="min-w-[860px]">
        <div role="row" className={`${GRID} sticky top-0 z-10 border-b border-border bg-slate-50 py-2`}>
          {COLS.map((c) => {
            const active = sortKey === c.key;
            const Icon = !active ? ChevronsUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
            return (
              <div key={c.key} role="columnheader" aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"} className={c.cls}>
                <button type="button" onClick={() => onSort(c.key)}
                  className={`inline-flex min-h-[32px] cursor-pointer items-center gap-1 rounded text-xs font-semibold uppercase tracking-wide text-slate-700 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${c.cls === "text-right" ? "flex-row-reverse" : ""}`}>
                  {c.label}<Icon className="h-3 w-3" aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-600">No team members match the current filters</div>
        ) : virtual ? (
          <div ref={scrollRef} className="max-h-[560px] overflow-y-auto" data-testid="roster-scroll">
            <div style={{ height: v.getTotalSize(), position: "relative" }}>
              {v.getVirtualItems().map((vi) => (
                <Row key={rows[vi.index].employeeId} m={rows[vi.index]} onOpen={onOpen}
                  style={{ position: "absolute", top: 0, left: 0, width: "100%", height: ROW_H, transform: `translateY(${vi.start}px)` }} />
              ))}
            </div>
          </div>
        ) : (
          <div>{rows.map((m) => <Row key={m.employeeId} m={m} onOpen={onOpen} />)}</div>
        )}
      </div>
    </div>
  );
}

export default RosterTable;
