/**
 * AgentPerformanceTable — Sortable table showing agent-level performance metrics.
 * Columns: agent_name, quality%, calls, risk_score, coaching_needed.
 */
import { useState } from "react";
import { ChevronUp, ChevronDown, Loader, AlertTriangle, BookOpen } from "lucide-react";
import { useAgentPerformance, type AgentPerformance } from "@/hooks/useManagementDashboard";

type SortKey = keyof Pick<AgentPerformance, "agent_name" | "quality_pct" | "calls" | "risk_score">;
type SortDir = "asc" | "desc";

function QualityBadge({ score }: { score: number }) {
  const cls =
    score >= 80
      ? "bg-emerald-50 text-emerald-700"
      : score >= 70
      ? "bg-amber-50 text-amber-700"
      : "bg-red-50 text-red-700";
  return <span className={`rounded-full px-3 py-1 text-xs font-bold ${cls}`}>{score.toFixed(1)}%</span>;
}

function RiskBadge({ score }: { score: number }) {
  const cls =
    score <= 30
      ? "bg-emerald-50 text-emerald-700"
      : score <= 60
      ? "bg-amber-50 text-amber-700"
      : "bg-red-50 text-red-700";
  const label = score <= 30 ? "Low" : score <= 60 ? "Medium" : "High";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${cls}`}>{label} ({score})</span>;
}

function SortIcon({ col, active, dir }: { col: string; active: string; dir: SortDir }) {
  if (col !== active) return <ChevronDown className="inline h-3 w-3 opacity-30" />;
  return dir === "asc"
    ? <ChevronUp className="inline h-3 w-3 text-blue-600" />
    : <ChevronDown className="inline h-3 w-3 text-blue-600" />;
}

export function AgentPerformanceTable() {
  const [sortKey, setSortKey] = useState<SortKey>("quality_pct");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { data, isLoading, error } = useAgentPerformance(sortKey);

  function handleSort(col: SortKey) {
    if (col === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col);
      setSortDir("desc");
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
        Failed to load agent performance: {error.message}
      </div>
    );
  }

  const rows = [...(data ?? [])].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    if (typeof aVal === "string" && typeof bVal === "string") {
      return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    const diff = (aVal as number) - (bVal as number);
    return sortDir === "asc" ? diff : -diff;
  });

  const COLS: { key: SortKey; label: string }[] = [
    { key: "agent_name", label: "Agent" },
    { key: "quality_pct", label: "Quality %" },
    { key: "calls", label: "Calls" },
    { key: "risk_score", label: "Risk Score" },
  ];

  if (rows.length === 0) {
    return (
      <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        <div className="py-16 text-center text-slate-400">
          <BookOpen className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p className="font-semibold">No agent performance data available.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              {COLS.map((col) => (
                <th
                  key={col.key}
                  className="cursor-pointer select-none p-4 font-semibold hover:text-slate-800"
                  onClick={() => handleSort(col.key)}
                >
                  {col.label} <SortIcon col={col.key} active={sortKey} dir={sortDir} />
                </th>
              ))}
              <th className="p-4 font-semibold">Coaching</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.agent_id} className="border-t transition-colors hover:bg-slate-50/80">
                <td className="p-4">
                  <div className="font-bold text-slate-950">{row.agent_name}</div>
                  <div className="font-mono text-xs text-slate-400">{row.agent_id}</div>
                </td>
                <td className="p-4">
                  <QualityBadge score={row.quality_pct} />
                </td>
                <td className="p-4 font-mono text-slate-700">{row.calls.toLocaleString()}</td>
                <td className="p-4">
                  <RiskBadge score={row.risk_score} />
                </td>
                <td className="p-4">
                  {row.coaching_needed ? (
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">
                      Needed
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                      OK
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
