import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { StatusPill } from "@/components/wfm/console/StatusPill";
import { cn } from "@/lib/utils";
import {
  OWNER_LABEL, PRIORITY_LABEL, TIER_LABEL, TIER_TONE, fmtDate, sortCases, topRecommendation,
  type CaseRow, type SortKey, type SortState,
} from "./calc";

const GRID = "grid grid-cols-[minmax(180px,2fr)_92px_64px_minmax(220px,3fr)_110px_100px_84px_92px] items-center gap-3 px-3";
const ROW_H = 56;

const COLS: Array<{ key: SortKey; label: string; right?: boolean }> = [
  { key: "employee", label: "Employee" }, { key: "tier", label: "Risk" }, { key: "score", label: "Score", right: true },
  { key: "action", label: "Top action" }, { key: "owner", label: "Owner" },
];

export function CaseStatus({ row }: { row: CaseRow }) {
  if (row.outcome === "retained") return <StatusPill tone="green">Retained</StatusPill>;
  if (row.outcome === "exited") return <StatusPill tone="red">Exited</StatusPill>;
  if (row.actionTaken) return <StatusPill tone="violet">Actioned</StatusPill>;
  if (row.overdue) return <StatusPill tone="red">Overdue</StatusPill>;
  return <StatusPill tone="amber">Open</StatusPill>;
}

export default function InterventionTable({ rows, onOpen }: { rows: CaseRow[]; onOpen: (r: CaseRow) => void }) {
  const [sort, setSort] = useState<SortState>({ key: "tier", dir: "asc" });
  const sorted = useMemo(() => sortCases(rows, sort), [rows, sort]);
  const parent = useRef<HTMLDivElement>(null);
  // Virtualised so a 200-row page stays cheap; rows are fixed-height to avoid measuring.
  const v = useVirtualizer({ count: sorted.length, getScrollElement: () => parent.current, estimateSize: () => ROW_H, overscan: 8 });
  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "score" || key === "age" ? "desc" : "asc" }));
  const head = (key: SortKey, label: string, right?: boolean) => {
    const active = sort.key === key;
    const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <button key={key} type="button" onClick={() => toggle(key)}
        aria-label={`Sort by ${label}`}
        className={cn("flex min-h-[44px] cursor-pointer items-center gap-1 text-left text-[11px] font-bold uppercase tracking-wide text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0", right && "justify-end text-right")}>
        {label}<Icon className="h-3 w-3" aria-hidden />
      </button>
    );
  };
  return (
    <div role="table" aria-label="Retention intervention cases" aria-rowcount={sorted.length + 1} className="overflow-x-auto">
      <div className="min-w-[900px]">
        <div role="row" className={cn(GRID, "sticky top-0 z-10 border-b border-border bg-muted/60 py-2 backdrop-blur")}>
          {COLS.map((c) => <div key={c.key} role="columnheader">{head(c.key, c.label, c.right)}</div>)}
          <div role="columnheader">{head("age", "Age", true)}</div>
          <div role="columnheader" className="text-[11px] font-bold uppercase tracking-wide text-slate-600">Status</div>
          <div role="columnheader" className="text-right text-[11px] font-bold uppercase tracking-wide text-slate-600">Generated</div>
        </div>
        <div ref={parent} className="max-h-[560px] overflow-y-auto" role="rowgroup">
          <div style={{ height: v.getTotalSize(), position: "relative" }}>
            {v.getVirtualItems().map((vi) => {
              const r = sorted[vi.index];
              const top = topRecommendation(r.recommendations);
              return (
                <div key={r.id} role="row" tabIndex={0} aria-label={`Open case for ${r.employeeName}`}
                  onClick={() => onOpen(r)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(r); } }}
                  className={cn(GRID, "absolute left-0 w-full cursor-pointer border-b border-border text-sm hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring")}
                  style={{ height: ROW_H, transform: `translateY(${vi.start}px)` }}>
                  <div role="cell" className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">{r.employeeName || "—"}</p>
                    <p className="truncate text-xs text-slate-600">{[r.employeeCode, r.processName, r.branchName].filter(Boolean).join(" · ") || "—"}</p>
                  </div>
                  <div role="cell"><StatusPill tone={TIER_TONE[r.riskTier]}>{TIER_LABEL[r.riskTier]}</StatusPill></div>
                  <div role="cell" className="text-right font-semibold tabular-nums">{r.score}</div>
                  <div role="cell" className="min-w-0">
                    <p className="line-clamp-2 text-xs text-slate-800">{top?.action ?? "No recommendation"}</p>
                    {top && <p className="text-[11px] text-slate-600">{PRIORITY_LABEL[top.priority]}</p>}
                  </div>
                  <div role="cell" className="truncate text-xs text-slate-800">{top ? OWNER_LABEL[top.owner] : "—"}</div>
                  <div role="cell" className="text-right text-xs tabular-nums text-slate-800">{r.ageDays}d</div>
                  <div role="cell"><CaseStatus row={r} /></div>
                  <div role="cell" className="text-right text-xs tabular-nums text-slate-700">{fmtDate(r.generatedAt)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
