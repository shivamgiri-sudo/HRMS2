import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { StatusPill } from "@/components/wfm/console/StatusPill";
import { SeverityPill } from "./ComplianceDrawer";
import { fmtDate, SEVERITY_ORDER } from "./format";
import type { DrawerTarget, FeedRow } from "./types";

type SortKey = "date" | "employeeName" | "branchName" | "ruleName" | "severity";

const COLS: Array<{ key: SortKey; label: string; className?: string }> = [
  { key: "date", label: "Date" },
  { key: "employeeName", label: "Employee" },
  { key: "branchName", label: "Branch" },
  { key: "ruleName", label: "Rule" },
  { key: "severity", label: "Severity" },
];

/** Sorts within the loaded page only; paging and filtering are server-side. */
export function sortRows(rows: FeedRow[], key: SortKey, dir: "asc" | "desc"): FeedRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const val = (r: FeedRow) => (key === "severity" ? SEVERITY_ORDER[r.severity] ?? 9 : String(r[key] ?? "").toLowerCase());
  return [...rows].sort((a, b) => {
    const x = val(a); const y = val(b);
    return (x < y ? -1 : x > y ? 1 : 0) * sign;
  });
}

export function ViolationsTable({ rows, onOpen }: { rows: FeedRow[]; onOpen: (t: DrawerTarget) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "date", dir: "desc" });
  const sorted = useMemo(() => sortRows(rows, sort.key, sort.dir), [rows, sort]);
  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "date" || key === "severity" ? "desc" : "asc" }));
  return (
    <div className="max-h-[520px] overflow-auto rounded-md border border-border">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="sticky top-0 z-10 bg-muted">
          <tr>
            {COLS.map((c) => {
              const active = sort.key === c.key;
              const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
              return (
                <th key={c.key} scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className="px-3 py-2 text-left text-xs font-semibold text-slate-700">
                  <button type="button" onClick={() => toggle(c.key)} className="inline-flex min-h-[32px] cursor-pointer items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {c.label}<Icon className="h-3 w-3" aria-hidden />
                  </button>
                </th>
              );
            })}
            <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-slate-700">Detail</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sorted.map((r) => (
            <tr
              key={r.violationId}
              tabIndex={0}
              onClick={() => onOpen({ type: "employee", id: r.employeeId })}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen({ type: "employee", id: r.employeeId }); } }}
              aria-label={`Open ${r.employeeName} compliance detail`}
              className="cursor-pointer hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDate(r.date)}</td>
              <td className="px-3 py-2"><span className="font-medium text-slate-900">{r.employeeName}</span><span className="ml-2 text-xs tabular-nums text-slate-600">{r.employeeCode}</span></td>
              <td className="px-3 py-2 text-slate-700">{r.branchName ?? "—"}</td>
              <td className="px-3 py-2"><StatusPill tone="neutral" dot={false}>{r.ruleName}</StatusPill></td>
              <td className="px-3 py-2"><SeverityPill s={r.severity} /></td>
              <td className="max-w-[320px] truncate px-3 py-2 text-xs text-slate-700" title={r.details}>{r.details}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
